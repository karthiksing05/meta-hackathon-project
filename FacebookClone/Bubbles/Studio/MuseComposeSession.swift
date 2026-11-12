import Foundation

/// One compose run's agent loop: Muse Wonder plans and composes with Studio's tools
/// (`StudioTools`), Ember writes bulk content, the runtime validates and playtests, and failures go
/// back to Wonder for at most two repair rounds. Spark 1.3 takes over if Wonder stops answering.
///
/// Used from a single task: tool calls in one turn run in order, except `write_content` calls,
/// which run concurrently.
final class MuseComposeSession {
    struct Options: Sendable {
        var maxTurns = 9
        var maxRepairRounds = 2
        /// Seconds for the whole agent loop before Studio finishes on its own.
        var budget: TimeInterval = 120
        /// Seconds per Wonder turn (per attempt). No turn outlives the budget.
        var turnTimeout: TimeInterval = 60
        var plannerTokens = 16_000
        var contentTokens = 8_000
        var coverTimeout: TimeInterval = 90
    }

    struct Outcome: Sendable {
        var manifest: BubbleManifest
        var validation: BubbleJSRuntime.Validation
        var playtest: StudioPlaytest.Report?
        var comparison: StudioPlaytest.Comparison?
        /// Honest notes when Studio shipped with soft flags or had to fix things itself.
        var notes: [String]
        /// Daily Bubbles and Icebreakers: authors of the sources used.
        var sourcesUsed: [String]
        var turns: Int
        var filledDefaults: Int
    }

    enum SessionError: Error, LocalizedError {
        case noPassingDraft(String)

        var errorDescription: String? {
            switch self {
            case .noPassingDraft(let reason): return "Muse didn't produce a draft that passed checks (\(reason))."
            }
        }
    }

    private enum Difficulty { case harder, easier }

    let request: StudioRequest
    let brief: BubbleBrief
    let catalog: StudioCatalog
    let client: MuseClient
    let runtime: StudioRuntime
    let timeline: StudioTimeline
    let cover: StudioCoverPainter
    let builder: StudioManifestBuilder
    let options: Options
    /// For portraits of people Muse names (the demo world's synthetic people).
    let world: StudioDemoWorld?
    /// Looks of the last Bubbles made here, so new ones vary (LOOKS.md).
    let recentLooks: [String]

    private var messages: [JSONValue] = []
    private var planner: String
    private let fallbackPlanner: String
    private var pickedFormula: String?
    private var contentStore: [String: JSONValue] = [:]
    private var emberKeys = Set<String>()
    private var failureRounds = 0
    private var roundCountedThisTurn = false
    private var repairPending = false
    private var lastManifest: BubbleManifest?
    private var lastDraft: JSONValue?
    private var best: (manifest: BubbleManifest, validation: BubbleJSRuntime.Validation, report: StudioPlaytest.Report?, filled: Int)?
    private var finalized: Outcome?
    private var turns = 0
    private var announcedConcepts: [String]?
    private var announcedGlue = Set<String>()
    private var announcedContent = false
    private var announcedSources = false
    private var sourcesUsedNames: [String] = []
    private var baseReport: StudioPlaytest.Report?
    /// The last draft that went the asked-for way but too far (harder than the base, yet too hard).
    private var overshotDraft: BubbleManifest?
    private var announcedLook: String?
    private(set) var modelsUsed: [String] = []

    init(
        request: StudioRequest,
        brief: BubbleBrief,
        catalog: StudioCatalog,
        client: MuseClient,
        runtime: StudioRuntime,
        timeline: StudioTimeline,
        cover: StudioCoverPainter,
        builder: StudioManifestBuilder,
        options: Options = Options(),
        world: StudioDemoWorld? = nil,
        recentLooks: [String] = []
    ) {
        self.request = request
        self.brief = brief
        self.catalog = catalog
        self.client = client
        self.runtime = runtime
        self.timeline = timeline
        self.cover = cover
        self.builder = builder
        self.options = options
        self.world = world
        self.recentLooks = recentLooks
        self.planner = client.config.plannerModel
        self.fallbackPlanner = client.config.visionModel
    }

    // MARK: - Loop

    func run() async throws -> Outcome {
        let baseDraft = builder.base.map { StudioManifestBuilder.draftForm($0) }
        messages = [
            ["role": "system", "content": .string(MusePrompts.composerSystem(catalog))],
            ["role": "user", "content": .string(MusePrompts.composerUser(request, brief: brief, catalog: catalog, baseDraft: baseDraft, today: builder.today,
                                                                         keepsBaseLook: builder.keepsBaseLook, recentLooks: recentLooks))],
        ]
        let deadline = Date().addingTimeInterval(options.budget)
        timeline.emit(.compose, "Muse is composing", detail: "Wonder is reading the library of \(catalog.formulas.count) formulas and \(catalog.concepts.count) concepts", model: planner)

        var stopReason = "ran out of turns"
        var nudges = 0
        while turns < options.maxTurns {
            try Task.checkCancellation()
            if Date() >= deadline {
                stopReason = "took longer than \(Int(options.budget)) s"
                break
            }
            turns += 1
            roundCountedThisTurn = false
            let reply: MuseClient.ChatReply
            do {
                reply = try await plannerTurn(deadline: deadline)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // Muse stopped answering: keep a draft that already passed, or let the caller fall back.
                if Task.isCancelled { throw CancellationError() }
                guard best != nil || lastManifest != nil else { throw error }
                stopReason = "stopped answering (\((error as? MuseError)?.shortReason ?? "error"))"
                break
            }
            messages.append(reply.message)

            if reply.toolCalls.isEmpty {
                // Some replies carry the draft as text instead of a tool call.
                if let draft = MuseJSON.object(in: reply.content), StudioManifestBuilder.unwrapDraft(draft)["concepts"] != nil {
                    let result = await finalizeTool(StudioManifestBuilder.unwrapDraft(draft))
                    if let finalized { return finalized }
                    messages.append(["role": "user", "content": .string("Studio checked that draft: \(result.jsonString()). Fix it and call finalize with the whole draft.")])
                } else {
                    nudges += 1
                    if nudges > 2 { stopReason = "stopped calling tools"; break }
                    messages.append(["role": "user", "content": .string(MusePrompts.nudge)])
                }
                if failureRounds > options.maxRepairRounds { stopReason = "repairs ran out"; break }
                continue
            }

            let results = await execute(reply.toolCalls)
            messages.append(contentsOf: results)
            if let finalized { return finalized }
            if failureRounds > options.maxRepairRounds {
                stopReason = "repairs ran out"
                break
            }
        }
        return try await takeOver(reason: stopReason)
    }

