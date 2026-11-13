import Foundation

// Wire models for the games backend (backend/README.md on `backend-api` at 17e4ce7), plus the
// request and result types of the client. Server JSON is camelCase; ids are Strings (24 hex
// characters, made by the server); scores are Doubles. Foundation only.

// MARK: - Server models

/// One game as the server describes it (`GameView`).
struct RemoteGame: Codable, Identifiable, Hashable, Sendable {
    var id: String
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
        case id, title, description, tags, formula, likes, plays, finishes, likedByMe, remixOf, createdAt
        case ownerID = "ownerId"
        case ownerUsername
        case packageURL = "packageUrl"
        case manifestURL = "manifestUrl"
        case coverURL = "coverUrl"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
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
        id: String, title: String, description: String = "", tags: [String] = [], formula: String = "",
        ownerID: String = "", ownerUsername: String = "", likes: Int = 0, plays: Int = 0, finishes: Int = 0,
        likedByMe: Bool = false, remixOf: String? = nil, packageURL: URL, manifestURL: URL,
        coverURL: URL? = nil, createdAt: Date
    ) {
        self.id = id; self.title = title; self.description = description; self.tags = tags
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

// MARK: - Events

/// What the app reports about a game. The server accepts only the first ten kinds; the rest are
/// app-only and are dropped by the live client before sending.
enum GameEventKind: String, Codable, CaseIterable, Sendable {
    case view, play, finish, quit, skip, replay, like, unlike, share, remix
    // App-only (no server endpoint yet): dropped by the live client.
    case challengeSent = "challenge_sent"
    case challengeAccepted = "challenge_accepted"
    case challengeWon = "challenge_won"

    var isAcceptedByServer: Bool {
        switch self {
        case .challengeSent, .challengeAccepted, .challengeWon: return false
        default: return true
        }
    }
}

struct GameEvent: Hashable, Sendable {
    /// A local id (slug) or a server id; the live client maps slugs.
    var gameID: String
    var kind: GameEventKind
    var value: Double
    var at: Date

    init(gameID: String, kind: GameEventKind, value: Double = 0, at: Date = Date()) {
        self.gameID = gameID
        self.kind = kind
        self.value = value
        self.at = at
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

// MARK: - Mock-only features (no server endpoints yet)

/// A challenge to friends: "beat my 34". Mock only until the backend has the endpoint.
struct ChallengeRequest: Codable, Hashable, Sendable {
    var gameID: String
    var toUserIDs: [String]
    var score: Double?
    var seed: Int?
    var message: String?
}

struct Challenge: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var gameID: String
    var fromUserID: String
    var toUserIDs: [String]
    var score: Double?
    var seed: Int?
    var message: String?
    var createdAt: Date
}

/// What a Group has in common and a few games for it (Kevin's Group Blend). Mock only for now.
struct GroupBlendSummary: Codable, Hashable, Sendable {
    var groupID: String
    var headline: String
    var sharedTraits: [String]
    var suggestedGameIDs: [String]
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
