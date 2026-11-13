import Foundation

/// A game left mid-run: its seed and input log so far (docs/BUBBLES.md 4.8, "Resume").
///
/// Resuming replays `log` at full speed to `log.totalTicks`, then hands control back, so the finished
/// run is still one seed plus one input log and verifies like any other.
struct SavedRun: Codable, Hashable, Sendable {
    var gameID: String
    /// `BubbleRuntimeHost.sessionKey` of the manifest it was played on (id, version, content hash,
    /// so seed and length too). A saved run only resumes on exactly the same game.
    var sessionKey: String
    var log: BubbleInputLog
    var score: Int
    var savedAt: Date
}

/// Where runs left mid-play are kept. Local today; it can move to the server (per account) behind
/// this protocol without touching the player.
@MainActor
protocol RunResumeStoring: AnyObject {
    /// The saved run for a game, if it was saved on the same manifest (`sessionKey`) and isn't stale.
    func saved(gameID: String, sessionKey: String) -> SavedRun?
    func save(_ run: SavedRun)
    func clear(gameID: String)
}

enum RunResumeStores {
    @MainActor static let current: RunResumeStoring = LocalRunResumeStore.shared
}

/// One small JSON file in Application Support, one entry per game (the latest), kept a week.
@MainActor
final class LocalRunResumeStore: RunResumeStoring {
    static let shared = LocalRunResumeStore()

    /// Saved runs older than this are dropped.
    static let maxAge: TimeInterval = 7 * 24 * 3600
    /// At most this many games keep a saved run (the newest).
    static let maxEntries = 24

    private var runs: [String: SavedRun]
    private var pendingWrite: DispatchWorkItem?
    private let fileURL: URL?
    private static let writeQueue = DispatchQueue(label: "run-resume-store", qos: .utility)

    private init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        fileURL = folder?.appendingPathComponent("run-resume.json")
        if let fileURL, let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([String: SavedRun].self, from: data) {
            runs = decoded
        } else {
            runs = [:]
        }
    }

    func saved(gameID: String, sessionKey: String) -> SavedRun? {
        guard let run = runs[gameID] else { return nil }
        guard run.sessionKey == sessionKey, Date().timeIntervalSince(run.savedAt) < Self.maxAge else { return nil }
        return run
    }

    func save(_ run: SavedRun) {
        runs[run.gameID] = run
        if runs.count > Self.maxEntries {
            let keep = runs.values.sorted { $0.savedAt > $1.savedAt }.prefix(Self.maxEntries)
            runs = Dictionary(uniqueKeysWithValues: keep.map { ($0.gameID, $0) })
        }
        scheduleWrite()
    }

    func clear(gameID: String) {
        guard runs.removeValue(forKey: gameID) != nil else { return }
        scheduleWrite()
    }

    /// Writes at most every half second, off the main thread (checkpoints come every 2 s while playing).
    private func scheduleWrite() {
        pendingWrite?.cancel()
        let snapshot = runs
        let url = fileURL
        let work = DispatchWorkItem {
            guard let url, let data = try? JSONEncoder().encode(snapshot) else { return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: .atomic)
        }
        pendingWrite = work
        Self.writeQueue.asyncAfter(deadline: .now() + 0.5, execute: work)
    }
}
