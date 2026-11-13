import Foundation

// Server-side game generation (Max's `POST /v1/generate`, posted 2026-11-12 16:01 PST).
//
//     POST /v1/generate               {"request", "brief": BubbleBrief}  -> 202 {"jobId"}
//     GET  /v1/generate/{jobId}       {"status": queued|running|done|failed, "events": [...], "game"?, "error"?}
//     GET  /v1/generate               my jobs
//     DELETE /v1/generate/{jobId}     (asked for; 404/405 are ignored)
//
// Events are `MicrogameComposer` events run on the server (drafting, expanding, repairing,
// playtesting, playtested, done, failed), each with `seq`, `kind`, `summary` and `issues`. Fields we
// asked for but that aren't confirmed are all optional here: `data` on events, `position` while
// queued, `code` on failure, `?after=<seq>` (sent anyway; events are deduped by `seq`).
// When the job is done, `game` is the normal `RemoteGame`; its manifest is fetched from
// `manifestUrl` and decoded as is (`content.game_json` stays the exact text the server wrote).
//
//     let generator = GameGeneratorFactory.current          // nil: Studio keeps the on-device composer
//     for try await update in generator!.generate(request: "...", brief: brief) { ... }
//
// Cancelling the consuming task ends the job (`DELETE`, best effort).

/// One server-side generation backend. Implementations only speak the wire; `generate` (below)
/// does the polling, dedupe, cap and cancel for all of them.
protocol GameGenerator: Sendable {
    /// `POST /v1/generate`; returns the job id.
    func start(request: String, brief: BubbleBrief) async throws -> String
    /// `GET /v1/generate/{id}`, with `after` = the last `seq` seen (nil on the first poll).
    func job(id: String, after: Int?) async throws -> GenerationJob
    /// `DELETE /v1/generate/{id}`. Best effort: never throws.
    func cancel(id: String) async
    /// The finished game's manifest, from `game.manifestURL`.
    func manifest(for game: RemoteGame) async throws -> BubbleManifest
    /// How long to wait between polls.
    var pollInterval: TimeInterval { get }
}

// MARK: - Wire models

/// `GET /v1/generate/{jobId}`.
struct GenerationJob: Decodable, Sendable {
    enum Status: String, Sendable {
        case queued, running, done, failed
    }

    var status: Status
    var events: [GenerationEvent]
    var game: RemoteGame?
    var error: String?
    /// Asked for: `muse_timeout`, `invalid_after_repairs`, `gate_failed`, `rate_limited`, `capped`.
    var code: String?
    /// Asked for: place in line while queued (1 = next).
    var position: Int?

    enum CodingKeys: String, CodingKey {
        case status, events, game, error, code, position
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decode(String.self, forKey: .status).lowercased()
        // Unknown states read as "still working".
        status = Status(rawValue: raw) ?? (raw == "error" ? .failed : .running)
        events = (try? c.decodeIfPresent([GenerationEvent].self, forKey: .events)) ?? []
        game = try? c.decodeIfPresent(RemoteGame.self, forKey: .game)
        error = Self.text(c, .error)
        code = try? c.decodeIfPresent(String.self, forKey: .code)
        position = (try? c.decodeIfPresent(Int.self, forKey: .position)) ?? nil
    }

    /// `error` may come as a string or as `{"message": ...}`.
    private static func text(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> String? {
        if let s = try? c.decodeIfPresent(String.self, forKey: key) { return s }
        if let v = try? c.decodeIfPresent(JSONValue.self, forKey: key) { return v["message"]?.string }
        return nil
    }
}

/// One `MicrogameComposer` event, as the server reports it.
struct GenerationEvent: Decodable, Hashable, Sendable {
    enum Kind: String, Sendable {
        case drafting, expanding, repairing, playtesting, playtested, done, failed, other
    }

    var seq: Int
    var kind: Kind
    /// The composer's own one-line summary ("Fixing 2 issues"); shown as is.
    var summary: String
    var issues: [String]?
    /// Asked for, shape not fixed: playtested `{runs: [{bot, skill, seconds, outcome, score}], spread,
    /// passed}`, repairing `{round}`, done `{fragments}`, drafting `{model, attempt}`.
    var data: JSONValue?

    enum CodingKeys: String, CodingKey {
        case seq, kind, summary, issues, data
    }

    init(seq: Int, kind: Kind, summary: String, issues: [String]? = nil, data: JSONValue? = nil) {
        self.seq = seq; self.kind = kind; self.summary = summary; self.issues = issues; self.data = data
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let n = try? c.decode(Int.self, forKey: .seq) {
            seq = n
        } else {
            seq = Int(try c.decode(Double.self, forKey: .seq))
        }
        kind = Kind(rawValue: (try? c.decode(String.self, forKey: .kind))?.lowercased() ?? "") ?? .other
        summary = (try? c.decodeIfPresent(String.self, forKey: .summary)) ?? ""
        issues = (try? c.decodeIfPresent([String].self, forKey: .issues)) ?? nil
        data = (try? c.decodeIfPresent(JSONValue.self, forKey: .data)) ?? nil
    }
}

/// `POST /v1/generate` → `{"jobId"}` (also accepts `id`).
struct GenerationStarted: Decodable, Sendable {
    var jobID: String

