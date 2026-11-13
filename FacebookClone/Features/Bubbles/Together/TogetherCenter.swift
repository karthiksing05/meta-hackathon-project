import Foundation
import Observation

// State for the "together" feature (docs/BUBBLES.md 7.4): co-making sessions and the
// contributions that arrive in a chat or a Group, the hand-off to Muse Studio, and what happens
// when a co-made game or a game about you is published.
//
// Friends' contributions and plays need the server to share a session (docs/APP_LIVE_DATA_PLAN.md,
// Stage 4). Nothing is simulated: no canned contributions, no made-up plays. Starting a session
// says "Not available yet" (TogetherScreens).

/// What friends add to a co-made game.
enum TogetherAskKind: String, CaseIterable, Identifiable, Codable, Hashable {
    case question
    case words
    case scene
    case level

    var id: String { rawValue }

    /// The formula Muse should stitch this kind into; nil lets Muse pick (scenes and levels).
    var formula: BubbleFormula? {
        switch self {
        case .question: return .answer
        case .words: return .guess
        case .scene: return .story
        case .level: return nil
        }
    }
}

/// One contribution to a session (yours or a friend's).
struct TogetherEntry: Identifiable, Hashable {
    let id: String
    var makerID: String
    var makerName: String
    var kind: TogetherAskKind
    /// As written. Questions use `TogetherStudio.encodeQuestion`'s format.
    var text: String
    var arrivedAt: Date
    var cardID: String?
}

/// A co-making session: a game someone started and invited a chat, a friend or a Group to add to.
struct TogetherSession: Identifiable, Hashable {
    let id: String
    var kind: TogetherAskKind
    var title: String
    var ask: String
    var starterID: String
    var starterName: String
    var target: BubbleShareTarget
    /// People invited to add (user ids, not you).
    var invitedIDs: [String]
    /// People who are still "typing" a contribution (simulated), for the waiting row.
    var pendingIDs: [String]
    var entries: [TogetherEntry]
    var inviteCardID: String
    var createdAt: Date
    /// The published game, once stitched.
    var bubbleID: String?

    /// Everyone who added something, the starter first.
    var makerIDs: [String] {
        var out = [starterID]
        for entry in entries where !out.contains(entry.makerID) { out.append(entry.makerID) }
        return out
    }

    var friendEntries: [TogetherEntry] { entries.filter { $0.makerID != starterID } }
}

@MainActor
@Observable
final class TogetherCenter {
    static let shared = TogetherCenter()

    private(set) var sessions: [TogetherSession] = []
    /// The session whose stitch is open in Studio; its game gets the "made together" card.
    @ObservationIgnored var stitchingSessionID: String?
    /// About-me Bubbles whose friends' plays were already scheduled.
    @ObservationIgnored private var scheduledAboutMe: Set<String> = []
    /// Your games about you already sent to a chat this launch (the "Sent" state on the profile).
    private(set) var sentAboutMeIDs: Set<String> = []
    @ObservationIgnored private var installed = false

    private init() {}

    func session(id: String) -> TogetherSession? {
        sessions.first { $0.id == id }
    }

    /// The session a card belongs to.
    func session(for card: BubbleChatCard) -> TogetherSession? {
        let id = card.extras[TogetherCard.sessionKey]?.string ?? card.sessionID ?? ""
        return session(id: id)
    }

    private func mutate(_ id: String, _ change: (inout TogetherSession) -> Void) {
        guard let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        change(&sessions[index])
    }

    // MARK: - Start

    /// Starts a session: sends the invite card to the target and schedules friends' contributions.
    @discardableResult
    func start(kind: TogetherAskKind, title: String, ask: String, target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore,
               id: String = "together-" + UUID().uuidString.prefix(8).lowercased(), delays: [Double]? = nil) -> TogetherSession {
        let me = appStore.me
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanAsk = ask.trimmingCharacters(in: .whitespacesAndNewlines)
        let makers = Self.simulatedMakers(for: target, appStore: appStore, bubbleStore: bubbleStore)
        let card = BubbleChatCard(
            id: "card-\(id)-invite",
            kind: .contribution,
            bubbleID: "",
            fromUserID: me.id,
            headline: TogetherCopy.inviteHeadline(name: me.firstName, title: cleanTitle),
            sessionID: id,
            extras: [
                TogetherCard.sessionKey: .string(id),
                TogetherCard.stageKey: .string(TogetherCard.Stage.invite.rawValue),
                TogetherCard.kindKey: .string(kind.rawValue),
                TogetherCard.askKey: .string(cleanAsk),
                TogetherCard.titleKey: .string(cleanTitle),
            ]
        )
        let session = TogetherSession(
            id: id,
            kind: kind,
            title: cleanTitle.isEmpty ? TogetherCopy.defaultTitle(kind) : cleanTitle,
            ask: cleanAsk.isEmpty ? TogetherCopy.defaultAsk(kind) : cleanAsk,
            starterID: me.id,
            starterName: me.firstName,
            target: target,
            invitedIDs: makers.map(\.id),
            pendingIDs: makers.map(\.id),
            entries: [],
            inviteCardID: card.id,
            createdAt: Date()
        )
        sessions.insert(session, at: 0)
        BubbleSocialHub.send(card, to: target, note: TogetherCopy.inviteNote(session.ask), appStore: appStore, bubbleStore: bubbleStore)
        return session
    }