    /// One planner turn, bounded by the session deadline. Wonder first; Spark 1.3 takes over for
    /// the rest of the session if Wonder fails.
    private func plannerTurn(deadline: Date) async throws -> MuseClient.ChatReply {
        do {
            return try await ask(planner, deadline: deadline)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            guard planner != fallbackPlanner, deadline.timeIntervalSinceNow > 15 else { throw error }
            if case .http(let status, _)? = error as? MuseError, status == 401 || status == 403 { throw error }
            let reason = (error as? MuseError)?.shortReason ?? "an error"
            let previous = planner
            planner = fallbackPlanner
            timeline.emit(.compose, "Switched to the backup planner",
                          detail: "\(Self.modelName(previous)) didn't answer (\(reason)), so \(Self.modelName(fallbackPlanner)) picks up the same plan",
                          model: fallbackPlanner)
            return try await ask(planner, deadline: deadline)
        }
    }

    private func ask(_ model: String, deadline: Date) async throws -> MuseClient.ChatReply {
        let remaining = deadline.timeIntervalSinceNow
        guard remaining > 3 else { throw MuseError.timedOut(seconds: options.budget) }
        let chatOptions = MuseClient.ChatOptions(
            maxTokens: options.plannerTokens,
            tools: StudioTools.definitions(catalog),
            toolChoice: "auto",
            timeout: min(options.turnTimeout, remaining),
            maxAttempts: 2,
            purpose: "compose turn \(turns)\(model == fallbackPlanner && fallbackPlanner != client.config.plannerModel ? " (backup)" : "")"
        )
        let client = self.client
        let messages = self.messages
        let reply = try await StudioAsync.withTimeout(remaining) {
            try await client.chat(model: model, messages: messages, options: chatOptions)
        }
        noteModel(model)
        return reply
    }

    private func execute(_ calls: [MuseClient.ToolCall]) async -> [JSONValue] {
        var results: [String: JSONValue] = [:]

        // Ember content calls run together.
        let contentCalls = calls.filter { $0.name == StudioTools.writeContent }
        if !contentCalls.isEmpty {
            let specs = contentCalls.map { ($0.id, MuseJSON.arguments($0.arguments) ?? .object([:])) }
            let written = await withTaskGroup(of: (String, ContentResult).self) { group -> [String: ContentResult] in
                for (id, spec) in specs {
                    group.addTask { [self] in (id, await self.writeContent(spec)) }
                }
                var out: [String: ContentResult] = [:]
                for await (id, result) in group { out[id] = result }
                return out
            }
            for (id, _) in specs {
                guard let result = written[id] else { continue }
                results[id] = absorb(result)
            }
        }

        for call in calls where call.name != StudioTools.writeContent {
            guard let arguments = MuseJSON.arguments(call.arguments) else {
                results[call.id] = ["error": "The arguments weren't valid JSON. Send a JSON object."]
                continue
            }
            switch call.name {
            case StudioTools.listFormulas:
                timeline.emit(.compose, "Looked through \(catalog.formulas.count) formulas",
                              detail: StudioCopy.list(catalog.formulas.map(\.title), limit: 6), model: planner)
                results[call.id] = ["formulas": catalog.formulaSummaries()]
            case StudioTools.getFormula:
                results[call.id] = getFormula(arguments)
            case StudioTools.getConcepts:
                results[call.id] = getConcepts(arguments)
            case StudioTools.paintCover:
                results[call.id] = paintCover(arguments)
            case StudioTools.validateManifest:
                results[call.id] = await validateTool(arguments)
            case StudioTools.playtest:
                results[call.id] = await playtestTool(arguments)
            case StudioTools.finalize:
                results[call.id] = await finalizeTool(arguments)
            default:
                results[call.id] = ["error": .string("Unknown tool \(call.name).")]
            }
        }

        return calls.map { call in
            [
                "role": "tool",
                "tool_call_id": .string(call.id),
                "content": .string((results[call.id] ?? ["error": "No result"]).jsonString()),
            ]
        }
    }

    // MARK: - Library tools

    private func getFormula(_ arguments: JSONValue) -> JSONValue {
        let id = (arguments["id"]?.string ?? "").lowercased()
        guard let formula = catalog.formula(id) else {
            return ["error": .string("Unknown formula \"\(id)\"."), "formulas": .array(catalog.formulaIDs.map { .string($0) })]
        }
        let reason = Self.sentence(arguments["reason"]?.string ?? "")
        let switched = pickedFormula != nil && pickedFormula != id
        if pickedFormula != id {
            pickedFormula = id
            timeline.emit(.compose, switched ? "Switched to \(id)" : "Picked \(id)",
                          detail: reason.isEmpty ? formula.describe : reason, model: planner)
        }

        var ids: [String] = formula.coreIDs + formula.optionalIDs
        if let example = formula.example {
            ids += (example["concepts"]?.array ?? []).compactMap { $0["use"]?.string }
        }
        var contracts: [String: JSONValue] = [:]
        for conceptID in StudioManifestBuilder.unique(ids) {
            contracts[conceptID] = catalog.contract(conceptID, full: false)
        }
        let others = catalog.concepts(for: id).map(\.id).filter { contracts[$0] == nil }

        var out: [String: JSONValue] = [
            "id": .string(formula.id),
            "title": .string(formula.title),
            "describe": .string(formula.describe),
            "core": .array(formula.core.map { .string($0) }),
            "optional": .array(formula.optional.map { .string($0) }),
            "content": ["describe": .string(formula.contentDescribe), "schema": formula.contentSchema],
            "concepts": .object(contracts),
            "more_concepts_for_this_formula": .array(others.map { .string($0) }),
        ]
        if let bot = formula.raw["bot"]?["describe"]?.string {
            out["bot"] = .string(bot)
        }
        if !formula.tips.isEmpty {
            out["tips"] = .array(formula.tips.map { .string($0) })
        }
        if let example = formula.example {
            out["example"] = StudioManifestBuilder.draftForm(json: example)
        }
        if !formula.examples.isEmpty {
            out["more_examples"] = .array(formula.examples.prefix(3).map { StudioManifestBuilder.draftForm(json: $0) })
        }
        if formula.core.contains(where: { $0.contains("|") }) {
            out["core_note"] = "\"a|b\" in core means one of them."
        }
        return .object(out)
    }

