import Foundation

/// Muse Studio's deterministic fallback, with no network: picks the formula from the prompt's
/// keywords, starts from the catalog `example` and adapts title, rule, palette, emoji and content
/// from the prompt and the demo world. Studio uses it when there's no key, when offline, or after
/// Muse fails or times out, and marks the result (`studio.offline`, `StudioEvent.isOffline`).
/// The same request always gives the same Bubble.
final class OfflineComposer: @unchecked Sendable {
    struct Result: Sendable {
        var manifest: BubbleManifest
        var validation: BubbleJSRuntime.Validation?
        var report: StudioPlaytest.Report?
        var sourcesUsed: [String]
        var filled: Int
    }

    /// A theme read from the request's words.
    struct Theme: Sendable {
        var keys: [String]
        var noun: String
        var emoji: String
        var palette: String
        /// Looks that suit the theme, best first (LOOKS.md); the first one the runtime has wins.
        var looks: [String]
        var motif: String?
        var words: [String]
    }

    let world: StudioDemoWorld?
    /// Seconds between timeline steps, so the app's timeline can animate. 0 in the CLI.
    var pacing: TimeInterval

    init(world: StudioDemoWorld?, pacing: TimeInterval = 0) {
        self.world = world
        self.pacing = pacing
    }

    // MARK: - Brief

    func brief(for request: StudioRequest) -> BubbleBrief {
        if let given = request.brief { return given }
        let text = request.prompt.lowercased()
        var mood: [String] = []
        let moodWords: [(String, [String])] = [
            ("chill", ["chill", "relax", "calm", "easy", "slow", "zen"]),
            ("cozy", ["cozy", "warm", "daily", "morning", "coffee"]),
            ("playful", ["fun", "silly", "playful", "goofy", "party"]),
            ("competitive", ["compete", "competitive", "beat", "race", "fast", "hard", "harder", "intense"]),
            ("nostalgic", ["nostalgic", "old", "remember", "retro"]),
            ("dreamy", ["dream", "night", "stars", "moon", "float"]),
        ]
        for (name, keys) in moodWords where keys.contains(where: { text.contains($0) }) {
            mood.append(name)
        }
        if request.mode == .daily { mood.append("cozy") }
        if request.scope.hasPrefix("event:") || text.contains("icebreaker") { mood.append("playful") }
        if mood.isEmpty { mood = request.base?.brief.mood ?? ["playful"] }
        mood = Array(StudioManifestBuilder.unique(mood).prefix(3))

        let energy: String
        if mood.contains("competitive") { energy = "high" } else if mood.contains("chill") || mood.contains("cozy") { energy = "low" } else { energy = "medium" }
        let competition: String
        if mood.contains("competitive") { competition = "friendly" } else if mood.contains("chill") { competition = "light" } else { competition = "light" }

        let occasion: String?
        if request.mode == .daily { occasion = "daily" }
        else if request.scope.hasPrefix("event:") || text.contains("icebreaker") { occasion = "icebreaker" }
        else if text.contains("club") { occasion = "club" }
        else { occasion = request.base?.brief.occasion }

        var intent = request.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if intent.isEmpty {
            intent = request.mode == .daily ? "today's game for \(StudioCopy.audience(request))" : (request.base?.brief.intent ?? "a quick game for friends")
        }
        let who = StudioCopy.audience(request)
        let notes = "I read this as \(StudioCopy.list(mood, limit: 2)), for \(who == "everyone" ? "everyone" : who)."
        return BubbleBrief(
            intent: String(intent.prefix(120)),
            audience: request.scope,
            mood: mood,
            energy: energy,
            competition: competition,
            occasion: occasion,
            contentSources: request.mode == .daily && !request.sources.isEmpty ? request.sources.map { "\($0.author)'s post (opted in)" } : nil,
            notes: notes
        )
    }

    // MARK: - Compose