    /// Who could add from the target: your 1:1 friend, the chat's members, or the Group's members.
    static func simulatedMakers(for target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore) -> [User] {
        switch target.kind {
        case .friend:
            return [appStore.user(id: target.targetID) ?? bubbleStore.resolvePerson(target.targetID)]
        case .chat:
            let chat = appStore.conversations.first { $0.id == target.targetID }
            return Array((chat?.participants ?? []).filter { !$0.isMe }.prefix(2))
        case .group:
            let members = bubbleStore.serverGroups[target.targetID]?.memberSample ?? appStore.group(id: target.targetID)?.memberSample ?? []
            return Array(members.filter { !$0.isMe }.prefix(2))
        case .feed, .story:
            return []
        }
    }

    private func deliver(_ card: BubbleChatCard, from user: User, text: String?, session: TogetherSession, appStore: AppStore, bubbleStore: BubbleStore) {
        if let chat = BubbleSocialHub.conversation(for: session.target, appStore: appStore, bubbleStore: bubbleStore) {
            BubbleSocialHub.receive(card, from: user, in: chat, text: text, appStore: appStore)
        }
        let count = (self.session(id: session.id)?.friendEntries.count ?? 0)
        BubbleSocialHub.update(cardID: session.inviteCardID, appStore: appStore) { invite in
            invite.extras[TogetherCard.addedKey] = .number(Double(count))
        }
    }

    // MARK: - Your own contribution

