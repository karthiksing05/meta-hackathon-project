import Foundation
import Observation

/// Brackets on the server's series (`/v1/series`, docs/BUBBLES.md 7.14): a best of N with a friend
/// on the same games and the server's seeds. Each round's run goes up as the engine's input log,
/// and the server replays it (`MicrogameEngine.verify`) to get the score, so neither phone is
/// trusted. Nothing is simulated: the other side's rounds come from the other person.
@MainActor
@Observable
final class ServerBracketService: BracketService {
    static let shared = ServerBracketService()

    /// My series, newest first, as the server last sent them.
    private(set) var series: [RemoteSeries] = []
    private(set) var state: FeedLoadState = .idle
    /// Rounds being submitted, by "seriesID|n".
    private(set) var submitting: Set<String> = []

    @ObservationIgnored private weak var appStore: AppStore?
    @ObservationIgnored private weak var bubbleStore: BubbleStore?
    /// Server game id → app game id, filled as series games are adopted.
    @ObservationIgnored private var bubbleIDs: [String: String] = [:]
    @ObservationIgnored private var installed = false

    /// Games per series: a best of 5 (first to 3).
    static let roundsPerSeries = 5

    private init() {}

    func install(appStore: AppStore, bubbleStore: BubbleStore) {
        self.appStore = appStore
        self.bubbleStore = bubbleStore
        guard !installed else { return }
        installed = true
        NotificationCenter.default.addObserver(forName: .gamesAccountChanged, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                ServerBracketService.shared.series = []
                ServerBracketService.shared.reload()
            }
        }
        reload()
    }

    // MARK: - Reading

    /// Fetches my series again (on install, after a run, pull to refresh, a new moment).
    func reload() {
        guard state != .loading, let bubbleStore else { return }
        state = .loading
        Task { @MainActor in
            guard await GamesAccount.shared.waitForUser() != nil else { state = .idle; return }
            do {
                let list = try await GamesAPIFactory.current.seriesList()
                await adoptGames(in: list, bubbleStore: bubbleStore)
                series = list
                state = .idle
            } catch {
                state = .failed(error.localizedDescription)
            }
        }
    }

    /// Your latest bracket with someone.
    func bracket(with userID: String) -> FriendBracket? {
        series.first { $0.opponent.id == userID }.map(bracket(from:))
    }

    /// Series still being played, newest first (Challenges shows these on top).
    var active: [FriendBracket] { series.filter { !$0.isDone }.map(bracket(from:)) }
    var finished: [FriendBracket] { series.filter(\.isDone).map(bracket(from:)) }

    /// Rounds waiting on you across all series (a badge).
    var yourTurnCount: Int {
        series.filter { !$0.isDone }.reduce(0) { $0 + $1.rounds.filter { !$0.mine.played }.count }
    }

    func opponent(of bracket: FriendBracket) -> RemoteProfile? {
        series.first { $0.id == bracket.id }?.opponent
    }

    // MARK: - Starting

    /// Quick, scored games for a series: microgames from the server's feed, a stable pick per pair.
    func pickGames(with userID: String, count: Int = roundsPerSeries) -> [Bubble] {
        guard let bubbleStore else { return [] }
        var seen = Set<String>()
        let pool = bubbleStore.feedBubbles.filter {
            $0.manifest.formula == .microgame && !$0.serverID.isEmpty && !$0.isDaily && seen.insert($0.serverID).inserted
        }
        let pair = [GamesAccount.shared.userID ?? "me", userID].sorted().joined(separator: "|")
        let ordered = pool.sorted {
            SeededGenerator.stableHash("series|\(pair)|\($0.serverID)") < SeededGenerator.stableHash("series|\(pair)|\($1.serverID)")
        }
        return Array(ordered.prefix(count))
    }

    /// Starts a best of N with a friend on these games (`POST /v1/series`). Throws the server's message.
    @discardableResult
    func start(with userID: String, games: [Bubble]) async throws -> FriendBracket {
        let created = try await GamesAPIFactory.current.startSeries(opponentID: userID, gameIDs: games.map { $0.serverID.isEmpty ? $0.id : $0.serverID })
        if let bubbleStore { await adoptGames(in: [created], bubbleStore: bubbleStore) }
        series.removeAll { $0.id == created.id }
        series.insert(created, at: 0)
        return bracket(from: created)
    }

    /// From the profile card or a hook: start one on picked games. The card updates when it's made.
    @discardableResult
    func propose(with user: User, origin: BracketOrigin) -> FriendBracket? {
        let games = pickGames(with: user.id)
        guard !games.isEmpty else {
            appStore?.showToast("No games on the server yet to play together", symbol: "gamecontroller")
            return nil
        }
        Task { @MainActor in
            do {
                try await start(with: user.id, games: games)
                appStore?.showToast("Best of \(games.count) started with \(user.firstName)", symbol: "trophy.fill")
            } catch {
                appStore?.showToast("Couldn't start: \(error.localizedDescription)", symbol: "exclamationmark.circle")
            }
        }
        return nil
    }

    // MARK: - Playing

    /// After you play a round (matched by game and the round's seed): submit the run's engine log.
    func recordMine(gameID: String, seed: Int, score: Int) {
        guard let bubbleStore,
              let s = series.first(where: { s in !s.isDone && s.rounds.contains { matches($0, gameID: gameID, seed: seed) && !$0.mine.played } }),
              let round = s.rounds.first(where: { matches($0, gameID: gameID, seed: seed) && !$0.mine.played }) else { return }
        guard let log = bubbleStore.lastEngineLogs[gameID], !log.isEmpty else {
            appStore?.showToast("This round needs a finished run to count. Play it to the end.", symbol: "exclamationmark.circle")
            return
        }
        let key = "\(s.id)|\(round.n)"
        guard !submitting.contains(key) else { return }
        submitting.insert(key)
        let opponentName = s.opponent.displayName.isEmpty ? s.opponent.username : s.opponent.displayName
        Task { @MainActor in
            defer { submitting.remove(key) }
            do {
                let updated = try await GamesAPIFactory.current.submitSeriesRound(seriesID: s.id, round: round.n, log: log)
                await adoptGames(in: [updated], bubbleStore: bubbleStore)
                if let i = series.firstIndex(where: { $0.id == updated.id }) { series[i] = updated }
                appStore?.showToast(Self.roundToast(updated, round: round.n, opponent: opponentName), symbol: "trophy.fill")
            } catch {
                appStore?.showToast("Your round didn't count: \(error.localizedDescription)", symbol: "exclamationmark.circle")
            }
        }
    }

    // MARK: - Mapping

    private func matches(_ round: RemoteSeriesRound, gameID: String, seed: Int) -> Bool {
        round.seed == seed && (bubbleIDs[round.gameID] == gameID || round.gameID == gameID)
    }

    private func adoptGames(in list: [RemoteSeries], bubbleStore: BubbleStore) async {
        for round in list.flatMap(\.rounds) where bubbleIDs[round.gameID] == nil {
            if let game = round.game, let bubble = await bubbleStore.adopt(game) {
                bubbleIDs[round.gameID] = bubble.id
            }
        }
    }

    private static func side(_ value: String?) -> BracketSide? {
        switch value {
        case "me": return .me
        case "them": return .them
        case "draw": return .tie
        default: return nil
        }
    }

    func bracket(from s: RemoteSeries) -> FriendBracket {
        let themes = BracketTheme.allCases
        let rounds = s.rounds.sorted { $0.n < $1.n }.enumerated().map { i, r in
            BracketRound(index: i, theme: themes[i % themes.count], gameID: bubbleIDs[r.gameID] ?? r.gameID, seed: r.seed,
                         length: nil, mine: r.mine.played ? r.mine.score : nil, theirs: r.theirs.played ? r.theirs.score : nil,
                         theirsReplay: nil, decided: Self.side(r.winner))
        }
        return FriendBracket(id: s.id, opponentID: s.opponent.id, origin: .newFriend, createdAt: s.createdAt, rounds: rounds,
                             winsNeeded: s.winsNeeded, isDoneOnServer: s.isDone, serverWinner: Self.side(s.winner))
    }

    private static func roundToast(_ s: RemoteSeries, round n: Int, opponent: String) -> String {
        if s.isDone {
            switch s.winner {
            case "me": return "You won the best of \(s.rounds.count) against \(opponent), \(s.tally.me)–\(s.tally.them)!"
            case "them": return "\(opponent) won the best of \(s.rounds.count), \(s.tally.them)–\(s.tally.me). Rematch?"
            default: return "The best of \(s.rounds.count) with \(opponent) ends in a draw"
            }
        }
        guard let round = s.rounds.first(where: { $0.n == n }) else { return "Round \(n) counted" }
        switch round.winner {
        case "me": return "You took round \(n)! \(s.tally.me)–\(s.tally.them)"
        case "them": return "\(opponent) took round \(n). \(s.tally.me)–\(s.tally.them)"
        case "draw": return "Round \(n) is a draw"
        default: return "Round \(n) counted. Waiting for \(opponent)"
        }
    }
}

