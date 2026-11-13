import Foundation

/// Server-side generation without a server: replays a real run (`generate-replay-postcard-pairs.json`,
/// a real `MicrogameComposer` run with real Muse: a flagged playtest, two fix rounds, then a pass, in
/// 104 s) at its real pace, as the job JSON the server would send. Replies go through the same
/// decoders and the same polling as the live client, so the optional fields get exercised too.
///
/// - `.full`: everything we asked Max for (`data`, `position`, `code`, `?after=`).
/// - `.plain`: only the confirmed fields, to check the screens without the optional ones.
/// - `.fail(code:)`: stops after the second fix round with that failure code.
///
/// `FB_GENERATE_SPEED=4` replays 4× faster (for screenshots). The queue (2, then 1 ahead) is made up;
/// the recorded run had none.
final class GameGeneratorMock: GameGenerator, @unchecked Sendable {
    enum Variant: Equatable {
        case full, plain
        case fail(code: String)
    }

    let variant: Variant
    let speed: Double
    private let lock = NSLock()
    private var jobs: [String: (started: Date, request: String, brief: BubbleBrief)] = [:]
    private(set) var cancelled: [String] = []

    init(variant: Variant = .full, speed: Double? = nil) {
        self.variant = variant
        self.speed = max(0.1, speed ?? DebugLaunch.value("FB_GENERATE_SPEED").flatMap(Double.init) ?? 1)
    }

    var pollInterval: TimeInterval { max(0.1, 0.4 / speed) }

    // MARK: Fixture

    private struct Replay: Decodable {
        struct Slot: Decodable { var t: Double; var position: Int }
        struct Event: Decodable {
            var t: Double
            var seq: Int
            var kind: String
            var summary: String
            var issues: [String]?
            var data: JSONValue?
        }
        struct Fail: Decodable { var afterSeq: Int; var t: Double; var summary: String; var error: String }
        var queue: [Slot]
        var queueSeconds: Double
        var events: [Event]
        var fail: Fail
        var manifest: String
    }

    private static let replay: Replay? = {
        guard let url = Bundle.main.url(forResource: "generate-replay-postcard-pairs", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Replay.self, from: data)
    }()

    // MARK: GameGenerator

    func start(request: String, brief: BubbleBrief) async throws -> String {
        guard Self.replay != nil else { throw GamesAPIError.server(status: 500, message: "The replay fixture is missing.") }
        let id = (0..<12).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        lock.withLock { jobs[id] = (Date(), request, brief) }
        return id
    }

    func job(id: String, after: Int?) async throws -> GenerationJob {
        guard let replay = Self.replay, let job = lock.withLock({ jobs[id] }) else { throw GamesAPIError.notFound }
        let t = Date().timeIntervalSince(job.started) * speed
        var reply: [String: Any] = [:]

        if t < replay.queueSeconds {
            reply["status"] = "queued"
            if variant != .plain, let slot = replay.queue.last(where: { $0.t <= t }) { reply["position"] = slot.position }
            reply["events"] = [Any]()
            return try decode(reply)
        }

        let run = t - replay.queueSeconds
        var events = replay.events.filter { $0.t <= run }
        var failed = false
        if case .fail(let code) = variant {
            events = events.filter { $0.seq <= replay.fail.afterSeq }
            if run >= replay.fail.t {
                failed = true
                events.append(.init(t: replay.fail.t, seq: replay.fail.afterSeq + 1, kind: "failed", summary: replay.fail.summary))
                reply["error"] = replay.fail.error
                reply["code"] = code
            }
        }
        let finished = !Self.isFail(variant) && events.count == replay.events.count
        reply["status"] = failed ? "failed" : finished ? "done" : "running"
        if variant != .plain, let after { events = events.filter { $0.seq > after } }
        reply["events"] = events.map { event -> [String: Any] in
            var item: [String: Any] = ["seq": event.seq, "kind": event.kind, "summary": event.summary]
            if let issues = event.issues { item["issues"] = issues }
            if variant != .plain, let data = event.data { item["data"] = data.foundationObject }
            return item
        }
        if finished {
            let base = "mock://generate/\(id)/"
            reply["game"] = [
                "id": id, "title": "Postcard Pairs", "description": "", "formula": "microgame",
                "ownerId": "me", "ownerUsername": "me", "packageUrl": base,
                "manifestUrl": base + "manifest.json", "createdAt": "2026-11-12T23:05:35Z",
            ]
        }
        return try decode(reply)
    }

    func cancel(id: String) async {
        lock.withLock {
            jobs[id] = nil
            cancelled.append(id)
        }
    }

    func manifest(for game: RemoteGame) async throws -> BubbleManifest {
        guard let name = Self.replay?.manifest,
              let url = Bundle.main.url(forResource: name, withExtension: "json") else { throw GamesAPIError.notFound }
        // The recorded manifest's bytes, decoded as is (like the live client); a fresh id per run,
        // and the brief this run asked for (the server wraps the game with it).
        var manifest = try BubbleManifest.decode(try Data(contentsOf: url))
        let base = manifest.id.split(separator: "-").dropLast().joined(separator: "-")
        manifest.id = "\(base)-\(StudioManifestBuilder.randomSuffix())"
        if let brief = lock.withLock({ jobs[game.id]?.brief }) { manifest.brief = brief }
        return manifest
    }

    // MARK: Helpers

    private static func isFail(_ variant: Variant) -> Bool {
        if case .fail = variant { return true }
        return false
    }

    private func decode(_ object: [String: Any]) throws -> GenerationJob {
        let data = try JSONSerialization.data(withJSONObject: object)
        return try GamesAPICoding.decoder().decode(GenerationJob.self, from: data)
    }
}
