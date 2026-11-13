import Foundation

// Wire models for the games backend (backend/README.md), plus the request and result types of the
// client. Server JSON is camelCase; game ids are Strings (24 hex characters, made by the server);
// scores are whole numbers. Foundation only.

// MARK: - Server models

/// One game as the server describes it (`GameView`).
struct RemoteGame: Codable, Identifiable, Hashable, Sendable {
    var id: String
    /// The manifest's lowercase slug (`my-game`), when it had one.
    var slug: String?
    /// The Group or Event the game was made for (manifest `structure.group_id` / `event_id`).
    var groupID: String?
    var eventID: String?
    var title: String
    var description: String
    var tags: [String]
    var formula: String
    var ownerID: String
    var ownerUsername: String
    /// "Saves are the likes": one counter for both.
    var likes: Int
    var plays: Int
    var finishes: Int
    var likedByMe: Bool
    var remixOf: String?
    var packageURL: URL
    var manifestURL: URL
    var coverURL: URL?
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, slug, title, description, tags, formula, likes, plays, finishes, likedByMe, remixOf, createdAt
        case groupID = "groupId"
        case eventID = "eventId"
        case ownerID = "ownerId"
        case ownerUsername
        case packageURL = "packageUrl"
        case manifestURL = "manifestUrl"
        case coverURL = "coverUrl"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = try c.decodeIfPresent(String.self, forKey: .slug).flatMap { $0.isEmpty ? nil : $0 }
        groupID = try c.decodeIfPresent(String.self, forKey: .groupID).flatMap { $0.isEmpty ? nil : $0 }
        eventID = try c.decodeIfPresent(String.self, forKey: .eventID).flatMap { $0.isEmpty ? nil : $0 }
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        formula = try c.decodeIfPresent(String.self, forKey: .formula) ?? ""
        ownerID = try c.decodeIfPresent(String.self, forKey: .ownerID) ?? ""
        ownerUsername = try c.decodeIfPresent(String.self, forKey: .ownerUsername) ?? ""
        likes = try c.decodeIfPresent(Int.self, forKey: .likes) ?? 0
        plays = try c.decodeIfPresent(Int.self, forKey: .plays) ?? 0
        finishes = try c.decodeIfPresent(Int.self, forKey: .finishes) ?? 0
        likedByMe = try c.decodeIfPresent(Bool.self, forKey: .likedByMe) ?? false
        remixOf = try c.decodeIfPresent(String.self, forKey: .remixOf)
        packageURL = try c.decode(URL.self, forKey: .packageURL)
        manifestURL = try c.decode(URL.self, forKey: .manifestURL)
        coverURL = try c.decodeIfPresent(URL.self, forKey: .coverURL)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
    }

    init(
        id: String, slug: String? = nil, groupID: String? = nil, eventID: String? = nil, title: String, description: String = "", tags: [String] = [], formula: String = "",
        ownerID: String = "", ownerUsername: String = "", likes: Int = 0, plays: Int = 0, finishes: Int = 0,
        likedByMe: Bool = false, remixOf: String? = nil, packageURL: URL, manifestURL: URL,
        coverURL: URL? = nil, createdAt: Date
    ) {
        self.id = id; self.slug = slug; self.groupID = groupID; self.eventID = eventID; self.title = title; self.description = description; self.tags = tags
        self.formula = formula; self.ownerID = ownerID; self.ownerUsername = ownerUsername
        self.likes = likes; self.plays = plays; self.finishes = finishes; self.likedByMe = likedByMe
        self.remixOf = remixOf; self.packageURL = packageURL; self.manifestURL = manifestURL
        self.coverURL = coverURL; self.createdAt = createdAt
    }
}

/// `{items, nextCursor}`; an empty `nextCursor` means the last page.
struct RemoteGamePage: Codable, Hashable, Sendable {
    var items: [RemoteGame]
    var nextCursor: String

    init(items: [RemoteGame], nextCursor: String = "") {
        self.items = items
        self.nextCursor = nextCursor
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decodeIfPresent([RemoteGame].self, forKey: .items) ?? []
        nextCursor = try c.decodeIfPresent(String.self, forKey: .nextCursor) ?? ""
    }

    var hasMore: Bool { !nextCursor.isEmpty }
    /// The cursor to pass to the next `feed(cursor:)` call, or nil on the last page.
    var next: String? { nextCursor.isEmpty ? nil : nextCursor }
}

