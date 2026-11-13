import Foundation

/// Runs Artem's `MicrogameComposer` (docs/BUBBLES.md 7.12) for Studio and turns its events into
/// the `StudioEvent`s the rest of Studio already understands, so the Build storyboard, the
/// timeline, Try and Share treat a microgame like any other game.
///
/// Every event here is one the composer really emitted; titles come from `Event.summary`, so the
/// screen never words a step itself. The playtest report rides alongside (`onReport`), because
/// `StudioEvent` has no field for per-bot runs.
///
/// When Studio uses it (`StudioModel.buildsMicrogame`):
/// - the person picks "Microgame" in the Game type picker, or
/// - Muse picks the type and the request reads like arcade or physics play (`fits(_:)`); the Brief
///   step shows the choice and the person can switch back to a ready formula.
/// It needs a configured Muse key: without one Studio keeps the existing pipeline (and its offline
/// composer), because a microgame can't be made offline.
@MainActor
enum StudioMicrogameBridge {
    /// Whether real Muse is configured, so a microgame can be made at all.
    static var isAvailable: Bool { MuseClient.studio.isConfigured }

    /// Words that suggest play the formulas can't do well but the engine can: physics, arcade
    /// action, aiming, bouncing. Matched as whole words in the request.
    static let arcadeWords: Set<String> = [
        "arcade", "physics", "bounce", "bouncing", "bouncy", "gravity", "pinball", "breakout", "brick", "bricks",
        "paddle", "juggle", "juggling", "launch", "launcher", "slingshot", "aim", "aiming", "shoot", "shooter",
        "asteroid", "asteroids", "orbit", "orbiting", "platformer", "platform", "jump", "jumping", "swing",
        "rhythm", "beat", "beats", "drum", "drums", "flick", "swipe", "catapult", "ricochet", "billiards",
    ]

    /// True when the request reads like arcade or physics play.
    static func fits(_ request: String) -> Bool {
        let words = request.lowercased().split { !$0.isLetter }.map(String.init)
        return words.contains { arcadeWords.contains($0) }
    }

    /// A new microgame from the request and brief.
    static func compose(request: String, brief: BubbleBrief, onReport: @escaping @MainActor (UUID, StudioPlaytest.Report) -> Void) -> AsyncThrowingStream<StudioEvent, Error> {
        run(onReport: onReport) { composer, onEvent in
            try await composer.compose(request: request, brief: brief, onEvent: onEvent)
        }
    }

    /// Changes a microgame as asked ("tweak with Muse", a next level), from its authoring manifest.
    static func revise(_ game: BubbleManifest, request: String, onReport: @escaping @MainActor (UUID, StudioPlaytest.Report) -> Void) -> AsyncThrowingStream<StudioEvent, Error> {
        run(onReport: onReport) { composer, onEvent in
            try await composer.revise(game, request: request, onEvent: onEvent)
        }
    }

    /// Whether `revise` can change this game (it needs the stored authoring manifest).
    static func canRevise(_ game: BubbleManifest) -> Bool {
        guard game.formula == .microgame else { return false }
        if let text = game.content["authoring_json"]?.string, !text.isEmpty { return true }
        return game.content["authoring"]?.object != nil
    }

    /// The fragments a microgame uses, from its stored authoring manifest (`uses[].fragment`), as
    /// concept-style ids ("fragment.timer_bar") so the concept chips can draw them.
    nonisolated static func fragments(of game: BubbleManifest) -> [String] {
        let json: Any?
        if let text = game.content["authoring_json"]?.string, let data = text.data(using: .utf8) {
            json = try? JSONSerialization.jsonObject(with: data)
        } else if let object = game.content["authoring"], let data = object.jsonString().data(using: .utf8) {
            json = try? JSONSerialization.jsonObject(with: data)
        } else {
            json = nil
        }
        guard let root = json as? [String: Any], let uses = root["uses"] as? [[String: Any]] else { return [] }
        var seen: [String] = []
        for use in uses {
            guard let name = use["fragment"] as? String, !name.isEmpty else { continue }
            let id = "fragment.\(name)"
            if !seen.contains(id) { seen.append(id) }
        }
        return seen
    }

