import Foundation

// The games backend client (Max's Go API; backend/README.md on `backend-api`).
//
// Not wired into BubbleStore or any screen yet: the app still runs on local data.
//
//     let api = GamesAPIFactory.current(store: bubbleStore)      // FB_API=mock (default) or FB_API=live
//     let page = try await api.feed(cursor: nil)            // RemoteGamePage: items + next cursor
//     let more = try await api.feed(cursor: page.next)
//     let game = try await api.game(id: "hill-hopper")      // a slug or a 24-hex server id
//     let board = try await api.scores(gameID: game.id, scope: .everyone)
//     _ = try await api.setSaved(true, gameID: game.id)     // PUT /like; needs a signed-in account
//     try await api.sendEvents([GameEvent(gameID: game.id, kind: .play)])
//
// Live only: `GamesAPILive` also adopts `GamesAuth` (register, login, signInAsDevice, signOut).
// Errors are `GamesAPIError`. Mock: no network, deterministic, read-only use of BubbleStore.

protocol GamesAPI: Sendable {
    /// Newest-first games. Pass `RemoteGamePage.next` to continue; nil starts over.
    func feed(cursor: String?) async throws -> RemoteGamePage
    func game(id: String) async throws -> RemoteGame
    /// Uploads a package; returns the server's game (its `id` is the server id).
    func publish(_ package: GamePackage) async throws -> RemoteGame
    /// The server has one global board per game; `scope` filters only in the mock.
    func scores(gameID: String, scope: BubbleBoardScope) async throws -> [RemoteScore]
    /// Trust-only for now: the server keeps the signed-in user's best. Returns the board.
    func submitScore(_ score: Double, gameID: String) async throws -> [RemoteScore]
    /// A save is a like on the server.
    func setSaved(_ saved: Bool, gameID: String) async throws -> SaveState
    /// Batches of at most 100; kinds the server does not accept are dropped.
    func sendEvents(_ events: [GameEvent]) async throws
    /// Mock only. Live throws `GamesAPIError.notSupported`.
    func sendChallenge(_ challenge: ChallengeRequest) async throws -> Challenge
    /// Mock only. Live throws `GamesAPIError.notSupported`.
    func challenges() async throws -> [Challenge]
    /// Mock only. Live throws `GamesAPIError.notSupported`.
    func blend(groupID: String) async throws -> GroupBlend
}

/// Accounts. The live client implements it; the mock has no accounts.
protocol GamesAuth: Sendable {
    func register(email: String, username: String, displayName: String, password: String) async throws -> RemoteUser
    func login(email: String, password: String) async throws -> RemoteUser
    /// Creates (once) and signs in a device account whose password lives in the Keychain.
    func signInAsDevice() async throws -> RemoteUser
    func signOut() async
    var isSignedIn: Bool { get async }
}

enum GamesAPIError: LocalizedError, Equatable {
    case notSupported(String)
    case signInRequired
    case notFound
    case unknownGame(String)
    case server(status: Int, message: String)
    case network(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .notSupported(let what): return "\(what) is not available on the server yet."
        case .signInRequired: return "Sign in to do that."
        case .notFound: return "That game was not found."
        case .unknownGame(let id): return "No server game is linked to \(id)."
        case .server(_, let message): return message
        case .network(let message): return "Could not reach the server: \(message)"
        case .decoding(let message): return "Unexpected server reply: \(message)"
        }
    }
}

enum GamesAPIMode: String {
    case mock, live
}

enum GamesAPIConfig {
    static let defaultBaseURL = URL(string: "https://api.ol4ol.com")!

    /// `FB_API=mock|live` (DEBUG launch variable); anything else, and release builds, use the mock.
    static var mode: GamesAPIMode {
        DebugLaunch.value("FB_API").flatMap { GamesAPIMode(rawValue: $0.lowercased()) } ?? .mock
    }

    /// `FB_API_URL` overrides the live base URL.
    static var baseURL: URL {
        DebugLaunch.value("FB_API_URL").flatMap(URL.init(string:)) ?? defaultBaseURL
    }
}

enum GamesAPIFactory {
    /// The client for the current launch mode. Live clients are created once and shared.
    static func current(store: BubbleStore) -> any GamesAPI {
        switch GamesAPIConfig.mode {
        case .mock: return GamesAPIMock(store: store)
        case .live: return GamesAPILive.shared
        }
    }
}

// MARK: - Mapping to app types

extension RemoteScore {
    /// A board row for an app user, e.g. `score.asBoardEntry(user: user)`.
    func asBoardEntry(user: User) -> BubbleScore {
        BubbleScore(id: "\(userID)-\(Int(updatedAt.timeIntervalSince1970))", user: user, score: points, achievedAt: updatedAt)
    }
}

extension RemoteGame {
    /// The in-app formula, when the server's `formula` names one.
    var appFormula: BubbleFormula? { BubbleFormula(rawValue: formula) }
}