/// One leaderboard row. The server keeps each person's best; scores are floats on the wire.
struct RemoteScore: Codable, Identifiable, Hashable, Sendable {
    var userID: String
    var username: String
    var score: Double
    var updatedAt: Date

    var id: String { userID }
    /// The app shows whole-number scores.
    var points: Int { Int(score.rounded()) }

    enum CodingKeys: String, CodingKey {
        case userID = "userId"
        case username, score, updatedAt
    }
}

struct RemoteScoreboard: Codable, Hashable, Sendable {
    var items: [RemoteScore]
}

/// `PUT` and `DELETE /v1/games/{id}/like`.
struct SaveState: Codable, Hashable, Sendable {
    var likes: Int
    var likedByMe: Bool
}

/// An account, as the server returns it.
struct RemoteUser: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var email: String?
    var username: String
    var displayName: String
    var createdAt: Date
}

/// `register`, `login` and `refresh` responses. Never log this.
struct AuthTokens: Codable, Sendable {
    var accessToken: String
    var expiresAt: Date
    var refreshToken: String
    var user: RemoteUser?
}

// MARK: - Feed

/// One page of `GET /v1/feed`: the game plus why the recommender picked it.
struct RemoteFeedItem: Decodable, Identifiable, Hashable, Sendable {
    var game: RemoteGame
    /// The server's id for this page; sent back in page events.
    var feedItemID: String
    /// The recommender's reason (`friendBurst`, `groupBurst`, `daily`, `icebreaker`, `nearby`,
    /// `nextLevel`, `yours`, `popular`, or `newest` when ranking is off).
    var reason: String
    /// A short line about why, when the server sends one. Shown as is.
    var why: String?
    var unproven: Bool
    /// `A` or `B` when the server interleaves; sent back in page events.
    var team: String?

    var id: String { feedItemID }

    enum CodingKeys: String, CodingKey {
        case feedItemID, reason, why, unproven, team
    }

    init(from decoder: Decoder) throws {
        game = try RemoteGame(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        feedItemID = try c.decodeIfPresent(String.self, forKey: .feedItemID) ?? game.id
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        why = try c.decodeIfPresent(String.self, forKey: .why).flatMap { $0.isEmpty ? nil : $0 }
        unproven = try c.decodeIfPresent(Bool.self, forKey: .unproven) ?? false
        team = try c.decodeIfPresent(String.self, forKey: .team).flatMap { $0.isEmpty ? nil : $0 }
    }
}

struct RemoteFeedPage: Decodable, Sendable {
    var items: [RemoteFeedItem]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decodeIfPresent([RemoteFeedItem].self, forKey: .items) ?? []
    }

    enum CodingKeys: String, CodingKey { case items }
}

/// One `POST /v1/feed/events` event: a feed page the person saw, or an off-feed moment (`kind`).
/// Field names are the server's (backend/README.md, "Event log").
struct FeedEvent: Hashable, Sendable {
    var eventID: String = UUID().uuidString
    var gameID: String
    var feedItemID: String?
    var position: Int?
    var sessionID: String?
    var reason: String?
    var team: String?
    var dwellSec: Double?
    var tookOver = false
    var runsFinished = 0
    var replays = 0
    var saved = false
    var liked = false
    var floated = false
    var openedBoard = false
    var addedFriend = false
    var remixed = false
    var quitMidRun = false
    var endedSession = false
    var social: [String] = []
    var with: [String] = []
    /// Set for an off-feed moment (any short snake_case name).
    var kind: String?
    var at = Date()

    /// The wire form. Booleans and empty lists are left out.
    func wire(serverGameID: String) -> [String: Any] {
        var out: [String: Any] = ["eventID": eventID, "gameID": serverGameID]
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        out["ts"] = iso.string(from: at)
        if let kind {
            out["kind"] = kind
            if !with.isEmpty { out["with"] = with }
            return out
        }
        if let feedItemID { out["feedItemID"] = feedItemID }
        if let position { out["position"] = position }
        if let sessionID { out["sessionID"] = sessionID }
        if let reason, !reason.isEmpty { out["reason"] = reason }
        if let team { out["team"] = team }
        if let dwellSec { out["dwellSec"] = (dwellSec * 10).rounded() / 10 }
        let flags: [(String, Bool)] = [
            ("tookOver", tookOver), ("saved", saved), ("liked", liked), ("floated", floated),
            ("openedBoard", openedBoard), ("addedFriend", addedFriend), ("remixed", remixed),
            ("quitMidRun", quitMidRun), ("endedSession", endedSession),
        ]
        for (key, value) in flags where value { out[key] = true }
        if runsFinished > 0 { out["runsFinished"] = runsFinished }
        if replays > 0 { out["replays"] = replays }
        if !social.isEmpty { out["social"] = social }
        if !with.isEmpty { out["with"] = with }
        return out
    }
}

