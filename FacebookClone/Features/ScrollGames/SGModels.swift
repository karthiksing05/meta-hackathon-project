import Foundation

// Codable models for the Scroll Games server (docs/scroll-games/CONTRACTS.md).
// Decoding is deliberately forgiving: every field is optional on the wire, unknown fields are ignored.

/// Raw JSON, used for manifests, content and briefs that the app passes through untouched.
enum JSONValue: Codable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    /// Converts the output of `JSONSerialization` (or a WebKit message body).
    init(any value: Any?) {
        switch value {
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                self = .bool(number.boolValue)
            } else {
                self = .number(number.doubleValue)
            }
        case let string as String:
            self = .string(string)
        case let array as [Any]:
            self = .array(array.map { JSONValue(any: $0) })
        case let dict as [String: Any]:
            self = .object(dict.mapValues { JSONValue(any: $0) })
        default:
            self = .null
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let dict) = self { return dict[key] }
        return nil
    }

    var stringValue: String? {
        switch self {
        case .string(let value): return value
        case .number(let value): return value == value.rounded() ? String(Int(value)) : String(value)
        case .bool(let value): return value ? "true" : "false"
        default: return nil
        }
    }

    var doubleValue: Double? {
        switch self {
        case .number(let value): return value
        case .string(let value): return Double(value)
        default: return nil
        }
    }

    var intValue: Int? { doubleValue.map { Int($0) } }

    var arrayValue: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }
}

extension KeyedDecodingContainer {
    /// Decodes a value if present and well-typed; otherwise nil.
    func flex<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        try? decodeIfPresent(type, forKey: key)
    }
}

struct SGUser: Decodable, Identifiable, Hashable {
    let id: String
    var name: String
    var avatarURL: String?
    var isCreator: Bool
    var follows: [String]
    var friends: [String]

    enum CodingKeys: String, CodingKey {
        case id, name, follows, friends
        case avatarURL = "avatar_url"
        case isCreator = "is_creator"
    }

    init(id: String, name: String, avatarURL: String? = nil, isCreator: Bool = false, follows: [String] = [], friends: [String] = []) {
        self.id = id
        self.name = name
        self.avatarURL = avatarURL
        self.isCreator = isCreator
        self.follows = follows
        self.friends = friends
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flex(String.self, .id) ?? UUID().uuidString
        name = c.flex(String.self, .name) ?? id
        avatarURL = c.flex(String.self, .avatarURL)
        isCreator = c.flex(Bool.self, .isCreator) ?? false
        follows = c.flex([String].self, .follows) ?? []
        friends = c.flex([String].self, .friends) ?? []
    }

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
}

struct SGMedia: Decodable, Identifiable, Hashable {
    let id: String
    var url: String
    var caption: String
    var groupID: String?
    var ownerID: String?

    enum CodingKeys: String, CodingKey {
        case id, url, caption
        case groupID = "group_id"
        case ownerID = "owner_id"
    }

    init(id: String, url: String, caption: String, groupID: String? = nil, ownerID: String? = nil) {
        self.id = id
        self.url = url
        self.caption = caption
        self.groupID = groupID
        self.ownerID = ownerID
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flex(String.self, .id) ?? UUID().uuidString
        url = c.flex(String.self, .url) ?? ""
        caption = c.flex(String.self, .caption) ?? ""
        groupID = c.flex(String.self, .groupID)
        ownerID = c.flex(String.self, .ownerID)
    }
}

struct SGGroup: Decodable, Identifiable, Hashable {
    let id: String
    var name: String
    var memberIDs: [String]
    var mediaIDs: [String]

    enum CodingKeys: String, CodingKey {
        case id, name
        case memberIDs = "member_ids"
        case mediaIDs = "media_ids"
    }

    init(id: String, name: String, memberIDs: [String] = [], mediaIDs: [String] = []) {
        self.id = id
        self.name = name
        self.memberIDs = memberIDs
        self.mediaIDs = mediaIDs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flex(String.self, .id) ?? UUID().uuidString
        name = c.flex(String.self, .name) ?? id
        memberIDs = c.flex([String].self, .memberIDs) ?? []
        mediaIDs = c.flex([String].self, .mediaIDs) ?? []
    }
}

