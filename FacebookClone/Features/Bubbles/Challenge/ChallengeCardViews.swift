import SwiftUI

// Challenge, session and share cards in Messenger chats and Group posts (docs/BUBBLES.md 7.2).
// Cards read their live state from the card's extras (`scores`, `played`, `members`,
// `winner_id`), which `ChallengeCenter` keeps current through `BubbleSocialHub.update`, plus the
// challenge or session in `ChallengeCenter` for names and actions.

/// The challenge feature's blue-to-purple accent.
enum ChallengeStyle {
    static let purple = FBColor.savedPurple
    static var gradient: LinearGradient {
        LinearGradient(colors: [FBColor.brandBlue, FBColor.savedPurple], startPoint: .leading, endPoint: .trailing)
    }
}

/// A small capsule label on a card cover ("Challenge", "Group challenge", "Rematch").
struct ChallengeBadge: View {
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.fbCaptionEmphasized)
            .foregroundStyle(Color.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(ChallengeStyle.gradient, in: Capsule())
            .accessibilityElement(children: .combine)
    }
}

/// Shared frame for every challenge card: chat bubble width in Messenger, full width in posts.
private struct ChallengeCardFrame<Content: View>: View {
    let placement: BubbleChatCardPlacement
    let label: String
    @ViewBuilder let content: Content

    private var isPost: Bool {
        if case .post = placement { return true }
        return false
    }

    var body: some View {
        content
            .frame(width: isPost ? nil : 268)
            .frame(maxWidth: isPost ? .infinity : nil, alignment: .leading)
            .background(FBColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                    .strokeBorder(FBColor.divider, lineWidth: 1)
            )
            .padding(isPost ? EdgeInsets(top: 0, leading: FBMetrics.gutter, bottom: 8, trailing: FBMetrics.gutter) : EdgeInsets())
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
    }
}

/// The cover strip at the top of invite and session cards.
private struct ChallengeCardCover: View {
    let bubble: Bubble?
    let badge: String
    let symbol: String
    var height: CGFloat = 96

    var body: some View {
        ZStack(alignment: .topLeading) {
            Group {
                if let bubble {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                } else {
                    BubbleGlow.lilacHaze.gradient
                }
            }
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .clipped()
            ChallengeBadge(text: badge, symbol: symbol)
                .padding(8)
        }
    }
}

// MARK: - 1:1 challenge

/// "Beat my 34 in Hill Hopper": both scores, who's winning, and Play on the same seed.
struct ChallengeInviteCard: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let center = ChallengeCenter.shared
        let challenge = center.challenge(card.sessionID)
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        let isRematch = card.extras[ChallengeCardKeys.rematchOf]?.string != nil
        ChallengeCardFrame(placement: placement, label: card.headline) {
            VStack(alignment: .leading, spacing: 0) {
                ChallengeCardCover(
                    bubble: bubble,
                    badge: isRematch ? ChallengeCopy.rematch : ChallengeCopy.challenge,
                    symbol: isRematch ? "arrow.triangle.2.circlepath" : "flag.checkered"
                )
                VStack(alignment: .leading, spacing: 10) {
                    Text(card.headline)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    if let challenge {
                        ChallengeScoreRow(card: card, challenge: challenge)
                        ChallengeStatusLine(challenge: challenge)
                    }
                    actions(challenge: challenge, bubble: bubble)
                }
                .padding(12)
            }
        }
    }

    @ViewBuilder
    private func actions(challenge: BubbleChallenge?, bubble: Bubble?) -> some View {
        let opponent = challenge.flatMap { ChallengeCenter.shared.person($0.opponentID) }
        HStack(spacing: 8) {
            Button {
                Haptics.light()
                BubbleSocialHub.play(card, router: router)
            } label: {
                if let theirs = challenge?.theirs, let opponent {
                    Label(ChallengeCopy.beat(opponent.firstName, theirs.score), systemImage: "play.fill")
                } else {
                    Label(ChallengeCopy.play, systemImage: "play.fill")
                }
            }
            .buttonStyle(.fb(.primary, height: 36))
            .disabled(bubble == nil)
            if let challenge, challenge.isFinished {
                Button {
                    Haptics.light()
                    ChallengeCenter.shared.rematch(challengeID: challenge.id)
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: FBIconSize.medium, weight: .semibold))
                }
                .buttonStyle(.fb(.secondary, expand: false, height: 36))
                .accessibilityLabel(ChallengeCopy.rematch)
            }
        }
    }
}

