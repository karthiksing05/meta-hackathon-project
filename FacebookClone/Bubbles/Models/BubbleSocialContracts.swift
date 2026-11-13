import Foundation

// Collaboration contracts shared by the challenge, groups-search, together, remix, story, nextline,
// learn, length and saves features (docs/BUBBLES.md 7). Foundation only: the CLI compiles this
// file too, so nothing here may reference SwiftUI or app-only types (User, FBGroup, Conversation).
// Everything points at people, chats and Groups by id.

// MARK: - Categories

/// The chip a Bubble shows next to its formula. `.play` shows no chip.
enum BubbleCategory: String, Codable, CaseIterable, Sendable {
    case play
    case adventure
    case party
    case learn

    var title: String {
        switch self {
        case .play: return "Play"
        case .adventure: return "Adventure"
        case .party: return "Quiz night"
        case .learn: return "Learn"
        }
    }

    var symbol: String {
        switch self {
        case .play: return "gamecontroller"
        case .adventure: return "signpost.right.and.left"
        case .party: return "party.popper"
        case .learn: return "graduationcap"
        }
    }
}

// MARK: - Makers and "games about me"

/// One maker of a co-made Bubble (docs/BUBBLES.md 7.4). `role` is "starter" or "contributor";
/// `contribution` says what they added ("a question", "6 words", "the ferry scene").
struct BubbleMaker: Codable, Hashable, Sendable {
    var id: String
    var name: String
    var role: String
    var contribution: String?

    init(id: String, name: String, role: String = "contributor", contribution: String? = nil) {
        self.id = id
        self.name = name
        self.role = role
        self.contribution = contribution
    }
}

/// Manifest `about`: a "Games about me" Bubble (How well do you know me?, My first month in SF,
/// Guess my favorite spot). `template` is the template id.
struct BubbleAboutMe: Codable, Hashable, Sendable {
    var subjectID: String
    var subjectName: String
    var template: String

    init(subjectID: String, subjectName: String, template: String) {
        self.subjectID = subjectID
        self.subjectName = subjectName
        self.template = template
    }

    enum CodingKeys: String, CodingKey {
        case template
        case subjectID = "subject_id"
        case subjectName = "subject_name"
    }
}

// MARK: - Playable cards (Messenger chats and Group posts)

/// What a playable card in a chat or a Group post is for. Each kind is rendered by the feature
/// that owns it (`BubbleChatCardView` dispatches); delivery always goes through the challenge
/// feature's `BubbleSocialHub`.
enum BubbleChatCardKind: String, Codable, Sendable {
    /// A 1:1 same-seed challenge ("Beat my 34 in Hill Drift"). Owner: challenge.
    case challenge
    /// A shared group-chat session: everyone plays the same seed. Owner: challenge.
    case session
    /// A plain playable share ("Pop in to Hill Drift"). Owner: challenge.
    case share
    /// "Send it back": a remix sent to the original creator. Owner: remix.
    case remix
    /// A co-making invite or contribution ("Add a question"). Owner: together.
    case contribution
    /// A quiz night in a Group or group chat. Owner: nextline.
    case gameNight
    /// "Maya took the ferry": a path through an adventure. Owner: story.
    case storyPath
    /// A shared lesson ("New in SF knows 82% of the hills"). Owner: learn.
    case lesson
}

/// A playable card: the payload of a Messenger message or a Group post. Every play from a card
/// uses `seed` and `length`, so everyone plays the same game and every score stays verifiable
/// (seed + input log).
struct BubbleChatCard: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var kind: BubbleChatCardKind
    var bubbleID: String
    /// The seed everyone plays. Nil plays the Bubble's own seed.
    var seed: Int?
    /// The length everyone is locked to. Nil uses the Bubble's.
    var length: BubbleLength?
    /// Who sent it (user id; the signed-in user's id for your own cards).
    var fromUserID: String
    /// Headline on the card ("Beat my 34 in Hill Drift").
    var headline: String
    /// The challenge, session, co-making session or game night this card belongs to.
    var sessionID: String?
    /// The sender's score, when the card carries one.
    var score: Int?
    /// Feature-specific extras (ending ids, contribution text, round counts…). Keys are owned by
    /// the card kind's feature and documented in docs/BUBBLES.md 7.
    var extras: [String: JSONValue]

    init(
        id: String = UUID().uuidString,
        kind: BubbleChatCardKind,
        bubbleID: String,
        seed: Int? = nil,
        length: BubbleLength? = nil,
        fromUserID: String,
        headline: String,
        sessionID: String? = nil,
        score: Int? = nil,
        extras: [String: JSONValue] = [:]
    ) {
        self.id = id
        self.kind = kind
        self.bubbleID = bubbleID
        self.seed = seed
        self.length = length
        self.fromUserID = fromUserID
        self.headline = headline
        self.sessionID = sessionID
        self.score = score
        self.extras = extras
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, seed, length, headline, score, extras
        case bubbleID = "bubble_id"
        case fromUserID = "from_user_id"
        case sessionID = "session_id"
    }
}

