import Foundation

// Same-seed rounds in a chat or a Group (`/v1/rounds`, backend/README.md "Rounds"), and how opinion
// games compare (`GET /v1/games/{id}/agreement`). The server picks the seed, replays every run,
// writes the result lines, ranks the players and works out agreement. The app only shows it.

/// Where a round lives: a chat thread or a Group. Its wire form is `chat:<id>` or `group:<id>`.
struct RoundTarget: Hashable, Sendable, Codable {
    enum Kind: String, Codable, Sendable { case chat, group }
    var kind: Kind
    var id: String

    var wire: String { "\(kind.rawValue):\(id)" }

    init(kind: Kind, id: String) {
        self.kind = kind
        self.id = id
    }

    /// Parses `chat:<id>` or `group:<id>`.
    init?(wire: String) {
        let parts = wire.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2, let kind = Kind(rawValue: parts[0]), !parts[1].isEmpty else { return nil }
        self.init(kind: kind, id: parts[1])
    }
}

/// A game's `group_play` block as the server stores it (only the parts the app shows).
struct RemoteGroupPlay: Decodable, Hashable, Sendable {
    struct Result: Decodable, Hashable, Sendable {
        var kind: String?
        /// score, ending, agreement or none.
        var compare: String
        var display: String?
    }

    var mode: String
    var roundSeconds: Int?
    var result: Result
    var shareLine: String?

    enum CodingKeys: String, CodingKey {
        case mode, result
        case roundSeconds = "round_seconds"
        case shareLine = "share_line"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "same_seed_async"
        roundSeconds = try c.decodeIfPresent(Int.self, forKey: .roundSeconds)
        result = try c.decodeIfPresent(Result.self, forKey: .result) ?? Result(kind: nil, compare: "score", display: nil)
        shareLine = try c.decodeIfPresent(String.self, forKey: .shareLine)
    }

    var isOpinion: Bool { result.compare == "agreement" }
}

/// Only the `group_play` of a game object (`GET /v1/games/{id}`, or the `game` inside a round).
struct RemoteGameGroupPlay: Decodable, Sendable {
    var groupPlay: RemoteGroupPlay?

    enum CodingKeys: String, CodingKey { case groupPlay = "group_play" }
}

/// One member's run of a round, as the server replayed it.
struct RemoteRoundPlay: Decodable, Hashable, Sendable {
    var played: Bool
    var score: Int?
    /// The score as the game formats it ("1:02.4", "7 right"). The app never formats a score itself.
    var display: String?
    var timeMs: Int?
    var dnf: Bool
    /// The end state the game names in `group_play.result.state` (an ending, picks).
    var result: JSONValue?

    enum CodingKeys: String, CodingKey { case played, score, display, timeMs, dnf, result }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        played = try c.decodeIfPresent(Bool.self, forKey: .played) ?? false
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        display = try c.decodeIfPresent(String.self, forKey: .display)
        timeMs = try c.decodeIfPresent(Int.self, forKey: .timeMs)
        dnf = try c.decodeIfPresent(Bool.self, forKey: .dnf) ?? false
        result = try c.decodeIfPresent(JSONValue.self, forKey: .result)
    }

    /// The ending a story game reached, when the game reports one.
    var ending: String? { result?["ending"]?.string }
}

/// A line the round's thread shows ("Ana: 7 right on Capital Dash. Your turn.").
struct RemoteRoundLine: Decodable, Hashable, Sendable, Identifiable {
    var userID: String
    var text: String
    var at: Date

    var id: String { "\(userID)|\(at.timeIntervalSince1970)" }

    enum CodingKeys: String, CodingKey { case userID = "userId", text, at }
}

/// How much my picks match another player's in an opinion game (0 to 100).
struct RemoteRoundAgreement: Decodable, Hashable, Sendable {
    var userID: String
    var percent: Int

    enum CodingKeys: String, CodingKey { case userID = "userId", percent }
}

/// A same-seed round, as the person asking sees it.
struct RemoteRound: Decodable, Identifiable, Hashable, Sendable {
    var id: String
    var gameID: String
    var game: RemoteGame?
    var groupPlay: RemoteGroupPlay?
    var creatorID: String
    var target: RoundTarget?
    var members: [RemoteProfile]
    var mode: String
    /// The server's seed: play the round with it as the run seed.
    var seed: Int
    /// Seconds a run should take (`group_play.round_seconds`).
    var length: Int?
    /// By user id; a member who hasn't played has `played: false`.
    var plays: [String: RemoteRoundPlay]
    var lines: [RemoteRoundLine]
    /// User ids, best first (not for an opinion game).
    var order: [String]
    var winnerID: String?
    /// Mine against each other player (opinion games only).
    var agreement: [RemoteRoundAgreement]
    var createdAt: Date
    var closesAt: Date
    var finished: Bool

    enum CodingKeys: String, CodingKey {
        case id, game, members, mode, seed, length, plays, lines, order, agreement, createdAt, closesAt, finished, target
        case gameID = "gameId", creatorID = "creatorId", winnerID = "winnerId"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        gameID = try c.decode(String.self, forKey: .gameID)
        game = try? c.decodeIfPresent(RemoteGame.self, forKey: .game)
        groupPlay = (try? c.decodeIfPresent(RemoteGameGroupPlay.self, forKey: .game))??.groupPlay
        creatorID = try c.decodeIfPresent(String.self, forKey: .creatorID) ?? ""
        if let t = try c.decodeIfPresent([String: String].self, forKey: .target),
           let kind = t["kind"].flatMap(RoundTarget.Kind.init(rawValue:)), let tid = t["id"] {
            target = RoundTarget(kind: kind, id: tid)
        }
        members = try c.decodeIfPresent([RemoteProfile].self, forKey: .members) ?? []
        mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? ""
        seed = try c.decodeIfPresent(Int.self, forKey: .seed) ?? 0
        length = try c.decodeIfPresent(Int.self, forKey: .length)
        plays = try c.decodeIfPresent([String: RemoteRoundPlay].self, forKey: .plays) ?? [:]
        lines = try c.decodeIfPresent([RemoteRoundLine].self, forKey: .lines) ?? []
        order = try c.decodeIfPresent([String].self, forKey: .order) ?? []
        winnerID = try c.decodeIfPresent(String.self, forKey: .winnerID).flatMap { $0.isEmpty ? nil : $0 }
        agreement = try c.decodeIfPresent([RemoteRoundAgreement].self, forKey: .agreement) ?? []
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        closesAt = try c.decode(Date.self, forKey: .closesAt)
        finished = try c.decodeIfPresent(Bool.self, forKey: .finished) ?? false
    }

    var isOpinion: Bool { groupPlay?.isOpinion ?? !agreement.isEmpty }
    var playedCount: Int { plays.values.filter(\.played).count }

    func member(_ id: String) -> RemoteProfile? { members.first { $0.id == id } }
    func hasPlayed(_ userID: String?) -> Bool { userID.flatMap { plays[$0]?.played } ?? false }
}

/// `GET /v1/games/{id}/agreement`: how my picks compare with a friend's, my friends' or a Group's.
struct RemoteGameAgreement: Decodable, Sendable {
    struct Item: Decodable, Hashable, Sendable {
        var item: String
        var mine: String
        var group: String
        /// The share of the others who picked what I did (0 to 1, or 0 to 100).
        var share: Double
    }

    var agreement: Int
    var players: Int
    var items: [Item]
}

extension RemoteProfile {
    /// The name to show: the display name, else the username.
    var shownName: String { displayName.isEmpty ? username : displayName }
}
