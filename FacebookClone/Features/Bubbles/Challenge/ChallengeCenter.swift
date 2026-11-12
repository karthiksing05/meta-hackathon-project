import Foundation
import Observation

/// Runs Challenge Me and group-chat sessions (docs/BUBBLES.md 7.2): 1:1 same-seed challenges,
/// shared sessions in group chats and Groups, friends' bot runs on short delays, rivalry tallies,
/// and the live card updates that go with them. Owner: challenge.
///
/// Every score is a real run on the card's seed and length: yours from the player, friends' from
/// `BubbleStore.simulateRun` (the formula's bot in the real runtime), so all of them carry a
/// replay and stay verifiable. Nothing here records a score for you that you didn't play.
@MainActor
@Observable
final class ChallengeCenter {
    static let shared = ChallengeCenter()

    /// 1:1 challenges by id.
    private(set) var challenges: [String: BubbleChallenge] = [:]
    /// Group-chat and Group sessions by id.
    private(set) var sessions: [String: ChallengeSession] = [:]
    /// Live rivalry results this launch, by user id.
    private(set) var liveWins: [String: Int] = [:]
    private(set) var liveLosses: [String: Int] = [:]

    @ObservationIgnored private(set) weak var appStore: AppStore?
    @ObservationIgnored private(set) weak var bubbleStore: BubbleStore?
    /// Your entry for a card about to be sent (the run you challenge with), by card id.
    @ObservationIgnored private var pendingEntries: [String: ChallengeEntry] = [:]
    @ObservationIgnored private var installed = false

    private init() {}

    // MARK: - Setup

    /// Once at launch: seeds Maya's chat, a finished session in New in SF crew, and rivalry history.
    func install(appStore: AppStore, bubbleStore: BubbleStore) {
        self.appStore = appStore
        self.bubbleStore = bubbleStore
        guard !installed else { return }
        installed = true
        seedRivalChat(appStore: appStore, bubbleStore: bubbleStore)
        seedPastSession(appStore: appStore, bubbleStore: bubbleStore)
    }

    private var meID: String { appStore?.me.id ?? "me" }

    func person(_ id: String) -> User? {
        guard let appStore, let bubbleStore else { return nil }
        return id == appStore.me.id ? appStore.me : bubbleStore.resolvePerson(id)
    }

    // MARK: - Lookups

    func challenge(_ id: String?) -> BubbleChallenge? {
        id.flatMap { challenges[$0] }
    }

    func session(_ id: String?) -> ChallengeSession? {
        id.flatMap { sessions[$0] }
    }

    /// The latest challenge on a Bubble (optionally with one person).
    func latestChallenge(on bubbleID: String, with userID: String? = nil) -> BubbleChallenge? {
        challenges.values
            .filter { $0.bubbleID == bubbleID && (userID == nil || $0.opponentID == userID) }
            .max { $0.createdAt < $1.createdAt }
    }

    /// Open challenges with you on a Bubble, newest first (for the Bubble page).
    func activeChallenges(on bubbleID: String) -> [BubbleChallenge] {
        challenges.values.filter { $0.bubbleID == bubbleID }.sorted { $0.createdAt > $1.createdAt }
    }

    /// The chat a challenge or session lives in.
    func conversation(for id: String) -> Conversation? {
        guard let appStore else { return nil }
        let conversationID = challenges[id]?.conversationID ?? sessions[id]?.conversationID
        return conversationID.flatMap { cid in appStore.conversations.first { $0.id == cid } }
    }

    // MARK: - Your run as a challenge

    /// What you challenge people with: a run's seed, length and score.
    struct Draft: Hashable {
        let bubbleID: String
        let seed: Int
        let length: BubbleLength?
        /// Nil sends a challenge without a score: they play first.
        let score: Int?
        let replay: BubbleInputLog?
        let scoreID: String?
    }

    /// A draft from a finished run (the result sheet).
    func draft(for bubble: Bubble, result: BubbleRunResult) -> Draft {
        let recorded = bubble.scores.last { $0.user.isMe && $0.replay == result.replay }
        return Draft(
            bubbleID: bubble.id,
            seed: result.replay.seed,
            length: result.replay.length ?? bubble.manifest.length,
            score: result.score,
            replay: result.replay,
            scoreID: recorded?.id
        )
    }

    /// A draft from your best run on the Board, or a scoreless one when you haven't played.
    func bestDraft(for bubble: Bubble) -> Draft {
        guard let appStore, let bubbleStore,
              let best = bubbleStore.bestScore(of: appStore.me, in: bubble) else {
            return Draft(bubbleID: bubble.id, seed: bubble.manifest.seed, length: bubble.manifest.length, score: nil, replay: nil, scoreID: nil)
        }
        return Draft(
            bubbleID: bubble.id,
            seed: best.replay?.seed ?? bubble.manifest.seed,
            length: best.replay?.length ?? bubble.manifest.length,
            score: best.score,
            replay: best.replay,
            scoreID: best.id
        )
    }