/// Where a card, challenge or share goes. Ids only (the hub resolves them to app objects).
struct BubbleShareTarget: Codable, Hashable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable {
        /// A friend: the card goes to your 1:1 chat with them.
        case friend
        /// An existing Messenger chat (1:1 or group chat), by conversation id.
        case chat
        /// A Group: the card becomes a post in its feed.
        case group
        /// Your own feed.
        case feed
        /// Your story.
        case story
    }

    var kind: Kind
    /// User id, conversation id or Group id; empty for feed and story.
    var targetID: String
    var title: String

    var id: String { "\(kind.rawValue):\(targetID)" }

    init(kind: Kind, targetID: String = "", title: String) {
        self.kind = kind
        self.targetID = targetID
        self.title = title
    }
}

/// How a play was started, so the player and the result sheet can show the social side
/// (head-to-head, "3 of 5 played", game night round). Passed in `BubblePlayRequest.context`.
struct BubblePlayContext: Codable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable {
        case challenge
        case session
        case gameNight
        case contribution
        case lesson
        /// A same-seed round on the server (`/v1/rounds`); `id` is the round id.
        case round
    }

    var kind: Kind
    /// Challenge, session or game night id.
    var id: String
    /// The card the play started from, if any.
    var cardID: String?
    /// The person or chat this play is against or with ("Maya", "New in SF crew").
    var opponentName: String?
    /// The score to beat, if any.
    var target: Int?

    init(kind: Kind, id: String, cardID: String? = nil, opponentName: String? = nil, target: Int? = nil) {
        self.kind = kind
        self.id = id
        self.cardID = cardID
        self.opponentName = opponentName
        self.target = target
    }
}

// MARK: - Saves (the appreciation signal)

/// Where a save happened (docs/BUBBLES.md 7.10). Kevin's recommender reads it from
/// `Notification.Name.bubbleSaveChanged`.
enum BubbleSaveSource: String, Codable, CaseIterable, Sendable {
    case feed
    case game
    case result
    case detail
    case library
    case chat
    case group
    case search
    case profile
}

// MARK: - Notifications

extension Notification.Name {
    /// Posted by `BubbleStore.toggleSave(_:source:)` on every save and unsave.
    /// userInfo: `["bubbleID": String, "isSaved": Bool, "source": String]`.
    static let bubbleSaveChanged = Notification.Name("bubbleSaveChanged")

    /// Posted by `BubbleSocialSignals.post(_:bubbleID:with:)` on every collaboration moment.
    /// userInfo: `["kind": String, "bubbleID": String, "with": [String]]` (user ids).
    static let bubbleSocialSignal = Notification.Name("bubbleSocialSignal")
}

/// The collaboration moments the recommender listens to (docs/BUBBLES.md 7.1).
enum BubbleSocialSignalKind: String, Codable, CaseIterable, Sendable {
    case challengeSent = "challenge_sent"
    case challengeAccepted = "challenge_accepted"
    case challengeWon = "challenge_won"
    case challengeRematch = "challenge_rematch"
    case groupChatPlay = "group_chat_play"
    case groupChallenge = "group_challenge"
    case gameNightPlay = "game_night_play"
    case remix
    case share
    case coMakeContribution = "co_make_contribution"
    case aboutMePlay = "about_me_play"
    case storyPathShared = "story_path_shared"
    case lessonShared = "lesson_shared"
    case addFriendFromGame = "add_friend_from_game"
}

/// Posts `Notification.Name.bubbleSocialSignal`. The one way to report a collaboration moment.
enum BubbleSocialSignals {
    /// userInfo keys, for listeners.
    static let kindKey = "kind"
    static let bubbleIDKey = "bubbleID"
    static let withKey = "with"

    /// - Parameters:
    ///   - kind: what happened.
    ///   - bubbleID: the Bubble it happened around.
    ///   - with: the other people's user ids (never the signed-in user's).
    static func post(_ kind: BubbleSocialSignalKind, bubbleID: String, with userIDs: [String]) {
        NotificationCenter.default.post(
            name: .bubbleSocialSignal,
            object: nil,
            userInfo: [kindKey: kind.rawValue, bubbleIDKey: bubbleID, withKey: userIDs]
        )
    }
}

/// Posts `Notification.Name.bubbleSaveChanged`. Only `BubbleStore.toggleSave(_:source:)` calls it.
enum BubbleSaveSignals {
    static let bubbleIDKey = "bubbleID"
    static let isSavedKey = "isSaved"
    static let sourceKey = "source"

    static func post(bubbleID: String, isSaved: Bool, source: BubbleSaveSource) {
        NotificationCenter.default.post(
            name: .bubbleSaveChanged,
            object: nil,
            userInfo: [bubbleIDKey: bubbleID, isSavedKey: isSaved, sourceKey: source.rawValue]
        )
    }
}