    /// The whole offline pipeline as a Studio timeline: understand, brief, compose, content,
    /// validate, playtest, polish, done. Every event is marked offline.
    func stream(_ request: StudioRequest, runtime: StudioRuntime) -> AsyncThrowingStream<StudioEvent, Error> {
        AsyncThrowingStream { continuation in
            let timeline = StudioTimeline(continuation: continuation)
            let task = Task {
                let started = timeline.startDate
                timeline.emit(.understand, StudioCopy.understandTitle(request), detail: StudioCopy.understandDetail(request), offline: true)
                await StudioAsync.pause(self.pacing)
                let brief = self.brief(for: request)
                timeline.emit(.brief, "Brief from your words", detail: brief.notes, brief: brief, offline: true)
                await StudioAsync.pause(self.pacing)
                let catalog = (try? await runtime.catalog()) ?? .empty
                let result = await self.compose(request, brief: brief, catalog: catalog, runtime: runtime, timeline: timeline)
                if Task.isCancelled {
                    timeline.finish(throwing: CancellationError())
                    return
                }
                let builder = StudioManifestBuilder(request: request, catalog: catalog)
                let compiled = builder.compiled(result.manifest)
                let manifest = builder.stamped(compiled.manifest, models: [], started: started, offline: true, coverPrompt: nil)
                await StudioAsync.pause(self.pacing)
                let filled = result.filled + compiled.filled
                timeline.emit(.polish, "Final touches",
                              detail: filled == 0 ? "Every param already set · pinned engine v\(manifest.engineVersion)" : "Filled \(filled) defaults · pinned engine v\(manifest.engineVersion)",
                              offline: true)
                timeline.emit(.done, "Ready to play", detail: "\(manifest.title) · \(manifest.formula.rawValue) · made on this device",
                              manifest: manifest, offline: true, baseUpdate: builder.baseUpdate(for: manifest),
                              sources: result.sourcesUsed.isEmpty ? nil : result.sourcesUsed)
                timeline.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Composes, validates and playtests a Bubble without the network, emitting offline steps.
    func compose(_ request: StudioRequest, brief: BubbleBrief, catalog: StudioCatalog, runtime: StudioRuntime, timeline: StudioTimeline) async -> Result {
        let builder = StudioManifestBuilder(request: request, catalog: catalog, suffix: Self.stableSuffix(request), seed: Self.stableSeed(request))
        let theme = Self.theme(for: request, brief: brief)
        var sourcesUsed: [String] = []

        var manifest: BubbleManifest
        var notes: [String] = []
        switch builder.effectiveMode {
        case .edit, .remix, .nextLevel:
            let base = builder.compiled(request.base!).manifest
            manifest = base
            let changed = adapt(&manifest, from: base, request: request, theme: theme, catalog: catalog, builder: builder)
            notes = changed
            timeline.emit(.compose, Self.modeTitle(builder.effectiveMode, base: base),
                          detail: changed.isEmpty ? "Kept the \(base.formula.rawValue) core" : Self.sentence(StudioCopy.list(changed, limit: 3)),
                          concepts: manifest.conceptIDs, manifest: manifest, offline: true)
            if let look = catalog.look(manifest.style.look) {
                let kept = manifest.style.look == base.style.look && manifest.style.palette == base.style.palette && manifest.style.colors == base.style.colors
                timeline.emit(.compose, BubbleLookSpec.row(look, colors: builder.colorWords(manifest.style)),
                              detail: Self.lookLine(manifest.style, look: look, builder: builder, verb: kept ? "Kept" : "Switched to"),
                              manifest: manifest, offline: true)
            }
        case .create, .daily:
            let pick = Self.pickFormula(request: request, brief: brief, catalog: catalog)
            if let formula = pick.formula, let example = Self.bestExample(for: request, formula: formula) {
                manifest = example
                timeline.emit(.compose, "Picked \(formula.id)", detail: pick.reason, offline: true)
                await StudioAsync.pause(pacing)
                let identity = builder.identity(title: Self.title(theme: theme, formula: formula.id, request: request), operators: [])
                manifest.id = identity.id
                manifest.version = identity.version
                manifest.lineage = identity.lineage
                manifest.chain = identity.chain
                manifest.structure = identity.structure
                manifest.seed = identity.seed
                manifest.title = Self.title(theme: theme, formula: formula.id, request: request)
                manifest.brief = brief
                let look = Self.look(for: request, brief: brief, theme: theme, formula: formula.id, catalog: catalog, builder: builder)
                manifest.style = Self.style(look: look, theme: theme, request: request, brief: brief, catalog: catalog, builder: builder,
                                            emoji: theme?.emoji ?? manifest.style.emoji)
                timeline.emit(.compose, "Composed \(manifest.concepts.count) concepts",
                              detail: "Started from the tested \(formula.id) template", concepts: manifest.conceptIDs, manifest: manifest, offline: true)
                timeline.emit(.compose, BubbleLookSpec.row(look, colors: builder.colorWords(manifest.style)),
                              detail: Self.lookLine(manifest.style, look: look, builder: builder, verb: builder.lookHint?.id == look.id ? "Your pick:" : "Picked"),
                              manifest: manifest, offline: true)
            } else {
                manifest = Self.lastResort(request: request, brief: brief, builder: builder, theme: theme)
                timeline.emit(.compose, "Picked dodge", detail: "The game library didn't load, so Studio used its built-in starter",
                              concepts: manifest.conceptIDs, manifest: manifest, offline: true)
                if let look = catalog.look(manifest.style.look) ?? BubbleLookSpec.known[manifest.style.look] {
                    timeline.emit(.compose, BubbleLookSpec.row(look, colors: builder.colorWords(manifest.style)),
                                  detail: Self.lookLine(manifest.style, look: look, builder: builder, verb: "Picked"),
                                  manifest: manifest, offline: true)
                }
            }
        }
        await StudioAsync.pause(pacing)

        // Content from the request, the sources and the demo world.
        let original = manifest
        let contentNote = adaptContent(&manifest, request: request, theme: theme, catalog: catalog)
        sourcesUsed = contentNote.sources
        if let line = contentNote.line {
            timeline.emit(.content, line.title, detail: line.detail, offline: true, sources: sourcesUsed.isEmpty ? nil : sourcesUsed)
        }
        // Feature formulas write their own offline content; social and length hooks run after
        // (docs/BUBBLES.md 7.1).
        if let fill = StudioFormulaHints.hint(for: manifest.formula.rawValue)?.offlineContent, let line = fill(&manifest, request, brief) {
            timeline.emit(.content, line, offline: true)
        }
        StudioSocialHooks.applyOffline(&manifest, request: request, brief: brief)
        if (request.mode == .daily || request.scope.hasPrefix("event:")) && !request.sources.isEmpty {
            manifest.brief.contentSources = sourcesUsed.isEmpty ? nil : sourcesUsed.map { "\($0)'s post (opted in)" }
        }
        await StudioAsync.pause(pacing)

        // Validate; undo content changes that don't pass.
        let compiled = builder.compiled(manifest)
        manifest = compiled.manifest
        var validation: BubbleJSRuntime.Validation? = catalog.isEmpty ? nil : await runtime.validate(manifest)
        if let check = validation, !check.ok, manifest.content != original.content {
            var reverted = manifest
            reverted.content = original.content
            reverted = builder.compiled(reverted).manifest
            let second = await runtime.validate(reverted)
            if second.ok {
                manifest = reverted
                validation = second
                sourcesUsed = []
                timeline.emit(.repair, "Kept the template's content", detail: "The adapted content didn't pass: \(check.errors.first?.message ?? "")", offline: true)
            }
        }
        if let check = validation, !check.ok, let fixed = await builder.autofix(manifest, validate: { await runtime.validate($0) }) {
            manifest = fixed.manifest
            validation = await runtime.validate(manifest)
            timeline.emit(.repair, "Fixed the draft", detail: Self.sentence(StudioCopy.list(fixed.fixes, limit: 3)), offline: true)
        }
        if let check = validation, !check.ok, let safe = await Self.safeStarter(like: manifest, catalog: catalog, builder: builder, runtime: runtime) {
            // Never ship something that doesn't validate: take the first tested template that does.
            timeline.emit(.repair, "Switched to a tested \(safe.manifest.formula.rawValue) starter",
                          detail: "The \(manifest.formula.rawValue) draft didn't pass: \(check.errors.first?.message ?? "")", offline: true)
            manifest = safe.manifest
            validation = safe.validation
            sourcesUsed = []
        }
        if let check = validation {
            let count = check.errors.count
            timeline.emit(.validate, check.ok ? "Wiring checks out" : (count == 1 ? "Found 1 problem" : "Found \(count) problems"),
                          detail: check.ok ? "\(manifest.concepts.count) concepts, every event wired" : check.errors.first?.message,
                          manifest: manifest, issues: check.ok ? nil : check.errors.map { "\($0.code): \($0.message)" }, offline: true)
        }
        await StudioAsync.pause(pacing)

        // Playtest, and for harder levels make sure it is harder.
        var report: StudioPlaytest.Report?
        if !catalog.isEmpty {
            report = await runtime.playtest(manifest)
            // A harder or easier change that went too far: try gentler versions (a steeper ramp with
            // the same start, then smaller steps) and keep the first that plays well and still goes
            // the asked-for way.
            if let base = request.base, let retune = notes.first(where: { $0.hasPrefix("harder") || $0.hasPrefix("easier") }),
               let first = report, !first.passed,
               first.blocking.allSatisfy({ ["too_hard", "too_short", "too_easy", "never_ends"].contains($0.code) }) {
                let harder = retune.hasPrefix("harder")
                let start = builder.effectiveMode == .nextLevel ? 0.3 : 0.25
                let baseCompiled = builder.compiled(base).manifest
                let baseReport = await runtime.playtest(baseCompiled)
                var variants: [(label: String, amount: Double, only: ((String) -> Bool)?)] = []
                if harder {
                    variants.append(("a steeper ramp, same start", start * 2, Self.isRampParam))
                    variants.append(("a steeper ramp, same start", start, Self.isRampParam))
                }
                for share in [0.6, 0.35, 0.2] {
                    variants.append(("\(Int((start * share * 100).rounded()))% \(harder ? "harder" : "easier") instead of \(Int((start * 100).rounded()))%", start * share, nil))
                }
                var fallback: (BubbleManifest, StudioPlaytest.Report, String)?
                for variant in variants {
                    var candidate = manifest
                    candidate.concepts = Self.scaleDifficulty(baseCompiled, catalog: catalog, harder: harder, amount: variant.amount, only: variant.only).manifest.concepts
                    candidate = builder.compiled(candidate).manifest
                    guard candidate.concepts != manifest.concepts, (await runtime.validate(candidate)).ok else { continue }
                    let check = await runtime.playtest(candidate)
                    guard check.passed else { continue }
                    let comparison = StudioPlaytest.compare(check, to: baseReport, baseLabel: "base")
                    if (harder ? comparison.harder : comparison.easier) == true {
                        fallback = (candidate, check, variant.label)
                        break
                    }
                    if fallback == nil { fallback = (candidate, check, variant.label) }
                }
                if let (candidate, check, label) = fallback {
                    timeline.emit(.repair, "Softened the change",
                                  detail: "\(Self.sentence(first.headline)) at first, so Studio went with \(label)", offline: true)
                    manifest = candidate
                    report = check
                }
            }
            // A new Bubble whose random seed deals an unfair start: try a few other seeds.
            if builder.effectiveMode == .create || builder.effectiveMode == .remix, let first = report, !first.passed,
               first.blocking.allSatisfy({ ["too_hard", "too_short"].contains($0.code) }) {
                for step in 1...4 {
                    var candidate = manifest
                    candidate.seed = manifest.seed &+ step &* 7_919
                    let check = await runtime.playtest(candidate)
                    guard check.passed else { continue }
                    timeline.emit(.repair, "Dealt a fairer start", detail: "\(Self.sentence(first.headline)) with the first seed, so Studio picked another one",
                                  offline: true)
                    manifest = candidate
                    report = check
                    break
                }
            }
            if let base = request.base, builder.effectiveMode == .nextLevel || notes.contains(where: { $0.hasPrefix("harder") }) {
                let baseReport = await runtime.playtest(builder.compiled(base).manifest)
                let comparison = StudioPlaytest.compare(report!, to: baseReport, baseLabel: builder.effectiveMode == .nextLevel ? "level \(base.chain?.index ?? 1)" : "v\(base.version)")
                timeline.emit(.playtest, "Playtest: \(report!.headline)", detail: "\(report!.spread) · \(comparison.line)", manifest: manifest,
                              issues: report!.flags.isEmpty ? nil : report!.flags.map(\.message), offline: true)
            } else {
                timeline.emit(.playtest, "Playtest: \(report!.headline)", detail: report!.spread, manifest: manifest,
                              issues: report!.flags.isEmpty ? nil : report!.flags.map(\.message), offline: true)
            }
        }
        return Result(manifest: manifest, validation: validation, report: report, sourcesUsed: sourcesUsed, filled: compiled.filled)
    }

    /// The first formula example (in priority order) that validates, dressed in the draft's
    /// identity, title and look.
    private static func safeStarter(like draft: BubbleManifest, catalog: StudioCatalog, builder: StudioManifestBuilder, runtime: StudioRuntime) async -> (manifest: BubbleManifest, validation: BubbleJSRuntime.Validation)? {
        let ids = [draft.formula.rawValue] + formulaPriority + catalog.formulaIDs
        for id in StudioManifestBuilder.unique(ids) {
            guard var example = builder.exampleManifest(for: id) else { continue }
            let check = await runtime.validate(builder.compiled(example).manifest)
            guard check.ok else { continue }
            if id != draft.formula.rawValue {
                example.title = draft.title.isEmpty ? example.title : draft.title
            } else {
                example.title = draft.title
                example.oneLineRule = draft.oneLineRule.isEmpty ? example.oneLineRule : example.oneLineRule
            }
            example.id = draft.id
            example.version = draft.version
            example.lineage = draft.lineage
            example.chain = draft.chain
            example.structure = draft.structure
            example.seed = draft.seed
            example.brief = draft.brief
            let emoji = draft.style.emoji ?? example.style.emoji
            example.style = draft.style
            example.style.emoji = emoji
            example = builder.compiled(example).manifest
            let final = await runtime.validate(example)
            if final.ok { return (example, final) }
        }
        return nil
    }

    // MARK: - Edit, remix and next level

    /// Applies the request's words to a base manifest. Returns what changed, for the timeline.
    private func adapt(_ manifest: inout BubbleManifest, from base: BubbleManifest, request: StudioRequest, theme: Theme?, catalog: StudioCatalog, builder: StudioManifestBuilder) -> [String] {
        var changes: [String] = []
        let text = request.prompt.lowercased()
        var operators: [String] = []

        // The look: kept unless the request asks for a new one (LOOKS.md).
        if !builder.keepsBaseLook {
            let night = ["night", "dark", "darker", "moon", "midnight"].contains { BubbleLookSpec.tokens(text).contains($0) }
            let named = catalog.looks.first { BubbleLookSpec.tokens(text).contains($0.id) }
            let look = builder.lookHint ?? named ?? (night ? catalog.look("neon") : nil)
                ?? Self.look(for: request, brief: manifest.brief, theme: theme, formula: base.formula.rawValue, catalog: catalog, builder: builder)
            var style = Self.style(look: look, theme: theme, request: request, brief: manifest.brief, catalog: catalog, builder: builder,
                                   emoji: night && !text.contains("emoji") ? "🌙" : (theme?.emoji ?? manifest.style.emoji))
            if night, look.id != "neon", catalog.isPreset("night-bloom") {
                style.palette = "night-bloom"
                style.colors = nil
            }
            style.motif = style.motif ?? base.style.motif
            if style.look != base.style.look || style.palette != base.style.palette || style.colors != base.style.colors {
                manifest.style = style
                changes.append("\(look.phrase) look")
                operators.append("re-skin")
            }
        } else if let palette = request.paletteHint, catalog.isPreset(palette), palette != manifest.style.palette {
            manifest.style.palette = palette
            manifest.style.colors = nil
            changes.append("\(palette) palette")
            operators.append("re-skin")
        }

        let wantsHarder = builder.effectiveMode == .nextLevel || ["harder", "tougher", "faster", "difficult", "challenging", "trickier"].contains { text.contains($0) }
        let wantsEasier = !wantsHarder && ["easier", "slower", "gentler", "simpler", "relaxed"].contains { text.contains($0) }
        if wantsHarder || wantsEasier {
            let tuned = Self.scaleDifficulty(manifest, catalog: catalog, harder: wantsHarder, amount: builder.effectiveMode == .nextLevel ? 0.3 : 0.25)
            manifest = tuned.manifest
            if !tuned.changes.isEmpty {
                changes.append("\(wantsHarder ? "harder" : "easier"): \(StudioCopy.list(tuned.changes, limit: 2))")
                operators.append("re-tune")
            }
        }

        let title: String
        switch builder.effectiveMode {
        case .remix:
            title = theme.map { "\($0.noun) \(Self.formulaNoun(base.formula.rawValue, seed: request.prompt))" } ?? "\(base.title) remix"
        case .nextLevel:
            let index = (base.chain?.index ?? 1) + 1
            title = "\(base.chain?.title ?? base.title) \(index)"
        default:
            title = base.title
        }
        let identity = builder.identity(title: title, operators: operators)
        manifest.id = identity.id
        manifest.version = identity.version
        manifest.lineage = identity.lineage
        manifest.chain = identity.chain
        manifest.structure = identity.structure
        manifest.seed = identity.seed
        if manifest.title != title {
            manifest.title = title
            changes.append("title “\(title)”")
        }
        let intent = request.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !intent.isEmpty { manifest.brief.notes = "\(Self.modeVerb(builder.effectiveMode)): \(intent)" }
        return changes
    }

    /// Scales params that clearly set difficulty. A param spec's `harder` ("up" or "down") wins;
    /// otherwise the name decides (speeds and rates up, gaps, timers and tries down).
    /// Params that set how fast a run ramps up (not how it starts).
    static func isRampParam(_ name: String) -> Bool {
        let key = name.lowercased()
        return ["rate", "shrink", "ramp", "accel", "max"].contains(where: key.contains)
    }

    static func scaleDifficulty(_ manifest: BubbleManifest, catalog: StudioCatalog, harder: Bool, amount: Double,
                                only: ((String) -> Bool)? = nil) -> (manifest: BubbleManifest, changes: [String]) {
        var out = manifest
        var changes: [String] = []
        for index in out.concepts.indices {
            guard let concept = catalog.concept(out.concepts[index].use) else { continue }
            var params = out.concepts[index].params ?? [:]
            for (name, spec) in concept.params.sorted(by: { $0.key < $1.key }) {
                let type = spec["type"]?.string ?? ""
                guard type == "number" || type == "integer" else { continue }
                guard only?(name) ?? true, let direction = spec["harder"]?.string ?? Self.difficultyDirection(name) else { continue }
                guard let current = params[name]?.double ?? spec["default"]?.double else { continue }
                let up = (direction == "up") == harder
                var value = current * (up ? 1 + amount : 1 - amount)
                if type == "integer" {
                    value = up ? max(value.rounded(), current + 1) : min(value.rounded(), current - 1)
                }
                if let low = spec["min"]?.double { value = max(value, low) }
                if let high = spec["max"]?.double { value = min(value, high) }
                if type == "number" { value = (value * 1000).rounded() / 1000 }
                guard value != current else { continue }
                params[name] = .number(value)
                changes.append("\(StudioCopy.humanKey(name)) \(Self.number(current)) → \(Self.number(value))")
            }
            out.concepts[index].params = params.isEmpty ? nil : params
        }
        return (out, changes)
    }

    static func difficultyDirection(_ name: String) -> String? {
        let key = name.lowercased()
        // Checked first: these grow harder upward even when they also name a gap ("gap_shrink").
        if key.contains("shrink") || key == "max" || key.hasSuffix("_max") { return "up" }
        let downWords = ["gap", "interval", "spacing", "attempt", "tries", "lives", "hearts", "seconds", "duration", "window", "tolerance", "time_limit", "grace", "hint"]
        let upWords = ["speed", "rate", "gravity", "ramp", "accel", "density", "wind", "frequency", "max_obstacles", "drift"]
        if downWords.contains(where: key.contains) { return "down" }
        if upWords.contains(where: key.contains) { return "up" }
        return nil
    }

    // MARK: - Content

    private struct ContentNote {
        var line: (title: String, detail: String)?
        var sources: [String]
    }

    /// Adapts the template's content: daily and icebreaker content from the sources, themed labels
    /// from the request. Formula-specific where the content shape is known, generic otherwise.
    private func adaptContent(_ manifest: inout BubbleManifest, request: StudioRequest, theme: Theme?, catalog: StudioCatalog) -> ContentNote {
        guard var content = manifest.content.object else { return ContentNote(line: nil, sources: []) }
        let names = request.audienceNames.isEmpty ? (world?.people.map(\.firstName) ?? []) : request.audienceNames

        // Answer rounds from what people shared ("Who runs Lands End every Saturday?").
        if manifest.formula == .answer, (request.scope.hasPrefix("event:") || request.mode == .daily), !request.sources.isEmpty,
           manifest.uses("rule.answer_key") || catalog.concept("rule.answer_key") != nil {
            let rounds = Self.whoRounds(sources: request.sources, names: names)
            if rounds.count >= 2 {
                content["rounds"] = .array(rounds.map { $0.json })
                if manifest.uses("rule.consensus") {
                    manifest.concepts = manifest.concepts.map { use in
                        if use.use == "rule.consensus" { return ConceptUse("rule.answer_key") }
                        if use.use == "score.closeness" { return ConceptUse("score.answer_points") }
                        return use
                    }
                }
                content.removeValue(forKey: "crowd")
                manifest.content = .object(content)
                let used = StudioManifestBuilder.unique(rounds.map(\.author))
                if manifest.oneLineRule.lowercased().contains("picked") { manifest.oneLineRule = "Match each fact to the newcomer who shared it." }
                return ContentNote(line: ("Wrote \(rounds.count) who-said-it rounds", "From what \(StudioCopy.list(used, limit: 4)) shared"), sources: used)
            }
        }

        // Guess, who style: people and their facts, from what they shared.
        if manifest.formula == .guess, content["people"] != nil || content["rounds"] != nil, !request.sources.isEmpty {
            var people: [JSONValue] = []
            var used: [String] = []
            for (index, source) in request.sources.prefix(8).enumerated() {
                let facts = source.text.split(whereSeparator: { $0 == "." || $0 == "!" || $0 == "?" })
                    .compactMap { Self.thirdPersonFact(String($0)) }
                    .filter { $0.count <= 90 }
                guard !facts.isEmpty else { continue }
                var person: [String: JSONValue] = [
                    "id": .string("p\(index + 1)"),
                    "name": .string(source.author),
                    "facts": .array(facts.prefix(2).map { .string($0) }),
                ]
                if let url = world?.person(named: source.author)?.avatarURL { person["avatar"] = .string(url) }
                people.append(.object(person))
                used.append(source.author)
            }
            if people.count >= 3 {
                content["people"] = .array(people)
                content.removeValue(forKey: "rounds")
                manifest.content = .object(content)
                if let index = manifest.concepts.firstIndex(where: { $0.use == "flow.rounds" }) {
                    var params = manifest.concepts[index].params ?? [:]
                    params["count"] = .number(Double(min(max(people.count, 3), 6)))
                    manifest.concepts[index].params = params
                }
                return ContentNote(line: ("Wrote facts for \(people.count) people", "From what \(StudioCopy.list(used, limit: 4)) shared"), sources: used)
            }
        }

        // Guess, word style: today's words from the posts, each with a fill-in-the-blank clue.
        if manifest.formula == .guess, content["words"] != nil, !request.sources.isEmpty {
            var words: [String] = []
            var clues: [String: JSONValue] = [:]
            var used: [String] = []
            for source in request.sources {
                for sentence in source.text.split(whereSeparator: { $0 == "." || $0 == "!" || $0 == "?" }).map(String.init) {
                    for word in Self.words(in: sentence, lengths: 4...8) where !words.contains(word) && !Self.common.contains(word) {
                        guard let clue = Self.blankedClue(sentence, word: word, author: source.author) else { continue }
                        words.append(word)
                        clues[word] = .string(clue)
                        if !used.contains(source.author) { used.append(source.author) }
                        break
                    }
                    if words.count >= 6 { break }
                }
            }
            if words.count >= 3 {
                content["words"] = .array(words.map { .string($0) })
                content["clues"] = .object(clues)
                content.removeValue(forKey: "target")
                if let dictionary = content["dictionary"]?.strings {
                    content["dictionary"] = .array(StudioManifestBuilder.unique(dictionary + words).map { .string($0) })
                }
                manifest.content = .object(content)
                manifest.oneLineRule = "Guess today's word from \(request.scopeName ?? "the Group")'s posts in six tries."
                if manifest.oneLineRule.count > 70 { manifest.oneLineRule = "Guess today's word from the Group's posts in six tries." }
                return ContentNote(line: ("Picked \(words.count) words from today's posts", "Clues quote posts by \(StudioCopy.list(used, limit: 4))"), sources: used)
            }
        }

        // Guess: today's word from the posts.
        if manifest.formula == .guess, let target = content["target"]?.string {
            let length = target.count
            let fromSources = request.sources.flatMap { source in Self.words(in: source.text, length: length).map { ($0, source.author) } }
            let pool: [(String, String?)] = fromSources.isEmpty
                ? (world?.sfWords.filter { $0.count == length }.map { ($0, nil) } ?? [])
                : fromSources.map { ($0.0, Optional($0.1)) }
            if !pool.isEmpty {
                let pick = pool[Self.stableIndex(request.date ?? request.prompt, count: pool.count)]
                content["target"] = .string(pick.0)
                if var dictionary = content["dictionary"]?.strings, !dictionary.contains(pick.0) {
                    dictionary.append(pick.0)
                    content["dictionary"] = .array(dictionary.map { .string($0) })
                }
                manifest.content = .object(content)
                if let author = pick.1 {
                    return ContentNote(line: ("Picked today's word from \(author)'s post", "A \(length)-letter word, from opted-in posts only"), sources: [author])
                }
                return ContentNote(line: ("Picked today's word", "A \(length)-letter San Francisco word"), sources: [])
            }
        }

        // Generic: swap short label lists for theme words.
        guard let theme else { return ContentNote(line: nil, sources: []) }
        var swapped: [String] = []
        for (key, value) in content.sorted(by: { $0.key < $1.key }) {
            guard let list = value.array, list.count >= 2, list.allSatisfy({ ($0.string?.count ?? 99) <= 18 }) else { continue }
            let upper = list.allSatisfy { $0.string == $0.string?.uppercased() }
            let words = theme.words.filter { $0.count <= 18 }
            guard words.count >= list.count else { continue }
            content[key] = .array(words.prefix(list.count).map { .string(upper ? $0.uppercased() : $0) })
            swapped.append("\(list.count) \(StudioCopy.humanKey(key))")
        }
        guard !swapped.isEmpty else { return ContentNote(line: nil, sources: []) }
        manifest.content = .object(content)
        return ContentNote(line: ("Themed the content", "\(Self.sentence(StudioCopy.list(swapped))) about \(theme.noun.lowercased())s"), sources: [])
    }

    private struct WhoRound {
        var author: String
        var json: JSONValue
    }

    /// Rounds that match a fact to the person who shared it, up to two facts per person.
    private static func whoRounds(sources: [StudioSource], names: [String]) -> [WhoRound] {
        let everyone = StudioManifestBuilder.unique(sources.map(\.author) + names)
        var perSource: [[(String, String)]] = []
        for source in sources.prefix(10) {
            let questions = source.text.split(whereSeparator: { $0 == "." || $0 == "!" || $0 == "?" })
                .compactMap { whoQuestion(String($0)) }
            perSource.append(questions.prefix(2).map { (source.author, $0) })
        }
        // First facts first, then second ones, so more people get a round.
        var picked: [(String, String)] = []
        for slot in 0..<2 {
            for questions in perSource where questions.count > slot {
                picked.append(questions[slot])
            }
        }
        var rounds: [WhoRound] = []
        for (index, item) in picked.prefix(8).enumerated() {
            let (author, prompt) = item
            let others = everyone.filter { $0 != author }
            guard !others.isEmpty else { continue }
            var choices = [author]
            for step in 0..<2 {
                let other = others[(index * 3 + step * 5) % others.count]
                if !choices.contains(other) { choices.append(other) }
            }
            let rotation = index % choices.count
            let ordered = Array(choices[rotation...] + choices[..<rotation])
            rounds.append(WhoRound(author: author, json: [
                "prompt": .string(prompt),
                "choices": .array(ordered.map { .string($0) }),
                "answer": .number(Double(ordered.firstIndex(of: author) ?? 0)),
            ]))
        }
        return rounds
    }

    /// "I bake way too much sourdough" → "Bakes way too much sourdough" (a fact about them).
    static func thirdPersonFact(_ sentence: String) -> String? {
        guard let question = whoQuestion(sentence) else { return nil }
        var body = String(question.dropFirst("Who ".count).dropLast())
        if body.hasPrefix("is ") && body.count > 3 { body = String(body) }
        guard let first = body.first else { return nil }
        return first.uppercased() + body.dropFirst()
    }

    /// A fill-in-the-blank clue from the sentence the word came from: Diego: “I bake way too much _________”.
    static func blankedClue(_ sentence: String, word: String, author: String) -> String? {
        let clean = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let range = clean.range(of: word, options: .caseInsensitive) else { return nil }
        let blanked = clean.replacingCharacters(in: range, with: String(repeating: "_", count: word.count))
        let clue = "\(author): “\(blanked)”"
        return clue.count <= 90 ? clue : nil
    }

    /// "I bake way too much sourdough and need…" → "Who bakes way too much sourdough?";
    /// "Moved from Austin three weeks ago" → "Who moved from Austin three weeks ago?".
    static func whoQuestion(_ sentence: String) -> String? {
        var text = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 12 else { return nil }
        for cut in [" and I ", " and I'm ", ", so ", " but "] {
            if let range = text.range(of: cut) { text = String(text[..<range.lowerBound]) }
        }
        var words = text.split(separator: " ").map(String.init)
        guard let first = words.first else { return nil }
        var predicate: [String]
        switch first.lowercased() {
        case "i'm", "i’m":
            predicate = ["is"] + words.dropFirst()
        case "i":
            guard words.count > 2 else { return nil }
            if let and = words.firstIndex(of: "and"), and > 1 { words = Array(words[..<and]) }
            predicate = [thirdPerson(words[1])] + words.dropFirst(2)
        default:
            if isThirdPersonVerbPhrase(text) || ["will", "can", "would"].contains(first.lowercased()) {
                predicate = [first.lowercased()] + words.dropFirst()
            } else if first.lowercased().hasSuffix("ing"), first.count > 4 {
                predicate = ["is", first.lowercased()] + words.dropFirst()
            } else {
                return nil
            }
        }
        let swaps = ["my": "their", "me": "them", "myself": "themselves", "I": "they", "I'm": "they're"]
        let body = predicate.map { swaps[$0] ?? $0 }.joined(separator: " ")
        let question = "Who \(body)?"
        return question.count <= 90 ? question : nil
    }

    /// bake → bakes, teach → teaches, carry → carries, have → has, am → is.
    static func thirdPerson(_ verb: String) -> String {
        let lower = verb.lowercased()
        switch lower {
        case "am", "'m": return "is"
        case "have": return "has"
        case "do": return "does"
        case "go": return "goes"
        case "will", "can", "would", "could", "should", "might", "must": return lower
        default: break
        }
        if ["s", "sh", "ch", "x", "z", "o"].contains(where: { lower.hasSuffix($0) }) { return lower + "es" }
        if lower.hasSuffix("y"), let before = lower.dropLast().last, !"aeiou".contains(before) { return lower.dropLast() + "ies" }
        return lower + "s"
    }

    /// "Runs the Lands End trail…", "Moved from Austin…", "Is still getting used to the fog".
    private static func isThirdPersonVerbPhrase(_ text: String) -> Bool {
        guard let first = text.split(separator: " ").first?.lowercased() else { return false }
        if ["moved", "arrived", "grew", "still", "just", "is", "has", "loves"].contains(first) { return true }
        return first.count > 3 && first.hasSuffix("s") && !first.hasSuffix("ss") && first.first?.isLetter == true
    }

    /// Uppercase words with a letter count in `lengths`, longest first.
    private static func words(in text: String, lengths: ClosedRange<Int>) -> [String] {
        let words = text.split(whereSeparator: { !$0.isLetter }).map { String($0).uppercased() }
        return StudioManifestBuilder.unique(words.filter { lengths.contains($0.count) && $0.allSatisfy { $0.isASCII && $0.isLetter } })
            .sorted { $0.count > $1.count }
    }

    /// Uppercase words of exactly `length` letters in a text.
    private static func words(in text: String, length: Int) -> [String] {
        let words = text.split(whereSeparator: { !$0.isLetter }).map { String($0).uppercased() }
        return StudioManifestBuilder.unique(words.filter { $0.count == length && $0.allSatisfy { $0.isASCII && $0.isLetter } && !common.contains($0) })
    }

    private static let common: Set<String> = [
        "ABOUT", "THREE", "WEEKS", "THERE", "THEIR", "WHICH", "WOULD", "COULD", "LOOKING", "PEOPLE", "SHIFTS", "STILL", "NEVER",
        "EVERY", "AFTER", "MOVED", "SINCE", "WHERE", "THINK", "TODAY", "OTHER", "TOWNS", "ANYONE", "ACROSS", "AROUND", "WITH",
        "FROM", "THAT", "THIS", "HAVE", "WANT", "NEED", "WILL", "LAST", "WEEK", "MOST", "MUCH", "MORE", "LOVE", "FREE", "TOWN",
        "JUST", "SOME", "INTO", "EVEN", "BEST", "GIVE", "AGO", "WAY", "TOO", "FOR", "AND", "THE", "NEW", "CITY", "MORNINGS",
        "SATURDAY", "SUNDAYS", "EVENINGS", "AFTERNOONS", "ARRIVED", "BRAVE", "COMPANY", "BUDDY", "TRADE", "LESSONS", "HUNTING",
    ]

    // MARK: - Picking

    /// Built-in keywords plus each feature formula's (`StudioFormulaHints`).
    static let formulaKeywords: [String: [String]] = baseFormulaKeywords.merging(StudioFormulaHints.keywords) { builtIn, _ in builtIn }

    static let baseFormulaKeywords: [String: [String]] = [
        "dodge": ["dodge", "avoid", "fly", "float", "flap", "jump", "hop", "run", "runner", "running", "jog", "hill", "hills", "obstacle", "survive", "endless", "drift", "glide", "swim", "bike", "surf", "wave", "fog", "chill"],
        "guess": ["word", "words", "guess", "letter", "letters", "spell", "puzzle", "riddle", "daily word"],
        "group": ["sort", "group them", "category", "categories", "categorize", "match", "pairs", "which neighborhood", "bucket", "belongs"],
        "answer": ["quiz", "trivia", "question", "questions", "this or that", "would you rather", "poll", "vote", "pick", "consensus", "icebreaker", "who's", "whos", "who is", "get to know", "facts", "fact", "newcomer"],
        "time": ["stack", "stacking", "timing", "right moment", "rhythm", "beat", "catch", "tower", "precision", "sourdough", "cable car", "tap at"],
        "merge": ["merge", "combine", "grow", "fuse", "bigger", "blend", "match three"],
    ]

    static let formulaPriority = ["dodge", "guess", "group", "answer", "time", "merge"] + StudioFormulaHints.formulas

    static func pickFormula(request: StudioRequest, brief: BubbleBrief, catalog: StudioCatalog) -> (formula: StudioCatalog.Formula?, reason: String) {
        let available = catalog.formulas.filter { $0.example != nil }
        guard !available.isEmpty else { return (nil, "") }
        if let hint = request.formulaHint, let formula = available.first(where: { $0.id == hint.rawValue }) {
            return (formula, "You picked \(formula.title.lowercased())")
        }
        let text = " " + (request.prompt + " " + brief.intent).lowercased() + " "
        var scores: [String: Int] = [:]
        var hits: [String: [String]] = [:]
        for (formula, keys) in formulaKeywords {
            for key in keys where text.contains(" \(key)") || text.contains("\(key) ") {
                scores[formula, default: 0] += 1
                hits[formula, default: []].append(key)
            }
        }
        if request.mode == .daily {
            scores["guess", default: 0] += 2
            scores["answer", default: 0] += 1
        }
        if request.scope.hasPrefix("event:") || text.contains("icebreaker") || text.contains("picnic") {
            scores["guess", default: 0] += 2
            scores["answer", default: 0] += 1
        }
        let ranked = available.sorted { a, b in
            let sa = scores[a.id] ?? 0
            let sb = scores[b.id] ?? 0
            if sa != sb { return sa > sb }
            return (formulaPriority.firstIndex(of: a.id) ?? 99) < (formulaPriority.firstIndex(of: b.id) ?? 99)
        }
        let pick = ranked[0]
        let words = StudioManifestBuilder.unique(hits[pick.id] ?? []).prefix(2).map { "“\($0)”" }
        let reason: String
        if request.mode == .daily && words.isEmpty {
            reason = "Daily \(ProductName.plural) work best as a quick \(pick.title.lowercased()) game everyone shares"
        } else if words.isEmpty {
            reason = "A one-touch game anyone can jump into"
        } else {
            reason = "Your words \(words.joined(separator: " and ")) fit \(pick.title.lowercased())"
        }
        return (pick, reason)
    }

    /// The formula example that fits the request best: the kit's daily example for a Daily Bubble,
    /// its icebreaker example for an Event, otherwise the one sharing the most words.
    static func bestExample(for request: StudioRequest, formula: StudioCatalog.Formula) -> BubbleManifest? {
        let candidates = ([formula.example].compactMap { $0 } + formula.examples).compactMap { try? $0.decode(BubbleManifest.self) }
        guard !candidates.isEmpty else { return nil }
        let wantsDaily = request.mode == .daily
        let wantsIcebreaker = request.scope.hasPrefix("event:") || request.prompt.lowercased().contains("icebreaker")
        let words = Set(request.prompt.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init).filter { $0.count > 3 })
        func score(_ example: BubbleManifest) -> Int {
            var total = 0
            if wantsDaily && (example.structure.cadence == "daily" || example.brief.occasion == "daily") { total += 5 }
            if wantsIcebreaker && (example.brief.occasion == "icebreaker" || example.structure.scope.hasPrefix("event:")) { total += 5 }
            let text = "\(example.title) \(example.oneLineRule) \(example.brief.intent)".lowercased()
            total += words.filter { text.contains($0) }.count
            return total
        }
        return candidates.enumerated().max { a, b in
            let (sa, sb) = (score(a.element), score(b.element))
            return sa != sb ? sa < sb : a.offset > b.offset
        }?.element
    }

    static let themes: [Theme] = [
        Theme(keys: ["hill", "hills", "twin peaks", "bernal"], noun: "Hill", emoji: "⛰️", palette: "sky-glow", looks: ["paper"], motif: "hills",
              words: ["Twin Peaks", "Bernal", "Nob Hill", "Russian Hill", "Telegraph", "Potrero", "Tank Hill", "Corona"]),
        Theme(keys: ["fog", "foggy", "karl"], noun: "Fog", emoji: "🌫️", palette: "lilac-haze", looks: ["ink", "glow"], motif: "clouds",
              words: ["Fog bank", "Sea mist", "Gray wall", "Drizzle", "Marine layer", "Cloud puff", "Mist", "Haze"]),
        Theme(keys: ["run", "running", "jog", "runner", "marathon"], noun: "Run", emoji: "🏃", palette: "mint-pop", looks: ["pixel", "paper"], motif: "city",
              words: ["Uphill", "Stairs", "Puddle", "Curb", "Crosswalk", "Steep block", "Wind gust", "Long hill"]),
        Theme(keys: ["picnic", "blanket", "dolores"], noun: "Picnic", emoji: "🧺", palette: "peach-fizz", looks: ["paper"], motif: "leaves",
              words: ["Blanket", "Sandwich", "Lemonade", "Frisbee", "Grapes", "Sunhat", "Cookies", "Speaker"]),
        Theme(keys: ["beach", "ocean", "surf", "wave", "waves"], noun: "Wave", emoji: "🌊", palette: "sky-glow", looks: ["glow", "clay"], motif: "waves",
              words: ["Wave", "Seagull", "Sandbar", "Kelp", "Foam", "Riptide", "Driftwood", "Sea lion"]),
        Theme(keys: ["coffee", "cafe", "latte"], noun: "Coffee", emoji: "☕", palette: "peach-fizz", looks: ["riso", "paper"], motif: "dots",
              words: ["Latte", "Cortado", "Pour-over", "Mocha", "Cold brew", "Croissant", "Oat milk", "Espresso"]),
        Theme(keys: ["sourdough", "bread", "bake", "baking"], noun: "Sourdough", emoji: "🍞", palette: "peach-fizz", looks: ["riso", "clay"], motif: "dots",
              words: ["Starter", "Crust", "Crumb", "Loaf", "Boule", "Flour", "Proof", "Oven"]),
        Theme(keys: ["bike", "cycling", "cyclist"], noun: "Bike", emoji: "🚲", palette: "mint-pop", looks: ["pixel"], motif: "city",
              words: ["Pothole", "Tram track", "Steep hill", "Bike lane", "Bell", "Hill climb", "Wind", "Pigeon"]),
        Theme(keys: ["cable car", "trolley", "tram", "muni"], noun: "Cable Car", emoji: "🚋", palette: "peach-fizz", looks: ["pixel"], motif: "city",
              words: ["Powell", "Hyde", "Turnaround", "Bell", "Grip", "Brake", "Hill", "Conductor"]),
        Theme(keys: ["music", "band", "song", "open mic", "concert"], noun: "Encore", emoji: "🎵", palette: "night-bloom", looks: ["neon"], motif: "grid",
              words: ["Bass", "Snare", "Keys", "Encore", "Chorus", "Riff", "Mic", "Amp"]),
        Theme(keys: ["night", "dark", "moon", "stars"], noun: "Night", emoji: "🌙", palette: "night-bloom", looks: ["neon"], motif: "stars",
              words: ["Moon", "Star", "Streetlight", "Neon", "Owl", "Comet", "Firefly", "Lantern"]),
        Theme(keys: ["park", "garden", "tree", "golden gate park"], noun: "Park", emoji: "🌳", palette: "mint-pop", looks: ["paper", "ink"], motif: "leaves",
              words: ["Oak", "Bench", "Fountain", "Squirrel", "Meadow", "Path", "Tulip", "Pond"]),
        Theme(keys: ["bridge"], noun: "Bridge", emoji: "🌉", palette: "peach-fizz", looks: ["ink", "riso"], motif: "waves",
              words: ["Cable", "Tower", "Fog", "Bolt", "Railing", "Span", "Gull", "Breeze"]),
        Theme(keys: ["dumpling", "taco", "burrito", "food", "snack", "noodle"], noun: "Snack", emoji: "🥟", palette: "peach-fizz", looks: ["clay"], motif: "dots",
              words: ["Dumpling", "Burrito", "Bao", "Taco", "Noodles", "Pho", "Mochi", "Churro"]),
        Theme(keys: ["newcomer", "new in", "welcome", "icebreaker", "meet", "neighbor"], noun: "Hello", emoji: "👋", palette: "peach-fizz", looks: ["paper"], motif: "dots",
              words: ["Hello", "Wave", "Name tag", "High five", "Smile", "New friend", "Coffee", "Picnic"]),
        Theme(keys: ["swim", "cold water", "aquatic"], noun: "Swim", emoji: "🏊", palette: "sky-glow", looks: ["clay", "glow"], motif: "waves",
              words: ["Buoy", "Wave", "Cold snap", "Kelp", "Seal", "Splash", "Current", "Fog"]),
        Theme(keys: ["board game", "game night", "trivia"], noun: "Game Night", emoji: "🎲", palette: "night-bloom", looks: ["chalk", "neon"], motif: "grid",
              words: ["Dice", "Meeple", "Card", "Token", "Timer", "Buzzer", "Pawn", "Spinner"]),
    ]

    /// The Daily Bubble's theme when the prompt names none.
    static let dailyTheme = Theme(keys: [], noun: "Neighbor", emoji: "🏡", palette: "lilac-haze", looks: ["ink", "riso", "paper"], motif: "city",
                                  words: ["Hello", "Corner", "Stoop", "Porch", "Block", "Cafe", "Bus stop", "Park"])

    static func theme(for request: StudioRequest, brief: BubbleBrief) -> Theme? {
        // A Daily Bubble's intent names the Group ("New in SF"), not a theme: only its prompt counts.
        let words = request.mode == .daily ? request.prompt : request.prompt + " " + brief.intent
        let text = " " + words.lowercased() + " "
        var best: (Theme, Int)?
        for theme in themes {
            let score = theme.keys.filter { text.contains(" \($0)") }.count
            if score > 0, score > (best?.1 ?? 0) { best = (theme, score) }
        }
        if let best { return best.0 }
        if request.mode == .daily { return dailyTheme }
        if request.scope.hasPrefix("event:") { return themes.first { $0.noun == "Hello" } }
        return nil
    }

    /// The theme's look when the runtime has it, otherwise the best fit for the words and formula.
    static func look(for request: StudioRequest, brief: BubbleBrief, theme: Theme?, formula: String, catalog: StudioCatalog, builder: StudioManifestBuilder) -> BubbleLookSpec {
        // The creator's pick wins; then style words in the request ("retro", "cute", "brainy") beat
        // the theme's usual look.
        if let hint = builder.lookHint { return hint }
        if !BubbleLookSpec.hasStyleWords(request.prompt), let theme, let look = theme.looks.lazy.compactMap({ catalog.look($0) }).first {
            return look
        }
        return builder.defaultLook(brief: brief, formula: formula)
    }

    /// A complete style in a look: the creator's preset palette, else the theme's preset for glow
    /// and the look's own colors for the rest; the look's first font; the theme's motif.
    static func style(look: BubbleLookSpec, theme: Theme?, request: StudioRequest, brief: BubbleBrief, catalog: StudioCatalog,
                      builder: StudioManifestBuilder, emoji: String?) -> BubbleStyle {
        var style = BubbleStyle(look: look.id, palette: "lilac-haze", font: look.fonts.first ?? "rounded", motif: theme?.motif,
                                moodPreset: brief.mood.first, emoji: emoji)
        if let hint = builder.paletteHintPreset {
            style.palette = hint
        } else if look.id == "glow", let palette = theme?.palette, catalog.isPreset(palette) {
            style.palette = palette
        } else {
            let resolved = builder.defaultPalette(look: look, brief: brief)
            style.palette = resolved["palette"]?.string ?? "lilac-haze"
            if let colors = StudioColors.colors(from: resolved["colors"]) { style.colors = colors }
        }
        let scene = "\(theme.map { "a \($0.noun.lowercased()) scene" } ?? "a playful scene") for a tiny game about \(brief.intent)"
        style.coverPrompt = MusePrompts.coverPrompt(scene: scene, look: look, colors: builder.colorWords(style), motif: style.motif)
        return style
    }

    /// "Picked a paper-cutout look in cream, tomato red and teal, with rolling hills behind".
    static func lookLine(_ style: BubbleStyle, look: BubbleLookSpec, builder: StudioManifestBuilder, verb: String) -> String {
        var line = "\(verb) \(look.withArticle) look in \(builder.colorWords(style))"
        if let motif = style.motif, let phrase = BubbleLookSpec.motifPhrases[motif] { line += ", with \(phrase) behind" }
        return line
    }

    static func title(theme: Theme?, formula: String, request: StudioRequest) -> String {
        if request.mode == .daily {
            return "\(theme?.noun ?? "Daily") \(formula == "guess" ? "Words" : formulaNoun(formula, seed: request.date ?? ""))"
        }
        if request.scope.hasPrefix("event:") && theme?.noun == "Hello" {
            return formula == "answer" ? "Who's Who" : "Hello \(formulaNoun(formula, seed: request.prompt))"
        }
        return "\(theme?.noun ?? "Pop") \(formulaNoun(formula, seed: request.prompt))"
    }

    static func formulaNoun(_ formula: String, seed: String) -> String {
        let options: [String]
        switch formula {
        case "dodge": options = ["Dash", "Drift", "Glide"]
        case "guess": options = ["Words", "Guess"]
        case "group": options = ["Sort", "Sorter"]
        case "answer": options = ["Quiz", "Picks"]
        case "time": options = ["Stack", "Catch"]
        case "merge": options = ["Merge", "Fizz"]
        default: options = StudioFormulaHints.hint(for: formula).map(\.nouns).flatMap { $0.isEmpty ? nil : $0 } ?? ["Pop"]
        }
        return options[stableIndex(seed, count: options.count)]
    }

    /// The built-in starter when the runtime has no catalog (placeholder runtime).
    static func lastResort(request: StudioRequest, brief: BubbleBrief, builder: StudioManifestBuilder, theme: Theme?) -> BubbleManifest {
        let title = "\(theme?.noun ?? "Pop") Drift"
        let identity = builder.identity(title: title, operators: [])
        return BubbleManifest(
            id: identity.id,
            version: identity.version,
            title: title,
            oneLineRule: "Tap to glide through the gaps.",
            formula: .dodge,
            brief: brief,
            structure: identity.structure,
            lineage: identity.lineage,
            chain: identity.chain,
            style: style(look: look(for: request, brief: brief, theme: theme, formula: "dodge", catalog: builder.catalog, builder: builder),
                         theme: theme, request: request, brief: brief, catalog: builder.catalog, builder: builder, emoji: theme?.emoji ?? "🫧"),
            concepts: [
                ConceptUse("space.side_scroll"), ConceptUse("entity.avatar"), ConceptUse("entity.obstacle"), ConceptUse("input.tap"),
                ConceptUse("behavior.gravity"), ConceptUse("behavior.impulse"), ConceptUse("behavior.spawn_stream"),
                ConceptUse("rule.collide_fail"), ConceptUse("score.count"), ConceptUse("flow.run_retry"),
            ],
            content: ["theme": .string(theme?.noun ?? "Bubbles")],
            seed: identity.seed
        )
    }

    // MARK: - Helpers

    static func modeTitle(_ mode: StudioMode, base: BubbleManifest) -> String {
        switch mode {
        case .edit: return "Edited \(base.title)"
        case .remix: return "Remixed \(base.title)"
        case .nextLevel: return "Built level \((base.chain?.index ?? 1) + 1)"
        default: return "Composed \(base.concepts.count) concepts"
        }
    }

    static func modeVerb(_ mode: StudioMode) -> String {
        switch mode {
        case .edit: return "Edit"
        case .remix: return "Remix"
        case .nextLevel: return "Next level"
        default: return "Request"
        }
    }

    static func stableSuffix(_ request: StudioRequest) -> String {
        let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")
        var hash = stableHash(request.mode.rawValue + request.prompt + request.scope + (request.base?.id ?? ""))
        var out = ""
        for _ in 0..<4 {
            out.append(alphabet[Int(hash % UInt64(alphabet.count))])
            hash /= UInt64(alphabet.count)
        }
        return out
    }

    static func stableSeed(_ request: StudioRequest) -> Int {
        Int(stableHash(request.prompt + request.scope) % 2_000_000_000) + 1_000
    }

    static func stableIndex(_ text: String, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return Int(stableHash(text) % UInt64(count))
    }

    /// FNV-1a, stable across launches (unlike `hashValue`).
    static func stableHash(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return hash
    }

    static func sentence(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }

    static func number(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value).replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }
}

/// The Studio service with no Muse key: the whole pipeline runs on the device with the offline
/// composer. Validates and playtests with the real runtime like the Muse path.
final class OfflineStudioService: BubbleStudioService {
    let runtime: StudioRuntime
    let composer: OfflineComposer

    var isMuseConnected: Bool { false }

    init(runtime: StudioRuntime, world: StudioDemoWorld?, pacing: TimeInterval = 0.35) {
        self.runtime = runtime
        self.composer = OfflineComposer(world: world, pacing: pacing)
    }

    /// The app's offline service: the bundled runtime and demo world.
    convenience init() {
        self.init(runtime: .bundled(), world: StudioDemoWorld.load())
    }

    func draftBrief(_ request: StudioRequest) async throws -> BubbleBrief {
        composer.brief(for: request)
    }

    func compose(_ request: StudioRequest) -> AsyncThrowingStream<StudioEvent, Error> {
        composer.stream(MuseStudioService.enrich(request, world: composer.world), runtime: runtime)
    }

    /// Same as `compose`: everything here is offline.
    func composeOffline(_ request: StudioRequest) -> AsyncThrowingStream<StudioEvent, Error> {
        compose(request)
    }
}
