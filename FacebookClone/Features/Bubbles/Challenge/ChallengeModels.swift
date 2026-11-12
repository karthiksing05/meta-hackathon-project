import Foundation

// State for Challenge Me and group-chat sessions (docs/BUBBLES.md 7.2). Owner: challenge.
// Everything here lives in `ChallengeCenter.shared` for this launch, like the mock chats.

/// One person's play in a challenge or session. Scores come from real runs: yours from the
/// player (seed + input log), friends' from bot runs of the real runtime on the same seed.
struct ChallengeEntry: Hashable {
    var userID: String
    var score: Int
    /// The run's input log. Nil only for a friend's synthetic fallback or a seeded past session.
    var replay: BubbleInputLog?
    /// The `BubbleScore` id on the Bubble Board, for your own runs (its `isVerified` flips once
    /// the replay checks out).
    var scoreID: String?
    /// True when the replay re-simulated to exactly this score (friends' bot runs are checked as
    /// they are made).
    var isVerified: Bool
    var playedAt: Date

    init(userID: String, score: Int, replay: BubbleInputLog? = nil, scoreID: String? = nil, isVerified: Bool = false, playedAt: Date = Date()) {
        self.userID = userID
        self.score = score
        self.replay = replay
        self.scoreID = scoreID
        self.isVerified = isVerified
        self.playedAt = playedAt
    }
}

/// How a 1:1 challenge ended, from your side.
enum ChallengeOutcome: String, Hashable {
    case won
    case lost
    case tied
}

/// A 1:1 same-seed challenge between you and one person, in your 1:1 chat with them.
struct BubbleChallenge: Identifiable, Hashable {
    /// UUID string. Also the cards' `sessionID`.
    let id: String
    let bubbleID: String
    /// Everyone plays this seed and length, so it's a fair head-to-head.
    let seed: Int
    let length: BubbleLength?
    /// Who sent it: your id, or the opponent's.
    let fromUserID: String
    let opponentID: String
    let conversationID: String
    /// The card that started it.
    var cardID: String
    /// The previous challenge, for rematches.
    var rematchOf: String?
    /// How many rematches deep this thread is (0 for the first challenge).
    var round: Int
    var mine: ChallengeEntry?
    var theirs: ChallengeEntry?
    /// Whether the opponent's bot run is on its way.
    var isOpponentPlaying: Bool
    /// The outcome already counted in the rivalry tally, so a better run moves it instead of
    /// counting twice.
    var countedOutcome: ChallengeOutcome?
    /// Your head-to-head result card in the chat, once you've played.
    var resultCardID: String?
    let createdAt: Date

    var isFinished: Bool { mine != nil && theirs != nil }

    /// Nil until both have played.
    var outcome: ChallengeOutcome? {
        guard let mine, let theirs else { return nil }
        if mine.score == theirs.score { return .tied }
        return mine.score > theirs.score ? .won : .lost
    }
}

/// A shared session: a game dropped into a group chat or a Group, where everyone plays the same
/// seed and the card keeps score.
struct ChallengeSession: Identifiable, Hashable {
    /// UUID string. Also the card's `sessionID`.
    let id: String
    let bubbleID: String
    let seed: Int
    let length: BubbleLength?
    let fromUserID: String
    /// Everyone in it, you included.
    let memberIDs: [String]
    /// The group chat, or nil for a Group post.
    let conversationID: String?
    /// The Group, for "Challenge the Group" posts.
    let groupID: String?
    /// "New in SF crew", "New in SF".
    let title: String
    var cardID: String
    var rematchOf: String?
    var entries: [String: ChallengeEntry]
    let createdAt: Date

    var isGroupPost: Bool { groupID != nil && conversationID == nil }
    var playedCount: Int { entries.count }
    var isFinished: Bool { memberIDs.allSatisfy { entries[$0] != nil } }

    /// Best first; ties go to whoever played first.
    var standings: [ChallengeEntry] {
        entries.values.sorted { a, b in
            a.score != b.score ? a.score > b.score : a.playedAt < b.playedAt
        }
    }

    var leader: ChallengeEntry? { standings.first }
}

/// A past result in a rivalry ("Hill Hopper · you won 38–31").
struct ChallengeHistoryItem: Hashable, Identifiable {
    let id: String
    let bubbleID: String
    let myScore: Int
    let theirScore: Int
    let daysAgo: Int

    var outcome: ChallengeOutcome {
        myScore == theirScore ? .tied : (myScore > theirScore ? .won : .lost)
    }
}

/// Card extras owned by the challenge feature (docs/BUBBLES.md 7.2).
enum ChallengeCardKeys {
    /// `[{"user_id": String, "score": Int}]`, best first.
    static let scores = "scores"
    /// How many people have played.
    static let played = "played"
    /// How many people are in it.
    static let members = "members"
    /// The winner once everyone has played; absent (or null) before.
    static let winnerID = "winner_id"
    /// The challenge or session this one is a rematch of.
    static let rematchOf = "rematch_of"
    /// What this card is in its thread: "invite" (starts it), "reply" (a friend's score),
    /// "result" (your head-to-head).
    static let role = "role"
    /// The chat or Group name a session belongs to ("New in SF crew").
    static let title = "title"
}

extension BubbleChatCard {
    /// `scores` extras as (user id, score), best first.
    var challengeScores: [(userID: String, score: Int)] {
        (extras[ChallengeCardKeys.scores]?.array ?? []).compactMap { item in
            guard let id = item["user_id"]?.string, let score = item["score"]?.int else { return nil }
            return (id, score)
        }
    }

    var challengePlayed: Int { extras[ChallengeCardKeys.played]?.int ?? challengeScores.count }
    var challengeMembers: Int { extras[ChallengeCardKeys.members]?.int ?? 2 }
    var challengeWinnerID: String? { extras[ChallengeCardKeys.winnerID]?.string }
    var challengeRole: String { extras[ChallengeCardKeys.role]?.string ?? "invite" }
    var challengeTitle: String? { extras[ChallengeCardKeys.title]?.string }

    /// Writes the live score extras.
    mutating func setChallengeScores(_ entries: [ChallengeEntry], members: Int, winnerID: String?) {
        extras[ChallengeCardKeys.scores] = .array(entries.map { entry in
            .object(["user_id": .string(entry.userID), "score": .number(Double(entry.score))])
        })
        extras[ChallengeCardKeys.played] = .number(Double(entries.count))
        extras[ChallengeCardKeys.members] = .number(Double(members))
        extras[ChallengeCardKeys.winnerID] = winnerID.map { .string($0) } ?? .null
    }
}
