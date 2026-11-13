import Foundation
import Observation

// State for the "together" feature (docs/BUBBLES.md 7.4): co-making sessions and the
// contributions that arrive in a chat or a Group, the hand-off to Muse Studio, and what happens
// when a co-made game or a game about you is published.
//
// Sessions live on the server (`/v1/sessions`, backend/README.md "Making a game together"): who is
// in one, every entry, and making the game (the server runs Muse through the same path as
// `/v1/generate`). This keeps only what the server last sent. Nothing is simulated.

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
    /// Always empty: the server has no "typing" state. Kept for the waiting row.
    var pendingIDs: [String]
    var entries: [TogetherEntry]
    var inviteCardID: String
    var createdAt: Date
    /// The published game, once made.
    var bubbleID: String?
    /// The server's state: open, making, made or failed.
    var status: String = "open"
    /// Why the last make failed.
    var error: String?
    /// The server's game, once made (adopted into `bubbleID`).
    var gameID: String?

    var isMaking: Bool { status == "making" }
    var isMade: Bool { status == "made" || bubbleID != nil }

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

    // MARK: - Server

    /// Session ids by target (`chat:<id>` or `group:<id>`), newest first.
    private(set) var lists: [String: [String]] = [:]
    /// Sessions being added to or made, so a button can't fire twice.
    private(set) var busy: Set<String> = []

    func sessions(at target: RoundTarget) -> [TogetherSession] {
        (lists[target.wire] ?? []).compactMap { session(id: $0) }
    }

    /// Fetches the sessions at a chat or a Group. Failures keep what's on screen.
    func load(_ target: RoundTarget, bubbleStore: BubbleStore) {
        Task { @MainActor in
            guard await GamesAccount.shared.waitForUser() != nil,
                  let items = try? await GamesAPIFactory.current.sessions(target: target) else { return }
            items.forEach { apply($0, bubbleStore: bubbleStore) }
            lists[target.wire] = items.map(\.id)
        }
    }

    /// Fetches one session again. Throws the server's message.
    @discardableResult
    func refresh(id: String, bubbleStore: BubbleStore) async throws -> TogetherSession? {
        guard await GamesAccount.shared.waitForUser() != nil else { throw GamesAPIError.signInRequired }
        let remote = try await GamesAPIFactory.current.session(id: id)
        return apply(remote, bubbleStore: bubbleStore)
    }

    /// Takes the server's session as it is now. A made game is adopted so it can be played.
    @discardableResult
    func apply(_ remote: RemoteSession, bubbleStore: BubbleStore) -> TogetherSession {
        let kind = TogetherAskKind(rawValue: remote.kind) ?? .question
        let people = (remote.members + [remote.starter] + remote.entries.map(\.maker))
        for p in people { _ = bubbleStore.person(id: p.id, name: p.shownName, isFriend: p.isFriend) }
        let meID = GamesAccount.shared.userID
        let target: BubbleShareTarget
        switch remote.target?.kind {
        case .group?:
            let id = remote.target?.id ?? ""
            target = BubbleShareTarget(kind: .group, targetID: id, title: bubbleStore.serverGroups[id]?.name ?? TogetherCopy.theGroup)
        default:
            let names = remote.members.filter { $0.id != meID }.map(\.shownName)
            target = BubbleShareTarget(kind: .chat, targetID: remote.target?.id ?? "", title: TogetherStudio.names(names))
        }
        let old = session(id: remote.id)
        let updated = TogetherSession(
            id: remote.id,
            kind: kind,
            title: remote.title,
            ask: remote.ask.isEmpty ? TogetherCopy.defaultAsk(kind) : remote.ask,
            starterID: remote.starter.id,
            starterName: remote.starter.shownName,
            target: target,
            invitedIDs: remote.members.map(\.id).filter { $0 != meID && $0 != remote.starter.id },
            pendingIDs: [],
            entries: remote.entries.map {
                TogetherEntry(id: $0.id, makerID: $0.maker.id, makerName: $0.maker.shownName, kind: kind, text: $0.text, arrivedAt: $0.at, cardID: nil)
            },
            inviteCardID: old?.inviteCardID ?? "card-\(remote.id)-invite",
            createdAt: remote.createdAt,
            bubbleID: old?.bubbleID,
            status: remote.status,
            error: remote.error,
            gameID: remote.gameID
        )
        if let index = sessions.firstIndex(where: { $0.id == remote.id }) {
            sessions[index] = updated
        } else {
            sessions.insert(updated, at: 0)
        }
        if updated.bubbleID == nil, let game = remote.game {
            Task { @MainActor in
                if let bubble = await bubbleStore.adopt(game) {
                    mutate(remote.id) { $0.bubbleID = bubble.id }
                }
            }
        }
        return updated
    }

    /// Whether I started a session (only the starter can make the game).
    func isStarter(_ session: TogetherSession) -> Bool {
        session.starterID == GamesAccount.shared.userID
    }

    // MARK: - Start

    /// Starts a session on the server (`POST /v1/sessions`): a chat names its members (friends);
    /// a Group with no members invites the whole Group. The server notifies everyone invited.
    func start(kind: TogetherAskKind, title: String, ask: String, target: RoundTarget, members: [String],
               bubbleStore: BubbleStore) async throws -> TogetherSession {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanAsk = ask.trimmingCharacters(in: .whitespacesAndNewlines)
        guard await GamesAccount.shared.waitForUser() != nil else { throw GamesAPIError.signInRequired }
        let remote = try await GamesAPIFactory.current.startSession(
            kind: kind.rawValue,
            title: cleanTitle.isEmpty ? TogetherCopy.defaultTitle(kind) : cleanTitle,
            ask: cleanAsk.isEmpty ? TogetherCopy.defaultAsk(kind) : cleanAsk,
            target: target, members: members)
        let session = apply(remote, bubbleStore: bubbleStore)
        var ids = lists[target.wire] ?? []
        ids.removeAll { $0 == session.id }
        lists[target.wire] = [session.id] + ids
        return session
    }

    // MARK: - Your own contribution

    /// Adds your entry on the server. Throws the server's message.
    func addMine(_ text: String, to sessionID: String, bubbleStore: BubbleStore) async throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !busy.contains(sessionID) else { return }
        busy.insert(sessionID)
        defer { busy.remove(sessionID) }
        let remote = try await GamesAPIFactory.current.addSessionEntry(id: sessionID, text: trimmed)
        apply(remote, bubbleStore: bubbleStore)
    }

    // MARK: - Make

    /// Has the server make the game from every entry (`POST /v1/sessions/{id}/make`, the starter
    /// only), then follows the session until the game is made or the job fails.
    func make(_ sessionID: String, bubbleStore: BubbleStore) async throws {
        guard !busy.contains(sessionID) else { return }
        busy.insert(sessionID)
        defer { busy.remove(sessionID) }
        _ = try await GamesAPIFactory.current.makeSession(id: sessionID)
        mutate(sessionID) { $0.status = "making"; $0.error = nil }
        try await follow(sessionID, bubbleStore: bubbleStore)
    }

    /// Reads the session every few seconds while its game is being made (up to 15 minutes).
    func follow(_ sessionID: String, bubbleStore: BubbleStore) async throws {
        for _ in 0..<300 {
            guard let current = session(id: sessionID), current.isMaking else { return }
            try await Task.sleep(nanoseconds: 3_000_000_000)
            _ = try? await refresh(id: sessionID, bubbleStore: bubbleStore)
        }
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