    /// The card a draft makes for a target.
    func card(for draft: Draft, bubble: Bubble, target: BubbleShareTarget) -> BubbleChatCard {
        let isGroupTarget = isGroup(target)
        let headline: String
        if let score = draft.score {
            headline = ChallengeCopy.beatMy(score, in: bubble.title)
        } else {
            headline = isGroupTarget ? ChallengeCopy.sameCourse(bubble.title) : ChallengeCopy.canYouBeatMe(bubble.title)
        }
        return BubbleChatCard(
            kind: isGroupTarget ? .session : .challenge,
            bubbleID: bubble.id,
            seed: draft.seed,
            length: draft.length,
            fromUserID: meID,
            headline: headline,
            score: draft.score
        )
    }

    /// Sends a challenge from a draft. Returns false when the target can't take it.
    @discardableResult
    func send(_ draft: Draft, to target: BubbleShareTarget, bubble: Bubble) -> Bool {
        guard let appStore, let bubbleStore else { return false }
        let card = card(for: draft, bubble: bubble, target: target)
        if let score = draft.score {
            pendingEntries[card.id] = ChallengeEntry(userID: meID, score: score, replay: draft.replay, scoreID: draft.scoreID, isVerified: isVerified(scoreID: draft.scoreID, in: bubble))
        }
        let sent = BubbleSocialHub.send(card, to: target, appStore: appStore, bubbleStore: bubbleStore)
        pendingEntries[card.id] = nil
        if sent {
            appStore.showToast(ChallengeCopy.sentToast(target.title), symbol: "flag.checkered")
        } else {
            appStore.showToast(ChallengeCopy.couldNotSend, symbol: "exclamationmark.circle")
        }
        return sent
    }

    func isGroup(_ target: BubbleShareTarget) -> Bool {
        switch target.kind {
        case .group: return true
        case .chat: return appStore?.conversations.first { $0.id == target.targetID }?.isGroup ?? false
        case .friend, .feed, .story: return false
        }
    }

    // MARK: - Hub hooks (BubbleSocialHub.send)

    /// Called by `BubbleSocialHub.send` for a `.challenge` or `.session` card with no session yet.
    /// Registers the challenge or session, returns the card to deliver (session id and extras
    /// filled in) and a closure to run once it's delivered (bots start). Nil leaves the card as is.
    func open(_ card: BubbleChatCard, to target: BubbleShareTarget, chat: Conversation?, group: FBGroup?) -> (BubbleChatCard, () -> Void)? {
        guard let appStore, let bubbleStore, let bubble = bubbleStore.bubble(id: card.bubbleID) else { return nil }
        let seed = card.seed ?? bubble.manifest.seed
        let mine = pendingEntries[card.id] ?? (card.fromUserID == meID ? card.score.map { ChallengeEntry(userID: meID, score: $0) } : nil)
        let rematchOf = card.extras[ChallengeCardKeys.rematchOf]?.string
        var card = card
        card.seed = seed

        if let chat, !chat.isGroup, let opponent = chat.participants.first {
            // 1:1: a head-to-head challenge.
            let previous = self.challenge(rematchOf)
            var created = BubbleChallenge(
                id: UUID().uuidString, bubbleID: bubble.id, seed: seed, length: card.length,
                fromUserID: meID, opponentID: opponent.id, conversationID: chat.id, cardID: card.id,
                rematchOf: rematchOf, round: (previous?.round ?? -1) + 1, mine: mine, theirs: nil,
                isOpponentPlaying: false, countedOutcome: nil, resultCardID: nil, createdAt: Date()
            )
            created.mine?.userID = meID
            card.kind = .challenge
            card.sessionID = created.id
            card.extras[ChallengeCardKeys.role] = .string("invite")
            card.setChallengeScores(created.mine.map { [$0] } ?? [], members: 2, winnerID: nil)
            challenges[created.id] = created
            let id = created.id
            return (card, { [weak self] in
                guard let self else { return }
                BubbleSocialSignals.post(rematchOf == nil ? .challengeSent : .challengeRematch, bubbleID: bubble.id, with: [opponent.id])
                self.scheduleOpponent(challengeID: id)
            })
        }

        // A group chat or a Group: a shared session.
        let others: [User]
        let title: String
        if let chat, chat.isGroup {
            others = chat.participants.filter { !$0.isMe }
            title = chat.title
        } else if let group {
            others = Array(BubbleSocialCast.groupMembers(bubbleStore).prefix(5))
            title = group.name
        } else {
            return nil
        }
        var entries: [String: ChallengeEntry] = [:]
        if var mine {
            mine.userID = meID
            entries[meID] = mine
        }
        let session = ChallengeSession(
            id: UUID().uuidString, bubbleID: bubble.id, seed: seed, length: card.length,
            fromUserID: meID, memberIDs: [appStore.me.id] + others.map(\.id),
            conversationID: chat?.id, groupID: chat == nil ? group?.id : nil, title: title,
            cardID: card.id, rematchOf: rematchOf, entries: entries, createdAt: Date()
        )
        card.kind = .session
        card.sessionID = session.id
        card.extras[ChallengeCardKeys.role] = .string("invite")
        card.extras[ChallengeCardKeys.title] = .string(title)
        card.setChallengeScores(session.standings, members: session.memberIDs.count, winnerID: nil)
        sessions[session.id] = session
        let id = session.id
        let otherIDs = others.map(\.id)
        let isGroupPost = chat == nil
        return (card, { [weak self] in
            guard let self else { return }
            let kind: BubbleSocialSignalKind = rematchOf != nil ? .challengeRematch : (isGroupPost ? .groupChallenge : .challengeSent)
            BubbleSocialSignals.post(kind, bubbleID: bubble.id, with: otherIDs)
            self.scheduleMembers(sessionID: id)
        })
    }

