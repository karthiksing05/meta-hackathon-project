import Foundation

/// What `MicrogameComposer` needs from Muse: one JSON-mode turn. `MuseClient` conforms as is.
protocol MicrogameMuse: Sendable {
    func chatJSON(model: String, system: String, user: String, options: MuseClient.ChatOptions) async throws -> (value: JSONValue, reply: MuseClient.ChatReply)
}

extension MuseClient: MicrogameMuse {}

extension MuseClient {
    /// Studio's Muse client: `MuseConfig.json` in the bundle, then `MUSE_API_KEY`. Without either
    /// it isn't configured, and calls throw `MuseError.notConfigured`.
    static let studio = MuseClient(config: MuseConfig.load() ?? MuseConfig(apiKey: ""))
}

/// A stand-in Muse that replies from a script, for tests and the CLI's `--fake-muse`: each call
/// returns the next reply (the last one repeats).
final class ScriptedMicrogameMuse: MicrogameMuse, @unchecked Sendable {
    private let replies: [JSONValue]
    private let model: String
    private let lock = NSLock()
    private var index = 0
    /// The user turns it was sent, in order.
    private(set) var prompts: [String] = []

    init(replies: [JSONValue], model: String = "scripted-muse") {
        self.replies = replies
        self.model = model
    }

    func chatJSON(model: String, system: String, user: String, options: MuseClient.ChatOptions) async throws -> (value: JSONValue, reply: MuseClient.ChatReply) {
        let value: JSONValue = lock.withLock {
            let value = replies.isEmpty ? JSONValue.object([:]) : replies[min(index, replies.count - 1)]
            index += 1
            prompts.append(user)
            return value
        }
        let reply = MuseClient.ChatReply(model: self.model, content: value.jsonString(), toolCalls: [], finishReason: "stop",
                                         message: ["role": "assistant", "content": .string(value.jsonString())], seconds: 0,
                                         usage: MuseClient.Usage(promptTokens: nil, completionTokens: nil, reasoningTokens: nil))
        return (value, reply)
    }
}

/// Muse makes a microgame (docs/BUBBLES.md 7.12): Muse writes an authoring manifest, the expander
/// and the engine check it, errors go back to Muse for repair, the bots playtest it, and it's
/// wrapped as a `formula: "microgame"` Bubble.
@MainActor final class MicrogameComposer {
    enum Event {
        case drafting(attempt: Int)
        case expanding
        case repairing(round: Int, issues: [String])
        case playtesting(bots: Int)
        case playtested(StudioPlaytest.Report)
        case done(BubbleManifest)
        case failed(String)
    }

    enum ComposerError: Error, LocalizedError {
        /// `revise` needs `content.authoring_json`.
        case noAuthoring
        /// Still invalid after every repair round.
        case invalid([String])

        var errorDescription: String? {
            switch self {
            case .noAuthoring: return "This Bubble has no authoring manifest (content.authoring_json), so Muse can't revise it."
            case .invalid(let issues): return "Muse's microgame still doesn't validate: \(issues.first ?? "unknown error")"
            }
        }
    }

    /// How the last compose or revise went (for measuring the repair loop).
    struct Stats: Sendable {
        /// Whether Muse's first manifest validated with no repair.
        var firstDraftValid: Bool?
        /// Repair rounds for validation errors.
        var repairRounds = 0
        /// Whether the gate's blocking flags were sent back to Muse.
        var playtestRepair = false
        var passedGate = false
        var museCalls = 0
        var seconds: Double = 0
        var models: [String] = []
    }

    let muse: any MicrogameMuse
    let studio: MicrogameStudio
    let maxRepairRounds: Int
    var model: String
    var options: MuseClient.ChatOptions

    /// Library bugs seen so far (diagnostics inside a fragment or look). Never shown to Muse in full.
    private(set) var libraryIssues: [MicrogameDiagnostic] = []
    private(set) var lastStats = Stats()

    init(muse: any MicrogameMuse = MuseClient.studio, studio: MicrogameStudio = .shared, maxRepairRounds: Int = 3, model: String? = nil) {
        self.muse = muse
        self.studio = studio
        self.maxRepairRounds = maxRepairRounds
        self.model = model ?? (muse as? MuseClient)?.config.plannerModel ?? "muse-wonder-1.0"
        self.options = MuseClient.ChatOptions(maxTokens: 16_000, reasoningEffort: "medium", timeout: 150, maxAttempts: 2, purpose: "microgame")
    }

    /// A new microgame from the creator's request and brief.
    func compose(request: String, brief: BubbleBrief, onEvent: @MainActor (Event) -> Void) async throws -> BubbleManifest {
        let started = Date()
        lastStats = Stats()
        do {
            let catalog = try await studio.catalog()
            let system = MicrogamePrompts.system(catalog)
            let draft = try await draft(system: system, user: MicrogamePrompts.compose(request: request, brief: brief), onEvent: onEvent)
            let (expansion, _) = try await check(draft, system: system, request: request, onEvent: onEvent)
            let title = expansion.game["meta"]?["title"]?.string ?? "microgame"
            let id = "mg-\(StudioManifestBuilder.slug(title).isEmpty ? "game" : StudioManifestBuilder.slug(title))-\(StudioManifestBuilder.randomSuffix())"
            var manifest = try await studio.wrap(expansion, id: id, brief: brief, emoji: nil, seed: Int.random(in: 1...999_999))
            manifest.studio = stamp(started)
            onEvent(.done(manifest))
            return manifest
        } catch {
            lastStats.seconds = Date().timeIntervalSince(started)
            onEvent(.failed(error.localizedDescription))
            throw error
        }
    }