/// You and them side by side with scores; the winner's side is highlighted.
struct ChallengeScoreRow: View {
    let card: BubbleChatCard
    let challenge: BubbleChallenge

    @Environment(AppStore.self) private var appStore

    var body: some View {
        let center = ChallengeCenter.shared
        HStack(spacing: 8) {
            column(user: appStore.me, entry: challenge.mine, isWinner: challenge.outcome == .won, isPending: false)
            Text(ChallengeCopy.versus)
                .font(.fbCaptionEmphasized)
                .foregroundStyle(FBColor.secondaryText)
            column(user: center.person(challenge.opponentID), entry: challenge.theirs, isWinner: challenge.outcome == .lost, isPending: challenge.isOpponentPlaying)
        }
    }

    @ViewBuilder
    private func column(user: User?, entry: ChallengeEntry?, isWinner: Bool, isPending: Bool) -> some View {
        if let user {
            HStack(spacing: 6) {
                AvatarView(user: user, size: FBAvatarSize.reply)
                VStack(alignment: .leading, spacing: 0) {
                    Text(user.isMe ? ChallengeCopy.you : user.firstName)
                        .font(.fbCaptionEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                    HStack(spacing: 3) {
                        Text(entry.map { $0.score.withCommas } ?? (isPending ? ChallengeCopy.waiting : "–"))
                            .font(entry == nil ? .fbMeta : .fbHeadline.monospacedDigit())
                            .foregroundStyle(FBColor.primaryText)
                            .contentTransition(.numericText())
                        if let entry, ChallengeCenter.shared.isVerified(entry, bubbleID: challenge.bubbleID) {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: FBIconSize.xs))
                                .foregroundStyle(FBColor.accent)
                                .accessibilityLabel(ChallengeCopy.verified)
                        }
                    }
                }
                Spacer(minLength: 0)
                if isWinner {
                    Image(systemName: "crown.fill")
                        .font(.system(size: FBIconSize.small))
                        .foregroundStyle(ChallengeStyle.purple)
                        .accessibilityLabel(ChallengeCopy.winner)
                }
            }
            .padding(6)
            .frame(maxWidth: .infinity)
            .background(isWinner ? FBColor.tintedBlueBackground : FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            .accessibilityElement(children: .combine)
        }
    }
}

/// "You win! You beat Maya", "Maya wins this round", "Waiting for Maya to play…".
struct ChallengeStatusLine: View {
    let challenge: BubbleChallenge

