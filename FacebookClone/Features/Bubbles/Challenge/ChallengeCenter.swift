import Foundation
import Observation

/// Challenge Me and group-chat sessions (docs/BUBBLES.md 7.2): 1:1 same-seed challenges, shared
/// sessions, rivalry tallies and live card updates. Owner: challenge.
///
/// The other side of a challenge (their runs, replies, history) needs server endpoints that don't
/// exist yet (docs/APP_LIVE_DATA_PLAN.md, Stage 4). Until then no challenge or session starts and
/// nobody's run is simulated; the entry points say "Not available yet".
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

    /// Once at launch. Nothing is staged: no chats, sessions or rivalry history are made up.
    func install(appStore: AppStore, bubbleStore: BubbleStore) {
        self.appStore = appStore
        self.bubbleStore = bubbleStore
        installed = true
    }

    private var meID: String { appStore?.me.id ?? "me" }

    func person(_ id: String) -> User? {
        guard let appStore, let bubbleStore else { return nil }
        return id == appStore.me.id ? appStore.me : bubbleStore.serverPeople[id]
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
    ///
    /// Challenges and sessions need the server (send and list challenges, the other side's runs);
    /// it has no endpoint yet (docs/APP_LIVE_DATA_PLAN.md, Stage 4), so nothing is started here and
    /// nobody's run is made up. The card goes out as a plain game card.
    func open(_ card: BubbleChatCard, to target: BubbleShareTarget, chat: Conversation?, group: FBGroup?) -> (BubbleChatCard, () -> Void)? {
        nil
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
    }

    private func recordMine(_ entry: ChallengeEntry, sessionID: String) {
        guard var session = sessions[sessionID], let bubbleStore, let bubble = bubbleStore.bubble(id: session.bubbleID) else { return }
        let first = session.entries[meID] == nil
        if let current = session.entries[meID], current.score >= entry.score { return }
        if !session.memberIDs.contains(meID) {
            // Joining a session you weren't counted in (a finished one from before you arrived).
            session.memberIDs.append(meID)
        }
        session.entries[meID] = entry
        sessions[sessionID] = session
        refreshCards(sessionID: sessionID)
        if first {
            BubbleSocialSignals.post(.groupChatPlay, bubbleID: bubble.id, with: session.memberIDs.filter { $0 != meID })
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

    /// Your record against someone: results from this launch.
    func rivalry(with userID: String) -> (wins: Int, losses: Int) {
        let history = self.history(with: userID)
        let wins = history.filter { $0.outcome == .won }.count + (liveWins[userID] ?? 0)
        let losses = history.filter { $0.outcome == .lost }.count + (liveLosses[userID] ?? 0)
        return (wins, losses)
    }

    /// Past results with someone. The server keeps no challenge history yet, so none.
    func history(with userID: String) -> [ChallengeHistoryItem] {
        []
    }

    /// Counts a finished challenge once, and moves the count if a better run flips it. Posts
    /// `challenge_won` whenever the result turns into your win: your run passing theirs, or their
    /// run landing below yours. `announce` is false only for DEBUG staging.
    private func settleTally(challengeID: String, announce: Bool = true) {
        guard var challenge = challenges[challengeID], let outcome = challenge.outcome, outcome != challenge.countedOutcome else { return }
        if announce, outcome == .won {
            BubbleSocialSignals.post(.challengeWon, bubbleID: challenge.bubbleID, with: [challenge.opponentID])
        }
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

    func after(_ seconds: Double, _ action: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            if seconds > 0 {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            }
            action()
        }
    }
}
