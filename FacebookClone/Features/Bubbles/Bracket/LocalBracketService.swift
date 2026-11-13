import Foundation
import Observation

extension Notification.Name {
    /// Posted by `AppStore` when you and someone become friends (you confirmed, or they accepted).
    /// userInfo: `["userID": String]`.
    static let friendshipStarted = Notification.Name("friendshipStarted")
}

/// Brackets kept on the device for this launch, until the server has /v1/brackets
/// (docs/BUBBLES.md 7.14). The other side's rounds come from `BracketLocalOpponent` (bot runs).
/// Results go where you met: your 1:1 chat always, and the Group for brackets from a Group board.
@MainActor
@Observable
final class LocalBracketService: BracketService {
    static let shared = LocalBracketService()

    private(set) var brackets: [String: FriendBracket] = [:]

    @ObservationIgnored private weak var appStore: AppStore?
    @ObservationIgnored private weak var bubbleStore: BubbleStore?
    @ObservationIgnored private var observer: NSObjectProtocol?

    private init() {}

    /// Once at launch: proposes a bracket to every new friend.
    func install(appStore: AppStore, bubbleStore: BubbleStore) {
        self.appStore = appStore
        self.bubbleStore = bubbleStore
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: .friendshipStarted, object: nil, queue: .main) { [weak self] note in
            guard let id = note.userInfo?["userID"] as? String else { return }
            MainActor.assumeIsolated {
                guard let self, let user = self.appStore?.user(id: id) else { return }
                if self.bracket(with: id) == nil, self.propose(with: user, origin: .newFriend) != nil {
                    self.appStore?.showToast(BracketCopy.newFriendToast(user.firstName), symbol: "trophy.fill")
                }
            }
        }
    }

    // MARK: BracketService

    func bracket(with userID: String) -> FriendBracket? {
        brackets.values.filter { $0.opponentID == userID }.max { $0.createdAt < $1.createdAt }
    }

    @discardableResult
    func propose(with user: User, origin: BracketOrigin) -> FriendBracket? {
        guard let appStore, let bubbleStore, !user.isMe, !user.isPage else { return nil }
        if let open = bracket(with: user.id), !open.isFinished { return open }
        let rounds = BracketPlanner.plan(me: appStore.me.id, them: user.id, games: bubbleStore.bubbles)
        guard rounds.count == BracketTheme.allCases.count else { return nil }
        let bracket = FriendBracket(id: UUID().uuidString, opponentID: user.id, origin: origin, createdAt: Date(), rounds: rounds)
        brackets[bracket.id] = bracket
        BubbleSocialSignals.post(.challengeSent, bubbleID: rounds[0].gameID, with: [user.id])
        // LOCAL STAND-IN: their three rounds, played by the runtime's bot on the same seeds.
        for round in rounds {
            BracketLocalOpponent.play(round, as: user, bubbleStore: bubbleStore) { [weak self] score, replay in
                self?.applyTheirs(score, replay: replay, round: round.index, bracketID: bracket.id)
            }
        }
        return bracket
    }

    func recordMine(gameID: String, seed: Int, score: Int) {
        guard let (id, index) = locate(gameID: gameID, seed: seed), var bracket = brackets[id] else { return }
        let wasFinished = bracket.isFinished
        let best = max(bracket.rounds[index].mine ?? 0, score)
        let isFirst = bracket.rounds[index].mine == nil
        bracket.rounds[index].mine = best
        brackets[id] = bracket
        if isFirst { postRound(bracket.rounds[index], of: bracket) }
        if !wasFinished && bracket.isFinished { postFinal(bracket) }
    }

    // MARK: Their side

    private func applyTheirs(_ score: Int, replay: BubbleInputLog?, round index: Int, bracketID: String) {
        guard var bracket = brackets[bracketID], bracket.rounds.indices.contains(index) else { return }
        let wasFinished = bracket.isFinished
        bracket.rounds[index].theirs = score
        bracket.rounds[index].theirsReplay = replay
        bracket.rounds[index].theirsIsLocalStandIn = true
        brackets[bracketID] = bracket
        if bracket.rounds[index].mine != nil { postRound(bracket.rounds[index], of: bracket) }
        if !wasFinished && bracket.isFinished { postFinal(bracket) }
    }

    // MARK: Posting results where you met

    private func postRound(_ round: BracketRound, of bracket: FriendBracket) {
        guard let appStore, let bubbleStore, let them = appStore.user(id: bracket.opponentID),
              let mine = round.mine, let theirs = round.theirs,
              let game = bubbleStore.bubble(id: round.gameID) else { return }
        let chat = appStore.conversation(with: them)
        appStore.send(BracketCopy.roundLine(round.index, game: game.title, mine: mine, them: them.firstName, theirs: theirs), in: chat)
    }

    private func postFinal(_ bracket: FriendBracket) {
        guard let appStore, let bubbleStore, let them = appStore.user(id: bracket.opponentID) else { return }
        let line = BracketCopy.finalLine(bracket, them: them.firstName)
        appStore.send(line, in: appStore.conversation(with: them))
        if case .group(let groupID) = bracket.origin, let group = appStore.group(id: groupID),
           let last = bracket.rounds.last(where: { $0.mine != nil }) {
            let card = BubbleChatCard(kind: .share, bubbleID: last.gameID, seed: last.seed, length: last.length,
                                      fromUserID: appStore.me.id, headline: line, score: last.mine)
            _ = BubbleSocialHub.send(card, to: BubbleShareTarget(kind: .group, targetID: group.id, title: group.name),
                                     note: BracketCopy.groupNote(them.firstName), appStore: appStore, bubbleStore: bubbleStore)
        }
        appStore.showToast(line, symbol: "trophy.fill")
    }

    private func locate(gameID: String, seed: Int) -> (String, Int)? {
        for bracket in brackets.values.sorted(by: { $0.createdAt > $1.createdAt }) {
            if let index = bracket.rounds.firstIndex(where: { $0.gameID == gameID && $0.seed == seed }) {
                return (bracket.id, index)
            }
        }
        return nil
    }

    // MARK: DEBUG

    #if DEBUG
    /// `FB_BRACKET=<userID>` proposes a bracket with that person at launch; `<userID>:played` also
    /// records your first round (42) so the card shows a result once their side lands.
    func debugApply() {
        guard let value = DebugLaunch.value("FB_BRACKET"), let appStore else { return }
        let parts = value.split(separator: ":").map(String.init)
        guard let user = appStore.user(id: parts[0]), let bracket = propose(with: user, origin: .newFriend) else { return }
        if parts.count > 1, let first = bracket.rounds.first {
            recordMine(gameID: first.gameID, seed: first.seed, score: 42)
        }
    }
    #endif
}