    enum CodingKeys: String, CodingKey {
        case jobId, id
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let id = try? c.decode(String.self, forKey: .jobId) {
            jobID = id
        } else {
            jobID = try c.decode(String.self, forKey: .id)
        }
    }
}

// MARK: - Updates and errors

/// What `generate` streams.
enum GenerationUpdate: Sendable {
    /// Queued behind other jobs; `position` when the server says (1 = next).
    case waiting(position: Int?)
    /// The job left the queue.
    case running
    /// A new composer event (each `seq` once, in order).
    case event(GenerationEvent)
    /// Done: the server's game and its manifest. Always the last update.
    case finished(RemoteGame, BubbleManifest)
}

enum GameGenerationError: LocalizedError, Equatable {
    /// The job failed on the server. `code` when the server sends one.
    case failed(code: String?, message: String?)
    /// Another job of this person's is still running (409, or a 429 that says so).
    case busy(String?)
    /// Too many jobs this hour (429).
    case rateLimited(String?)
    /// Done without a usable game or manifest.
    case noGame(String)

    var errorDescription: String? {
        switch self {
        case .failed(let code, let message): return message ?? code ?? "The game couldn't be made."
        case .busy(let message): return message ?? "Another game is still being made."
        case .rateLimited(let message): return message ?? "Too many games this hour."
        case .noGame(let why): return "The server finished without a game: \(why)"
        }
    }

    /// The failure code the copy keys on.
    var code: String? {
        switch self {
        case .failed(let code, _): return code
        case .busy: return "busy"
        case .rateLimited: return "rate_limited"
        case .noGame: return nil
        }
    }

    /// Reads a `POST /v1/generate` HTTP error: 409 (or a 429 that says "running") is busy; 429 is rate limited.
    static func from(_ error: GamesAPIError) -> GameGenerationError? {
        guard case .server(let status, let message) = error else { return nil }
        let lower = message.lowercased()
        if status == 409 || (status == 429 && (lower.contains("running") || lower.contains("already"))) { return .busy(message) }
        if status == 429 { return .rateLimited(message) }
        return nil
    }
}

// MARK: - Polling

extension GameGenerator {
    /// Starts a job and streams it to the end. Cancelling the consumer cancels the job.
    func generate(request: String, brief: BubbleBrief) -> AsyncThrowingStream<GenerationUpdate, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var jobID: String?
                do {
                    let id: String
                    do {
                        id = try await start(request: request, brief: brief)
                    } catch let error as GamesAPIError {
                        throw GameGenerationError.from(error) ?? error
                    }
                    jobID = id
                    try await poll(id: id, continuation: continuation)
                    continuation.finish()
                } catch {
                    if let jobID, Task.isCancelled || error is CancellationError {
                        // The poll task is cancelled; DELETE from a fresh task.
                        let generator = self
                        Task.detached { await generator.cancel(id: jobID) }
                    }
                    continuation.finish(throwing: Task.isCancelled ? CancellationError() : error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func poll(id: String, continuation: AsyncThrowingStream<GenerationUpdate, Error>.Continuation) async throws {
        var seen = Set<Int>()
        var lastSeq: Int?
        var queued: Int?? = nil   // .some(position) while queued
        var misses = 0
        // The server caps a job at 10 minutes; give it a little more before giving up here.
        let deadline = Date().addingTimeInterval(11 * 60)

        while true {
            try Task.checkCancellation()
            let job: GenerationJob
            do {
                job = try await self.job(id: id, after: lastSeq)
                misses = 0
            } catch let error as GamesAPIError {
                // A dropped poll isn't a failed job: retry a few times.
                if case .network = error, misses < 4 {
                    misses += 1
                    try await Task.sleep(nanoseconds: UInt64(pollInterval * 2 * 1_000_000_000))
                    continue
                }
                if case .notFound = error { throw GameGenerationError.failed(code: nil, message: "The server lost this job.") }
                throw error
            }

            if job.status == .queued {
                if queued != .some(job.position) {
                    queued = .some(job.position)
                    continuation.yield(.waiting(position: job.position))
                }
            } else if queued != nil {
                queued = nil
                continuation.yield(.running)
            }

            for event in job.events.sorted(by: { $0.seq < $1.seq }) where !seen.contains(event.seq) {
                seen.insert(event.seq)
                lastSeq = max(lastSeq ?? event.seq, event.seq)
                continuation.yield(.event(event))
            }

            switch job.status {
            case .done:
                guard let game = job.game else { throw GameGenerationError.noGame("no game in the reply") }
                let manifest: BubbleManifest
                do {
                    manifest = try await self.manifest(for: game)
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    throw GameGenerationError.noGame(error.localizedDescription)
                }
                continuation.yield(.finished(game, manifest))
                return
            case .failed:
                let summary = job.events.last(where: { $0.kind == .failed })?.summary
                throw GameGenerationError.failed(code: job.code, message: job.error ?? summary)
            case .queued, .running:
                break
            }

            if Date() > deadline {
                await cancel(id: id)
                throw GameGenerationError.failed(code: "capped", message: nil)
            }
            try await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
        }
    }
}

// MARK: - Choosing one

enum GameGeneratorFactory {
    /// The generator for this launch, or nil to keep the on-device `MicrogameComposer`.
    /// - `FB_GENERATE=mock`: replays a recorded run (`GameGeneratorMock`); `mock-plain` without the
    ///   optional fields; `mock-fail` fails partway (`FB_GENERATE_FAIL_CODE` picks the code).
    /// - `FB_GENERATE=device`: the on-device composer even with `FB_API=live`.
    /// - `FB_API=live`: the server (`GameGeneratorLive`).
    /// Release builds read no launch variables, so they use the on-device composer.
    static var current: (any GameGenerator)? {
        switch DebugLaunch.value("FB_GENERATE")?.lowercased() {
        case "mock": return GameGeneratorMock(variant: .full)
        case "mock-plain": return GameGeneratorMock(variant: .plain)
        case "mock-fail": return GameGeneratorMock(variant: .fail(code: DebugLaunch.value("FB_GENERATE_FAIL_CODE") ?? "invalid_after_repairs"))
        case "device", "off": return nil
        default: return GamesAPIConfig.mode == .live ? GameGeneratorLive.shared : nil
        }
    }
}