// MARK: - People and Groups

/// A person's public profile (`GET /v1/users/{id}`, friends, Group members).
struct RemoteProfile: Decodable, Identifiable, Hashable, Sendable {
    var id: String
    var username: String
    var displayName: String
    var bio: String?
    var isFriend: Bool
    /// Group members only: `owner` or nil.
    var role: String?

    enum CodingKeys: String, CodingKey {
        case id, username, displayName, bio, isFriend, role
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        username = try c.decodeIfPresent(String.self, forKey: .username) ?? ""
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        bio = try c.decodeIfPresent(String.self, forKey: .bio)
        isFriend = try c.decodeIfPresent(Bool.self, forKey: .isFriend) ?? false
        role = try c.decodeIfPresent(String.self, forKey: .role)
    }
}

/// A Group or an Event (`kind` is `group` or `event`).
struct RemoteGroup: Decodable, Identifiable, Hashable, Sendable {
    var id: String
    var kind: String
    var name: String
    var category: String?
    var about: String?
    var isPrivate: Bool
    var ownerID: String?
    var memberCount: Int
    var isMember: Bool
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, kind, name, category, about, memberCount, isMember, createdAt
        case isPrivate = "private"
        case ownerID = "ownerId"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "group"
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        category = try c.decodeIfPresent(String.self, forKey: .category)
        about = try c.decodeIfPresent(String.self, forKey: .about)
        isPrivate = try c.decodeIfPresent(Bool.self, forKey: .isPrivate) ?? false
        ownerID = try c.decodeIfPresent(String.self, forKey: .ownerID)
        memberCount = try c.decodeIfPresent(Int.self, forKey: .memberCount) ?? 0
        isMember = try c.decodeIfPresent(Bool.self, forKey: .isMember) ?? false
        createdAt = try? c.decodeIfPresent(Date.self, forKey: .createdAt)
    }
}

/// `GET /v1/groups/{id}`: the Group and its members.
struct RemoteGroupDetail: Decodable, Sendable {
    var group: RemoteGroup
    var members: [RemoteProfile]

    enum CodingKeys: String, CodingKey { case group, members }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        group = try c.decode(RemoteGroup.self, forKey: .group)
        members = try c.decodeIfPresent([RemoteProfile].self, forKey: .members) ?? []
    }
}

/// `{items: [...]}` replies.
struct RemoteList<Item: Decodable & Sendable>: Decodable, Sendable {
    var items: [Item]

    enum CodingKeys: String, CodingKey { case items }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decodeIfPresent([Item].self, forKey: .items) ?? []
    }
}

/// A Group's Blend, made on the server from what the members actually play
/// (`POST /v1/groups/{id}/blend`; Kevin's `groupBlend` in game-recs.js, run by the API).
struct RemoteBlend: Decodable, Sendable {
    struct Pick: Decodable, Identifiable, Sendable {
        let gameID: String
        /// "Everyone's pick" or "For Maya & you".
        let label: String
        let why: String
        /// The game, attached by the server.
        let game: RemoteGame?

        var id: String { gameID }
    }

    /// The Blend game, in the shape of a brief, plus a prompt Studio takes as is.
    struct Spec: Decodable, Sendable {
        let formula: String?
        let mood: [String]?
        let energy: String?
        let competition: String?
        let why: String?
        let prompt: String
    }

    /// Someone in the Group with a taste like yours whom you aren't friends with yet.
    struct Twin: Decodable, Identifiable, Sendable {
        let userID: String
        let name: String
        let why: String

        var id: String { userID }
    }

    let picks: [Pick]
    let spec: Spec?
    /// Mean pairwise taste similarity, 0...1.
    let cohesion: Double?
    let twins: [Twin]

