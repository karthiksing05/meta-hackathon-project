import Foundation
import Observation

// State for the "together" feature (docs/BUBBLES.md 7.4): co-making sessions and the
// contributions that arrive in a chat or a Group, the hand-off to Muse Studio, and what happens
// when a co-made game or a game about you is published.
//
// With one phone at the demo, friends' contributions and plays are simulated on short delays
// from canned, original content (deterministic per session), and friends' scores are real bot
// runs of the published game (BubbleStore.simulateRun), so every score stays verifiable.

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
        scheduleContributions(for: session, makers: makers, delays: delays, appStore: appStore, bubbleStore: bubbleStore)
        return session
    }

    /// Two people from the target add (one adds twice): your 1:1 friend, the chat's members, or
    /// the Group's members, rival and friends first.
    static func simulatedMakers(for target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore) -> [User] {
        let preferred = [BubbleSocialCast.rivalID] + BubbleSocialCast.friendIDs
        func ranked(_ users: [User]) -> [User] {
            users.filter { !$0.isMe }.enumerated().sorted { a, b in
                let ra = preferred.firstIndex(of: a.element.id) ?? 99
                let rb = preferred.firstIndex(of: b.element.id) ?? 99
                return ra != rb ? ra < rb : a.offset < b.offset
            }.map(\.element)
        }
        switch target.kind {
        case .friend:
            return [appStore.user(id: target.targetID) ?? bubbleStore.resolvePerson(target.targetID)]
        case .chat:
            let chat = appStore.conversations.first { $0.id == target.targetID }
            let people = chat?.participants ?? []
            // Keep the chat's own order so the first members (Maya, Diego in New in SF crew) lead.
            return Array(people.filter { !$0.isMe }.prefix(2))
        case .group:
            var members = target.targetID == BubbleDemo.groupID ? BubbleSocialCast.groupMembers(bubbleStore) : []
            if members.isEmpty { members = appStore.group(id: target.targetID)?.memberSample ?? [] }
            return Array(ranked(members).prefix(2))
        case .feed, .story:
            return Array(ranked(appStore.friends).prefix(2))
        }
    }

    private func scheduleContributions(for session: TogetherSession, makers: [User], delays: [Double]?, appStore: AppStore, bubbleStore: BubbleStore) {
        guard let first = makers.first else { return }
        // One from the first maker, two from the second (or two from a single friend).
        let order: [User] = makers.count > 1 ? [first, makers[1], makers[1]] : [first, first]
        let pool = TogetherCopy.cannedContributions(session.kind)
        let waits = delays ?? [3.5, 7, 10.5]
        for (index, maker) in order.enumerated() {
            let text = pool[index % pool.count]
            let reply = TogetherCopy.contributionReply(session.kind, index: index)
            let wait = waits[min(index, waits.count - 1)]
            let isLast = !order[(index + 1)...].contains(maker)
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                self?.arrive(text: text, from: maker, reply: reply, finishesMaker: isLast, sessionID: session.id, appStore: appStore, bubbleStore: bubbleStore)
            }
        }
    }

    /// A friend's contribution lands: in the session, as a card in the chat (or as live progress
    /// on the Group post), with a notification and a co-making signal.
    private func arrive(text: String, from maker: User, reply: String, finishesMaker: Bool, sessionID: String, appStore: AppStore, bubbleStore: BubbleStore) {
        guard let session = self.session(id: sessionID), session.bubbleID == nil else { return }
        let card = BubbleChatCard(
            id: "card-\(sessionID)-\(session.entries.count + 1)",
            kind: .contribution,
            bubbleID: "",
            fromUserID: maker.id,
            headline: TogetherCopy.addedHeadline(name: maker.firstName, kind: session.kind, title: session.title),
            sessionID: sessionID,
            extras: [
                TogetherCard.sessionKey: .string(sessionID),
                TogetherCard.stageKey: .string(TogetherCard.Stage.contribution.rawValue),
                TogetherCard.kindKey: .string(session.kind.rawValue),
                TogetherCard.textKey: .string(text),
                TogetherCard.titleKey: .string(session.title),
            ]
        )
        let entry = TogetherEntry(id: card.id, makerID: maker.id, makerName: maker.firstName, kind: session.kind, text: text, arrivedAt: Date(), cardID: card.id)
        mutate(sessionID) { session in
            session.entries.append(entry)
            if finishesMaker { session.pendingIDs.removeAll { $0 == maker.id } }
        }
        deliver(card, from: maker, text: reply, session: session, appStore: appStore, bubbleStore: bubbleStore)
        let notification = AppNotification(
            kind: .bubblePlayed,
            actors: [maker],
            message: TogetherCopy.addedNotification(kind: session.kind, title: session.title),
            bubbleID: nil
        )
        notification.bubbleAction = BubbleFeatureRoute(.together, "session", sessionID)
        appStore.notifications.insert(notification, at: 0)
        BubbleSocialSignals.post(.coMakeContribution, bubbleID: session.bubbleID ?? sessionID, with: [maker.id])
    }

    /// Puts a card from someone else where the session lives: the chat, or live progress on the
    /// Group or feed post.
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
        if let about = bubble.manifest.about, about.subjectID == appStore.me.id || about.subjectID == "me" {
            scheduleAboutMePlays(bubble, appStore: appStore, bubbleStore: bubbleStore)
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
        schedulePlays(of: bubble, by: people, session: session, appStore: appStore, bubbleStore: bubbleStore)
    }

    /// The makers play the game they made together, on its own seed, and say so in the chat.
    private func schedulePlays(of bubble: Bubble, by people: [User], session: TogetherSession?, appStore: AppStore, bubbleStore: BubbleStore) {
        for (index, person) in people.prefix(3).enumerated() {
            let wait = 6.0 + Double(index) * 5
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                bubbleStore.simulateRun(of: person, on: bubble, manifest: bubble.manifest) { score in
                    bubble.scores.append(score)
                    bubble.playCount += 1
                    guard let self, let session else { return }
                    self.announcePlay(score, in: bubble, session: session, appStore: appStore, bubbleStore: bubbleStore)
                }
            }
        }
    }

    private func announcePlay(_ score: BubbleScore, in bubble: Bubble, session: TogetherSession, appStore: AppStore, bubbleStore: BubbleStore) {
        guard let chat = BubbleSocialHub.conversation(for: session.target, appStore: appStore, bubbleStore: bubbleStore) else { return }
        var extras: [String: JSONValue] = [
            TogetherCard.sessionKey: .string(session.id),
            TogetherCard.stageKey: .string(TogetherCard.Stage.played.rawValue),
            TogetherCard.titleKey: .string(bubble.title),
        ]
        if let line = score.share?.scoreText { extras[TogetherCard.textKey] = .string(line) }
        let card = BubbleChatCard(
            id: "card-\(session.id)-played-\(score.user.id)",
            kind: .contribution,
            bubbleID: bubble.id,
            seed: bubble.manifest.seed,
            fromUserID: score.user.id,
            headline: TogetherCopy.playedHeadline(name: score.user.firstName, title: bubble.title, score: score.score),
            sessionID: session.id,
            score: score.score,
            extras: extras
        )
        BubbleSocialHub.receive(card, from: score.user, in: chat, text: TogetherCopy.playedReply(index: session.entries.count + score.score), appStore: appStore)
    }

    // MARK: - Games about you

    /// Friends play your new game about you over the next few seconds, so "Who knows you best"
    /// fills in. Diego is the one who knows you best in the demo.
    func scheduleAboutMePlays(_ bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) {
        guard scheduledAboutMe.insert(bubble.id).inserted else { return }
        let players: [(String, Double)] = [("sf-diego-ramirez", 0.97), ("sf-aiko-tanaka", 0.6), ("sf-theo-adeyemi", 0.35)]
        for (index, (id, skill)) in players.enumerated() {
            let person = bubbleStore.resolvePerson(id)
            guard !person.isMe else { continue }
            let wait = 4.0 + Double(index) * 4
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                bubbleStore.simulateRun(of: person, on: bubble, manifest: bubble.manifest, skill: skill) { score in
                    bubble.scores.append(score)
                    bubble.playCount += 1
                    let notification = AppNotification(
                        kind: .bubblePlayed,
                        actors: [person],
                        message: TogetherCopy.aboutMePlayedNotification(bubble.title, line: score.share?.scoreText),
                        bubbleID: bubble.id
                    )
                    notification.bubbleAction = BubbleFeatureRoute(.together, "profile", appStore.me.id)
                    appStore.notifications.insert(notification, at: 0)
                }
            }
        }
    }

    // MARK: - Demo

    /// The demo session: picnic trivia in "New in SF crew", contributions over about 10 s.
    func stageDemo(appStore: AppStore, bubbleStore: BubbleStore) -> TogetherSession? {
        if let existing = session(id: TogetherCopy.demoSessionID) { return existing }
        guard let chat = BubbleSocialCast.conversation(BubbleSocialCast.newInSFCrew, in: appStore) else { return nil }
        return start(
            kind: .question,
            title: TogetherCopy.defaultTitle(.question),
            ask: TogetherCopy.defaultAsk(.question),
            target: BubbleShareTarget(kind: .chat, targetID: chat.id, title: chat.title),
            appStore: appStore,
            bubbleStore: bubbleStore,
            id: TogetherCopy.demoSessionID,
            delays: [3, 6.5, 10]
        )
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
    }

    static func stage(of card: BubbleChatCard) -> Stage {
        Stage(rawValue: card.extras[stageKey]?.string ?? "") ?? (card.bubbleID.isEmpty ? .contribution : .published)
    }
}
