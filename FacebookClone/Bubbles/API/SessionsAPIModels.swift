import Foundation

// Making a game together (`/v1/sessions`, backend/README.md "Making a game together"). The server
// keeps the session, its members and every entry, and makes the game through the same path as
// `/v1/generate`. The app only shows it.

/// One person's addition to a session.
struct RemoteSessionEntry: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var maker: RemoteProfile
    var text: String
    var at: Date
}

/// A co-making session, as the person asking sees it.
struct RemoteSession: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    /// question, words, scene or level.
    var kind: String
    var title: String
    var ask: String
    var starter: RemoteProfile
    var target: RoundTarget?
    var members: [RemoteProfile]
    var entries: [RemoteSessionEntry]
    /// open, making, made or failed.
    var status: String
    var jobID: String?
    var gameID: String?
    var game: RemoteGame?
    var error: String?
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, kind, title, ask, starter, target, members, entries, status, game, error, createdAt
        case jobID = "jobId", gameID = "gameId"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "question"
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        ask = try c.decodeIfPresent(String.self, forKey: .ask) ?? ""
        starter = try c.decode(RemoteProfile.self, forKey: .starter)
        if let t = try c.decodeIfPresent([String: String].self, forKey: .target),
           let kind = t["kind"].flatMap(RoundTarget.Kind.init(rawValue:)), let tid = t["id"] {
            target = RoundTarget(kind: kind, id: tid)
        }
        members = try c.decodeIfPresent([RemoteProfile].self, forKey: .members) ?? []
        entries = try c.decodeIfPresent([RemoteSessionEntry].self, forKey: .entries) ?? []
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "open"
        jobID = try c.decodeIfPresent(String.self, forKey: .jobID).flatMap { $0.isEmpty ? nil : $0 }
        gameID = try c.decodeIfPresent(String.self, forKey: .gameID).flatMap { $0.isEmpty ? nil : $0 }
        game = try? c.decodeIfPresent(RemoteGame.self, forKey: .game)
        error = try c.decodeIfPresent(String.self, forKey: .error).flatMap { $0.isEmpty ? nil : $0 }
        createdAt = try c.decode(Date.self, forKey: .createdAt)
    }
}

/// `POST /v1/sessions/{id}/make`: the job making the game.
struct RemoteSessionMake: Decodable, Sendable {
    var jobID: String

    enum CodingKeys: String, CodingKey { case jobID = "jobId" }
}