    enum CodingKeys: String, CodingKey { case picks, spec, cohesion, twins }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        picks = (try? c.decodeIfPresent([Pick].self, forKey: .picks)) ?? []
        spec = try? c.decodeIfPresent(Spec.self, forKey: .spec)
        cohesion = try? c.decodeIfPresent(Double.self, forKey: .cohesion)
        twins = (try? c.decodeIfPresent([Twin].self, forKey: .twins)) ?? []
    }
}

// MARK: - Publishing

/// A game package: the files of a zip with `manifest.json` at the root (backend README, "Game
/// packages"). `localID` is the app's slug; the live client links it to the server id on success.
struct GamePackage: Sendable {
    var localID: String?
    var files: [String: Data]

    init(localID: String? = nil, files: [String: Data]) {
        self.localID = localID
        self.files = files
    }

    /// An uncompressed (stored) zip of `files`, entries sorted by path.
    func zipData() -> Data { StoredZip.archive(files) }
}

/// A minimal ZIP writer (method 0, no compression), enough for the server's package check.
enum StoredZip {
    static func archive(_ files: [String: Data]) -> Data {
        var out = Data()
        var central = Data()
        var count: UInt16 = 0
        for path in files.keys.sorted() {
            let data = files[path] ?? Data()
            let name = Data(path.utf8)
            let crc = crc32(data)
            let offset = UInt32(out.count)
            out.u32(0x04034b50); out.u16(20); out.u16(0x0800); out.u16(0); out.u16(0); out.u16(0x21)
            out.u32(crc); out.u32(UInt32(data.count)); out.u32(UInt32(data.count))
            out.u16(UInt16(name.count)); out.u16(0)
            out.append(name); out.append(data)
            central.u32(0x02014b50); central.u16(20); central.u16(20); central.u16(0x0800); central.u16(0)
            central.u16(0); central.u16(0x21); central.u32(crc)
            central.u32(UInt32(data.count)); central.u32(UInt32(data.count))
            central.u16(UInt16(name.count)); central.u16(0); central.u16(0); central.u16(0); central.u16(0)
            central.u32(0); central.u32(offset); central.append(name)
            count += 1
        }
        let start = UInt32(out.count)
        out.append(central)
        out.u32(0x06054b50); out.u16(0); out.u16(0); out.u16(count); out.u16(count)
        out.u32(UInt32(central.count)); out.u32(start); out.u16(0)
        return out
    }

    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = (crc >> 1) ^ (0xEDB8_8320 & (0 &- (crc & 1))) }
        }
        return ~crc
    }
}

private extension Data {
    mutating func u16(_ v: UInt16) { append(contentsOf: [UInt8(v & 0xFF), UInt8(v >> 8)]) }
    mutating func u32(_ v: UInt32) { u16(UInt16(v & 0xFFFF)); u16(UInt16(v >> 16)) }
}

// MARK: - Coding

enum GamesAPICoding {
    /// The Go server writes RFC 3339 with milliseconds ("2026-11-12T20:15:03.123Z"); accept both forms.
    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            let frac = ISO8601DateFormatter()
            frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = frac.date(from: s) { return date }
            let plain = ISO8601DateFormatter()
            if let date = plain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(s)"))
        }
        return d
    }

    static func encoder() -> JSONEncoder { JSONEncoder() }
}

// MARK: - Challenges (`GET`/`POST /v1/challenges`)

/// A friend's best on a challenged game (sent challenges).
struct RemoteChallengeResponse: Decodable, Hashable, Sendable {
    var userID: String
    var username: String
    var score: Double
    var beat: Bool

    enum CodingKeys: String, CodingKey {
        case userID = "userId", username, score, beat
    }
}

/// "Beat my score": one game, the sender's best when sent, and how each side is doing.
struct RemoteChallenge: Decodable, Identifiable, Hashable, Sendable {
    var id: String
    /// `sent` or `received`.
    var direction: String
    var game: RemoteGame?
    var from: RemoteProfile
    var toIDs: [String]
    /// The score to beat.
    var score: Double
    /// Received: my best on the game, if I've played it.
    var myScore: Double?
    /// Received: I've beaten it.
    var beaten: Bool
    /// Sent: the friends who have played, and how they did.
    var responses: [RemoteChallengeResponse]
    var createdAt: Date

    var isReceived: Bool { direction == "received" }

    enum CodingKeys: String, CodingKey {
        case id, direction, game, from, toIDs = "toIds", score, myScore, beaten, responses, createdAt
    }
}
