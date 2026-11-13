import Foundation
import Observation

/// Same-seed rounds in a chat or a Group, from the server (`/v1/rounds`, backend/README.md
/// "Rounds"). Someone sends a game; everyone plays the same run on the server's seed whenever they
/// like; the server replays each run, writes the result line, ranks the players (or, for an
/// opinion game, works out how in sync they are). This keeps only the last lists the server sent.
@MainActor
@Observable
final class RoundsCenter {
    static let shared = RoundsCenter()

    /// Rounds by id, as the server last sent them.
    private(set) var rounds: [String: RemoteRound] = [:]
    /// Round ids by target (`chat:<id>`, `group:<id>`, or "" for every round I'm in), newest first.
    private(set) var lists: [String: [String]] = [:]
    /// Loading or failed, by the same keys.
    private(set) var states: [String: FeedLoadState] = [:]
    /// Rounds whose run is being sent.
    private(set) var submitting: Set<String> = []

    @ObservationIgnored private weak var appStore: AppStore?
    @ObservationIgnored private weak var bubbleStore: BubbleStore?
    @ObservationIgnored private var installed = false

    private init() {}

    func install(appStore: AppStore, bubbleStore: BubbleStore) {
        self.appStore = appStore
        self.bubbleStore = bubbleStore
        guard !installed else { return }
        installed = true
        NotificationCenter.default.addObserver(forName: .gamesAccountChanged, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                RoundsCenter.shared.rounds = [:]
                RoundsCenter.shared.lists = [:]
                RoundsCenter.shared.states = [:]
            }
        }
    }

    var meID: String? { GamesAccount.shared.userID }

    // MARK: Reading

    private func key(_ target: RoundTarget?) -> String { target?.wire ?? "" }

    func list(_ target: RoundTarget?) -> [RemoteRound] {
        (lists[key(target)] ?? []).compactMap { rounds[$0] }
    }

    func state(_ target: RoundTarget?) -> FeedLoadState { states[key(target)] ?? .idle }

    /// Rounds waiting on me (not finished, not played yet).
    var yourTurnCount: Int {
        list(nil).filter { !$0.finished && !$0.hasPlayed(meID) }.count
    }

    /// Fetches the rounds at a target (nil: all of mine). `quiet` keeps the current list on screen.
    func load(_ target: RoundTarget?, quiet: Bool = false) {
        let k = key(target)
        guard states[k] != .loading else { return }
        if !quiet || lists[k] == nil { states[k] = .loading }
        Task { @MainActor in
            guard await GamesAccount.shared.waitForUser() != nil else {
                states[k] = .failed(GamesAPIError.signInRequired.localizedDescription)
                return
            }
            do {
                let items = try await GamesAPIFactory.current.rounds(target: target)
                items.forEach { rounds[$0.id] = $0 }
                lists[k] = items.map(\.id)
                states[k] = .idle
            } catch {
                states[k] = lists[k] == nil || !quiet ? .failed(error.localizedDescription) : .idle
            }
        }
    }

    /// Fetches one round again. Throws the server's message.
    @discardableResult
    func refresh(id: String) async throws -> RemoteRound {
        let round = try await GamesAPIFactory.current.round(id: id)
        store(round)
        return round
    }

    // MARK: Starting

    /// Starts a round on a game at a target (`POST /v1/rounds`). Chat rounds name their members;
    /// a Group round with no members is the whole Group. Throws the server's message.
    @discardableResult
    func start(gameID: String, target: RoundTarget, members: [String] = [], mode: String? = nil) async throws -> RemoteRound {
        let round = try await GamesAPIFactory.current.startRound(gameID: gameID, target: target, members: members, mode: mode)
        store(round, prepend: true)
        BubbleSocialSignals.post(target.kind == .group ? .groupChallenge : .groupChatPlay, bubbleID: gameID,
                                 with: round.members.map(\.id).filter { $0 != meID })
        return round
    }

    // MARK: Playing

    /// Opens the player on the round's seed. The run goes up when it finishes (`didFinish`).
    func play(_ round: RemoteRound, placeName: String?, router: Router) async {
        guard let bubbleStore, let game = round.game else {
            appStore?.showToast(RoundsCopy.gameGone, symbol: "exclamationmark.circle")
            return
        }
        guard let bubble = await bubbleStore.adopt(game) else {
            appStore?.showToast(RoundsCopy.gameDidNotLoad, symbol: "exclamationmark.circle")
            return
        }
        router.play(BubblePlayRequest(
            bubbleID: bubble.id,
            seed: round.seed,
            context: BubblePlayContext(kind: .round, id: round.id, opponentName: placeName)
        ))
    }

    /// After the player records a run started from a round: sends the engine's input log, which the
    /// server replays. Only your first finished run counts; Play again is practice.
    func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest) {
        guard let context = request.context, context.kind == .round, let bubbleStore else { return }
        let roundID = context.id
        if let round = rounds[roundID], round.hasPlayed(meID) { return }
        guard !submitting.contains(roundID) else { return }
        guard let log = bubbleStore.lastEngineLogs[bubble.id], !log.isEmpty else {
            appStore?.showToast(RoundsCopy.needsFinishedRun, symbol: "exclamationmark.circle")
            return
        }
        submitting.insert(roundID)
        Task { @MainActor in
            defer { submitting.remove(roundID) }
            do {
                let round = try await GamesAPIFactory.current.playRound(id: roundID, log: log)
                store(round)
                appStore?.showToast(RoundsCopy.countedToast(round, meID: meID), symbol: "person.3.fill")
            } catch {
                appStore?.showToast(RoundsCopy.didNotCount(error.localizedDescription), symbol: "exclamationmark.circle")
                _ = try? await refresh(id: roundID)
            }
        }
    }

    // MARK: Helpers

    private func store(_ round: RemoteRound, prepend: Bool = false) {
        rounds[round.id] = round
        guard prepend else { return }
        for k in ["", round.target?.wire].compactMap({ $0 }) where lists[k] != nil || k.isEmpty {
            var ids = lists[k] ?? []
            ids.removeAll { $0 == round.id }
            ids.insert(round.id, at: 0)
            lists[k] = ids
        }
    }

    /// A member as an app person (avatar, name).
    func person(_ profile: RemoteProfile) -> User? {
        bubbleStore?.person(id: profile.id, name: profile.shownName, isFriend: profile.isFriend)
    }

    /// A stable chat id for a round among friends with no Messenger thread (the server keeps no
    /// chats; the round is the thread).
    nonisolated static func chatID(for memberIDs: [String]) -> String {
        let joined = memberIDs.sorted().joined(separator: "|")
        return "friends-" + String(SeededGenerator.stableHash("round-chat|\(joined)"), radix: 16)
    }
}

