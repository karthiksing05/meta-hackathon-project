import Foundation

/// Makes a game from scratch on the server (`GameGenerator`: Max's `/v1/generate`, or its mock) and
/// turns the job into the same `StudioEvent`s the on-device path (`StudioMicrogameBridge`) yields, so
/// the Build storyboard, the timeline, Try, Share and "How Muse made it" can't tell them apart.
///
/// Titles are the server's own `summary` (the composer's words). The optional `data` fills in what
/// the on-device path shows when it's there (bot lanes from per-bot runs, the fix round, fragment
/// chips, the model) and is simply left out when it isn't: no report means no lanes.
///
/// Queue state goes to `onWait` (nil once the job runs). Failures come back as one `.failed` event
/// whose detail is the copy for the server's `code`. Cancelling the stream cancels the job.
///
/// Changes to a game (tweaks, a new look, the next level, remixes) come through `revise`: the same
/// job stream from `POST /v1/generate {baseGameId, ...}`, so they show the same steps.
@MainActor
enum StudioGenerateBridge {
    /// Waiting for a free slot; `position` when the server says (1 = next).
    struct Wait: Equatable {
        var position: Int?
    }

    static func compose(
        with generator: any GameGenerator,
        request: String,
        brief: BubbleBrief,
        onReport: @escaping @MainActor (UUID, StudioPlaytest.Report) -> Void,
        onWait: @escaping @MainActor (Wait?) -> Void
    ) -> AsyncThrowingStream<StudioEvent, Error> {
        events(from: generator.generate(request: request, brief: brief), onReport: onReport, onWait: onWait)
    }

    /// A change to a game the server has; the result is a new game (`remixOf` is the base).
    static func revise(
        with generator: any GameGenerator,
        revision: GameRevision,
        onReport: @escaping @MainActor (UUID, StudioPlaytest.Report) -> Void,
        onWait: @escaping @MainActor (Wait?) -> Void
    ) -> AsyncThrowingStream<StudioEvent, Error> {
        events(from: generator.generate(revision: revision), onReport: onReport, onWait: onWait)
    }

