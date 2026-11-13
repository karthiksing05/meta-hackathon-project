import Foundation

// The wider Facebook surfaces on the server: feed posts, reels, stories and Messenger (`/v1/fb/*`,
// backend/README.md "Facebook surfaces"). `AppStore+Live.swift` loads them into the store and falls
// back to the built-in mock world when the server can't be reached.
//
// `FB_API=mock` (DEBUG launch variable) keeps these surfaces on the mock world; `FB_API=live` or
// nothing uses the server. `FB_API_URL` points the client somewhere else, as for games.

enum FacebookDataMode: String {
    case live
    case mock

    static var current: FacebookDataMode {
        if ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1" { return .mock }
        return DebugLaunch.value("FB_API").flatMap(FacebookDataMode.init(rawValue:)) ?? .live
    }
}

// MARK: - Wire types

struct RemoteFBPerson: Decodable, Hashable, Sendable {
    var id: String
    var firstName: String
    var lastName: String?
    var kind: String
    var category: String?
    var avatarUrl: String?
    var coverUrl: String?
    var bio: String?
    var city: String?
    var work: String?
    var verified: Bool?
    var isMe: Bool?
    var isAccount: Bool?
}

struct RemoteFBMedia: Codable, Hashable, Sendable {
    var kind: String
    var url: String?
    var videoUrl: String?
    var aspect: Double?
    var duration: Double?
}

struct RemoteFBPollOption: Decodable, Hashable, Sendable {
    var id: String
    var title: String
    var votes: Int
}

struct RemoteFBComment: Decodable, Hashable, Sendable {
    var id: String
    var author: RemoteFBPerson
    var text: String
    var createdAt: Date
}

struct RemoteFBPost: Decodable, Hashable, Sendable {
    var id: String
    var kind: String
    var author: RemoteFBPerson
    var groupId: String?
    var text: String
    var background: Int?
    var media: [RemoteFBMedia]?
    var poll: [RemoteFBPollOption]?
    var feeling: String?
    var location: String?
    var lifeEvent: String?
    var audio: String?
    var sponsored: Bool?
    var allowsGames: Bool?
    var reactions: [String: Int]?
    var myReaction: String?
    var comments: [RemoteFBComment]?
    var shares: Int?
    var views: Int?
    var createdAt: Date
}

struct RemoteFBPostPage: Decodable, Sendable {
    var items: [RemoteFBPost]
    var cursor: String?
}

struct RemoteFBStoryItem: Decodable, Hashable, Sendable {
    var id: String
    var media: RemoteFBMedia?
    var text: String?
    var background: Int?
    var caption: String?
    var createdAt: Date
}

struct RemoteFBStoryGroup: Decodable, Sendable {
    var author: RemoteFBPerson
    var items: [RemoteFBStoryItem]
}

struct RemoteFBMessage: Decodable, Hashable, Sendable {
    var id: String
    var threadId: String
    var senderId: String
    var text: String?
    var imageUrl: String?
    var emoji: String?
    var sentAt: Date
}

struct RemoteFBThread: Decodable, Sendable {
    var id: String
    var members: [RemoteFBPerson]
    var name: String?
    var theme: String?
    var emoji: String?
    var lastAt: Date
    var lastText: String?
    var unread: Int
    var messages: [RemoteFBMessage]?
}

struct RemoteFBSent: Decodable, Sendable {
    var message: RemoteFBMessage
    var reply: RemoteFBMessage?
}

private struct Items<T: Decodable>: Decodable { var items: [T] }

// MARK: - Client

/// The `/v1/fb` calls. Uses `GamesAPILive.shared` for the base URL and the account's tokens.
struct FacebookAPILive: Sendable {
    static let shared = FacebookAPILive()

    private var api: GamesAPILive { GamesAPILive.shared }
    private let decoder = GamesAPICoding.decoder()

    private func get<T: Decodable>(_ path: String, _ query: [URLQueryItem] = [], signIn: Bool = false) async throws -> T {
        try decode(try await api.facebookRaw("GET", path, query: query, signIn: signIn))
    }

    private func send<T: Decodable>(_ method: String, _ path: String, _ body: [String: Any]?) async throws -> T {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        return try decode(try await api.facebookRaw(method, path, body: data, signIn: true))
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try decoder.decode(T.self, from: data) }
        catch { throw GamesAPIError.decoding(String(describing: error).prefix(200).description) }
    }

    func posts(cursor: String? = nil, limit: Int = 20) async throws -> RemoteFBPostPage {
        var q = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { q.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await get("v1/fb/posts", q)
    }

    func reels(limit: Int = 30) async throws -> RemoteFBPostPage {
        try await get("v1/fb/reels", [URLQueryItem(name: "limit", value: String(limit))])
    }

    func stories() async throws -> [RemoteFBStoryGroup] {
        (try await get("v1/fb/stories") as Items<RemoteFBStoryGroup>).items
    }

    func threads(messages: Int = 30) async throws -> [RemoteFBThread] {
        (try await get("v1/fb/threads", [URLQueryItem(name: "messages", value: String(messages))], signIn: true) as Items<RemoteFBThread>).items
    }

    func createPost(text: String, groupID: String?, background: Int?, feeling: String?, location: String?) async throws -> RemoteFBPost {
        var body: [String: Any] = ["text": text]
        if let groupID { body["groupId"] = groupID }
        if let background { body["background"] = background }
        if let feeling { body["feeling"] = feeling }
        if let location { body["location"] = location }
        return try await send("POST", "v1/fb/posts", body)
    }

    func setReaction(_ type: String?, postID: String) async throws {
        if let type {
            let _: RemoteFBPost = try await send("PUT", "v1/fb/posts/\(postID)/reaction", ["type": type])
        } else {
            let _: RemoteFBPost = try await send("DELETE", "v1/fb/posts/\(postID)/reaction", nil)
        }
    }

    func comment(_ text: String, postID: String) async throws -> RemoteFBComment {
        try await send("POST", "v1/fb/posts/\(postID)/comments", ["text": text])
    }

    func createTextStory(_ text: String, background: Int, caption: String?) async throws -> RemoteFBStoryItem {
        var body: [String: Any] = ["text": text, "background": background]
        if let caption { body["caption"] = caption }
        return try await send("POST", "v1/fb/stories", body)
    }

    func createThread(memberIDs: [String], name: String?) async throws -> RemoteFBThread {
        var body: [String: Any] = ["memberIds": memberIDs]
        if let name { body["name"] = name }
        return try await send("POST", "v1/fb/threads", body)
    }

    func sendMessage(threadID: String, text: String?, emoji: String?) async throws -> RemoteFBSent {
        var body: [String: Any] = [:]
        if let text { body["text"] = text }
        if let emoji { body["emoji"] = emoji }
        return try await send("POST", "v1/fb/threads/\(threadID)/messages", body)
    }

    func markRead(threadID: String) async throws {
        _ = try await api.facebookRaw("PUT", "v1/fb/threads/\(threadID)/read", signIn: true)
    }
}