/// Every user-facing string for rounds, in one place.
enum RoundsCopy {
    static let title = "Play together"
    static let rounds = "Rounds"
    static let startRound = "Start a round"
    static let startRoundDetail = "Everyone plays the same game on the same seed, whenever they like. Results compare when you're all in."
    static let play = "Play"
    static let yourTurn = "Your turn"
    static let seeResults = "See results"
    static let finished = "Finished"
    static let noRounds = "No rounds yet"
    static let noRoundsDetail = "Start one: pick a game and everyone plays the same run."
    static let pickGame = "Pick a game"
    static let noGames = "No games to play together yet"
    static let noGamesDetail = "Only games Muse made can be played in a round, so the server can check every run."
    static let pickPlace = "Who plays?"
    static let yourGroups = "Your Groups"
    static let friends = "Friends"
    static let start = "Start"
    static let gameGone = "This round's game is gone"
    static let gameDidNotLoad = "The game didn't load. Try again."
    static let needsFinishedRun = "This round needs a finished run to count. Play it to the end."
    static let onlyFirstRun = "Only your first run counts. This one was practice."
    static let thread = "In the thread"
    static let standings = "Standings"
    static let inSync = "In sync"
    static let waitingOn = "Waiting on"
    static let tie = "A tie for first"
    static let opinionNote = "No right answers here: see how in sync you are."
    static func started(_ place: String) -> String { "Round started in \(place)" }
    static func didNotCount(_ message: String) -> String { "Your run didn't count: \(message)" }
    static func played(_ n: Int, of total: Int) -> String { "\(n) of \(total) played" }
    static func inSyncWith(_ percent: Int, _ name: String) -> String { "\(percent)% in sync with \(name)" }
    static func groupInSync(_ percent: Int, players: Int) -> String { "\(percent)% in sync across \(players) players" }
    static func won(_ name: String) -> String { "\(name) won" }
    static let youWon = "You won!"
    static func closes(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        return "Closes \(f.localizedString(for: date, relativeTo: Date()))"
    }

    static func countedToast(_ round: RemoteRound, meID: String?) -> String {
        if let line = round.lines.last(where: { $0.userID == meID }) { return line.text }
        if let me = meID, let display = round.plays[me]?.display { return "Counted: \(display)" }
        return "Your run counted"
    }
}