/// Bracket copy, in one place.
enum BracketCopy {
    static func title(_ name: String) -> String { "You vs \(name)" }
    /// "Best of 3", "Best of 5": the match's own length (a friend with fewer games gets a shorter one).
    static func subtitle(rounds: Int) -> String { "Best of \(max(rounds, 1)) · same games, same seeds" }
    static func start(_ name: String) -> String { "Play \(name): best of 5" }
    static let play = "Play"
    static let replay = "Again"
    static func waiting(_ name: String) -> String { "Waiting for \(name)" }
    static func theirTurn(_ name: String) -> String { "\(name) played" }
    static func roundTitle(_ index: Int) -> String { "Round \(index + 1)" }
    static func score(_ mine: Int, _ them: String, _ theirs: Int) -> String { "You \(mine) · \(them) \(theirs)" }
    static func standing(_ myWins: Int, _ them: String, _ theirWins: Int) -> String { "You \(myWins) – \(theirWins) \(them)" }
    static func winner(_ bracket: FriendBracket, _ them: String) -> String {
        switch bracket.winner {
        case .me: return "You won the match!"
        case .them: return "\(them) won the match"
        case .tie: return "It's a draw"
        case nil: return ""
        }
    }
}

extension Notification.Name {
    /// Posted by `AppStore` when you and someone become friends in the app's own (Stage 5) friend
    /// list. userInfo: `["userID": String]`. Series need server friends, which post
    /// `gamesFriendAdded` instead, so nothing starts from this one.
    static let friendshipStarted = Notification.Name("friendshipStarted")
}