struct SGGameStats: Decodable, Hashable {
    var plays: Int
    var best: Int

    init(plays: Int = 0, best: Int = 0) {
        self.plays = plays
        self.best = best
    }

    enum CodingKeys: String, CodingKey { case plays, best }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plays = c.flex(Int.self, .plays) ?? 0
        best = c.flex(Int.self, .best) ?? 0
    }
}

struct SGGenInfo: Decodable, Hashable {
    var ms: Int?
    var source: String?
    var costUSD: Double?

    enum CodingKeys: String, CodingKey {
        case ms, source
        case costUSD = "cost_usd"
    }

    init(ms: Int? = nil, source: String? = nil, costUSD: Double? = nil) {
        self.ms = ms
        self.source = source
        self.costUSD = costUSD
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ms = c.flex(Int.self, .ms)
        source = c.flex(String.self, .source)
        costUSD = c.flex(Double.self, .costUSD)
    }
}

struct SGGame: Decodable, Identifiable, Hashable {
    let id: String
    var title: String
    var description: String
    var creatorID: String
    var status: String
    var manifest: JSONValue?
    var content: JSONValue?
    var brief: JSONValue?
    var createdAt: String?
    var gen: SGGenInfo?
    var stats: SGGameStats

    enum CodingKeys: String, CodingKey {
        case id, title, description, status, manifest, content, brief, gen, stats
        case creatorID = "creator_id"
        case createdAt = "created_at"
    }

    init(
        id: String, title: String, description: String = "", creatorID: String, status: String = "published",
        manifest: JSONValue? = nil, createdAt: String? = nil, stats: SGGameStats = SGGameStats()
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.creatorID = creatorID
        self.status = status
        self.manifest = manifest
        self.createdAt = createdAt
        self.stats = stats
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flex(String.self, .id) ?? UUID().uuidString
        let manifest = c.flex(JSONValue.self, .manifest)
        self.manifest = manifest
        title = c.flex(String.self, .title) ?? manifest?["title"]?.stringValue ?? "Untitled game"
        description = c.flex(String.self, .description) ?? manifest?["description"]?.stringValue ?? ""
        creatorID = c.flex(String.self, .creatorID) ?? ""
        status = c.flex(String.self, .status) ?? "published"
        content = c.flex(JSONValue.self, .content)
        brief = c.flex(JSONValue.self, .brief)
        createdAt = c.flex(String.self, .createdAt)
        gen = c.flex(SGGenInfo.self, .gen)
        stats = c.flex(SGGameStats.self, .stats) ?? SGGameStats()
    }

    var emoji: String {
        manifest?["theme"]?["emoji"]?.stringValue ?? "🎮"
    }

    var palette: String {
        manifest?["theme"]?["palette"]?.stringValue ?? id
    }

    var mood: String? {
        manifest?["theme"]?["mood"]?.stringValue
    }
}

struct SGPlay: Decodable, Hashable {
    var id: String?
    var userID: String?
    var gameID: String?
    var score: Int
    var seed: Int?
    var verified: Bool?

    enum CodingKeys: String, CodingKey {
        case id, score, seed, verified
        case userID = "user_id"
        case gameID = "game_id"
    }

    init(score: Int, id: String? = nil, userID: String? = nil, gameID: String? = nil) {
        self.id = id
        self.userID = userID
        self.gameID = gameID
        self.score = score
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flex(String.self, .id)
        userID = c.flex(String.self, .userID)
        gameID = c.flex(String.self, .gameID)
        score = c.flex(Int.self, .score) ?? 0
        seed = c.flex(Int.self, .seed)
        verified = c.flex(Bool.self, .verified)
    }
}

struct SGChallenge: Decodable, Hashable {
    var id: String
    var gameID: String?
    var seed: Int?
    var fromUserID: String?
    var score: Int?

