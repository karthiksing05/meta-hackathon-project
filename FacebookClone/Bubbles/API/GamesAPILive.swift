import Foundation
import Security

// The live client for Max's Go API (backend/README.md).
//
// Auth: `Authorization: Bearer <accessToken>`; access tokens last 15 minutes and refresh tokens
// rotate on every use (`POST /v1/auth/refresh` consumes the old one). Tokens live in the Keychain
// (this-device-only, available after first unlock) and are never logged. Refreshes are serialized
// so two requests never spend the same refresh token.
//
// Reads (feed, game, leaderboard, events) work signed out; saves, scores, friends and publishing
// need an account. The shared client signs in as a device account on the first call that needs one
// (`autoSignIn`); `GamesAccount` also signs in once at launch.

actor GamesAPILive: GamesAPI, GamesAuth {
    static let shared = GamesAPILive(baseURL: GamesAPIConfig.baseURL, autoSignIn: true)

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
    /// The server gives Muse 70 s for an anatomy turn.
    private static let anatomyTimeout: TimeInterval = 75

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

    func feed(limit: Int, sessionID: String?, exclude: [String]) async throws -> [RemoteFeedItem] {
        var query = [URLQueryItem(name: "limit", value: String(max(1, min(limit, 30))))]
        if let sessionID, !sessionID.isEmpty { query.append(URLQueryItem(name: "sessionID", value: sessionID)) }
        let skip = exclude.compactMap { ids.serverID(for: $0) }.prefix(200)
        if !skip.isEmpty { query.append(URLQueryItem(name: "exclude", value: skip.joined(separator: ","))) }
        let page: RemoteFeedPage = try await get("v1/feed", query: query, auth: .optional)
        page.items.forEach(link)
        return page.items
    }

    func search(query text: String, tag: String?, cursor: String?) async throws -> RemoteGamePage {
        var query = [URLQueryItem(name: "q", value: text), URLQueryItem(name: "limit", value: "20")]
        if let tag, !tag.isEmpty { query.append(URLQueryItem(name: "tag", value: tag)) }
        if let cursor, !cursor.isEmpty { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        let page: RemoteGamePage = try await get("v1/search", query: query, auth: .optional)
        page.items.forEach(link)
        return page
    }

    func game(id: String) async throws -> RemoteGame {
        // A slug the app hasn't linked yet goes to the server as is ({id} may be a slug).
        let game: RemoteGame = try await get("v1/games/\(ids.serverID(for: id) ?? id)", auth: .optional)
        link(game)
        return game
    }

    func publish(_ package: GamePackage) async throws -> RemoteGame {
        let data = try await send("POST", "v1/creations", body: package.zipData(), contentType: "application/zip",
                                  auth: .required, timeout: Self.uploadTimeout)
        let game: RemoteGame = try decode(data)
        if let local = package.localID { ids.link(localID: local, serverID: game.id) }
        link(game)
        return game
    }

    func scores(gameID: String) async throws -> [RemoteScore] {
        let board: RemoteScoreboard = try await get("v1/games/\(try serverID(gameID))/leaderboard", auth: .none)
        return board.items
    }

    func scores(gameID: String, scope: String, groupID: String?) async throws -> [RemoteScore] {
        var query = [URLQueryItem(name: "scope", value: scope)]
        if let groupID { query.append(URLQueryItem(name: "groupId", value: groupID)) }
        let board: RemoteScoreboard = try await get("v1/games/\(try serverID(gameID))/leaderboard", query: query,
                                                    auth: scope == "everyone" ? .none : .required)
        return board.items
    }

    func submitScore(_ score: Int, gameID: String) async throws -> [RemoteScore] {
        try await submitScore(score, log: nil, gameID: gameID)
    }

    /// `POST /v1/games/{id}/scores {score, log?}`. A game with a score model (harness v2) only takes a
    /// replayed run: the server replays `log` (the engine's `microgame-log/1`) and ignores `score`; a
    /// plain `{score}` is refused (400). Older games keep using `score` and ignore `log`.
    func submitScore(_ score: Int, log: String?, gameID: String) async throws -> [RemoteScore] {
        var payload: [String: Any] = ["score": score]
        if let log, !log.isEmpty { payload["log"] = log }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await send("POST", "v1/games/\(try serverID(gameID))/scores", body: body,
                                  contentType: "application/json", auth: .required)
        return (try decode(data) as RemoteScoreboard).items
    }

    func setSaved(_ saved: Bool, gameID: String) async throws -> SaveState {
        let data = try await send(saved ? "PUT" : "DELETE", "v1/games/\(try serverID(gameID))/like", auth: .required)
        return try decode(data)
    }

    func savedGames() async throws -> [RemoteGame] {
        let games = (try await get("v1/me/likes", query: [URLQueryItem(name: "limit", value: "100")], auth: .required) as RemoteList<RemoteGame>).items
        games.forEach(link)
        return games
    }

    func saves(gameID: String) async throws -> RemoteGameSaves {
        try await get("v1/games/\(try serverID(gameID))/likes", auth: .optional)
    }

    func sendFeedEvents(_ events: [FeedEvent]) async throws {
        let wire: [[String: Any]] = events.compactMap { e in
            guard let id = ids.serverID(for: e.gameID) else { return nil }
            return e.wire(serverGameID: id)
        }
        let signedIn = tokens != nil
        for start in stride(from: 0, to: wire.count, by: 100) {
            var payload: [String: Any] = ["events": Array(wire[start..<min(start + 100, wire.count)])]
            if !signedIn { payload["deviceId"] = ids.deviceID }
            let body = try JSONSerialization.data(withJSONObject: payload)
            _ = try await send("POST", "v1/feed/events", body: body, contentType: "application/json", auth: .optional)
        }
    }

    // MARK: People, friends and Groups

    func user(id: String) async throws -> RemoteProfile {
        try await get("v1/users/\(id)", auth: .optional)
    }

    /// The challenges I sent and received, newest first (`GET /v1/challenges`).
    func challenges() async throws -> [RemoteChallenge] {
        let items = (try await get("v1/challenges", auth: .required) as RemoteList<RemoteChallenge>).items
        for item in items { if let game = item.game { link(game) } }
        return items
    }

    /// "Beat my score" to friends (`POST /v1/challenges {gameId, toUserIds}`). The server takes my
    /// best on the game as the score to beat.
    func sendChallenge(gameID: String, toUserIDs: [String]) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["gameId": try serverID(gameID), "toUserIds": toUserIDs])
        _ = try await send("POST", "v1/challenges", body: body, contentType: "application/json", auth: .required)
    }

    /// People whose username or a word of their display name starts with `query`
    /// (`GET /v1/users?q=`, 2 to 40 characters; never includes you or anyone's email).
    func searchUsers(_ query: String, limit: Int = 20) async throws -> [RemoteProfile] {
        let q = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: String(limit))]
        return (try await get("v1/users", query: q, auth: .required) as RemoteList<RemoteProfile>).items
    }

    /// A Group's weekly board (`GET /v1/groups/{id}/leaderboard?week=`, members only). `week` is
    /// `2026-W46`; nil is this week.
    func groupWeeklyBoard(groupID: String, week: String? = nil) async throws -> RemoteGroupWeeklyBoard {
        let q = week.map { [URLQueryItem(name: "week", value: $0)] } ?? []
        return try await get("v1/groups/\(groupID)/leaderboard", query: q, auth: .required)
    }

    /// Starts a best-of-N with a friend (`POST /v1/series {opponentId, games}`, 1 to 5 microgames).
    func startSeries(opponentID: String, gameIDs: [String]) async throws -> RemoteSeries {
        let games = try gameIDs.map { try serverID($0) }
        let body = try JSONSerialization.data(withJSONObject: ["opponentId": opponentID, "games": games])
        let series: RemoteSeries = try decode(try await send("POST", "v1/series", body: body, contentType: "application/json", auth: .required))
        series.rounds.compactMap(\.game).forEach(link)
        return series
    }

    /// My series, newest first (`GET /v1/series`).
    func seriesList() async throws -> [RemoteSeries] {
        let items = (try await get("v1/series", auth: .required) as RemoteList<RemoteSeries>).items
        items.flatMap(\.rounds).compactMap(\.game).forEach(link)
        return items
    }

    /// Submits my run of a round: the engine's input log as text (`POST /v1/series/{id}/rounds/{n} {log}`).
    /// The server replays it and keeps the replayed score.
    func submitSeriesRound(seriesID: String, round: Int, log: String) async throws -> RemoteSeries {
        let body = try JSONSerialization.data(withJSONObject: ["log": log])
        let series: RemoteSeries = try decode(try await send("POST", "v1/series/\(seriesID)/rounds/\(round)", body: body,
                                                            contentType: "application/json", auth: .required, timeout: 30))
        series.rounds.compactMap(\.game).forEach(link)
        return series
    }

    // MARK: Game plan (harness v2)

    /// `POST /v1/harness/plan {request}`: the raw reply, for `HarnessPlanClient`.
    func gamePlanRaw(body: Data) async throws -> Data {
        try await send("POST", "v1/harness/plan", body: body, contentType: "application/json",
                       auth: .required, timeout: HarnessPlanClient.timeout)
    }

    // MARK: Sounds (backend/README.md, "Sounds")

    /// The library: `GET /v1/sounds?tab=trending|for_you|saved|recent&q=&limit=`. `saved` needs sign-in.
    func sounds(tab: String, query: String? = nil, limit: Int = 30) async throws -> [RemoteSound] {
        var q = [URLQueryItem(name: "tab", value: tab), URLQueryItem(name: "limit", value: String(limit))]
        if let query = query?.trimmingCharacters(in: .whitespacesAndNewlines), !query.isEmpty {
            q.append(URLQueryItem(name: "q", value: query))
        }
        return (try await get("v1/sounds", query: q, auth: tab == "saved" ? .required : .optional) as RemoteList<RemoteSound>).items
    }

    func sound(id: String) async throws -> RemoteSound {
        try await get("v1/sounds/\(id)", auth: .optional)
    }

    /// The games using a sound, `top` or `recent` (drafts left out).
    func soundGames(id: String, sort: String) async throws -> RemoteSoundGames {
        let page: RemoteSoundGames = try await get("v1/sounds/\(id)/games", query: [URLQueryItem(name: "sort", value: sort)], auth: .optional)
        page.items.forEach(link)
        return page
    }

    /// `PUT|DELETE /v1/sounds/{id}/save`.
    func setSoundSaved(_ saved: Bool, soundID: String) async throws -> RemoteSoundSaveState {
        try decode(try await send(saved ? "PUT" : "DELETE", "v1/sounds/\(soundID)/save", auth: .required))
    }

    /// Sets or swaps the sound on my game (`PUT /v1/games/{id}/sound`), or takes it off (`nil`).
    func setGameSound(gameID: String, soundID: String?, offsetMs: Int = 0, mix: Double? = nil) async throws {
        let id = try serverID(gameID)
        guard let soundID else {
            _ = try await send("DELETE", "v1/games/\(id)/sound", auth: .required)
            return
        }
        var body: [String: Any] = ["soundId": soundID, "offsetMs": offsetMs]
        if let mix { body["mix"] = mix }
        _ = try await send("PUT", "v1/games/\(id)/sound", body: try JSONSerialization.data(withJSONObject: body),
                           contentType: "application/json", auth: .required)
    }

    func friends() async throws -> [RemoteProfile] {
        (try await get("v1/me/friends", auth: .required) as RemoteList<RemoteProfile>).items
    }

    func setFriend(_ isFriend: Bool, userID: String) async throws {
        _ = try await send(isFriend ? "PUT" : "DELETE", "v1/me/friends/\(userID)", auth: .required)
    }

    func groups(kind: String?, mine: Bool) async throws -> [RemoteGroup] {
        var query: [URLQueryItem] = []
        if let kind { query.append(URLQueryItem(name: "kind", value: kind)) }
        if mine { query.append(URLQueryItem(name: "mine", value: "1")) }
        return (try await get("v1/groups", query: query, auth: .optional) as RemoteList<RemoteGroup>).items
    }

    func group(id: String) async throws -> RemoteGroupDetail {
        try await get("v1/groups/\(id)", auth: .optional)
    }

    func setMember(_ isMember: Bool, groupID: String) async throws {
        _ = try await send(isMember ? "PUT" : "DELETE", "v1/groups/\(groupID)/members/me", auth: .required)
    }

    func groupGames(id: String) async throws -> [RemoteGame] {
        let games = (try await get("v1/groups/\(id)/games", auth: .optional) as RemoteList<RemoteGame>).items
        games.forEach(link)
        return games
    }

    func blend(groupID: String, count: Int) async throws -> RemoteBlend {
        let body = try JSONSerialization.data(withJSONObject: ["count": count])
        let data = try await send("POST", "v1/groups/\(groupID)/blend", body: body, contentType: "application/json", auth: .required)
        let blend: RemoteBlend = try decode(data)
        blend.picks.compactMap(\.game).forEach(link)
        return blend
    }

    func creations() async throws -> [RemoteGame] {
        let games = (try await get("v1/creations", auth: .required) as RemoteList<RemoteGame>).items
        games.forEach(link)
        return games
    }

    // MARK: Game anatomy

    func anatomy(request: String, audience: String?) async throws -> JSONValue {
        var body: [String: JSONValue] = ["request": .string(request)]
        if let audience = audience?.trimmingCharacters(in: .whitespacesAndNewlines), !audience.isEmpty {
            body["audience"] = .string(audience)
        }
        return try await anatomyCall("v1/anatomy", body)
    }

    func reviseAnatomy(_ anatomy: JSONValue, change: String, request: String?, afterPlaying: Bool) async throws -> JSONValue {
        var body: [String: JSONValue] = ["anatomy": anatomy, "change": .string(change), "afterPlaying": .bool(afterPlaying)]
        if let request, !request.isEmpty { body["request"] = .string(request) }
        return try await anatomyCall("v1/anatomy/revise", body)
    }

    private func anatomyCall(_ path: String, _ body: [String: JSONValue]) async throws -> JSONValue {
        let data = try await send("POST", path, body: try GamesAPICoding.encoder().encode(JSONValue.object(body)),
                                  contentType: "application/json", auth: .required, timeout: Self.anatomyTimeout)
        return try decode(data)
    }

    /// Remembers a game's slug so later calls by slug go to its server id.
    private func link(_ game: RemoteGame) {
        if let slug = game.slug { ids.link(localID: slug, serverID: game.id) }
    }

    private func link(_ item: RemoteFeedItem) { link(item.game) }

    // MARK: GamesAuth

    var isSignedIn: Bool { tokens != nil }

    /// This phone already made its own (guest) account on an earlier launch.
    var hasDeviceAccount: Bool { keychain.read("device") != nil }

    /// Off while signed out, so a call that needs an account fails instead of quietly creating a
    /// guest account behind the sign-in screen.
    func setAutoSignIn(_ on: Bool) { autoSignIn = on }

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

    func me() async throws -> RemoteUser {
        try await get("v1/auth/me", auth: .required)
    }

    func signOut() async {
        if let refresh = tokens?.refreshToken, let body = try? JSONSerialization.data(withJSONObject: ["refreshToken": refresh]) {
            _ = try? await send("POST", "v1/auth/logout", body: body, contentType: "application/json", auth: .none)
        }
        clearTokens()
    }

    // MARK: Generation (raw calls for `GameGeneratorLive`)

    /// `POST /v1/generate`; needs an account. Returns the reply body.
    func generationStart(body: Data) async throws -> Data {
        try await send("POST", "v1/generate", body: body, contentType: "application/json", auth: .required)
    }

    /// `GET /v1/generate/{id}`, with `?after=<seq>` when given.
    func generationJob(id: String, after: Int?) async throws -> Data {
        let query = after.map { [URLQueryItem(name: "after", value: String($0))] } ?? []
        return try await send("GET", "v1/generate/\(id)", query: query, auth: .required)
    }

    /// `GET /v1/generate`: my jobs.
    func generationJobs() async throws -> Data {
        try await send("GET", "v1/generate", auth: .required)
    }

    /// `DELETE /v1/generate/{id}`. Best effort: 404 and 405 (not there, or not supported yet) and
    /// network errors are ignored.
    func generationCancel(id: String) async {
        _ = try? await send("DELETE", "v1/generate/\(id)", auth: .required)
    }

    /// `POST /v1/creations/{id}/publish`: lists a draft (owner only).
    func creationPublish(id: String) async throws {
        _ = try await send("POST", "v1/creations/\(id)/publish", auth: .required)
    }

    /// `DELETE /v1/creations/{id}`: deletes one of my games with its saves and scores. Best effort.
    func creationDelete(id: String) async {
        _ = try? await send("DELETE", "v1/creations/\(id)", auth: .required)
    }

    /// A file the server points at (a game's `manifestUrl`), as raw bytes. Relative URLs resolve
    /// against the base URL; the token goes only to the API's own host.
    func fetch(_ url: URL) async throws -> Data {
        let absolute = url.scheme == nil ? URL(string: url.relativeString, relativeTo: baseURL)?.absoluteURL ?? url : url
        var request = URLRequest(url: absolute, timeoutInterval: Self.uploadTimeout)
        if absolute.host == baseURL.host, let token = try? await accessToken(required: false) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(status) else { throw Self.error(status, data) }
            return data
        } catch let error as GamesAPIError {
            throw error
        } catch {
            throw GamesAPIError.network((error as? URLError)?.localizedDescription ?? error.localizedDescription)
        }
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

extension GamesAPILive: GamePlanTransport {}