    private func getConcepts(_ arguments: JSONValue) -> JSONValue {
        let ids = arguments["ids"]?.strings ?? (arguments["ids"]?.string.map { [$0] } ?? [])
        var found: [String: JSONValue] = [:]
        var unknown: [String: JSONValue] = [:]
        for id in StudioManifestBuilder.unique(ids).prefix(24) {
            if let contract = catalog.contract(id, full: true) {
                found[id] = contract
            } else {
                unknown[id] = .array(catalog.suggestions(for: id, formula: pickedFormula).map { .string($0) })
            }
        }
        if !found.isEmpty {
            let names = found.keys.sorted().map(StudioCopy.conceptName)
            timeline.emit(.compose, "Read \(found.count) concept \(found.count == 1 ? "contract" : "contracts")",
                          detail: StudioCopy.list(names, limit: 4), model: planner)
        }
        var out: [String: JSONValue] = ["concepts": .object(found)]
        if !unknown.isEmpty {
            out["unknown"] = .object(unknown)
            out["note"] = "Unknown ids don't exist in the library; the lists are the closest ones."
        }
        return .object(out)
    }

    private func paintCover(_ arguments: JSONValue) -> JSONValue {
        guard !cover.isStarted else {
            return ["ok": true, "message": "The cover is already painting."]
        }
        let keep = builder.keepsBaseLook
        let look = keep || builder.lookHint != nil ? builder.defaultLook(brief: brief, formula: pickedFormula)
            : catalog.look(arguments["look"]?.string) ?? builder.defaultLook(brief: brief, formula: pickedFormula, avoid: recentLooks)
        var colors = (arguments["colors"]?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var motif: String?
        if keep, let base = builder.base {
            colors = builder.colorWords(base.style)
            motif = base.style.motif
        }
        if colors.isEmpty {
            colors = look.exampleColors.first.map { StudioColors.words($0) } ?? StudioPalette.all[0].words
        }
        let scene = (arguments["scene"]?.string ?? "").isEmpty ? brief.intent : arguments["scene"]!.string!
        let prompt = MusePrompts.coverPrompt(scene: scene, look: look, colors: colors, motif: motif)
        cover.start(client: client, prompt: prompt, scene: scene, look: look.id, timeout: options.coverTimeout)
        noteModel(client.config.imageModel)
        // An early stand-in so Studio can preview the identity while the rest runs.
        let title = StudioManifestBuilder.cleanTitle(arguments["title"]?.string) ?? builder.base?.title ?? "New bubble"
        let emoji = arguments["emoji"]?.string.flatMap(StudioManifestBuilder.firstEmoji)
        let preview = builder.preview(title: title, emoji: emoji, look: look, formula: pickedFormula, brief: brief)
        announceLook(look, colors: colors, motif: motif ?? preview?.style.motif, manifest: preview)
        return ["ok": true, "message": .string("Painting the cover in the \(look.id) look in the background. Use style.look \"\(look.id)\" in the draft and keep composing.")]
    }

    /// Starts the cover from a draft when Muse never called `paint_cover`, and repaints it once if
    /// the draft landed on a different look than the cover.
    private func paintCoverIfNeeded(for manifest: BubbleManifest) {
        guard let look = catalog.look(manifest.style.look) ?? catalog.looks.first else { return }
        let scene = cover.scene ?? "\(manifest.title): \(manifest.brief.intent.isEmpty ? brief.intent : manifest.brief.intent)"
        let prompt = MusePrompts.coverPrompt(scene: scene, look: look, colors: builder.colorWords(manifest.style), motif: manifest.style.motif)
        if !cover.isStarted {
            cover.start(client: client, prompt: prompt, scene: scene, look: look.id, timeout: options.coverTimeout)
            noteModel(client.config.imageModel)
        } else if cover.look != look.id,
                  cover.repaint(client: client, prompt: prompt, scene: scene, look: look.id, timeout: options.coverTimeout) {
            timeline.emit(.compose, "Repainting the cover", detail: "The game moved to \(look.withArticle) look, so the cover follows it",
                          model: client.config.imageModel)
        }
    }

    /// The look's row: "Paper cutout · warm cream, tomato red and deep teal" with "Picked a
    /// paper-cutout look in …, with rolling hills behind".
    private func announceLook(_ look: BubbleLookSpec, colors: String, motif: String?, manifest: BubbleManifest?) {
        guard announcedLook != look.id else { return }
        let first = announcedLook == nil
        announcedLook = look.id
        var detail: String
        if builder.keepsBaseLook, let base = builder.base {
            detail = "Kept \(look.withArticle) look from \(request.mode == .nextLevel ? "level \(base.chain?.index ?? 1)" : base.title)"
        } else if builder.lookHint?.id == look.id {
            detail = "Your pick: \(look.withArticle) look"
        } else {
            detail = "\(first ? "Picked" : "Switched to") \(look.withArticle) look"
        }
        if !colors.isEmpty { detail += " in \(colors)" }
        if let motif, let phrase = BubbleLookSpec.motifPhrases[motif] { detail += ", with \(phrase) behind" }
        timeline.emit(.compose, BubbleLookSpec.row(look, colors: colors), detail: detail, model: planner, manifest: manifest)
    }

    // MARK: - Content (Ember)

    private struct ContentResult: Sendable {
        var key: String
        var label: String
        var items: [JSONValue]
        var requested: Int
        var seconds: Double
        var error: String?
    }

    private func writeContent(_ spec: JSONValue) async -> ContentResult {
        let key = (spec["key"]?.string ?? "items").trimmingCharacters(in: .whitespaces)
        let label = spec["label"]?.string ?? StudioCopy.humanKey(key)
        let count = min(max(spec["count"]?.int ?? 8, 1), 40)
        var payload: [String: JSONValue] = [
            "key": .string(key),
            "count": .number(Double(count)),
            "instructions": .string(spec["instructions"]?.string ?? "Write \(count) \(label)."),
        ]
        if let schema = spec["item_schema"], !schema.isNull {
            payload["item_schema"] = schema
        }
        let started = Date()
        do {
            let (value, _) = try await client.chatJSON(
                model: client.config.fastModel,
                system: MusePrompts.contentSystem(),
                user: MusePrompts.contentUser(spec: .object(payload), request: request, brief: brief, title: nil),
                options: MuseClient.ChatOptions(maxTokens: options.contentTokens, reasoningEffort: "medium", timeout: 45, maxAttempts: 2, purpose: "content: \(label)")
            )
            var items = value["items"]?.array ?? value[key]?.array ?? value.object?.values.first(where: { $0.array != nil })?.array ?? []
            items = Self.dedupe(items)
            if items.count > count { items = Array(items.prefix(count)) }
            return ContentResult(key: key, label: label, items: items, requested: count, seconds: Date().timeIntervalSince(started),
                                 error: items.isEmpty ? "no items" : nil)
        } catch {
            let reason = (error as? MuseError)?.shortReason ?? error.localizedDescription
            return ContentResult(key: key, label: label, items: [], requested: count, seconds: Date().timeIntervalSince(started), error: reason)
        }
    }

    private func absorb(_ result: ContentResult) -> JSONValue {
        noteModel(client.config.fastModel)
        guard result.error == nil, !result.items.isEmpty else {
            timeline.emit(.content, "Ember couldn't write the \(result.label)",
                          detail: "Wonder will write them instead (\(result.error ?? "no items"))", model: client.config.fastModel)
            return ["error": .string("The content model couldn't write this (\(result.error ?? "no items")). Write it yourself in the draft.")]
        }
        contentStore[result.key] = .array(result.items)
        emberKeys.insert(result.key.split(separator: ".").first.map(String.init) ?? result.key)
        let preview = result.items.prefix(3).compactMap { item -> String? in
            item.string ?? item["prompt"]?.string ?? item["name"]?.string ?? item["label"]?.string ?? item["word"]?.string
        }
        let count = result.items.count
        timeline.emit(.content, "Ember wrote \(count) \(result.label)",
                      detail: preview.isEmpty ? "In \(StudioCopy.seconds(result.seconds))" : preview.joined(separator: " · ") + (count > preview.count ? " …" : ""),
                      model: client.config.fastModel)
        return [
            "key": .string(result.key),
            "count": .number(Double(count)),
            "items": .array(result.items),
            "note": .string("Stored under content.\(result.key). Leave it out of your draft to use these as they are, or include your edited version."),
        ]
    }

    // MARK: - Checking tools

    /// A check either passes with a value or sends feedback back to Muse.
    private enum Checked<Value> {
        case success(Value)
        case failure(JSONValue)
    }

    private struct Built {
        var manifest: BubbleManifest
        var filled: Int
    }

    private func build(_ arguments: JSONValue) -> Checked<Built> {
        let draft = StudioManifestBuilder.unwrapDraft(arguments)
        lastDraft = draft
        do {
            let raw = try builder.manifest(fromDraft: draft, brief: brief, contentStore: contentStore,
                                           fallbackFormula: pickedFormula, models: modelsUsed)
            let compiled = builder.compiled(raw)
            var manifest = compiled.manifest
            if let world {
                var content = manifest.content
                if world.fillAvatars(in: &content) > 0 { manifest.content = content }
            }
            if pickedFormula == nil { pickedFormula = manifest.formula.rawValue }
            manifest = withSources(manifest, draft: draft)
            lastManifest = manifest
            if let look = catalog.look(manifest.style.look) {
                announceLook(look, colors: builder.colorWords(manifest.style), motif: manifest.style.motif, manifest: manifest)
            }
            announceDraft(manifest)
            paintCoverIfNeeded(for: manifest)
            return .success(Built(manifest: manifest, filled: compiled.filled))
        } catch {
            let message = error.localizedDescription
            timeline.emit(.validate, "The draft didn't fit the manifest shape", detail: message, issues: [message])
            return .failure(failureFeedback(kind: "draft", problems: [["code": "schema", "message": .string(message)]]))
        }
    }

    private func validateTool(_ arguments: JSONValue) async -> JSONValue {
        switch await check(arguments, playtest: false) {
        case .failure(let feedback): return feedback
        case .success(let passed): return passed.reply
        }
    }

    private func playtestTool(_ arguments: JSONValue) async -> JSONValue {
        switch await check(arguments, playtest: true) {
        case .failure(let feedback): return feedback
        case .success(let passed): return passed.reply
        }
    }

    private func finalizeTool(_ arguments: JSONValue) async -> JSONValue {
        switch await check(arguments, playtest: true) {
        case .failure(let feedback):
            return feedback
        case .success(let passed):
            // Playtest notes are already on the playtest step; these are for things Studio did itself.
            let notes: [String] = []
            finalized = Outcome(
                manifest: passed.manifest,
                validation: passed.validation,
                playtest: passed.report,
                comparison: passed.comparison,
                notes: notes,
                sourcesUsed: sourcesUsedNames,
                turns: turns,
                filledDefaults: passed.filled
            )
            return ["ok": true, "shipped": true, "message": "Validated, playtested and shipped. Thanks!"]
        }
    }

    private struct Passed {
        var manifest: BubbleManifest
        var validation: BubbleJSRuntime.Validation
        var report: StudioPlaytest.Report?
        var comparison: StudioPlaytest.Comparison?
        var filled: Int
        var reply: JSONValue
    }

    /// Builds, validates and (optionally) playtests a draft, emitting the timeline as it goes.
    private func check(_ arguments: JSONValue, playtest: Bool) async -> Checked<Passed> {
        let built: Built
        switch build(arguments) {
        case .failure(let feedback): return .failure(feedback)
        case .success(let value): built = value
        }
        let manifest = built.manifest

        let validation = await runtime.validate(manifest)
        let warnings = validation.warnings.map { "\($0.code): \($0.message)" }
        if !validation.ok {
            let problems = validation.errors.map(Self.issueJSON)
            timeline.emit(.validate, validation.errors.count == 1 ? "Found 1 problem" : "Found \(validation.errors.count) problems",
                          detail: validation.errors.first.map(Self.issueLine), manifest: manifest,
                          issues: validation.errors.map(Self.issueLine))
            return .failure(failureFeedback(kind: "validation", problems: problems, warnings: warnings))
        }

        var detail = "\(manifest.concepts.count) concepts, every event wired"
        if !manifest.glue.isEmpty { detail += ", glue compiles" }
        if !validation.warnings.isEmpty { detail += " · \(validation.warnings.count) \(validation.warnings.count == 1 ? "note" : "notes")" }
        let fixed = repairPending
        timeline.emit(.validate, fixed ? "Repair worked: wiring checks out" : "Wiring checks out", detail: detail, manifest: manifest,
                      issues: validation.warnings.isEmpty ? nil : validation.warnings.map(Self.issueLine))
        if best == nil || best?.report == nil {
            best = (manifest, validation, nil, built.filled)
        }

        guard playtest else {
            repairPending = false
            return .success(Passed(manifest: manifest, validation: validation, report: nil, comparison: nil, filled: built.filled,
                                   reply: ["ok": true, "errors": [], "warnings": .array(warnings.map { .string($0) }),
                                           "message": "Valid. Call finalize when ready (it playtests too)."]))
        }

        var report = await runtime.playtest(manifest)
        var comparison: StudioPlaytest.Comparison?
        if let base = builder.base, request.mode == .nextLevel || request.mode == .edit {
            comparison = await compare(report, with: base)
            if let comparison, let wanted = difficultyWanted {
                let ok = wanted == .harder ? comparison.harder == true : comparison.easier == true
                if !ok, comparison.harder != nil {
                    let target = request.mode == .nextLevel ? "Level \((base.chain?.index ?? 1) + 1) should play harder than level \(base.chain?.index ?? 1)" : (wanted == .harder ? "The edit asked for harder" : "The edit asked for easier")
                    let blocking = failureRounds < options.maxRepairRounds
                    report.flags.append(StudioPlaytest.Flag(
                        code: wanted == .harder ? "not_harder" : "not_easier",
                        message: "\(target), but \(comparison.line.prefix(1).lowercased() + comparison.line.dropFirst()). Change params so the difference shows (speed, gaps, timers, tries).",
                        blocking: blocking))
                }
            }
        }

        if let comparison, difficultyWanted != nil, comparison.harder == true || comparison.easier == true,
           report.blocking.contains(where: { ["too_hard", "too_short", "too_easy"].contains($0.code) }) {
            overshotDraft = manifest
        }

        // Out of repairs and still not the asked-for difficulty: search between the draft that
        // overshot and the base for the closest blend that passes.
        if difficultyWanted != nil, failureRounds >= options.maxRepairRounds, let overshot = overshotDraft,
           report.flags.contains(where: { $0.code == "not_harder" || $0.code == "not_easier" }) {
            if let tuned = await tuned(overshot) {
                timeline.emit(.playtest, "Playtest: \(report.headline)", detail: "\(report.spread)\(comparison.map { " · \($0.line)" } ?? "")", manifest: manifest)
                timeline.emit(.repair, "Studio tuned the difficulty", detail: tuned.line)
                timeline.emit(.playtest, "Playtest: \(tuned.report.headline)", detail: tuned.report.spread, manifest: tuned.manifest,
                              issues: tuned.report.flags.isEmpty ? nil : tuned.report.flags.map(\.message))
                best = (tuned.manifest, tuned.validation, tuned.report, built.filled)
                repairPending = false
                return .success(Passed(manifest: tuned.manifest, validation: tuned.validation, report: tuned.report, comparison: nil,
                                       filled: built.filled, reply: ["ok": true, "playtest": tuned.report.json(), "note": "Studio tuned the difficulty."]))
            }
        }

        let flags = report.flags.map(\.message)
        let headline = Self.sentence(report.headline)
        var playDetail = report.spread
        if let comparison { playDetail += " · \(comparison.line)" }
        if report.passed {
            timeline.emit(.playtest, "Playtest: \(report.headline)", detail: playDetail, manifest: manifest,
                          issues: flags.isEmpty ? nil : flags)
        } else {
            timeline.emit(.playtest, "Playtest: \(report.blocking.first.map { Self.flagTitle($0.code) } ?? "needs work")",
                          detail: "\(headline) · \(playDetail)", manifest: manifest, issues: flags)
        }

        let crashed = report.flags.contains { $0.code == "runtime_error" }
        if !crashed, report.passed || best?.report?.passed != true {
            best = (manifest, validation, report, built.filled)
        }

        if !report.passed {
            let problems = report.blocking.map { flag -> JSONValue in ["code": .string(flag.code), "message": .string(flag.message)] }
            var feedback = failureFeedback(kind: "playtest", problems: problems, warnings: warnings)
            if case .object(var object) = feedback {
                object["playtest"] = report.json(comparison: comparison)
                if let target = difficultyTarget(report) { object["target"] = .string(target) }
                feedback = .object(object)
            }
            return .failure(feedback)
        }
        repairPending = false
        return .success(Passed(manifest: manifest, validation: validation, report: report, comparison: comparison, filled: built.filled,
                               reply: ["ok": true, "playtest": report.json(comparison: comparison), "warnings": .array(warnings.map { .string($0) })]))
    }

    /// Counts a repair round and tells Muse what to fix.
    private func failureFeedback(kind: String, problems: [JSONValue], warnings: [String] = []) -> JSONValue {
        // One repair round per turn, however many checks fail in it.
        let counted = roundCountedThisTurn
        if !counted {
            failureRounds += 1
            roundCountedThisTurn = true
        }
        let round = failureRounds
        let left = max(options.maxRepairRounds - round, 0)
        let lines = problems.compactMap { $0["message"]?.string }
        if round <= options.maxRepairRounds && !counted {
            repairPending = true
            let noun = problems.count == 1 ? "problem" : "problems"
            timeline.emit(.repair, "Sending \(problems.count) \(noun) back to Muse",
                          detail: "Repair round \(round) of \(options.maxRepairRounds): \(lines.first ?? kind)", model: planner,
                          issues: lines)
        }
        var out: [String: JSONValue] = [
            "ok": false,
            "stage": .string(kind),
            "problems": .array(problems),
            "repair_round": .number(Double(round)),
            "repairs_left": .number(Double(left)),
        ]
        if !warnings.isEmpty { out["warnings"] = .array(warnings.map { .string($0) }) }
        out["next"] = round <= options.maxRepairRounds
            ? "Fix every problem, then call finalize again with the whole draft."
            : "No repairs left. Studio will finish this Bubble itself."
        return .object(out)
    }

    /// A concrete aim for the next draft, from the base's playtest when there is one.
    private func difficultyTarget(_ report: StudioPlaytest.Report) -> String? {
        let codes = Set(report.blocking.map(\.code))
        guard !codes.isDisjoint(with: ["too_hard", "too_short", "too_easy", "never_ends", "not_harder", "not_easier"]) else { return nil }
        let survival = report.completedRuns.contains { $0.outcome == "fail" || $0.outcome == "timeout" }
        if let baseRun = baseReport?.typical, survival, difficultyWanted == .harder {
            let low = Int((baseRun.seconds * 0.55).rounded())
            let high = Int((baseRun.seconds * 0.85).rounded())
            return "The typical bot lasts \(Int(baseRun.seconds.rounded())) s on the base. Aim for about \(max(low, 12))–\(max(high, 18)) s: change params by small steps (10–20%) from the base, not all at once."
        }
        if survival {
            return "Aim for the typical bot to last 20–90 s. Change params by small steps (10–20%) and keep the first seconds gentle."
        }
        return "Aim for runs of 20–90 s: add rounds, items or tries, or loosen timers."
    }

    // MARK: - Difficulty tuning

    /// When Muse's repairs run out on difficulty alone, Studio searches between Muse's draft and a
    /// known-good anchor (the base level, or the formula's example): it blends their shared numeric
    /// params, playtests each blend, and keeps the closest-to-Muse blend that passes (and is still
    /// harder or easier when the request asked for that).
    private func tuned(_ draft: BubbleManifest) async -> (manifest: BubbleManifest, validation: BubbleJSRuntime.Validation, report: StudioPlaytest.Report, line: String)? {
        let anchor: BubbleManifest
        let anchorLabel: String
        if let base = builder.base {
            anchor = builder.compiled(base).manifest
            anchorLabel = request.mode == .nextLevel ? "level \(base.chain?.index ?? 1)" : "v\(base.version)"
        } else if let example = builder.exampleManifest(for: draft.formula.rawValue) {
            anchor = builder.compiled(example).manifest
            anchorLabel = "the \(draft.formula.rawValue) template"
        } else {
            return nil
        }
        var fallback: (BubbleManifest, BubbleJSRuntime.Validation, StudioPlaytest.Report, String)?
        for share in [0.8, 0.65, 0.5, 0.35, 0.2] {
            let candidate = Self.blend(draft, toward: anchor, keeping: share)
            guard candidate != draft else { continue }
            let validation = await runtime.validate(candidate)
            guard validation.ok else { continue }
            let report = await runtime.playtest(candidate)
            guard report.passed else { continue }
            let kept = "Kept \(Int((share * 100).rounded()))% of Muse's param changes from \(anchorLabel)"
            if let wanted = difficultyWanted, let base = builder.base {
                let comparison = await compare(report, with: base)
                let ok = wanted == .harder ? comparison?.harder == true : comparison?.easier == true
                if ok { return (candidate, validation, report, "\(kept) · \(comparison?.line ?? "")") }
                if fallback == nil { fallback = (candidate, validation, report, "\(kept) · \(comparison?.line ?? "")") }
            } else {
                return (candidate, validation, report, kept)
            }
        }
        return fallback
    }

    /// The draft with each numeric param shared with the anchor moved back toward the anchor:
    /// value = anchor + share × (draft − anchor). Integers round toward the draft.
    static func blend(_ draft: BubbleManifest, toward anchor: BubbleManifest, keeping share: Double) -> BubbleManifest {
        var out = draft
        let anchorParams = Dictionary(anchor.concepts.map { ($0.use, $0.params ?? [:]) }, uniquingKeysWith: { first, _ in first })
        for index in out.concepts.indices {
            guard let base = anchorParams[out.concepts[index].use], var params = out.concepts[index].params else { continue }
            for (name, value) in params {
                guard let mine = value.double, let theirs = base[name]?.double, mine != theirs else { continue }
                var blended = theirs + share * (mine - theirs)
                let isInteger = mine.rounded() == mine && theirs.rounded() == theirs
                if isInteger {
                    blended = mine > theirs ? blended.rounded(.up) : blended.rounded(.down)
                } else {
                    blended = (blended * 1000).rounded() / 1000
                }
                params[name] = .number(blended)
            }
            out.concepts[index].params = params
        }
        return out
    }

    // MARK: - Base comparison

    private var difficultyWanted: Difficulty? {
        if request.mode == .nextLevel { return .harder }
        guard request.mode == .edit else { return nil }
        let text = request.prompt.lowercased()
        let harder = ["harder", "tougher", "more difficult", "faster", "challenging", "trickier", "hard mode", "more intense"]
        let easier = ["easier", "slower", "simpler", "gentler", "more chill", "relaxed", "less hard", "calmer"]
        if harder.contains(where: text.contains) { return .harder }
        if easier.contains(where: text.contains) { return .easier }
        return nil
    }

    private func compare(_ report: StudioPlaytest.Report, with base: BubbleManifest) async -> StudioPlaytest.Comparison? {
        if baseReport == nil {
            baseReport = await runtime.playtest(builder.compiled(base).manifest)
        }
        guard let baseReport, !baseReport.completedRuns.isEmpty else { return nil }
        let label = request.mode == .nextLevel ? "level \(base.chain?.index ?? 1)" : "v\(base.version)"
        return StudioPlaytest.compare(report, to: baseReport, baseLabel: label)
    }

    // MARK: - Take over

    /// Muse's turns, time or repairs ran out: ship the best passing draft, or fix the last one.
    private func takeOver(reason: String) async throws -> Outcome {
        if let best, best.report?.passed ?? false {
            timeline.emit(.repair, "Shipping the best passing draft", detail: "Muse \(reason), so Studio kept the version that passed every check", model: nil)
            return outcome(from: best, notes: ["Muse \(reason); Studio shipped the last draft that passed."])
        }
        if let best, let report = best.report, !report.passed,
           report.blocking.allSatisfy({ ["too_hard", "too_short", "not_harder", "not_easier"].contains($0.code) }),
           let tuned = await tuned(best.manifest) {
            timeline.emit(.repair, "Studio tuned the difficulty", detail: tuned.line, model: nil)
            timeline.emit(.playtest, "Playtest: \(tuned.report.headline)", detail: tuned.report.spread, manifest: tuned.manifest,
                          issues: tuned.report.flags.isEmpty ? nil : tuned.report.flags.map(\.message))
            return outcome(from: (tuned.manifest, tuned.validation, tuned.report, best.filled),
                           notes: ["Muse \(reason); Studio tuned the difficulty by playtest."])
        }
        if let best {
            let report: StudioPlaytest.Report
            if let existing = best.report {
                report = existing
            } else {
                report = await runtime.playtest(best.manifest)
            }
            if !report.flags.contains(where: { $0.code == "runtime_error" || $0.code == "never_ends" || $0.code == "no_score" }) {
                timeline.emit(.repair, "Shipping the best valid draft",
                              detail: "Muse \(reason). It passed validation; playtest notes: \(report.flags.map(\.message).first ?? "none")")
                return outcome(from: (best.manifest, best.validation, report, best.filled),
                               notes: report.flags.map(\.message) + ["Muse \(reason); Studio shipped the best valid draft."])
            }
        }
        if let last = lastManifest {
            let runtime = self.runtime
            if let fixed = await builder.autofix(last, validate: { await runtime.validate($0) }) {
                let validation = await runtime.validate(fixed.manifest)
                let report = await runtime.playtest(fixed.manifest)
                timeline.emit(.repair, "Studio fixed the last draft",
                              detail: fixed.fixes.isEmpty ? "Deterministic repair" : StudioCopy.list(fixed.fixes, limit: 3))
                timeline.emit(.playtest, "Playtest: \(report.headline)", detail: report.spread, manifest: fixed.manifest,
                              issues: report.flags.isEmpty ? nil : report.flags.map(\.message))
                if !report.flags.contains(where: { $0.code == "runtime_error" }) {
                    return outcome(from: (fixed.manifest, validation, report, 0),
                                   notes: ["Muse \(reason); Studio repaired the draft (\(fixed.fixes.joined(separator: ", ")))."])
                }
            }
        }
        throw SessionError.noPassingDraft(reason)
    }

    private func outcome(from best: (manifest: BubbleManifest, validation: BubbleJSRuntime.Validation, report: StudioPlaytest.Report?, filled: Int), notes: [String]) -> Outcome {
        Outcome(manifest: best.manifest, validation: best.validation, playtest: best.report, comparison: nil, notes: notes,
                sourcesUsed: sourcesUsedNames, turns: turns, filledDefaults: best.filled)
    }

    // MARK: - Timeline for drafts

    /// Announces what's new in a draft: its concepts, any glue and the content.
    private func announceDraft(_ manifest: BubbleManifest) {
        let ids = manifest.conceptIDs
        if announcedConcepts != ids {
            let first = announcedConcepts == nil
            let core = Set(catalog.formula(manifest.formula.rawValue)?.coreIDs ?? [])
            let extras = ids.filter { !core.contains($0) }.map(StudioCopy.conceptName)
            let detail: String
            if first {
                detail = extras.isEmpty ? "The \(manifest.formula.rawValue) core" : "\(manifest.formula.rawValue) core + \(StudioCopy.list(extras, limit: 4))"
            } else {
                let before = Set(announcedConcepts ?? [])
                let added = ids.filter { !before.contains($0) }.map(StudioCopy.conceptName)
                let removed = (announcedConcepts ?? []).filter { !ids.contains($0) }.map(StudioCopy.conceptName)
                var parts: [String] = []
                if !added.isEmpty { parts.append("added \(StudioCopy.list(added))") }
                if !removed.isEmpty { parts.append("dropped \(StudioCopy.list(removed))") }
                detail = parts.isEmpty ? "Retuned params" : Self.sentence(parts.joined(separator: "; "))
            }
            timeline.emit(.compose, first ? "Composed \(ids.count) concepts" : "Reworked the concepts", detail: detail,
                          model: planner, concepts: ids, manifest: manifest)
            announcedConcepts = ids
        }

        for (key, glue) in manifest.glue.sorted(by: { $0.key < $1.key }) where !announcedGlue.contains(glue.source) {
            announcedGlue.insert(glue.source)
            let what = glue.describe.map(Self.sentence) ?? "A custom \(glue.slot) function"
            timeline.emit(.glue, "Wrote a custom \(glue.slot) function", detail: "\(key.replacingOccurrences(of: "glue.", with: "")): \(what)", model: planner)
        }

        if !announcedContent, let content = manifest.content.object {
            announcedContent = true
            var own = content.filter { !emberKeys.contains($0.key) }
            let baseContent = builder.base?.content.object
            if let baseContent {
                // Edits, remixes and levels: only what changed is Muse's work.
                own = own.filter { baseContent[$0.key] != $0.value }
            }
            // Only lists are worth a line when Ember already wrote the bulk of it.
            let worth = emberKeys.isEmpty ? own : own.filter { $0.value.array != nil }
            let summary = Self.contentSummary(worth)
            if !summary.isEmpty {
                let verb = baseContent == nil ? "wrote the content" : "rewrote the content"
                timeline.emit(.content, "\(Self.modelName(planner)) \(verb)", detail: Self.sentence(summary), model: planner)
            } else if let baseContent, emberKeys.isEmpty, baseContent == content {
                timeline.emit(.content, "Kept the content", detail: Self.sentence(Self.contentSummary(content)), model: planner)
            }
        }

        if !announcedSources, !request.sources.isEmpty, request.mode == .daily || request.scope.hasPrefix("event:") {
            announcedSources = true
            let names = sourcesUsedNames
            if names.isEmpty {
                timeline.emit(.content, "Read \(request.sources.count) opted-in posts", detail: "Nothing else: no other posts or profiles", sources: [])
            } else {
                timeline.emit(.content, "Used \(names.count) of \(request.sources.count) opted-in posts",
                              detail: "\(StudioCopy.list(names, limit: 5)). Nothing else was read.", sources: names)
            }
        }
    }

    /// Records which opted-in sources the draft used and lists them in the brief.
    private func withSources(_ manifest: BubbleManifest, draft: JSONValue) -> BubbleManifest {
        guard !request.sources.isEmpty, request.mode == .daily || request.scope.hasPrefix("event:") || request.scope.hasPrefix("group:") else {
            return manifest
        }
        var used = Set<Int>()
        for number in draft["sources_used"]?.array?.compactMap({ $0.int }) ?? [] where number >= 1 && number <= request.sources.count {
            used.insert(number - 1)
        }
        let text = Self.allStrings(in: manifest.content).joined(separator: " ").lowercased()
        for (index, source) in request.sources.enumerated() {
            let words = Self.significantWords(source.text)
            if text.contains(source.author.lowercased()) || words.contains(where: { text.contains($0) }) {
                used.insert(index)
            }
        }
        let indices = used.sorted()
        sourcesUsedNames = StudioManifestBuilder.unique(indices.map { request.sources[$0].author })
        guard request.mode == .daily || request.scope.hasPrefix("event:") else { return manifest }
        var out = manifest
        out.brief.contentSources = indices.isEmpty
            ? ["\(request.scopeName ?? "Group") posts (opted in)"]
            : indices.map { "\(request.sources[$0].author)'s post (opted in)" }
        return out
    }

    // MARK: - Helpers

    private func noteModel(_ model: String) {
        if !modelsUsed.contains(model) { modelsUsed.append(model) }
    }

    static func modelName(_ id: String) -> String {
        switch id {
        case "muse-wonder-1.0": return "Wonder"
        case "muse-ember-1.0": return "Ember"
        case "muse-image-1.0": return "Muse Image"
        case "muse-spark-1.3": return "Spark 1.3"
        default: return id
        }
    }

    static func issueJSON(_ issue: BubbleJSRuntime.Issue) -> JSONValue {
        var out: [String: JSONValue] = ["code": .string(issue.code), "message": .string(issue.message)]
        if let path = issue.path { out["path"] = .string(path) }
        return .object(out)
    }

    static func issueLine(_ issue: BubbleJSRuntime.Issue) -> String {
        let path = issue.path.map { " (\($0))" } ?? ""
        return "\(issue.code): \(issue.message)\(path)"
    }

    static func flagTitle(_ code: String) -> String {
        switch code {
        case "too_short": return "too short"
        case "too_hard": return "too hard"
        case "too_easy": return "too easy"
        case "never_ends": return "never ends"
        case "no_score": return "nobody scores"
        case "runtime_error": return "it crashed"
        case "not_harder": return "not harder yet"
        case "not_easier": return "not easier yet"
        default: return code.replacingOccurrences(of: "_", with: " ")
        }
    }

    static func sentence(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return trimmed }
        return first.uppercased() + trimmed.dropFirst()
    }