    private static func events(
        from updates: AsyncThrowingStream<GenerationUpdate, Error>,
        onReport: @escaping @MainActor (UUID, StudioPlaytest.Report) -> Void,
        onWait: @escaping @MainActor (Wait?) -> Void
    ) -> AsyncThrowingStream<StudioEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task { @MainActor in
                let asked = Date()
                var runStart: Date?
                var model: String?
                var repairs = 0
                var doneEvent: GenerationEvent?
                var failedEvent: GenerationEvent?
                func elapsed() -> TimeInterval { Date().timeIntervalSince(runStart ?? asked) }

                do {
                    for try await update in updates {
                        switch update {
                        case .waiting(let position):
                            onWait(Wait(position: position))
                        case .running:
                            onWait(nil)
                            if runStart == nil { runStart = Date() }
                        case .event(let event):
                            if runStart == nil {
                                runStart = Date()
                                onWait(nil)
                            }
                            if let name = event.data?["model"]?.string { model = name }
                            switch event.kind {
                            case .done: doneEvent = event
                            case .failed: failedEvent = event
                            case .other: break
                            default:
                                if event.kind == .repairing { repairs += 1 }
                                let (studioEvent, report) = studioEvent(for: event, model: model, repairs: repairs, elapsed: elapsed())
                                if let report { onReport(studioEvent.id, report) }
                                continuation.yield(studioEvent)
                            }
                        case .finished(_, let manifest):
                            continuation.yield(done(manifest, event: doneEvent, repairs: repairs, elapsed: elapsed()))
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch {
                    guard !Task.isCancelled else { return continuation.finish(throwing: CancellationError()) }
                    onWait(nil)
                    continuation.yield(StudioEvent(
                        step: .failed,
                        title: failedEvent?.summary.nonEmpty ?? "Couldn't finish",
                        detail: message(for: error),
                        elapsed: elapsed()
                    ))
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Events

    /// One server event as a Studio event, with the playtest report its `data` describes (if any).
    static func studioEvent(for event: GenerationEvent, model: String?, repairs: Int, elapsed: TimeInterval) -> (StudioEvent, StudioPlaytest.Report?) {
        let title = event.summary
        switch event.kind {
        case .drafting:
            let attempt = event.data?["attempt"]?.int ?? (title.lowercased().contains("again") ? 2 : 1)
            return (StudioEvent(
                step: .compose,
                title: title.nonEmpty ?? "Muse is drafting the game",
                detail: attempt == 1 ? "Rules, art and sound, written as one game file" : "The first reply wasn't a game file, so Muse is asked again",
                model: model,
                elapsed: elapsed
            ), nil)
        case .expanding:
            return (StudioEvent(step: .validate, title: title.nonEmpty ?? "Building and checking the game",
                                detail: "The game engine builds Muse's draft and checks every rule", elapsed: elapsed), nil)
        case .repairing:
            let round = event.data?["round"]?.int ?? repairs
            let issues = (event.issues ?? []).prefix(4).map(StudioMicrogameBridge.readableIssue)
            return (StudioEvent(
                step: .repair,
                title: title.nonEmpty ?? "Fixing issues",
                detail: "Round \(round): sent back to Muse with where each one is",
                model: model,
                elapsed: elapsed,
                issues: issues.isEmpty ? nil : Array(issues)
            ), nil)
        case .playtesting:
            return (StudioEvent(step: .playtest, title: title.nonEmpty ?? "Test players are trying it",
                                detail: "New, regular and pro players, on the real engine", elapsed: elapsed), nil)
        case .playtested:
            let passed = event.data?["passed"]?.bool ?? !title.lowercased().hasPrefix("playtest flagged")
            let notes = event.issues ?? []
            let report = Self.report(from: event.data, passed: passed, notes: notes)
            // Without `data` there's no spread; say something, so "How Muse made it" keeps this result.
            let detail = event.data?["spread"]?.string ?? report?.spread
                ?? (passed ? "The test players got through it on the real engine" : "The test players hit problems on the real engine")
            return (StudioEvent(
                step: .playtest,
                title: title.nonEmpty ?? "Playtested",
                detail: detail,
                elapsed: elapsed,
                issues: passed || notes.isEmpty ? nil : Array(notes.prefix(3))
            ), report)
        case .done, .failed, .other:
            return (StudioEvent(step: .polish, title: title, elapsed: elapsed), nil)
        }
    }

    /// The final event, carrying the manifest, like the on-device path's `.done`.
    static func done(_ manifest: BubbleManifest, event: GenerationEvent?, repairs: Int, elapsed: TimeInterval) -> StudioEvent {
        var parts = ["\(manifest.title) · made in \(Int(elapsed.rounded())) s"]
        if repairs > 0 { parts.append("\(repairs) \(repairs == 1 ? "fix round" : "fix rounds")") }
        var studioEvent = StudioEvent(
            step: .done,
            title: event?.summary.nonEmpty ?? "\(manifest.title) is ready",
            detail: parts.joined(separator: " · "),
            elapsed: elapsed,
            manifest: manifest
        )
        let named = (event?.data?["fragments"]?.strings ?? []).map { $0.hasPrefix("fragment.") ? $0 : "fragment.\($0)" }
        let fragments = named.isEmpty ? StudioMicrogameBridge.fragments(of: manifest) : named
        if !fragments.isEmpty { studioEvent.concepts = fragments }
        return studioEvent
    }

    /// A playtest report from `data.runs` (or `data.bots`); nil without per-bot runs.
    nonisolated static func report(from data: JSONValue?, passed: Bool, notes: [String]) -> StudioPlaytest.Report? {
        guard let items = (data?["runs"] ?? data?["bots"])?.array, !items.isEmpty else { return nil }
        let runs: [StudioPlaytest.Run] = items.compactMap { item in
            guard let seconds = item["seconds"]?.double else { return nil }
            let label = item["bot"]?.string ?? item["label"]?.string ?? item["name"]?.string ?? "bot"
            let bot = StudioPlaytest.bots.first { $0.label == label }
                ?? StudioPlaytest.Bot(label: label, skill: item["skill"]?.double ?? 0.7, botSeed: 0, seedOffset: 0)
            let outcome = item["outcome"]?.string ?? "fail"
            return StudioPlaytest.Run(bot: bot, ok: outcome != "error", error: nil, outcome: outcome,
                                      score: item["score"]?.int ?? 0, seconds: seconds, events: [:])
        }
        guard !runs.isEmpty else { return nil }
        let flags = passed ? [] : (notes.isEmpty ? ["The playtest flagged it"] : notes)
            .map { StudioPlaytest.Flag(code: "server", message: $0, blocking: true) }
        return StudioPlaytest.Report(runs: runs, flags: flags)
    }

    // MARK: - Failure copy

    /// What the error card says, by the server's failure code.
    nonisolated static func message(for error: Error) -> String {
        let product = ProductName.singular
        if let error = error as? GameGenerationError {
            switch error.code {
            case "muse_timeout":
                return "Muse took too long to answer. Try again in a minute."
            case "invalid_after_repairs":
                return "Muse couldn't get this \(product) to work, even after a few fixes. Try again, or make it with a ready formula."
            case "gate_failed":
                return "The test players couldn't get through this \(product), so it wasn't kept. Try again, or make it with a ready formula."
            case "rate_limited":
                return "You've made a lot of \(ProductName.plural) this hour. Try again a little later, or make it with a ready formula."
            case "capped":
                return "This one took longer than 10 minutes, so it was stopped. Try a simpler idea, or make it with a ready formula."
            case "busy":
                return "Another \(product) of yours is still being made. Wait for it to finish, then try again."
            default:
                if case .failed(_, let message?) = error, message.count <= 160 { return message }
                return "Muse couldn't finish this \(product). Try again, or make it with a ready formula."
            }
        }
        if let error = error as? GamesAPIError {
            switch error {
            case .network: return "Couldn't reach the game server. Check your connection and try again."
            case .signInRequired: return "Couldn't sign in to the game server. Try again in a moment."
            case .notFound, .unknownGame: return "The game server doesn't have this \(product), so Muse can't change it."
            // The server's own words: "Muse is not set up on this server yet", "only microgames can be changed this way".
            case .server(_, let message) where !message.isEmpty && message.count <= 160:
                return GameAnatomy.sentence(message) + (message.hasSuffix(".") ? "" : ".")
            default: break
            }
        }
        return "Something interrupted Muse while it was making your \(product). Your brief is saved."
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : self
    }
}