/// Bracket copy, in one place.
enum BracketCopy {
    static func title(_ name: String) -> String { "Getting to know \(name)" }
    static let subtitle = "Best of 3 · same course for both of you"
    static func newFriendToast(_ name: String) -> String { "You and \(name) are friends now. Play a 3-game bracket to get to know each other" }
    static func start(_ name: String) -> String { "Get to know \(name): 3 quick games" }
    static let play = "Play"
    static let replay = "Again"
    static func waiting(_ name: String) -> String { "\(name) is playing" }
    static func theirTurn(_ name: String) -> String { "\(name) played" }
    static func roundTitle(_ index: Int) -> String { "Round \(index + 1)" }

    static func roundLine(_ index: Int, game: String, mine: Int, them: String, theirs: Int) -> String {
        let verdict = mine > theirs ? "I take it" : theirs > mine ? "you take it" : "a tie"
        return "🏆 Our bracket, round \(index + 1) (\(game)): me \(mine) · you \(theirs). \(verdict.prefix(1).uppercased() + verdict.dropFirst())!"
    }

    static func finalLine(_ bracket: FriendBracket, them: String) -> String {
        switch bracket.winner {
        case .me: return "🏆 I won our get-to-know bracket \(bracket.myWins)-\(bracket.theirWins), \(them). Rematch?"
        case .them: return "🏆 \(them) won our get-to-know bracket \(bracket.theirWins)-\(bracket.myWins). Well played!"
        default: return "🏆 Our get-to-know bracket ended in a tie, \(them). Tiebreaker?"
        }
    }

    static func groupNote(_ name: String) -> String { "Met \(name) on our board and played a bracket." }

    static func score(_ mine: Int, _ them: String, _ theirs: Int) -> String { "You \(mine) · \(them) \(theirs)" }
    static func standing(_ myWins: Int, _ them: String, _ theirWins: Int) -> String { "You \(myWins) – \(theirWins) \(them)" }
    static func winner(_ bracket: FriendBracket, _ them: String) -> String {
        switch bracket.winner {
        case .me: return "You won the bracket!"
        case .them: return "\(them) won the bracket"
        case .tie: return "It's a tie"
        case nil: return ""
        }
    }
}
