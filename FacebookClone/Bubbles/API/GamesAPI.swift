import Foundation

// The games backend client (Max's Go API; contract in backend/README.md). Every game, person,
// friend, Group, score and feed page in the games feature comes from here; the app keeps no game
// data of its own and does no ranking or generating.
//
//     let api = GamesAPIFactory.current                              // always the live client
//     let page = try await api.feed(limit: 10, sessionID: id, exclude: [])   // ranked by the server
//     let game = try await api.game(id: slugOrServerID)                // a slug or a 24-hex server id
//     let board = try await api.scores(gameID: game.id)                // one global board per game
//     _ = try await api.setSaved(true, gameID: game.id)                // PUT /like; needs an account
//     let saved = try await api.savedGames()                           // GET /v1/me/likes
//     let who = try await api.saves(gameID: game.id)                   // {count, friends}
//     try await api.sendFeedEvents([...])                              // what happened on each page
//
// `GamesAPILive` also adopts `GamesAuth`. The app signs in once at launch (`GamesAccount`).
// Errors are `GamesAPIError`.

protocol GamesAPI: Sendable {
    /// The next feed page, chosen by the server's recommender (`GET /v1/feed`).
    func feed(limit: Int, sessionID: String?, exclude: [String]) async throws -> [RemoteFeedItem]
    /// `GET /v1/search?q=&tag=&cursor=&limit=`.
    func search(query: String, tag: String?, cursor: String?) async throws -> RemoteGamePage
    func game(id: String) async throws -> RemoteGame
    /// Uploads a package; returns the server's game (its `id` is the server id).
    func publish(_ package: GamePackage) async throws -> RemoteGame
    /// The game's one global board, best first (`GET /v1/games/{id}/leaderboard`).
    func scores(gameID: String) async throws -> [RemoteScore]
    /// A board limited to my friends (and me) or a Group's members: `?scope=friends|group&groupId=`.
    /// Friends needs sign-in; group needs membership.
    func scores(gameID: String, scope: String, groupID: String?) async throws -> [RemoteScore]
    /// The server keeps the signed-in person's best. Returns the board.
    func submitScore(_ score: Int, gameID: String) async throws -> [RemoteScore]
    /// A save is a like on the server.
    func setSaved(_ saved: Bool, gameID: String) async throws -> SaveState
    /// The games I saved, newest first (`GET /v1/me/likes`); needs an account.
    func savedGames() async throws -> [RemoteGame]
    /// How many people saved a game, and which of my friends did (`GET /v1/games/{id}/likes`).
    /// Signed out, `friends` is empty.
    func saves(gameID: String) async throws -> RemoteGameSaves
    /// Feed page events and off-feed moments (`POST /v1/feed/events`), in batches of 100.
    func sendFeedEvents(_ events: [FeedEvent]) async throws

    // People, friends and Groups
    func user(id: String) async throws -> RemoteProfile
    func friends() async throws -> [RemoteProfile]
    func setFriend(_ isFriend: Bool, userID: String) async throws
    func groups(kind: String?, mine: Bool) async throws -> [RemoteGroup]
    func group(id: String) async throws -> RemoteGroupDetail
    func setMember(_ isMember: Bool, groupID: String) async throws
    /// `PUT /v1/groups/{id}/members/me`, by the Group's join policy: an open Group joins you, a
    /// request Group records your ask (202), an invite Group refuses (403 `invite_only`).
    func joinGroup(id: String) async throws -> GroupJoinOutcome
    /// `PUT /v1/groups/{id}/members/{userId}`: a member adds someone, or the owner of a request
    /// Group approves an ask.
    func addGroupMember(groupID: String, userID: String) async throws
    /// `GET /v1/groups/{id}/requests` (the owner only): the people asking to join, oldest first.
    func groupJoinRequests(groupID: String) async throws -> [RemoteProfile]
    /// `PATCH /v1/groups/{id}` (the owner only): changes only the fields that are set.
    func updateGroup(id: String, _ change: GroupSettingsChange) async throws -> RemoteGroup
    /// `PATCH /v1/me/profile`: changes only the fields that are set; returns me.
    func updateMyProfile(_ change: ProfileChange) async throws -> RemoteUser
    func groupGames(id: String) async throws -> [RemoteGame]
    /// Group Blend from the server's data about the members (`POST /v1/groups/{id}/blend`).
    func blend(groupID: String, count: Int) async throws -> RemoteBlend
    /// My own games (`GET /v1/creations`).
    func creations() async throws -> [RemoteGame]

    // Game anatomy (docs/BUBBLES.md 7.13): the server asks Muse; one short call each (about 5 to
    // 10 s), answered in the reply as a `game-anatomy/0.1` object. Decode it with
    // `GameAnatomy.decode`. 503: Muse isn't set up; 502: Muse's reply wasn't an anatomy.
    /// `POST /v1/anatomy {request, audience?}`: Muse takes an idea apart into its working parts.
    func anatomy(request: String, audience: String?) async throws -> JSONValue
    /// `POST /v1/anatomy/revise {anatomy, change, request?, afterPlaying?}`: the anatomy with the
    /// change (and any answers in it) folded in, plus `changed` and `reply`.
    func reviseAnatomy(_ anatomy: JSONValue, change: String, request: String?, afterPlaying: Bool) async throws -> JSONValue
}

/// Accounts.
protocol GamesAuth: Sendable {
    func register(email: String, username: String, displayName: String, password: String) async throws -> RemoteUser
    func login(email: String, password: String) async throws -> RemoteUser
    /// Creates (once) and signs in a device account whose password lives in the Keychain.
    func signInAsDevice() async throws -> RemoteUser
    /// `GET /v1/auth/me`: the signed-in account.
    func me() async throws -> RemoteUser
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
        case .notFound: return "That was not found on the server."
        case .unknownGame(let id): return "No server game is linked to \(id)."
        case .server(_, let message): return message
        case .network(let message): return "Could not reach the server: \(message)"
        case .decoding(let message): return "Unexpected server reply: \(message)"
        }
    }
}

enum GamesAPIConfig {
    static let defaultBaseURL = URL(string: "https://api.ol4ol.com")!

    /// `FB_API_URL` (DEBUG launch variable) overrides the base URL.
    static var baseURL: URL {
        DebugLaunch.value("FB_API_URL").flatMap(URL.init(string:)) ?? defaultBaseURL
    }
}

enum GamesAPIFactory {
    /// The one client: the live server. Created once and shared.
    static var current: GamesAPILive { GamesAPILive.shared }
}

// MARK: - Mapping to app types

extension RemoteGame {
    /// The in-app formula, when the server's `formula` names one.
    var appFormula: BubbleFormula? { BubbleFormula(rawValue: formula) }
}