    /// Adds your contribution and sends it to the chat (a Group post just counts it).
    func addMine(_ text: String, to sessionID: String, appStore: AppStore, bubbleStore: BubbleStore) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let session = session(id: sessionID), session.bubbleID == nil else { return }
        let me = appStore.me
        let card = BubbleChatCard(
            id: "card-\(sessionID)-me-\(session.entries.count + 1)",
            kind: .contribution,
            bubbleID: "",
            fromUserID: me.id,
            headline: TogetherCopy.addedHeadline(name: me.firstName, kind: session.kind, title: session.title),
            sessionID: sessionID,
            extras: [
                TogetherCard.sessionKey: .string(sessionID),
                TogetherCard.stageKey: .string(TogetherCard.Stage.contribution.rawValue),
                TogetherCard.kindKey: .string(session.kind.rawValue),
                TogetherCard.textKey: .string(trimmed),
                TogetherCard.titleKey: .string(session.title),
            ]
        )
        mutate(sessionID) { session in
            session.entries.append(TogetherEntry(id: card.id, makerID: me.id, makerName: me.firstName, kind: session.kind, text: trimmed, arrivedAt: Date(), cardID: card.id))
        }
        if session.target.kind == .chat || session.target.kind == .friend {
            BubbleSocialHub.send(card, to: session.target, appStore: appStore, bubbleStore: bubbleStore)
        }
    }

    // MARK: - Stitch

    /// Muse Studio, set up to stitch this session: every maker and contribution in `social`, the
    /// title in the prompt, and the Group as the audience when the session lives in one.
    func stitchLaunch(_ sessionID: String, appStore: AppStore) -> StudioLaunch? {
        guard let session = session(id: sessionID) else { return nil }
        stitchingSessionID = sessionID
        let makers = session.makerIDs.map { id -> BubbleMaker in
            let name = id == session.starterID ? session.starterName : (session.entries.first { $0.makerID == id }?.makerName ?? "")
            return BubbleMaker(id: id, name: name, role: id == session.starterID ? "starter" : "contributor")
        }
        let contributions = session.entries.map {
            StudioContribution(makerID: $0.makerID, makerName: $0.makerName, kind: $0.kind.rawValue, text: $0.text)
        }
        let friends = makers.dropFirst().map(\.name)
        return StudioLaunch(
            mode: .create,
            groupID: session.target.kind == .group ? session.target.targetID : nil,
            prompt: TogetherCopy.stitchPrompt(title: session.title, kind: session.kind, ask: session.ask, friends: Array(friends)),
            social: StudioSocialContext(makers: makers, contributions: contributions)
        )
    }

    // MARK: - Published

    /// Studio published: co-made games get their "made together" card where the session lives,
    /// makers' notifications and plays; games about you get friends' plays.
    func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
        guard let bubble = bubbles.first else { return }
        let makers = bubble.manifest.lineage.makers ?? []
        let lineage = bubble.manifest.lineage
        // Only your own new co-made game: a remix or next level of one keeps its makers but isn't
        // a new "made together" moment.
        let isNewCoMade = makers.count > 1 && lineage.remixOf == nil && lineage.parent == nil
            && (makers.first.map { $0.id == appStore.me.id || $0.id == "me" } ?? false)
        if isNewCoMade {
            publishedTogether(bubble, makers: makers, appStore: appStore, bubbleStore: bubbleStore)
        }
    }

    private func publishedTogether(_ bubble: Bubble, makers: [BubbleMaker], appStore: AppStore, bubbleStore: BubbleStore) {
        let me = appStore.me
        let others = makers.filter { $0.id != me.id && $0.id != "me" }
        let otherIDs = others.map(\.id)
        let session = stitchingSessionID.flatMap { self.session(id: $0) }
            ?? sessions.first { $0.bubbleID == nil && Set($0.makerIDs).isSuperset(of: otherIDs) }
        stitchingSessionID = nil
        let credit = TogetherCopy.madeBy(makers.map { $0.id == me.id || $0.id == "me" ? nil : $0.name })
        if let session {
            mutate(session.id) { $0.bubbleID = bubble.id }
            let card = BubbleChatCard(
                id: "card-\(session.id)-published",
                kind: .contribution,
                bubbleID: bubble.id,
                fromUserID: me.id,
                headline: TogetherCopy.publishedHeadline(bubble.title),
                sessionID: session.id,
                extras: [
                    TogetherCard.sessionKey: .string(session.id),
                    TogetherCard.stageKey: .string(TogetherCard.Stage.published.rawValue),
                    TogetherCard.kindKey: .string(session.kind.rawValue),
                    TogetherCard.titleKey: .string(bubble.title),
                    TogetherCard.makersKey: .string(credit),
                ]
            )
            switch session.target.kind {
            case .chat, .friend:
                BubbleSocialHub.send(card, to: session.target, note: TogetherCopy.publishedNote(bubble.title), appStore: appStore, bubbleStore: bubbleStore)
            case .group, .feed, .story:
                // The invite post becomes the game: one post in the Group, not two.
                BubbleSocialHub.update(cardID: session.inviteCardID, appStore: appStore) { invite in
                    invite = BubbleChatCard(id: invite.id, kind: .contribution, bubbleID: bubble.id, fromUserID: me.id,
                                            headline: card.headline, sessionID: session.id, extras: card.extras)
                }
            }
        }
        let people = others.map { bubbleStore.resolvePerson($0.id) }
        if !people.isEmpty {
            let notification = AppNotification(
                kind: .bubblePlayed,
                actors: Array(people.prefix(2)),
                extraActorCount: max(0, people.count - 2),
                message: TogetherCopy.publishedNotification(bubble.title, where: session?.target.title),
                bubbleID: bubble.id
            )
            appStore.notifications.insert(notification, at: 0)
            BubbleSocialSignals.post(.coMakeContribution, bubbleID: bubble.id, with: otherIDs)
        }
    }

    // MARK: - Games about you

    /// Sends your game about you to your most recent group chat ("How well do you know me? Play
    /// it"). Posts a `share` signal with the chat's members. Their plays come from the server.
    @discardableResult
    func sendAboutMe(_ bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        guard let chat = appStore.conversations.filter({ $0.isGroup && !$0.isArchived }).max(by: { $0.lastActivity < $1.lastActivity }) else { return false }
        let me = appStore.me
        let card = BubbleChatCard(
            id: "card-aboutme-\(bubble.id)-\(Int(Date().timeIntervalSince1970))",
            kind: .contribution,
            bubbleID: bubble.id,
            seed: bubble.manifest.seed,
            fromUserID: me.id,
            headline: TogetherCopy.aboutMeCardHeadline(bubble.title),
            extras: [
                TogetherCard.stageKey: .string(TogetherCard.Stage.aboutMe.rawValue),
                TogetherCard.titleKey: .string(bubble.title),
            ]
        )
        let target = BubbleShareTarget(kind: .chat, targetID: chat.id, title: chat.title)
        guard BubbleSocialHub.send(card, to: target, note: TogetherCopy.aboutMeSendNote, appStore: appStore, bubbleStore: bubbleStore) else { return false }
        sentAboutMeIDs.insert(bubble.id)
        BubbleSocialSignals.post(.share, bubbleID: bubble.id, with: chat.participants.filter { !$0.isMe }.map(\.id))
        return true
    }
}

/// The contribution card's extras keys and stages (docs/BUBBLES.md 7.4).
enum TogetherCard {
    static let sessionKey = "session_id"
    static let askKey = "ask"
    static let textKey = "text"
    static let kindKey = "kind"
    /// Owned additions: which moment the card is, the game's title, live count, credit line.
    static let stageKey = "stage"
    static let titleKey = "title"
    static let addedKey = "added"
    static let makersKey = "makers"

    enum Stage: String {
        /// "Alex started Picnic Trivia · Add a question".
        case invite
        /// "Maya added a question".
        case contribution
        /// "We made Picnic Trivia together · Play".
        case published
        /// "Maya played Picnic Trivia · 520".
        case played
        /// "How well do you know Alex? · Play": your game about you, sent to a chat.
        case aboutMe = "about_me"
    }

    static func stage(of card: BubbleChatCard) -> Stage {
        Stage(rawValue: card.extras[stageKey]?.string ?? "") ?? (card.bubbleID.isEmpty ? .contribution : .published)
    }
}