    enum CodingKeys: String, CodingKey {
        case id, seed, score
        case gameID = "game_id"
        case fromUserID = "from_user_id"
    }

    init(id: String, gameID: String?, seed: Int?, fromUserID: String? = nil, score: Int? = nil) {
        self.id = id
        self.gameID = gameID
        self.seed = seed
        self.fromUserID = fromUserID
        self.score = score
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flex(String.self, .id) ?? UUID().uuidString
        gameID = c.flex(String.self, .gameID)
        seed = c.flex(Int.self, .seed)
        fromUserID = c.flex(String.self, .fromUserID)
        score = c.flex(Int.self, .score)
    }
}

enum SGFeedType: String {
    case game, score, challenge, daily
}

struct SGFeedItem: Decodable, Identifiable, Hashable {
    let id: String
    var type: String
    var actor: SGUser?
    var game: SGGame?
    var play: SGPlay?
    var challenge: SGChallenge?
    var text: String
    var createdAt: String?
    var band: String?

    enum CodingKeys: String, CodingKey {
        case id, type, actor, game, play, challenge, text, band
        case createdAt = "created_at"
    }

    init(
        id: String, type: String, actor: SGUser?, game: SGGame?, play: SGPlay? = nil,
        challenge: SGChallenge? = nil, text: String = "", createdAt: String? = nil
    ) {
        self.id = id
        self.type = type
        self.actor = actor
        self.game = game
        self.play = play
        self.challenge = challenge
        self.text = text
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flex(String.self, .id) ?? UUID().uuidString
        type = c.flex(String.self, .type) ?? "game"
        actor = c.flex(SGUser.self, .actor)
        game = c.flex(SGGame.self, .game)
        play = c.flex(SGPlay.self, .play)
        challenge = c.flex(SGChallenge.self, .challenge)
        text = c.flex(String.self, .text) ?? ""
        createdAt = c.flex(String.self, .createdAt)
        band = c.flex(String.self, .band)
    }

    var kind: SGFeedType { SGFeedType(rawValue: type) ?? .game }

    var date: Date? { createdAt.flatMap(SGDates.parse) }
}

enum SGDates {
    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ string: String) -> Date? {
        withFraction.date(from: string) ?? plain.date(from: string)
    }
}

struct SGBeat: Decodable, Hashable {
    var user: String
    var score: Int
    var won: Bool

    enum CodingKeys: String, CodingKey { case user, score, won }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let name = c.flex(String.self, .user) {
            user = name
        } else if let object = c.flex(SGUser.self, .user) {
            user = object.name
        } else {
            user = "them"
        }
        score = c.flex(Int.self, .score) ?? 0
        won = c.flex(Bool.self, .won) ?? false
    }
}

/// The `daily` object of a play response when the play was submitted as the daily attempt.
struct SGDailyResult: Decodable, Hashable {
    var date: String
    var counted: Bool
    var streak: Int
    var rankAmongFriends: Int?

    enum CodingKeys: String, CodingKey {
        case date, counted, streak
        case rankAmongFriends = "rank_among_friends"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = c.flex(String.self, .date) ?? ""
        counted = c.flex(Bool.self, .counted) ?? false
        streak = c.flex(Int.self, .streak) ?? 0
        rankAmongFriends = c.flex(Int.self, .rankAmongFriends)
    }
}

/// `GET /api/daily`: today's game, its shared seed and how the viewer is doing.
struct SGDaily: Decodable, Hashable {
    var date: String
    var game: SGGame
    var seed: Int
    var resetsAt: String?
    var myPlay: SGPlay?
    var myStreak: Int
    var friendsPlayed: Int
    var myRankAmongFriends: Int?

    enum CodingKeys: String, CodingKey {
        case date, game, seed
        case resetsAt = "resets_at"
        case myPlay = "my_play"
        case myStreak = "my_streak"
        case friendsPlayed = "friends_played"
        case myRankAmongFriends = "my_rank_among_friends"
    }