    /// The play context for a card (who you're against and the score to beat).
    func playContext(for card: BubbleChatCard) -> BubblePlayContext? {
        if let challenge = self.challenge(card.sessionID) {
            let opponent = person(challenge.opponentID)
            return BubblePlayContext(kind: .challenge, id: challenge.id, cardID: challenge.cardID, opponentName: opponent?.firstName, target: challenge.theirs?.score)
        }
        if let session = self.session(card.sessionID) {
            let best = session.standings.first { $0.userID != meID }
            return BubblePlayContext(kind: .session, id: session.id, cardID: session.cardID, opponentName: session.title, target: best?.score)
        }
        return nil
    }

    /// The live score to beat while playing (it can arrive mid-run).
    func liveTarget(for context: BubblePlayContext) -> (name: String, score: Int)? {
        switch context.kind {
        case .challenge:
            if let challenge = self.challenge(context.id), let theirs = challenge.theirs {
                return (person(challenge.opponentID)?.firstName ?? context.opponentName ?? "", theirs.score)
            }
        case .session:
            if let session = self.session(context.id), let best = session.standings.first(where: { $0.userID != meID }) {
                return (person(best.userID)?.firstName ?? "", best.score)
            }
        default:
            break
        }
        if let target = context.target { return (context.opponentName ?? "", target) }
        return nil
    }

    // MARK: - Your plays (didFinish)