    static func dedupe(_ items: [JSONValue]) -> [JSONValue] {
        var seen = Set<String>()
        var out: [JSONValue] = []
        for item in items {
            if let text = item.string {
                let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !clean.isEmpty, seen.insert(clean.lowercased()).inserted else { continue }
                out.append(.string(clean))
            } else {
                let key = item.jsonString()
                guard seen.insert(key).inserted else { continue }
                out.append(item)
            }
        }
        return out
    }

    /// "12 obstacle labels, a theme"
    static func contentSummary(_ content: [String: JSONValue]) -> String {
        var parts: [String] = []
        for (key, value) in content.sorted(by: { $0.key < $1.key }) {
            if let list = value.array {
                parts.append("\(list.count) \(StudioCopy.humanKey(key))")
            } else if let text = value.string, !text.isEmpty {
                parts.append("\(StudioCopy.humanKey(key)) \(StudioCopy.quote(text, max: 28))")
            } else if let object = value.object {
                parts.append("\(StudioCopy.humanKey(key)) (\(object.count) fields)")
            }
        }
        return StudioCopy.list(parts, limit: 4)
    }

    static func allStrings(in value: JSONValue) -> [String] {
        switch value {
        case .string(let text): return [text]
        case .array(let list): return list.flatMap(allStrings)
        case .object(let object): return object.values.flatMap(allStrings)
        default: return []
        }
    }

    private static let stopWords: Set<String> = [
        "about", "after", "again", "their", "there", "these", "those", "would", "could", "should", "where", "which", "while",
        "people", "really", "still", "never", "every", "looking", "anyone", "moved", "weeks", "since", "other", "thing",
        "things", "being", "doing", "think", "first", "great", "little", "maybe", "mornings", "afternoons", "evenings",
    ]

    /// Distinctive words (5+ letters) of a source, for tracing content back to it.
    static func significantWords(_ text: String) -> [String] {
        let words = text.lowercased().split(whereSeparator: { !$0.isLetter })
        return StudioManifestBuilder.unique(words.map(String.init).filter { $0.count >= 5 && !stopWords.contains($0) })
    }
}
