import Foundation

// Get-to-know brackets (docs/BUBBLES.md 7.14): when you meet someone new (a new friend, or Add
// friend next to a stranger on a Group board), the app proposes a best of three: one quick-hands
// game, one words or trivia game, one "about you" game, each on a seed shared by the two of you.
// The model and the planner live here; `BracketService` holds brackets: the server's series
// (`ServerBracketService`, /v1/series), so both people play the same games on the same seeds and the
// server replays every run to check its score.

/// What each round is for, so the three games feel different.
enum BracketTheme: String, Codable, CaseIterable, Sendable {
    case reflex
    case words
    case aboutYou = "about_you"

    var title: String {
        switch self {
        case .reflex: return "Quick hands"
        case .words: return "Words and trivia"
        case .aboutYou: return "Get to know you"
        }
    }

    var symbol: String {
        switch self {
        case .reflex: return "bolt.fill"
        case .words: return "textformat.abc"
        case .aboutYou: return "person.2.fill"
        }
    }

    /// Formulas that fit the round, best first.
    var formulas: [BubbleFormula] {
        switch self {
        case .reflex: return [.dodge, .time, .microgame, .merge]
        case .words: return [.guess, .nextline, .answer, .learn]
        case .aboutYou: return [.answer, .story, .group, .nextline]
        }
    }
}

enum BracketSide: String, Codable, Sendable {
    case me
    case them
    case tie
}

/// Where you met: the bracket's results also go there.
enum BracketOrigin: Codable, Hashable, Sendable {
    case newFriend
    case group(String)
    case event(String)
}

struct BracketRound: Codable, Hashable, Identifiable, Sendable {
    var index: Int
    var theme: BracketTheme
    var gameID: String
    /// Both of you play this seed (and length), so it's the same course.
    var seed: Int
    var length: BubbleLength?
    var mine: Int?
    var theirs: Int?
    var theirsReplay: BubbleInputLog?
    /// The server's verdict once both have played (it breaks equal scores on time).
    var decided: BracketSide?

    var id: Int { index }

    var winner: BracketSide? {
        if let decided { return decided }
        guard let mine, let theirs else { return nil }
        return mine > theirs ? .me : theirs > mine ? .them : .tie
    }
}

struct FriendBracket: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var opponentID: String
    var origin: BracketOrigin
    var createdAt: Date
    var rounds: [BracketRound]

    /// Rounds needed to win (best of 5 needs 3); from the server when it says.
    var winsNeeded: Int?
    /// The server's status and verdict, when the bracket is a server series.
    var isDoneOnServer: Bool?
    var serverWinner: BracketSide?

    var myWins: Int { rounds.filter { $0.winner == .me }.count }
    var theirWins: Int { rounds.filter { $0.winner == .them }.count }
    var needed: Int { winsNeeded ?? (rounds.count / 2 + 1) }
    /// Over when someone has won more than half the rounds, or when every round is decided.
    var isFinished: Bool { isDoneOnServer ?? (myWins >= needed || theirWins >= needed || rounds.allSatisfy { $0.winner != nil }) }

    var winner: BracketSide? {
        guard isFinished else { return nil }
        if let serverWinner { return serverWinner }
        return myWins > theirWins ? .me : theirWins > myWins ? .them : .tie
    }

    /// The next round you haven't played.
    var nextRound: BracketRound? {
        isFinished ? nil : rounds.first { $0.mine == nil }
    }
}

/// Holds get-to-know brackets. The app talks only to this; the local implementation stands in until
/// the server has the endpoints in docs/BUBBLES.md 7.14.
@MainActor
protocol BracketService: AnyObject {
    /// Your latest bracket with someone.
    func bracket(with userID: String) -> FriendBracket?
    /// Starts a bracket with someone you just met (or returns the open one).
    @discardableResult
    func propose(with user: User, origin: BracketOrigin) -> FriendBracket?
    /// Records your run of a round, matched by game and seed (from the player's didFinish).
    func recordMine(gameID: String, seed: Int, score: Int)
}

enum BracketServices {
    @MainActor static var current: BracketService { ServerBracketService.shared }
}

/// Picks the three games for two people: one per theme, different games, stable for the pair.
enum BracketPlanner {
    static func plan(me: String, them: String, games: [Bubble]) -> [BracketRound] {
        var used: Set<String> = []
        var rounds: [BracketRound] = []
        let pair = [me, them].sorted().joined(separator: "|")
        for (index, theme) in BracketTheme.allCases.enumerated() {
            let pick = theme.formulas.lazy
                .map { formula in games.filter { $0.manifest.formula == formula && !used.contains($0.id) } }
                .first { !$0.isEmpty }
            // With live data most games are microgames: fall back to any game not used yet, so a
            // bracket still has three different games.
            let fallback = games.filter { !used.contains($0.id) && !$0.isDaily }
            guard let candidates = pick ?? (fallback.isEmpty ? nil : fallback) else { continue }
            let sorted = candidates.sorted { $0.id < $1.id }
            let game = sorted[Int(SeededGenerator.stableHash("bracket-pick|\(pair)|\(theme.rawValue)") % UInt64(sorted.count))]
            used.insert(game.id)
            let seed = Int(truncatingIfNeeded: SeededGenerator.stableHash("bracket|\(pair)|\(index)|\(game.id)") & 0x7FFF_FFFF)
            rounds.append(BracketRound(index: index, theme: theme, gameID: game.id, seed: seed, length: game.manifest.length))
        }
        return rounds
    }
}
