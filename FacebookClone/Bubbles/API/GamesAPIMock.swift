import Foundation

// A GamesAPI over today's local data. No network, deterministic, and read-only on BubbleStore:
// saves, challenges and events live in memory here and never touch the store.

final class GamesAPIMock: GamesAPI, @unchecked Sendable {
    private let store: BubbleStore
    private let lock = NSLock()
    private var saved: [String: Bool] = [:]
    private var sent: [Challenge] = []
    private(set) var recordedEvents: [GameEvent] = []
    private let pageSize: Int

    init(store: BubbleStore, pageSize: Int = 20) {
        self.store = store
        self.pageSize = pageSize
    }

    // MARK: Games

    func feed(cursor: String?) async throws -> RemoteGamePage {
        let games = await MainActor.run { store.feedBubbles.map(remote) }
        let start = min(Int(cursor ?? "") ?? 0, games.count)
        let end = min(start + pageSize, games.count)
        return RemoteGamePage(items: Array(games[start..<end]), nextCursor: end < games.count ? String(end) : "")
    }

    func game(id: String) async throws -> RemoteGame {
        guard let game = await MainActor.run(body: { store.bubble(id: id).map(remote) }) else {
            throw GamesAPIError.notFound
        }
        return game
    }

    func publish(_ package: GamePackage) async throws -> RemoteGame {
        let id = package.localID ?? "mock-\(StoredZip.crc32(package.zipData()))"
        var title = id
        if let data = package.files["manifest.json"],
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let t = obj["title"] as? String, !t.isEmpty {
            title = t
        }
        return RemoteGame(
            id: id, title: title, ownerID: "me", ownerUsername: "me",
            packageURL: Self.url(id, ""), manifestURL: Self.url(id, "manifest.json"),
            createdAt: Date(timeIntervalSince1970: 1_790_000_000)
        )
    }

    // MARK: Scores and saves

    func scores(gameID: String, scope: BubbleBoardScope) async throws -> [RemoteScore] {
        guard let rows = await MainActor.run(body: { () -> [RemoteScore]? in
            guard let bubble = store.bubble(id: gameID) else { return nil }
            return store.leaderboard(for: bubble, scope: scope).map {
                RemoteScore(userID: $0.user.id, username: $0.user.name, score: Double($0.score), updatedAt: $0.achievedAt)
            }
        }) else { throw GamesAPIError.notFound }
        return rows
    }

    func submitScore(_ score: Double, gameID: String) async throws -> [RemoteScore] {
        try await scores(gameID: gameID, scope: .everyone)
    }

    func setSaved(_ saved: Bool, gameID: String) async throws -> SaveState {
        let base = try await game(id: gameID)
        lock.withLock { self.saved[gameID] = saved }
        let delta = (saved ? 1 : 0) - (base.likedByMe ? 1 : 0)
        return SaveState(likes: max(0, base.likes + delta), likedByMe: saved)
    }

    func sendEvents(_ events: [GameEvent]) async throws {
        lock.withLock { recordedEvents.append(contentsOf: events.filter { $0.kind.isAcceptedByServer }) }
    }

    // MARK: Mock-only features

    func sendChallenge(_ challenge: ChallengeRequest) async throws -> Challenge {
        lock.withLock {
            let made = Challenge(
                id: "mock-challenge-\(sent.count + 1)", gameID: challenge.gameID, fromUserID: "me",
                toUserIDs: challenge.toUserIDs, score: challenge.score, seed: challenge.seed,
                message: challenge.message, createdAt: Date(timeIntervalSince1970: 1_790_000_000 + Double(sent.count))
            )
            sent.append(made)
            return made
        }
    }

    func challenges() async throws -> [Challenge] {
        lock.withLock { sent }
    }

    func blend(groupID: String) async throws -> GroupBlend {
        let ids = await MainActor.run { Array(store.feedBubbles.prefix(3).map(\.id)) }
        return GroupBlend(
            groupID: groupID, headline: "A game for everyone in this Group",
            sharedTraits: ["weekend plans", "quick rounds", "friendly competition"], suggestedGameIDs: ids
        )
    }

    // MARK: Mapping

    private func remote(_ bubble: Bubble) -> RemoteGame {
        let liked = lock.withLock { saved[bubble.id] } ?? bubble.isSaved
        return RemoteGame(
            id: bubble.id, title: bubble.title, description: bubble.rule,
            tags: bubble.manifest.brief.mood, formula: bubble.formula.rawValue,
            ownerID: bubble.creator.id, ownerUsername: bubble.creator.name,
            likes: bubble.saveCount, plays: bubble.playCount, likedByMe: liked,
            remixOf: bubble.manifest.lineage.remixOf,
            packageURL: Self.url(bubble.id, ""), manifestURL: Self.url(bubble.id, "manifest.json"),
            createdAt: bubble.createdAt
        )
    }

    private static func url(_ id: String, _ path: String) -> URL {
        URL(string: "mock://games/\(id)/\(path)") ?? URL(string: "mock://games")!
    }
}