    var body: some View {
        let line = Self.line(for: challenge)
        Label(line.text, systemImage: line.symbol)
            .font(.fbMetaEmphasized)
            .foregroundStyle(challenge.outcome == .won ? ChallengeStyle.purple : FBColor.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
    }

    @MainActor
    static func line(for challenge: BubbleChallenge) -> (text: String, symbol: String) {
        let name = ChallengeCenter.shared.person(challenge.opponentID)?.firstName ?? ""
        switch challenge.outcome {
        case .won: return (ChallengeCopy.youWin(name), "trophy.fill")
        case .lost: return (ChallengeCopy.theyWin(name), "flag.checkered")
        case .tied: return (ChallengeCopy.tie, "equal.circle.fill")
        case nil:
            if challenge.theirs != nil { return (ChallengeCopy.yourMove(name), "hand.point.right.fill") }
            return (ChallengeCopy.waitingFor(name), "hourglass")
        }
    }
}

/// A reply ("41 💪 your move") or your head-to-head result ("You 45 · Maya 41"), compact.
struct ChallengeReplyCard: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(Router.self) private var router
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        let challenge = ChallengeCenter.shared.challenge(card.sessionID)
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        let isResult = card.challengeRole == "result"
        ChallengeCardFrame(placement: placement, label: card.headline) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    if let bubble {
                        BubbleCoverView(bubble: bubble, showsEmoji: true)
                            .frame(width: 36, height: 36)
                            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(isResult ? ChallengeCopy.headToHeadTitle : (bubble?.title ?? ""))
                            .font(.fbCaptionEmphasized)
                            .foregroundStyle(FBColor.secondaryText)
                        Text(card.headline)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let challenge {
                    ChallengeScoreRow(card: card, challenge: challenge)
                    if isResult || challenge.isFinished {
                        ChallengeStatusLine(challenge: challenge)
                    }
                    HStack(spacing: 8) {
                        if challenge.isFinished {
                            Button {
                                Haptics.light()
                                ChallengeCenter.shared.rematch(challengeID: challenge.id)
                            } label: {
                                Label(challenge.outcome == .lost ? ChallengeCopy.challengeBack : ChallengeCopy.rematch, systemImage: "arrow.triangle.2.circlepath")
                            }
                            .buttonStyle(.fb(.tinted, height: 34))
                        }
                        if !isResult || !challenge.isFinished {
                            Button {
                                Haptics.light()
                                BubbleSocialHub.play(card, router: router)
                            } label: {
                                Label(playLabel(challenge), systemImage: "play.fill")
                            }
                            .buttonStyle(.fb(challenge.isFinished ? .secondary : .primary, height: 34))
                            .disabled(bubble == nil)
                        }
                    }
                }
            }
            .padding(12)
        }
    }

    private func playLabel(_ challenge: BubbleChallenge) -> String {
        if let theirs = challenge.theirs, !challenge.isFinished || challenge.outcome != .won,
           let name = ChallengeCenter.shared.person(challenge.opponentID)?.firstName {
            return ChallengeCopy.beat(name, theirs.score)
        }
        return ChallengeCopy.play
    }
}

// MARK: - Group-chat and Group sessions