    // MARK: - Running

    private static func run(
        onReport: @escaping @MainActor (UUID, StudioPlaytest.Report) -> Void,
        _ body: @escaping @MainActor (MicrogameComposer, @MainActor (MicrogameComposer.Event) -> Void) async throws -> BubbleManifest
    ) -> AsyncThrowingStream<StudioEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task { @MainActor in
                let composer = MicrogameComposer()
                let started = Date()
                var sawFailure = false
                let onEvent: @MainActor (MicrogameComposer.Event) -> Void = { event in
                    let elapsed = Date().timeIntervalSince(started)
                    var studioEvent = Self.studioEvent(for: event, model: composer.model, elapsed: elapsed, stats: composer.lastStats)
                    if case .failed = event { sawFailure = true }
                    if case .playtested(let report) = event {
                        onReport(studioEvent.id, report)
                    }
                    if case .done(let game) = event {
                        let fragments = Self.fragments(of: game)
                        if !fragments.isEmpty { studioEvent.concepts = fragments }
                    }
                    continuation.yield(studioEvent)
                }
                do {
                    _ = try await body(composer, onEvent)
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch {
                    // The composer already emitted `.failed` (which ends the run in Studio); if it
                    // didn't, let Studio word the error.
                    if sawFailure {
                        continuation.finish()
                    } else {
                        continuation.finish(throwing: error)
                    }
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// One composer event as a Studio event. Titles are the composer's own `summary`.
    static func studioEvent(for event: MicrogameComposer.Event, model: String, elapsed: TimeInterval, stats: MicrogameComposer.Stats) -> StudioEvent {
        switch event {
        case .drafting(let attempt):
            return StudioEvent(
                step: .compose,
                title: event.summary,
                detail: attempt == 1 ? "Rules, art and sound, written as one game file" : "The first reply wasn't a game file, so Muse is asked again",
                model: model,
                elapsed: elapsed
            )
        case .expanding:
            return StudioEvent(step: .validate, title: event.summary, detail: "The game engine builds Muse's draft and checks every rule", elapsed: elapsed)
        case .repairing(let round, let issues):
            return StudioEvent(
                step: .repair,
                title: event.summary,
                detail: "Round \(round): sent back to Muse with where each one is",
                model: model,
                elapsed: elapsed,
                issues: Array(issues.prefix(4)).map(readableIssue)
            )
        case .playtesting:
            return StudioEvent(step: .playtest, title: event.summary, detail: "New, regular and pro players, on the real engine", elapsed: elapsed)
        case .playtested(let report):
            let notes = report.flags.map(\.message)
            return StudioEvent(
                step: .playtest,
                title: event.summary,
                detail: report.spread,
                elapsed: elapsed,
                issues: report.passed || notes.isEmpty ? nil : Array(notes.prefix(3))
            )
        case .done(let game):
            var parts = ["\(game.title) · made in \(Int(elapsed.rounded())) s"]
            if stats.repairRounds > 0 {
                parts.append("\(stats.repairRounds) \(stats.repairRounds == 1 ? "fix round" : "fix rounds")")
            }
            return StudioEvent(step: .done, title: event.summary, detail: parts.joined(separator: " · "), elapsed: elapsed, manifest: game)
        case .failed(let reason):
            return StudioEvent(step: .failed, title: event.summary, detail: reason, elapsed: elapsed)
        }
    }

    /// Repair issues arrive as "CODE at /pointer: message (hint)" or "code: message"; people only
    /// need the message. Anything else is shown as is.
    nonisolated static func readableIssue(_ issue: String) -> String {
        let text = issue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let colon = text.range(of: ": ") else { return text }
        let head = String(text[..<colon.lowerBound])
        let code = head.components(separatedBy: " at ").first ?? head
        let isCode = !code.isEmpty && !code.contains(" ") && code.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" }
            && (code.contains("_") || code == code.uppercased())
        guard isCode, head == code || head.hasPrefix(code + " at ") else { return text }
        let rest = text[colon.upperBound...]
        guard let first = rest.first else { return text }
        return first.uppercased() + rest.dropFirst()
    }
}