    init(
        date: String, game: SGGame, seed: Int, resetsAt: String?, myPlay: SGPlay? = nil,
        myStreak: Int, friendsPlayed: Int, myRankAmongFriends: Int? = nil
    ) {
        self.date = date
        self.game = game
        self.seed = seed
        self.resetsAt = resetsAt
        self.myPlay = myPlay
        self.myStreak = myStreak
        self.friendsPlayed = friendsPlayed
        self.myRankAmongFriends = myRankAmongFriends
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let game = c.flex(SGGame.self, .game) else {
            throw DecodingError.dataCorruptedError(forKey: .game, in: c, debugDescription: "No daily game")
        }
        self.game = game
        date = c.flex(String.self, .date) ?? ""
        seed = c.flex(Int.self, .seed) ?? 0
        resetsAt = c.flex(String.self, .resetsAt)
        myPlay = c.flex(SGPlay.self, .myPlay)
        myStreak = c.flex(Int.self, .myStreak) ?? 0
        friendsPlayed = c.flex(Int.self, .friendsPlayed) ?? 0
        myRankAmongFriends = c.flex(Int.self, .myRankAmongFriends)
    }

    /// "Nov 12" for the card chip.
    var shortDate: String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd"
        guard let day = parser.date(from: date) else { return date }
        parser.dateFormat = "MMM d"
        return parser.string(from: day)
    }

    var resetDate: Date? { resetsAt.flatMap(SGDates.parse) }
}

struct SGPlayResponse: Decodable, Hashable {
    var play: SGPlay?
    var verified: Bool
    var rank: Int?
    var beat: SGBeat?
    var daily: SGDailyResult?

    enum CodingKeys: String, CodingKey { case play, verified, rank, beat, daily }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        play = c.flex(SGPlay.self, .play)
        verified = c.flex(Bool.self, .verified) ?? play?.verified ?? false
        rank = c.flex(Int.self, .rank)
        beat = c.flex(SGBeat.self, .beat)
        daily = c.flex(SGDailyResult.self, .daily)
    }
}

struct SGBriefResponse: Decodable {
    var brief: JSONValue
    var ms: Int?
    var cached: Bool
    var source: String

    enum CodingKeys: String, CodingKey { case brief, ms, cached, source }

    init(brief: JSONValue, ms: Int?, cached: Bool, source: String) {
        self.brief = brief
        self.ms = ms
        self.cached = cached
        self.source = source
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brief = c.flex(JSONValue.self, .brief) ?? .object([:])
        ms = c.flex(Int.self, .ms)
        cached = c.flex(Bool.self, .cached) ?? false
        source = c.flex(String.self, .source) ?? "fallback"
    }
}

struct SGChallengeResponse: Decodable {
    var challenge: SGChallenge?
    var url: String?
    var text: String?

    enum CodingKeys: String, CodingKey { case challenge, url, text }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        challenge = c.flex(SGChallenge.self, .challenge)
        url = c.flex(String.self, .url)
        text = c.flex(String.self, .text)
    }
}

/// A finished run reported by the player (`result` message).
struct SGPlayResult: Hashable {
    var score: Int
    var seed: Int
    var ticks: Int
    var inputs: JSONValue
    var correct: Int
    var wrong: Int
    var bestStreak: Int

    init(json: JSONValue) {
        score = json["score"]?.intValue ?? 0
        seed = json["seed"]?.intValue ?? 0
        ticks = json["ticks"]?.intValue ?? 0
        inputs = json["inputs"] ?? .array([])
        correct = json["stats"]?["correct"]?.intValue ?? 0
        wrong = json["stats"]?["wrong"]?.intValue ?? 0
        bestStreak = json["stats"]?["best_streak"]?.intValue ?? 0
    }

    init(score: Int, seed: Int, correct: Int, wrong: Int, bestStreak: Int) {
        self.score = score
        self.seed = seed
        ticks = 0
        inputs = .array([])
        self.correct = correct
        self.wrong = wrong
        self.bestStreak = bestStreak
    }
}

/// Server-sent events from `POST /api/games/generate`.
enum SGGenEvent {
    case stage(name: String, status: String, ms: Int?)
    case done(SGGame)
    case failed(String)
}