/// A shared session: "3 of 5 played", a mini leaderboard, your-turn nudge, winner line, Rematch.
struct ChallengeSessionCard: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let session = ChallengeCenter.shared.session(card.sessionID)
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        let scores = card.challengeScores
        let played = card.challengePlayed
        let members = max(card.challengeMembers, played)
        let iPlayed = scores.contains { $0.userID == appStore.me.id }
        let isFinished = card.challengeWinnerID != nil || (members > 0 && played >= members)
        let isRematch = card.extras[ChallengeCardKeys.rematchOf]?.string != nil
        ChallengeCardFrame(placement: placement, label: "\(card.headline). \(ChallengeCopy.playedCount(played, of: members))") {
            VStack(alignment: .leading, spacing: 0) {
                ChallengeCardCover(
                    bubble: bubble,
                    badge: isRematch ? ChallengeCopy.rematch : (session?.isGroupPost == true ? ChallengeCopy.challengeTheGroup(session?.title ?? "") : (card.challengeTitle ?? ChallengeCopy.challenge)),
                    symbol: "person.3.fill",
                    height: 84
                )
                VStack(alignment: .leading, spacing: 10) {
                    Text(card.headline)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    progress(played: played, members: members)
                    if !scores.isEmpty {
                        board(scores, winnerID: card.challengeWinnerID)
                    }
                    footer(session: session, bubble: bubble, iPlayed: iPlayed, isFinished: isFinished, scores: scores)
                }
                .padding(12)
            }
        }
    }

    private func progress(played: Int, members: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(ChallengeCopy.playedCount(played, of: members))
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.primaryText)
                    .contentTransition(.numericText())
                Spacer(minLength: 0)
                Label(ChallengeCopy.sameCourseChip, systemImage: "checkmark.seal")
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(FBColor.buttonGray)
                    Capsule()
                        .fill(ChallengeStyle.gradient)
                        .frame(width: members > 0 ? proxy.size.width * CGFloat(played) / CGFloat(members) : 0)
                }
            }
            .frame(height: 6)
            .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.8), value: played)
            .accessibilityHidden(true)
        }
    }

    private func board(_ scores: [(userID: String, score: Int)], winnerID: String?) -> some View {
        VStack(spacing: 4) {
            ForEach(Array(scores.prefix(3).enumerated()), id: \.element.userID) { index, row in
                let user = ChallengeCenter.shared.person(row.userID)
                let isMe = row.userID == appStore.me.id
                HStack(spacing: 8) {
                    Text("\(index + 1)")
                        .font(.fbMetaEmphasized.monospacedDigit())
                        .foregroundStyle(FBColor.secondaryText)
                        .frame(width: 14, alignment: .leading)
                    if let user {
                        AvatarView(user: user, size: FBAvatarSize.tiny)
                    }
                    Text(isMe ? ChallengeCopy.you : (user?.firstName ?? ""))
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    if row.userID == winnerID {
                        Image(systemName: "crown.fill")
                            .font(.system(size: FBIconSize.xs))
                            .foregroundStyle(ChallengeStyle.purple)
                            .accessibilityLabel(ChallengeCopy.winner)
                    }
                    Spacer(minLength: 4)
                    Text(row.score.withCommas)
                        .font(.fbMetaEmphasized.monospacedDigit())
                        .foregroundStyle(FBColor.primaryText)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(isMe ? BubbleGlow.lilac.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                .accessibilityElement(children: .combine)
            }
            if scores.count > 3, let mine = scores.firstIndex(where: { $0.userID == appStore.me.id }), mine >= 3 {
                Text(ChallengeCopy.rankLine(mine + 1, of: scores.count, in: card.challengeTitle ?? ""))
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func footer(session: ChallengeSession?, bubble: Bubble?, iPlayed: Bool, isFinished: Bool, scores: [(userID: String, score: Int)]) -> some View {
        if isFinished, let winner = scores.first {
            let name = ChallengeCenter.shared.person(winner.userID)?.firstName ?? ""
            Text(winner.userID == appStore.me.id ? ChallengeCopy.youWonSession(winner.score) : ChallengeCopy.winnerLine(name, winner.score))
                .font(.fbName)
                .foregroundStyle(ChallengeStyle.purple)
        } else if !iPlayed, session != nil {
            Label(ChallengeCopy.yourTurn(appStore.me.firstName), systemImage: "hand.point.right.fill")
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        } else if let session {
            let waiting = session.memberIDs.filter { session.entries[$0] == nil }.compactMap { ChallengeCenter.shared.person($0)?.firstName }
            if !waiting.isEmpty {
                Label(ChallengeCopy.waitingNames(waiting), systemImage: "hourglass")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
            }
        }
        HStack(spacing: 8) {
            Button {
                Haptics.light()
                BubbleSocialHub.play(card, router: router)
            } label: {
                Label(iPlayed ? ChallengeCopy.playAgain : ChallengeCopy.play, systemImage: "play.fill")
            }
            .buttonStyle(.fb(iPlayed ? .secondary : .primary, height: 36))
            .disabled(bubble == nil || session == nil && card.seed == nil)
            if isFinished, let session {
                Button {
                    Haptics.light()
                    ChallengeCenter.shared.rematch(sessionID: session.id)
                } label: {
                    Label(ChallengeCopy.rematch, systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.fb(.tinted, height: 36))
            }
        }
    }
}