    /// Changes an existing microgame Bubble as asked, from its `content.authoring_json`. Keeps its id,
    /// brief, lineage and emoji, and bumps its version.
    func revise(_ bubble: BubbleManifest, request: String, onEvent: @MainActor (Event) -> Void) async throws -> BubbleManifest {
        let started = Date()
        lastStats = Stats()
        do {
            // The authoring manifest as stored text (key order intact); older Bubbles kept it as an
            // object, whose keys JSONValue may have sorted.
            let authoring: String
            if let text = bubble.content["authoring_json"]?.string, !text.isEmpty {
                authoring = text
            } else if let object = bubble.content["authoring"], object.object != nil {
                authoring = object.jsonString()
            } else {
                throw ComposerError.noAuthoring
            }
            let catalog = try await studio.catalog()
            let system = MicrogamePrompts.system(catalog)
            let draft = try await draft(system: system, user: MicrogamePrompts.revise(authoring: authoring, request: request, brief: bubble.brief), onEvent: onEvent)
            let (expansion, _) = try await check(draft, system: system, request: request, onEvent: onEvent)
            var manifest = try await studio.wrap(expansion, id: bubble.id, brief: bubble.brief, emoji: bubble.style.emoji, seed: bubble.seed)
            manifest.version = bubble.version + 1
            manifest.lineage = bubble.lineage
            manifest.chain = bubble.chain
            manifest.structure = bubble.structure
            manifest.length = bubble.length
            manifest.about = bubble.about
            manifest.studio = stamp(started)
            onEvent(.done(manifest))
            return manifest
        } catch {
            lastStats.seconds = Date().timeIntervalSince(started)
            onEvent(.failed(error.localizedDescription))
            throw error
        }
    }

    // MARK: - Loop

    /// Muse's first manifest, as the reply's text. A reply that isn't JSON is asked for once more.
    private func draft(system: String, user: String, onEvent: @MainActor (Event) -> Void) async throws -> String {
        var lastError: Error?
        for attempt in 1...2 {
            onEvent(.drafting(attempt: attempt))
            do {
                return try await ask(system: system, user: user, purpose: "microgame draft")
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
            }
        }
        throw lastError ?? MuseError.invalidReply("no manifest")
    }

    /// Expand, repair, gate (one more repair for blocking flags). Returns the best valid version.
    private func check(_ first: String, system: String, request: String, onEvent: @MainActor (Event) -> Void) async throws -> (MicrogameExpansion, StudioPlaytest.Report) {
        // Muse's reply text goes to the page as is (JSONValue would sort its keys).
        var reply = first
        var repairs = 0
        var playtestRepairUsed = false
        var best: (MicrogameExpansion, StudioPlaytest.Report)?

        while true {
            onEvent(.expanding)
            let expansion = try await studio.expand(text: reply)
            // What Muse sees in a repair: the sort-safe manifest the page returned.
            let shown = expansion.authoring.string ?? expansion.authoring.jsonString()
            if lastStats.firstDraftValid == nil { lastStats.firstDraftValid = expansion.ok }
            for d in expansion.libraryErrors where !libraryIssues.contains(d) {
                libraryIssues.append(d)
                Self.log("library issue \(d.origin ?? "?") \(d.line)")
            }

            if !expansion.ok {
                let issues = MicrogamePrompts.issues(expansion)
                guard repairs < maxRepairRounds else {
                    // Out of repairs: ship the last version that validated, if there was one.
                    if let best { return best }
                    throw ComposerError.invalid(issues)
                }
                repairs += 1
                lastStats.repairRounds = repairs
                onEvent(.repairing(round: repairs, issues: issues))
                reply = try await ask(system: system, user: MicrogamePrompts.repair(request: request, manifest: shown, issues: issues, round: repairs),
                                         purpose: "microgame repair \(repairs)")
                continue
            }

            onEvent(.playtesting(bots: StudioPlaytest.bots.count))
            let report = try await studio.gate(expansion, seed: 1)
            onEvent(.playtested(report))
            if report.passed {
                lastStats.passedGate = true
                return (expansion, report)
            }
            // Neither passed: keep whichever version has fewer blocking flags.
            if best == nil || report.blocking.count < (best?.1.blocking.count ?? .max) { best = (expansion, report) }
            guard !playtestRepairUsed else { return best ?? (expansion, report) }
            playtestRepairUsed = true
            lastStats.playtestRepair = true
            onEvent(.repairing(round: repairs + 1, issues: report.blocking.map { "\($0.code): \($0.message)" }))
            reply = try await ask(system: system, user: MicrogamePrompts.playtestRepair(request: request, manifest: shown, report: report),
                                     purpose: "microgame playtest repair")
        }
    }

    /// One Muse turn; returns the reply's text (the page finds the manifest in it, nested or fenced).
    private func ask(system: String, user: String, purpose: String) async throws -> String {
        var options = self.options
        options.purpose = purpose
        let (value, reply) = try await muse.chatJSON(model: model, system: system, user: user, options: options)
        lastStats.museCalls += 1
        if !lastStats.models.contains(reply.model) { lastStats.models.append(reply.model) }
        return reply.content.isEmpty ? value.jsonString() : reply.content
    }

    private func stamp(_ started: Date) -> StudioStamp {
        lastStats.seconds = Date().timeIntervalSince(started)
        return StudioStamp(models: lastStats.models.isEmpty ? [model] : lastStats.models, createdAt: StudioManifestBuilder.timestamp(Date()),
                           durationSec: (lastStats.seconds * 10).rounded() / 10, offline: false)
    }

    private static func log(_ text: String) {
        #if DEBUG
        print("[MicrogameComposer] \(text)")
        #endif
    }
}