    func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest) {
        guard let context = request.context else { return }
        #if DEBUG
        if let seed = request.seed, score.replay?.seed != seed {
            print("[challenge] replay seed \(score.replay?.seed ?? -1) differs from card seed \(seed)")
        }
        #endif
        let entry = ChallengeEntry(userID: meID, score: score.score, replay: score.replay, scoreID: score.id, isVerified: score.isVerified)
        switch context.kind {
        case .challenge: recordMine(entry, challengeID: context.id)
        case .session: recordMine(entry, sessionID: context.id)
        default: break
        }
    }

    private func recordMine(_ entry: ChallengeEntry, challengeID: String) {
        guard var challenge = challenges[challengeID], let appStore, let bubbleStore,
              let chat = conversation(for: challengeID), let bubble = bubbleStore.bubble(id: challenge.bubbleID) else { return }
        if let mine = challenge.mine, mine.score >= entry.score, challenge.resultCardID != nil { return }
        if challenge.mine.map({ entry.score > $0.score }) ?? true {
            challenge.mine = entry
        }
        challenges[challengeID] = challenge
        let previousOutcome = challenge.countedOutcome
        refreshCards(challengeID: challengeID)
        settleTally(challengeID: challengeID)
        guard let mine = challenge.mine else { return }
        let opponent = person(challenge.opponentID)
        let name = opponent?.firstName ?? ""

        // The head-to-head lands in the chat as your result card.
        var result = BubbleChatCard(
            kind: .challenge, bubbleID: bubble.id, seed: challenge.seed, length: challenge.length,
            fromUserID: meID, headline: ChallengeCopy.headToHead(mine: mine.score, name: name, theirs: challenge.theirs?.score),
            sessionID: challenge.id, score: mine.score
        )
        result.extras[ChallengeCardKeys.role] = .string("result")
        result.setChallengeScores(entries(of: challenge), members: 2, winnerID: winnerID(of: challenge))
        if let resultID = challenge.resultCardID {
            BubbleSocialHub.update(cardID: resultID, appStore: appStore) { card in
                card.headline = result.headline
                card.score = result.score
                card.extras = result.extras
            }
        } else {
            challenges[challengeID]?.resultCardID = result.id
            BubbleSocialHub.send(result, to: BubbleShareTarget(kind: .chat, targetID: chat.id, title: chat.title), appStore: appStore, bubbleStore: bubbleStore)
        }
        if challenge.outcome == .won, previousOutcome != .won {
            BubbleSocialSignals.post(.challengeWon, bubbleID: bubble.id, with: [challenge.opponentID])
            if let opponent {
                say(ChallengeCopy.rivalConcedes(round: challenge.round), from: opponent, in: chat, after: 3.5)
            }
        }
    }

    private func recordMine(_ entry: ChallengeEntry, sessionID: String) {
        guard var session = sessions[sessionID], let bubbleStore, let bubble = bubbleStore.bubble(id: session.bubbleID) else { return }
        let first = session.entries[meID] == nil
        if let current = session.entries[meID], current.score >= entry.score { return }
        session.entries[meID] = entry
        sessions[sessionID] = session
        refreshCards(sessionID: sessionID)
        if first {
            BubbleSocialSignals.post(.groupChatPlay, bubbleID: bubble.id, with: session.memberIDs.filter { $0 != meID })
        }
        if session.isFinished {
            finishSession(sessionID)
        }
    }

    // MARK: - Rematches

    /// "Challenge back": a new course for the same two people, in the same chat. They play first.
    @discardableResult
    func rematch(challengeID: String) -> BubbleChallenge? {
        guard let previous = challenges[challengeID], let appStore, let bubbleStore,
              let bubble = bubbleStore.bubble(id: previous.bubbleID), let chat = conversation(for: challengeID) else { return nil }
        var card = BubbleChatCard(
            kind: .challenge, bubbleID: bubble.id, seed: rematchSeed(previous.id, base: previous.seed), length: previous.length,
            fromUserID: meID, headline: ChallengeCopy.rematchHeadline(bubble.title)
        )
        card.extras[ChallengeCardKeys.rematchOf] = .string(previous.id)
        guard BubbleSocialHub.send(card, to: BubbleShareTarget(kind: .chat, targetID: chat.id, title: chat.title), appStore: appStore, bubbleStore: bubbleStore) else { return nil }
        appStore.showToast(ChallengeCopy.rematchSent(person(previous.opponentID)?.firstName ?? chat.title), symbol: "arrow.triangle.2.circlepath")
        return latestChallenge(on: bubble.id, with: previous.opponentID)
    }

    /// Rematch for a session: a new course for the same chat or Group.
    @discardableResult
    func rematch(sessionID: String) -> ChallengeSession? {
        guard let previous = sessions[sessionID], let appStore, let bubbleStore,
              let bubble = bubbleStore.bubble(id: previous.bubbleID) else { return nil }
        let target: BubbleShareTarget
        if let conversationID = previous.conversationID {
            target = BubbleShareTarget(kind: .chat, targetID: conversationID, title: previous.title)
        } else if let groupID = previous.groupID {
            target = BubbleShareTarget(kind: .group, targetID: groupID, title: previous.title)
        } else {
            return nil
        }
        var card = BubbleChatCard(
            kind: .session, bubbleID: bubble.id, seed: rematchSeed(previous.id, base: previous.seed), length: previous.length,
            fromUserID: meID, headline: ChallengeCopy.rematchHeadline(bubble.title)
        )
        card.extras[ChallengeCardKeys.rematchOf] = .string(previous.id)
        guard BubbleSocialHub.send(card, to: target, note: ChallengeCopy.rematchNote, appStore: appStore, bubbleStore: bubbleStore) else { return nil }
        appStore.showToast(ChallengeCopy.rematchSent(previous.title), symbol: "arrow.triangle.2.circlepath")
        return sessions.values.filter { $0.rematchOf == previous.id }.max { $0.createdAt < $1.createdAt }
    }

    private func rematchSeed(_ id: String, base: Int) -> Int {
        let hash = SeededGenerator.stableHash("rematch|\(id)|\(base)")
        return Int(hash % 900_000) + 1_000
    }

    // MARK: - Friends' plays (bots)

    /// The opponent plays on the same seed after 3–6 s. When you've played, the bot's skill is
    /// the one of 0.95, 0.85 and 0.7 whose score lands closest above yours (so the rival is a
    /// close call); if none beats you, the lowest, and you win.
    private func scheduleOpponent(challengeID: String) {
        guard var challenge = challenges[challengeID], let bubbleStore,
              let bubble = bubbleStore.bubble(id: challenge.bubbleID), let opponent = person(challenge.opponentID) else { return }
        challenge.isOpponentPlaying = true
        challenges[challengeID] = challenge
        let manifest = bubble.manifest.withSeed(challenge.seed).withLength(challenge.length)
        let delay = 3 + Double(SeededGenerator.stableHash("delay|\(challengeID)") % 300) / 100
        let fireAt = Date().addingTimeInterval(delay)
        let botSeed = Int(truncatingIfNeeded: SeededGenerator.stableHash("bot|\(challengeID)") & 0x7FFF_FFFF)
        let myScore = challenge.mine?.score
        let skills: [Double] = myScore == nil ? [0.85] : [0.95, 0.85, 0.7]
        var results: [BubbleScore] = []

        for skill in skills {
            bubbleStore.simulateRun(of: opponent, on: bubble, manifest: manifest, skill: skill, botSeed: botSeed) { score in
                MainActor.assumeIsolated {
                    results.append(score)
                    guard results.count == skills.count else { return }
                    let chosen = Self.pick(results, against: myScore)
                    ChallengeCenter.shared.deliver(chosen, toChallenge: challengeID, at: fireAt)
                }
            }
        }
    }

    private static func pick(_ results: [BubbleScore], against mine: Int?) -> BubbleScore {
        guard let mine else { return results[0] }
        let above = results.filter { $0.score > mine }.min { $0.score < $1.score }
        return above ?? results.min { $0.score < $1.score } ?? results[0]
    }

    private func deliver(_ score: BubbleScore, toChallenge challengeID: String, at fireAt: Date) {
        guard let chat = conversation(for: challengeID), let opponent = person(challenges[challengeID]?.opponentID ?? "") else { return }
        let wait = max(0, fireAt.timeIntervalSinceNow)
        after(max(0, wait - 1.4)) {
            chat.isTyping = true
        }
        after(wait) { [weak self] in
            chat.isTyping = false
            self?.applyOpponent(score, challengeID: challengeID, opponent: opponent, chat: chat)
        }
    }

    private func applyOpponent(_ score: BubbleScore, challengeID: String, opponent: User, chat: Conversation) {
        guard var challenge = challenges[challengeID], let appStore, let bubbleStore,
              let bubble = bubbleStore.bubble(id: challenge.bubbleID) else { return }
        challenge.theirs = ChallengeEntry(userID: opponent.id, score: score.score, replay: score.replay, isVerified: score.isVerified)
        challenge.isOpponentPlaying = false
        challenges[challengeID] = challenge
        refreshCards(challengeID: challengeID)
        settleTally(challengeID: challengeID)

        let mine = challenge.mine?.score
        var reply = BubbleChatCard(
            kind: .challenge, bubbleID: bubble.id, seed: challenge.seed, length: challenge.length,
            fromUserID: opponent.id, headline: ChallengeCopy.replyHeadline(score.score, mine: mine),
            sessionID: challenge.id, score: score.score
        )
        reply.extras[ChallengeCardKeys.role] = .string("reply")
        reply.setChallengeScores(entries(of: challenge), members: 2, winnerID: winnerID(of: challenge))
        BubbleSocialHub.receive(reply, from: opponent, in: chat, text: ChallengeCopy.replyHeadline(score.score, mine: mine), appStore: appStore)
        BubbleSocialSignals.post(.challengeAccepted, bubbleID: bubble.id, with: [opponent.id])

        let message = ChallengeCopy.opponentNote(score: score.score, mine: mine, bubble: bubble.title)
        let note = AppNotification(kind: .bubbleScore, actors: [opponent], message: message, bubbleID: bubble.id)
        note.bubbleAction = BubbleFeatureRoute(.challenge, "chat", challengeID)
        appStore.notifications.insert(note, at: 0)
        if appStore.openConversationID != chat.id {
            appStore.showToast(ChallengeCopy.opponentToast(name: opponent.firstName, score: score.score, mine: mine), symbol: "flag.checkered")
        }
    }

    /// Everyone else in a session plays on staggered delays (5–25 s).
    private func scheduleMembers(sessionID: String) {
        guard let session = sessions[sessionID], let bubbleStore, let bubble = bubbleStore.bubble(id: session.bubbleID) else { return }
        let manifest = bubble.manifest.withSeed(session.seed).withLength(session.length)
        for memberID in session.memberIDs where memberID != meID && session.entries[memberID] == nil {
            guard let member = person(memberID) else { continue }
            let delay = 5 + Double(SeededGenerator.stableHash("delay|\(sessionID)|\(memberID)") % 2000) / 100
            let fireAt = Date().addingTimeInterval(delay)
            bubbleStore.simulateRun(of: member, on: bubble, manifest: manifest) { score in
                MainActor.assumeIsolated {
                    let wait = max(0, fireAt.timeIntervalSinceNow)
                    ChallengeCenter.shared.after(wait) {
                        ChallengeCenter.shared.applyMember(score, sessionID: sessionID)
                    }
                }
            }
        }
    }

    private func applyMember(_ score: BubbleScore, sessionID: String) {
        guard var session = sessions[sessionID], session.entries[score.user.id] == nil else { return }
        session.entries[score.user.id] = ChallengeEntry(userID: score.user.id, score: score.score, replay: score.replay, isVerified: score.isVerified)
        sessions[sessionID] = session
        refreshCards(sessionID: sessionID)
        guard let appStore, let bubbleStore, let bubble = bubbleStore.bubble(id: session.bubbleID) else { return }
        if session.isFinished {
            finishSession(sessionID)
        } else if session.entries[meID] == nil, session.entries.count == session.memberIDs.count - 1 {
            // Everyone but you: the nudge.
            let note = AppNotification(kind: .bubbleScore, actors: [score.user], extraActorCount: max(0, session.memberIDs.count - 3), message: ChallengeCopy.everyonePlayedNote(session.title, bubble: bubble.title), bubbleID: bubble.id)
            note.bubbleAction = BubbleFeatureRoute(.challenge, "chat", sessionID)
            appStore.notifications.insert(note, at: 0)
            if appStore.openConversationID != session.conversationID {
                appStore.showToast(ChallengeCopy.yourTurnToast(session.title), symbol: "hand.point.right.fill")
            }
        }
    }

    private func finishSession(_ sessionID: String) {
        guard let session = sessions[sessionID], let winner = session.leader, let appStore else { return }
        refreshCards(sessionID: sessionID)
        guard let chatID = session.conversationID, let chat = appStore.conversations.first(where: { $0.id == chatID }) else { return }
        // Someone who didn't win cheers the winner.
        if let cheerer = session.memberIDs.first(where: { $0 != winner.userID && $0 != meID }).flatMap(person) {
            let text = winner.userID == meID ? ChallengeCopy.cheerYou(appStore.me.firstName) : ChallengeCopy.cheer(person(winner.userID)?.firstName ?? "")
            say(text, from: cheerer, in: chat, after: 2.5)
        }
    }

    // MARK: - Cards

    private func entries(of challenge: BubbleChallenge) -> [ChallengeEntry] {
        [challenge.mine, challenge.theirs].compactMap { $0 }.sorted { $0.score > $1.score }
    }

    private func winnerID(of challenge: BubbleChallenge) -> String? {
        switch challenge.outcome {
        case .won: return meID
        case .lost: return challenge.opponentID
        case .tied, nil: return nil
        }
    }

    /// Rewrites the scores on every card in a challenge's thread.
    private func refreshCards(challengeID: String) {
        guard let challenge = challenges[challengeID], let appStore else { return }
        let scored = entries(of: challenge)
        let winner = winnerID(of: challenge)
        var ids = [challenge.cardID]
        if let resultID = challenge.resultCardID { ids.append(resultID) }
        for id in ids {
            BubbleSocialHub.update(cardID: id, appStore: appStore) { card in
                card.setChallengeScores(scored, members: 2, winnerID: winner)
            }
        }
    }

    private func refreshCards(sessionID: String) {
        guard let session = sessions[sessionID], let appStore else { return }
        BubbleSocialHub.update(cardID: session.cardID, appStore: appStore) { card in
            card.setChallengeScores(session.standings, members: session.memberIDs.count, winnerID: session.isFinished ? session.leader?.userID : nil)
        }
    }

    private func isVerified(scoreID: String?, in bubble: Bubble) -> Bool {
        guard let scoreID else { return false }
        return bubble.scores.first { $0.id == scoreID }?.isVerified ?? false
    }

    /// Whether an entry's run checked out (your runs verify in the background after recording).
    func isVerified(_ entry: ChallengeEntry, bubbleID: String) -> Bool {
        if entry.isVerified { return true }
        guard let bubble = bubbleStore?.bubble(id: bubbleID) else { return false }
        return isVerified(scoreID: entry.scoreID, in: bubble)
    }

    // MARK: - Rivalries

    /// Your record against someone this week: seeded history plus live results.
    func rivalry(with userID: String) -> (wins: Int, losses: Int) {
        let history = self.history(with: userID)
        let wins = history.filter { $0.outcome == .won }.count + (liveWins[userID] ?? 0)
        let losses = history.filter { $0.outcome == .lost }.count + (liveLosses[userID] ?? 0)
        return (wins, losses)
    }

    /// Seeded past results for the demo's two rivals (Maya and Diego), from
    /// `SeededGenerator.stableHash("rivalry|<id>")`, so they're the same every launch.
    func history(with userID: String) -> [ChallengeHistoryItem] {
        let pattern: [ChallengeOutcome]
        switch userID {
        case BubbleSocialCast.rivalID: pattern = [.won, .lost, .won, .lost, .won]
        case "sf-diego-ramirez": pattern = [.lost, .won, .won, .lost]
        default: return []
        }
        let games = ["hill-hopper", "fog-drift", "cable-car-catch", "sourdough-stack", "bay-bubbles"]
        var rng = SeededGenerator(seed: SeededGenerator.stableHash("rivalry|\(userID)"))
        return pattern.enumerated().map { index, outcome in
            let game = games[Int(rng.next() % UInt64(games.count))]
            let low = 18 + Int(rng.next() % 20)
            let gap = 2 + Int(rng.next() % 9)
            let mine = outcome == .won ? low + gap : low
            let theirs = outcome == .won ? low : low + gap
            return ChallengeHistoryItem(id: "\(userID)-\(index)", bubbleID: game, myScore: mine, theirScore: theirs, daysAgo: 1 + index)
        }
    }

    /// Counts a finished challenge once, and moves the count if a better run flips it.
    private func settleTally(challengeID: String) {
        guard var challenge = challenges[challengeID], let outcome = challenge.outcome, outcome != challenge.countedOutcome else { return }
        let id = challenge.opponentID
        switch challenge.countedOutcome {
        case .won: liveWins[id, default: 0] -= 1
        case .lost: liveLosses[id, default: 0] -= 1
        case .tied, nil: break
        }
        switch outcome {
        case .won: liveWins[id, default: 0] += 1
        case .lost: liveLosses[id, default: 0] += 1
        case .tied: break
        }
        challenge.countedOutcome = outcome
        challenges[challengeID] = challenge
    }

    // MARK: - Helpers

    /// A text from someone in a chat (friendly banter around a challenge).
    private func say(_ text: String, from user: User, in chat: Conversation, after delay: Double) {
        after(max(0, delay - 1.2)) { chat.isTyping = true }
        after(delay) { [weak self] in
            chat.isTyping = false
            chat.messages.append(Message(senderID: user.id, text: text))
            if self?.appStore?.openConversationID != chat.id {
                chat.unreadCount += 1
            }
        }
    }

    func after(_ seconds: Double, _ action: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            if seconds > 0 {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            }
            action()
        }
    }

    // MARK: - Demo staging (DEBUG launch targets and install)

    /// Maya's 1:1 chat: two friendly messages from the New in SF Group.
    private func seedRivalChat(appStore: AppStore, bubbleStore: BubbleStore) {
        let maya = BubbleSocialCast.rival(bubbleStore)
        guard !maya.isMe else { return }
        let chat = appStore.conversation(with: maya)
        guard chat.messages.isEmpty else { return }
        let now = Date()
        chat.messages = ChallengeCopy.rivalIntro.enumerated().map { index, text in
            Message(senderID: maya.id, text: text, sentAt: now.addingTimeInterval(-Double(14 - index) * 60))
        }
    }

    /// A finished Fog Drift session in New in SF crew, so the chat already shows a winner line.
    /// Your score is in it only when you've really played Fog Drift.
    private func seedPastSession(appStore: AppStore, bubbleStore: BubbleStore) {
        guard let chat = BubbleSocialCast.conversation(BubbleSocialCast.newInSFCrew, in: appStore),
              let bubble = bubbleStore.bubble(id: "fog-drift") else { return }
        let others = chat.participants.filter { !$0.isMe }
        guard let starter = others.first else { return }
        let startedAt = Date().addingTimeInterval(-125 * 60)
        var entries: [String: ChallengeEntry] = [:]
        for (index, member) in others.enumerated() {
            let score = BubbleStore.syntheticScore(for: bubble, userID: member.id) + Int(SeededGenerator.stableHash("past|\(member.id)") % 7)
            entries[member.id] = ChallengeEntry(userID: member.id, score: score, playedAt: startedAt.addingTimeInterval(Double(index + 1) * 240))
        }
        var memberIDs = others.map(\.id)
        if let best = bubbleStore.bestScore(of: appStore.me, in: bubble) {
            memberIDs.insert(appStore.me.id, at: 0)
            entries[appStore.me.id] = ChallengeEntry(userID: appStore.me.id, score: best.score, replay: best.replay, scoreID: best.id, isVerified: best.isVerified, playedAt: best.achievedAt)
        }
        var card = BubbleChatCard(
            kind: .session, bubbleID: bubble.id, seed: bubble.manifest.seed, length: bubble.manifest.length,
            fromUserID: starter.id, headline: ChallengeCopy.sameCourse(bubble.title)
        )
        let session = ChallengeSession(
            id: UUID().uuidString, bubbleID: bubble.id, seed: bubble.manifest.seed, length: bubble.manifest.length,
            fromUserID: starter.id, memberIDs: memberIDs, conversationID: chat.id, groupID: nil, title: chat.title,
            cardID: card.id, rematchOf: nil, entries: entries, createdAt: startedAt
        )
        card.sessionID = session.id
        card.extras[ChallengeCardKeys.role] = .string("invite")
        card.extras[ChallengeCardKeys.title] = .string(chat.title)
        card.setChallengeScores(session.standings, members: memberIDs.count, winnerID: session.leader?.userID)
        sessions[session.id] = session

        var message = Message(senderID: starter.id, text: ChallengeCopy.pastSessionNote, sentAt: startedAt)
        message.bubbleCard = card
        let winnerName = session.leader.flatMap { person($0.userID)?.firstName } ?? ""
        let cheererID = others.first { $0.id != session.leader?.userID }?.id ?? starter.id
        let cheer = Message(senderID: cheererID, text: ChallengeCopy.cheer(winnerName), sentAt: startedAt.addingTimeInterval(22 * 60))
        chat.messages.append(contentsOf: [message, cheer])
        chat.messages.sort { $0.sentAt < $1.sentAt }
    }

    #if DEBUG
    /// FB_OPEN staging: a challenge from you to Maya on `bubble` with your best (or a staged 34).
    func stageChallengeToRival(on bubble: Bubble) -> Conversation? {
        guard let appStore, let bubbleStore else { return nil }
        let maya = BubbleSocialCast.rival(bubbleStore)
        let best = bestDraft(for: bubble)
        let draft = best.score != nil ? best : Draft(bubbleID: bubble.id, seed: bubble.manifest.seed, length: bubble.manifest.length, score: 34, replay: nil, scoreID: nil)
        send(draft, to: BubbleShareTarget(kind: .friend, targetID: maya.id, title: maya.name), bubble: bubble)
        return appStore.conversation(with: maya)
    }

    /// FB_OPEN staging: a finished head-to-head (You 45, Maya 41) for the h2h screen.
    func stageFinishedChallenge(on bubble: Bubble) -> String? {
        guard let appStore, let bubbleStore else { return nil }
        let maya = BubbleSocialCast.rival(bubbleStore)
        let chat = appStore.conversation(with: maya)
        let id = UUID().uuidString
        var card = BubbleChatCard(kind: .challenge, bubbleID: bubble.id, seed: bubble.manifest.seed, length: bubble.manifest.length, fromUserID: appStore.me.id, headline: ChallengeCopy.beatMy(45, in: bubble.title), sessionID: id, score: 45)
        let mine = ChallengeEntry(userID: appStore.me.id, score: 45)
        let theirs = ChallengeEntry(userID: maya.id, score: 41, isVerified: true)
        card.extras[ChallengeCardKeys.role] = .string("invite")
        card.setChallengeScores([mine, theirs], members: 2, winnerID: appStore.me.id)
        challenges[id] = BubbleChallenge(
            id: id, bubbleID: bubble.id, seed: bubble.manifest.seed, length: bubble.manifest.length,
            fromUserID: appStore.me.id, opponentID: maya.id, conversationID: chat.id, cardID: card.id,
            rematchOf: nil, round: 0, mine: mine, theirs: theirs, isOpponentPlaying: false,
            countedOutcome: nil, resultCardID: nil, createdAt: Date()
        )
        settleTally(challengeID: id)
        var message = Message(senderID: appStore.me.id, status: .seen)
        message.bubbleCard = card
        chat.messages.append(message)
        return id
    }

    /// FB_OPEN staging: a fresh session in New in SF crew; the bots fill it in over ~20 s.
    func stageGroupChatSession(on bubble: Bubble) -> Conversation? {
        guard let appStore, let bubbleStore,
              let chat = BubbleSocialCast.conversation(BubbleSocialCast.newInSFCrew, in: appStore) else { return nil }
        let card = BubbleChatCard(kind: .session, bubbleID: bubble.id, seed: bubble.manifest.seed, length: bubble.manifest.length, fromUserID: appStore.me.id, headline: ChallengeCopy.sameCourse(bubble.title))
        BubbleSocialHub.send(card, to: BubbleShareTarget(kind: .chat, targetID: chat.id, title: chat.title), note: ChallengeCopy.groupNote, appStore: appStore, bubbleStore: bubbleStore)
        return chat
    }
    #endif
}
