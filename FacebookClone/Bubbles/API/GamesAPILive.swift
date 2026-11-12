import Foundation
import Security

// The live client for Max's Go API (backend/README.md on `backend-api`, commit 17e4ce7).
//
// Auth: `Authorization: Bearer <accessToken>`; access tokens last 15 minutes and refresh tokens
// rotate on every use (`POST /v1/auth/refresh` consumes the old one). Tokens live in the Keychain
// (this-device-only, available after first unlock) and are never logged. Refreshes are serialized
// so two requests never spend the same refresh token.
//
// Reads (feed, game, leaderboard, events) work signed out; saves, scores and publishing need an
// account. Set `autoSignIn` to create and use a device account on the first call that needs one.

actor GamesAPILive: GamesAPI, GamesAuth {
    static let shared = GamesAPILive(baseURL: GamesAPIConfig.baseURL)

    let baseURL: URL
    /// When true, calls that need an account sign in as a device account first (see `signInAsDevice`).
    var autoSignIn: Bool
    let ids = GameIDMap()
    private let session: URLSession
    private let keychain = GamesKeychain()
    private var tokens: AuthTokens?
    private var refreshing: Task<AuthTokens, Error>?
    private let decoder = GamesAPICoding.decoder()
    private static let timeout: TimeInterval = 8
    private static let uploadTimeout: TimeInterval = 60

    init(baseURL: URL, autoSignIn: Bool = false, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.autoSignIn = autoSignIn
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = Self.timeout
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
        if let data = keychain.read("tokens"), let saved = try? GamesAPICoding.decoder().decode(AuthTokens.self, from: data) {
            tokens = saved
        }
    }

    // MARK: GamesAPI

    func feed(cursor: String?) async throws -> RemoteGamePage {
        var query = [URLQueryItem(name: "limit", value: "20")]
        if let cursor, !cursor.isEmpty { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await get("v1/feed", query: query, auth: .optional)
    }

    func game(id: String) async throws -> RemoteGame {
        try await get("v1/games/\(try serverID(id))", auth: .optional)
    }

    func publish(_ package: GamePackage) async throws -> RemoteGame {
        let data = try await send("POST", "v1/creations", body: package.zipData(), contentType: "application/zip",
                                  auth: .required, timeout: Self.uploadTimeout)
        let game: RemoteGame = try decode(data)
        if let local = package.localID { ids.link(localID: local, serverID: game.id) }
        return game
    }

    func scores(gameID: String, scope: BubbleBoardScope) async throws -> [RemoteScore] {
        let board: RemoteScoreboard = try await get("v1/games/\(try serverID(gameID))/leaderboard", auth: .none)
        return board.items
    }

    func submitScore(_ score: Double, gameID: String) async throws -> [RemoteScore] {
        let body = try JSONSerialization.data(withJSONObject: ["score": score])
        let data = try await send("POST", "v1/games/\(try serverID(gameID))/scores", body: body,
                                  contentType: "application/json", auth: .required)
        return (try decode(data) as RemoteScoreboard).items
    }

    func setSaved(_ saved: Bool, gameID: String) async throws -> SaveState {
        let data = try await send(saved ? "PUT" : "DELETE", "v1/games/\(try serverID(gameID))/like", auth: .required)
        return try decode(data)
    }

    func sendEvents(_ events: [GameEvent]) async throws {
        let wire: [[String: Any]] = events.compactMap { e in
            guard e.kind.isAcceptedByServer, let id = try? serverID(e.gameID) else { return nil }
            var item: [String: Any] = ["gameId": id, "type": e.kind.rawValue, "at": Int64(e.at.timeIntervalSince1970 * 1000)]
            if e.value != 0 { item["value"] = e.value }
            return item
        }
        for start in stride(from: 0, to: wire.count, by: 100) {
            let chunk = Array(wire[start..<min(start + 100, wire.count)])
            let body = try JSONSerialization.data(withJSONObject: ["deviceId": ids.deviceID, "events": chunk])
            _ = try await send("POST", "v1/feed/events", body: body, contentType: "application/json", auth: .optional)
        }
    }

    func sendChallenge(_ challenge: ChallengeRequest) async throws -> Challenge {
        throw GamesAPIError.notSupported("Challenges")
    }

    func challenges() async throws -> [Challenge] {
        throw GamesAPIError.notSupported("Challenges")
    }

    func blend(groupID: String) async throws -> GroupBlend {
        throw GamesAPIError.notSupported("Group Blend")
    }

    // MARK: GamesAuth

    var isSignedIn: Bool { tokens != nil }

    func register(email: String, username: String, displayName: String, password: String) async throws -> RemoteUser {
        let body = try JSONSerialization.data(withJSONObject: [
            "email": email, "username": username, "displayName": displayName, "password": password,
        ])
        let data = try await send("POST", "v1/auth/register", body: body, contentType: "application/json", auth: .none)
        return try adopt(try decode(data))
    }

    func login(email: String, password: String) async throws -> RemoteUser {
        let body = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let data = try await send("POST", "v1/auth/login", body: body, contentType: "application/json", auth: .none)
        return try adopt(try decode(data))
    }

    func signInAsDevice() async throws -> RemoteUser {
        if let raw = keychain.read("device"), let creds = try? JSONDecoder().decode([String: String].self, from: raw),
           let email = creds["email"], let password = creds["password"] {
            return try await login(email: email, password: password)
        }
        let tag = Self.randomHex(10)
        let creds = ["email": "\(tag)@device.invalid", "password": Self.randomHex(16), "username": "d\(tag)"]
        let user = try await register(email: creds["email"]!, username: creds["username"]!,
                                      displayName: "Player", password: creds["password"]!)
        if let raw = try? JSONEncoder().encode(creds) { keychain.write("device", raw) }
        return user
    }

    func signOut() async {
        if let refresh = tokens?.refreshToken, let body = try? JSONSerialization.data(withJSONObject: ["refreshToken": refresh]) {
            _ = try? await send("POST", "v1/auth/logout", body: body, contentType: "application/json", auth: .none)
        }
        clearTokens()
    }

    // MARK: Requests

    private enum Auth { case none, optional, required }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], auth: Auth) async throws -> T {
        try decode(try await send("GET", path, query: query, auth: auth))
    }

    private func send(
        _ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
        contentType: String? = nil, auth: Auth, timeout: TimeInterval = GamesAPILive.timeout
    ) async throws -> Data {
        var token: String?
        if auth != .none {
            token = try await accessToken(required: auth == .required)
        }
        var (data, status) = try await perform(method, path, query, body, contentType, token, timeout)
        if status == 401, token != nil, auth != .none {
            // The access token may have just expired: refresh once and retry.
            if let fresh = try? await refreshTokens() {
                (data, status) = try await perform(method, path, query, body, contentType, fresh.accessToken, timeout)
            } else {
                clearTokens()
            }
        }
        guard (200..<300).contains(status) else { throw Self.error(status, data) }
        return data
    }

    private func perform(
        _ method: String, _ path: String, _ query: [URLQueryItem], _ body: Data?,
        _ contentType: String?, _ token: String?, _ timeout: TimeInterval
    ) async throws -> (Data, Int) {
        guard var parts = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw GamesAPIError.network("bad URL")
        }
        if !query.isEmpty { parts.queryItems = query }
        guard let url = parts.url else { throw GamesAPIError.network("bad URL") }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw GamesAPIError.network((error as? URLError)?.localizedDescription ?? error.localizedDescription)
        }
    }

    private static func error(_ status: Int, _ data: Data) -> GamesAPIError {
        let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        switch status {
        case 401: return .signInRequired
        case 404: return .notFound
        default: return .server(status: status, message: message ?? "Server error (\(status))")
        }
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try decoder.decode(T.self, from: data) }
        catch { throw GamesAPIError.decoding(String(describing: error).prefix(200).description) }
    }

    // MARK: Tokens

    /// A usable access token, refreshing when it has under a minute left. Nil is fine for optional auth.
    private func accessToken(required: Bool) async throws -> String? {
        if tokens == nil, autoSignIn, required { _ = try await signInAsDevice() }
        guard let current = tokens else {
            if required { throw GamesAPIError.signInRequired }
            return nil
        }
        if current.expiresAt.timeIntervalSinceNow > 60 { return current.accessToken }
        if let fresh = try? await refreshTokens() { return fresh.accessToken }
        clearTokens()
        if required { throw GamesAPIError.signInRequired }
        return nil
    }

    private func refreshTokens() async throws -> AuthTokens {
        if let refreshing { return try await refreshing.value }
        guard let refresh = tokens?.refreshToken else { throw GamesAPIError.signInRequired }
        let task = Task<AuthTokens, Error> {
            let body = try JSONSerialization.data(withJSONObject: ["refreshToken": refresh])
            let data = try await self.send("POST", "v1/auth/refresh", body: body, contentType: "application/json", auth: .none)
            return try self.decode(data) as AuthTokens
        }
        refreshing = task
        defer { refreshing = nil }
        let fresh = try await task.value
        store(fresh)
        return fresh
    }

    private func adopt(_ new: AuthTokens) throws -> RemoteUser {
        store(new)
        guard let user = new.user else { throw GamesAPIError.decoding("missing user") }
        return user
    }

    private func store(_ new: AuthTokens) {
        tokens = new
        if let data = try? JSONEncoder().encode(new) { keychain.write("tokens", data) }
    }

    private func clearTokens() {
        tokens = nil
        keychain.delete("tokens")
    }

    nonisolated private static func randomHex(_ bytes: Int) -> String {
        (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    private func serverID(_ id: String) throws -> String {
        guard let server = ids.serverID(for: id) else { throw GamesAPIError.unknownGame(id) }
        return server
    }
}

// MARK: - Id map

/// The app's slugs <-> the server's 24-hex ids, persisted in UserDefaults (ids are not secret).
/// A string that already looks like a server id passes through unchanged.
final class GameIDMap: @unchecked Sendable {
    private let defaults: UserDefaults
    private let lock = NSLock()
    private var slugToServer: [String: String]
    private let mapKey = "games.api.idmap"
    private let deviceKey = "games.api.deviceID"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        slugToServer = (defaults.dictionary(forKey: mapKey) as? [String: String]) ?? [:]
    }

    static func isServerID(_ id: String) -> Bool {
        id.count == 24 && id.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    func serverID(for id: String) -> String? {
        if Self.isServerID(id) { return id }
        return lock.withLock { slugToServer[id] }
    }

    func localID(for serverID: String) -> String? {
        lock.withLock { slugToServer.first { $0.value == serverID }?.key }
    }

    func link(localID: String, serverID: String) {
        lock.withLock {
            slugToServer[localID] = serverID
            defaults.set(slugToServer, forKey: mapKey)
        }
    }

    /// A random per-install id sent with events while signed out (the server needs at most 64 chars).
    var deviceID: String {
        lock.withLock {
            if let existing = defaults.string(forKey: deviceKey) { return existing }
            let made = UUID().uuidString
            defaults.set(made, forKey: deviceKey)
            return made
        }
    }
}

// MARK: - Keychain

/// Generic-password items for this API only. Values are never logged.
struct GamesKeychain: Sendable {
    private let service = "games-api"

    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    func write(_ account: String, _ data: Data) {
        delete(account)
        var q = query(account)
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
