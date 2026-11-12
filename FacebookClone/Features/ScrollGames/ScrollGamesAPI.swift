import Foundation

/// Where the Scroll Games server lives and who we are talking as.
enum SGConfig {
    static let defaultBaseURL = "http://localhost:8787"
    static let userID = "u_me"

    static var baseURL: URL {
        let stored = UserDefaults.standard.string(forKey: SettingsKey.scrollGamesBaseURL) ?? ""
        var text = stored.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        return URL(string: text.isEmpty ? defaultBaseURL : text) ?? URL(string: defaultBaseURL)!
    }

    /// `<base>/player/index.html?game=<id>&seed=<seed>&challenge=<id?>&embed=ios`
    static func playerURL(gameID: String, seed: Int, challengeID: String?) -> URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("player/index.html"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "game", value: gameID),
            URLQueryItem(name: "seed", value: String(seed)),
        ]
        if let challengeID { items.append(URLQueryItem(name: "challenge", value: challengeID)) }
        items.append(URLQueryItem(name: "embed", value: "ios"))
        components.queryItems = items
        return components.url!
    }

    /// The warm-up page: the player shell without a game, so its assets get cached.
    static var playerShellURL: URL { baseURL.appendingPathComponent("player/index.html") }

    static func randomSeed() -> Int { Int.random(in: 1...Int(Int32.max)) }
}

enum SGError: LocalizedError {
    case status(Int, String)
    case message(String)
    case unreachable

    var errorDescription: String? {
        switch self {
        case .status(let code, let body): return body.isEmpty ? "Server returned \(code)" : "Server returned \(code): \(body)"
        case .message(let text): return text
        case .unreachable: return "Can't reach the Scroll Games server"
        }
    }
}

/// All traffic to the Go server. Request bodies are `JSONValue`s so snake_case keys go out exactly as written.
actor ScrollGamesAPI {
    static let shared = ScrollGamesAPI()

    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()
    private let decoder = JSONDecoder()

    // MARK: Reads

    func health() async throws -> Bool {
        let value: JSONValue = try await send("GET", "/api/health")
        return value["ok"]?.stringValue != "false"
    }

    func me() async throws -> SGUser { try await send("GET", "/api/me") }

    func users() async throws -> [SGUser] { try await send("GET", "/api/users") }

    func media(groupID: String? = nil) async throws -> [SGMedia] {
        let query = groupID.map { [URLQueryItem(name: "group", value: $0)] } ?? []
        return try await send("GET", "/api/media", query: query)
    }

    func groups() async throws -> [SGGroup] { try await send("GET", "/api/groups") }

    func feed() async throws -> [SGFeedItem] { try await send("GET", "/api/feed") }

    func game(id: String) async throws -> SGGame {
        let envelope: GameEnvelope = try await send("GET", "/api/games/\(id)")
        guard let game = envelope.game else { throw SGError.message("Game not found") }
        return game
    }

    // MARK: Create

    func brief(prompt: String, mediaIDs: [String], level: String, optIn: Bool) async throws -> SGBriefResponse {
        let body: JSONValue = .object([
            "prompt": .string(prompt),
            "media_ids": .array(mediaIDs.map { .string($0) }),
            "level": .string(level),
            "opt_in_personal_media": .bool(optIn),
        ])
        return try await send("POST", "/api/briefs", body: body, timeout: 30)
    }

    /// Streams generation progress. Finishes after `.done` or `.failed`.
    nonisolated func generate(prompt: String, brief: JSONValue, mediaIDs: [String]) -> AsyncThrowingStream<SGGenEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let body: JSONValue = .object([
                        "prompt": .string(prompt),
                        "brief": brief,
                        "media_ids": .array(mediaIDs.map { .string($0) }),
                    ])
                    var request = Self.makeRequest("POST", "/api/games/generate", query: [], timeout: 120)
                    request.httpBody = try JSONEncoder().encode(body)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        throw SGError.status(http.statusCode, "")
                    }
                    var eventName = "message"
                    for try await line in bytes.lines {
                        if line.hasPrefix("event:") {
                            eventName = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                            let event = Self.parseEvent(name: eventName, data: payload)
                            eventName = "message"
                            if let event {
                                continuation.yield(event)
                                switch event {
                                case .done, .failed:
                                    continuation.finish()
                                    return
                                case .stage:
                                    break
                                }
                            }
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.mapped(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func publish(gameID: String) async throws -> (game: SGGame?, feedItem: SGFeedItem?) {
        let value: JSONValue = try await send("POST", "/api/games/\(gameID)/publish", body: .object([:]))
        let game = try value["game"].map { try reencode($0, as: SGGame.self) }
        let item = try value["feed_item"].map { try reencode($0, as: SGFeedItem.self) }
        return (game, item)
    }

    // MARK: Play

    func submitPlay(gameID: String, result: SGPlayResult, challengeID: String?) async throws -> SGPlayResponse {
        var fields: [String: JSONValue] = [
            "seed": .number(Double(result.seed)),
            "inputs": result.inputs,
            "score": .number(Double(result.score)),
            "ticks": .number(Double(result.ticks)),
        ]
        if let challengeID { fields["challenge_id"] = .string(challengeID) }
        return try await send("POST", "/api/games/\(gameID)/plays", body: .object(fields))
    }

    func createChallenge(gameID: String, playID: String) async throws -> SGChallengeResponse {
        let body: JSONValue = .object(["game_id": .string(gameID), "play_id": .string(playID)])
        return try await send("POST", "/api/challenges", body: body)
    }

    // MARK: Plumbing

    private struct GameEnvelope: Decodable {
        var game: SGGame?

        enum CodingKeys: String, CodingKey { case game }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            game = c.flex(SGGame.self, .game)
        }
    }

    private func reencode<T: Decodable>(_ value: JSONValue, as type: T.Type) throws -> T {
        try decoder.decode(type, from: JSONEncoder().encode(value))
    }

    private nonisolated static func makeRequest(_ method: String, _ path: String, query: [URLQueryItem], timeout: TimeInterval) -> URLRequest {
        var components = URLComponents(url: SGConfig.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue(SGConfig.userID, forHTTPHeaderField: "X-User")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func send<T: Decodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], body: JSONValue? = nil, timeout: TimeInterval = 15
    ) async throws -> T {
        var request = Self.makeRequest(method, path, query: query, timeout: timeout)
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        do {
            let (data, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw SGError.status(http.statusCode, String(data: data.prefix(200), encoding: .utf8) ?? "")
            }
            return try decoder.decode(T.self, from: data)
        } catch {
            throw Self.mapped(error)
        }
    }

    private nonisolated static func mapped(_ error: Error) -> Error {
        if let urlError = error as? URLError, urlError.code != .cancelled {
            return SGError.unreachable
        }
        return error
    }

    private nonisolated static func parseEvent(name: String, data: String) -> SGGenEvent? {
        guard let raw = data.data(using: .utf8), let json = try? JSONDecoder().decode(JSONValue.self, from: raw) else {
            return nil
        }
        switch name {
        case "stage":
            return .stage(
                name: json["stage"]?.stringValue ?? "",
                status: json["status"]?.stringValue ?? "",
                ms: json["ms"]?.intValue
            )
        case "done":
            let payload = json["game"] ?? json
            guard let encoded = try? JSONEncoder().encode(payload),
                  let game = try? JSONDecoder().decode(SGGame.self, from: encoded) else {
                return .failed("Server sent a game the app couldn't read")
            }
            return .done(game)
        case "error":
            return .failed(json["message"]?.stringValue ?? "Generation failed")
        default:
            return nil
        }
    }
}
