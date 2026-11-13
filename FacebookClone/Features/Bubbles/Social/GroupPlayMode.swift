import Foundation

/// How a game is played together (docs/harness-gaps/group-play.md): there is no live multiplayer.
/// Everyone plays the same single-player run on the same seed, whenever they like, and the results
/// are compared after. The plan's `social.mode` (and the published manifest's `group_play.mode`)
/// says what sending the game starts. This turns it into plain words for the Plan step and the
/// game's Send button.
enum GroupPlayMode: String, Sendable, CaseIterable {
    /// Send it, everyone plays when they like, the thread shows who won.
    case sameSeedAsync = "same_seed_async"
    /// Best of 3 or 5 with a friend, a fresh seed each round.
    case series
    /// Everyone in a Group or group chat plays the same game and is ranked.
    case groupRound = "group_round"
    /// Counts on the Group's weekly board.
    case weeklyBoard = "weekly_board"
    /// No right answer: how closely picks agree.
    case opinionCompare = "opinion_compare"

    /// Unknown or missing modes read as a head-to-head, the server's default.
    init(wire: String?) {
        self = wire.flatMap(GroupPlayMode.init(rawValue:)) ?? .sameSeedAsync
    }
}

/// What a game's group play is, from the plan's `social` part or a manifest's `group_play`.
struct GroupPlayInfo: Equatable, Sendable {
    var mode: GroupPlayMode
    /// 3 or 5 for a series.
    var bestOf: Int
    /// score, ending, agreement or none.
    var compare: String
    /// False for unranked games (opinion games, creations).
    var ranked: Bool

    init(mode: GroupPlayMode, bestOf: Int = 3, compare: String = "score", ranked: Bool = true) {
        self.mode = mode
        self.bestOf = bestOf == 5 ? 5 : 3
        self.compare = compare
        self.ranked = ranked
    }

    init(social: GameSpec.Social, ranked: Bool) {
        var mode = GroupPlayMode(wire: social.mode)
        if social.result.compare == "agreement", mode != .groupRound { mode = .opinionCompare }
        self.init(mode: mode, bestOf: social.bestOf, compare: social.result.compare,
                  ranked: ranked && social.result.compare != "agreement" && social.result.compare != "none")
    }

    /// A game with no `group_play` block: a head-to-head on the score.
    static let fallback = GroupPlayInfo(mode: .sameSeedAsync)

    /// Reads `group_play` (and `score.ranked`) from a published manifest's JSON.
    init?(manifest: JSONValue) {
        guard let block = manifest["group_play"], block.object != nil else { return nil }
        self.init(social: GameSpec.Social(json: block), ranked: manifest["score"]?["ranked"]?.bool ?? true)
    }

    // MARK: Copy

    /// The Plan step's line: how this game brings people together.
    var planLine: String {
        switch mode {
        case .series:
            return "Best of \(bestOf) with a friend"
        case .groupRound:
            return compare == "agreement" ? "Group round: see who agrees with whom" : "Group round: everyone plays the same game"
        case .weeklyBoard:
            return "Counts on your Group's board this week"
        case .opinionCompare:
            return "See how in sync your Group is"
        case .sameSeedAsync:
            switch compare {
            case "ending": return "Send it to a friend: who gets the best ending?"
            case "none": return "Send it to a friend and compare what you made"
            default: return "Send it to a friend: same game, beat their result"
            }
        }
    }

    /// The finished game's main action.
    var sendLabel: String {
        switch mode {
        case .series: return "Challenge a friend: best of \(bestOf)"
        case .groupRound: return "Start a Group round"
        case .weeklyBoard: return "Play it with your Group this week"
        case .opinionCompare: return "Compare picks with your Group"
        case .sameSeedAsync: return compare == "ending" ? "Challenge a friend: best ending" : "Challenge a friend"
        }
    }

    var symbol: String {
        switch mode {
        case .series: return "trophy.fill"
        case .groupRound, .weeklyBoard: return "person.3.fill"
        case .opinionCompare: return "heart.text.square.fill"
        case .sameSeedAsync: return "paperplane.fill"
        }
    }
}
