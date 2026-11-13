import SwiftUI

// Slot views for the "challenge" feature (docs/BUBBLES.md 7.2). Owner: challenge.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift.

/// Head-to-head line on the result sheet when the play was a challenge or session ('You 45 · Maya 41').
struct ChallengeResultHeadToHead: View {
    let slot: BubbleResultSlotContext

    @Environment(AppStore.self) private var appStore

    var body: some View {
        let center = ChallengeCenter.shared
        if let play = slot.play {
            switch play.kind {
            case .challenge:
                if let challenge = center.challenge(play.id), let opponent = center.person(challenge.opponentID) {
                    ChallengeHeadToHeadPanel(challenge: challenge, bubble: slot.bubble, me: appStore.me, opponent: opponent, compact: true)
                }
            case .session:
                if let session = center.session(play.id) {
                    ChallengeSessionStanding(session: session)
                }
            default:
                EmptyView()
            }
        }
    }
}

/// Where you stand in a session after your run: "You're 2nd of 5 in New in SF crew".
struct ChallengeSessionStanding: View {
    let session: ChallengeSession

    @Environment(AppStore.self) private var appStore

    var body: some View {
        let standings = session.standings
        let rank = (standings.firstIndex { $0.userID == appStore.me.id } ?? standings.count) + 1
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(ChallengeCopy.rankLine(rank, of: session.memberIDs.count, in: session.title))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer(minLength: 4)
                Text(ChallengeCopy.playedCount(session.playedCount, of: session.memberIDs.count))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            HStack(spacing: 10) {
                ForEach(standings.prefix(5), id: \.userID) { entry in
                    if let user = ChallengeCenter.shared.person(entry.userID) {
                        VStack(spacing: 2) {
                            AvatarView(user: user, size: FBAvatarSize.comment)
                                .overlay(alignment: .top) {
                                    if entry.userID == session.leader?.userID {
                                        Image(systemName: "crown.fill")
                                            .font(.system(size: FBIconSize.xs))
                                            .foregroundStyle(ChallengeStyle.purple)
                                            .offset(y: -10)
                                    }
                                }
                            Text(entry.score.withCommas)
                                .font(.fbCaptionEmphasized.monospacedDigit())
                                .foregroundStyle(entry.userID == appStore.me.id ? ChallengeStyle.purple : FBColor.primaryText)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(ChallengeCopy.scoreLabel(user.isMe ? ChallengeCopy.you : user.firstName, entry.score))
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }
}

/// 'Challenge Me' next to Save and Share; opens the picker; 'Challenge back' after a challenge.
struct ChallengeResultAction: View {
    let slot: BubbleResultSlotContext

    @Environment(Router.self) private var router
    @Environment(AppStore.self) private var appStore

    @State private var isPicking = false

    var body: some View {
        let center = ChallengeCenter.shared
        Group {
            switch slot.play?.kind {
            case .challenge?:
                challengeActions(center)
            case .session?:
                sessionActions(center)
            default:
                Button {
                    Haptics.light()
                    isPicking = true
                } label: {
                    Label(ChallengeCopy.challengeMe, systemImage: "flag.checkered")
                }
                .buttonStyle(.fb(.tinted, height: 44))
                .accessibilityHint(ChallengeCopy.challengeMeHint)
            }
        }
        .sheet(isPresented: $isPicking) {
            ChallengePickerSheet(bubbleID: slot.bubble.id, draft: center.draft(for: slot.bubble, result: slot.result.result))
        }
    }

    @ViewBuilder
    private func challengeActions(_ center: ChallengeCenter) -> some View {
        if let play = slot.play, let challenge = center.challenge(play.id) {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Button {
                        Haptics.light()
                        center.rematch(challengeID: challenge.id)
                        openChat(for: challenge.id)
                    } label: {
                        Label(ChallengeCopy.challengeBack, systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.fb(.tinted, height: 44))
                    Button {
                        Haptics.light()
                        openChat(for: challenge.id)
                    } label: {
                        Label(ChallengeCopy.openChat, systemImage: "message.fill")
                    }
                    .buttonStyle(.fb(.secondary, height: 44))
                }
                // Met through a game: one tap turns a rival into a friend.
                if let opponent = center.person(challenge.opponentID) {
                    ChallengeAddFriendButton(user: opponent, bubbleID: challenge.bubbleID)
                }
            }
        }
    }

    @ViewBuilder
    private func sessionActions(_ center: ChallengeCenter) -> some View {
        if let play = slot.play, let session = center.session(play.id) {
            HStack(spacing: 8) {
                if session.isFinished {
                    Button {
                        Haptics.light()
                        let next = center.rematch(sessionID: session.id)
                        openChat(for: next?.id ?? session.id)
                    } label: {
                        Label(ChallengeCopy.rematch, systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.fb(.tinted, height: 44))
                }
                Button {
                    Haptics.light()
                    openChat(for: session.id)
                } label: {
                    Label(ChallengeCopy.backToChat, systemImage: session.isGroupPost ? "person.3.fill" : "message.fill")
                }
                .buttonStyle(.fb(.secondary, height: 44))
            }
        }
    }

    private func openChat(for id: String) {
        let route = BubbleFeatureRoute(.challenge, "chat", id)
        slot.leavingPlayer {
            BubbleFeatureRouter.open(route, router: router)
        }
    }
}

/// 'Challenge a friend' row on the Bubble page, with your live challenges on it.
struct ChallengeDetailRow: View {
    let bubble: Bubble

    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    @State private var isPicking = false

    var body: some View {
        let center = ChallengeCenter.shared
        let draft = center.bestDraft(for: bubble)
        let latest = center.activeChallenges(on: bubble.id).first
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Haptics.light()
                isPicking = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "flag.checkered")
                        .font(.system(size: FBIconSize.regular, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .frame(width: 40, height: 40)
                        .background(GameColor.accentGradient, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ChallengeCopy.challengeAFriend)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Text(draft.score.map { "\(ChallengeCopy.challengeAFriendNote) · \(ChallengeCopy.yourBest($0))" } ?? ChallengeCopy.challengeAFriendNote)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.small, weight: .semibold))
                        .foregroundStyle(FBColor.tertiaryText)
                }
                .padding(12)
                .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChallengeCopy.challengeAFriend)

            if let latest, let opponent = center.person(latest.opponentID) {
                Button {
                    Haptics.light()
                    router.push(.bubbleFeature(BubbleFeatureRoute(.challenge, "h2h", latest.id)))
                } label: {
                    HStack(spacing: 8) {
                        AvatarView(user: opponent, size: FBAvatarSize.tiny)
                        Text(statusText(latest, name: opponent.firstName))
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(ChallengeCopy.headToHeadTitle)
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.accent)
                    }
                    .padding(.horizontal, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .sheet(isPresented: $isPicking) {
            ChallengePickerSheet(bubbleID: bubble.id, draft: draft)
        }
    }

    private func statusText(_ challenge: BubbleChallenge, name: String) -> String {
        guard let mine = challenge.mine, let theirs = challenge.theirs else {
            return ChallengeStatusLine.line(for: challenge).text
        }
        if mine.score >= theirs.score { return ChallengeCopy.youLead(name, mine.score, theirs.score) }
        return ChallengeCopy.leads(name, theirs.score, mine.score)
    }
}

/// 'Beat Maya's 41' banner while playing a challenge or session; 'Ahead of Maya!' once you pass it.
struct ChallengePlayerBanner: View {
    let bubble: Bubble
    let request: BubblePlayRequest
    let score: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let context = request.context, context.kind == .challenge || context.kind == .session {
            let target = ChallengeCenter.shared.liveTarget(for: context)
            let isAhead = target.map { score > $0.score } ?? false
            let text: String = {
                guard let target else { return ChallengeCopy.playingAgainst(context.opponentName ?? "") }
                return isAhead ? ChallengeCopy.ahead(of: target.name) : ChallengeCopy.beat(target.name, target.score)
            }()
            HStack(spacing: 6) {
                Image(systemName: isAhead ? "crown.fill" : "flag.checkered")
                    .font(.system(size: FBIconSize.small, weight: .bold))
                Text(text)
                    .font(.fbButton)
                    .lineLimit(1)
                    .contentTransition(.opacity)
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .frame(minHeight: 32)
            .background {
                if isAhead {
                    Capsule().fill(GameColor.accentGradient)
                } else {
                    Capsule().fill(Color.black.opacity(0.36))
                }
            }
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.5), lineWidth: 1))
            .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.8), value: isAhead)
            .allowsHitTesting(false)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(text)
        }
    }
}

/// Rivalry line and Challenge button on a person's profile ('You vs Maya: 3-2 this week').
struct ChallengeProfileRivalry: View {
    let user: User

    var body: some View {
        if !user.isMe && !user.isPage {
            ChallengeRivalryCard(user: user)
                .padding(.top, 8)
        }
    }
}

/// Challenge button on friend rows (pick a game).
struct ChallengeFriendButton: View {
    let user: User

    @State private var isPicking = false

    var body: some View {
        if !user.isMe && !user.isPage {
            Button {
                Haptics.light()
                isPicking = true
            } label: {
                Label(ChallengeCopy.challenge, systemImage: "flag.checkered")
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(FBColor.accent)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(FBColor.tintedBlueBackground, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChallengeCopy.challengeToGame(user.firstName))
            .sheet(isPresented: $isPicking) {
                ChallengeGamePickerSheet(userID: user.id)
            }
        }
    }
}

/// Challenge, session and share cards in chats and posts.
struct ChallengeCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        let center = ChallengeCenter.shared
        switch card.kind {
        case .challenge where center.challenge(card.sessionID) != nil:
            if card.challengeRole == "invite" {
                ChallengeInviteCard(card: card, placement: placement)
            } else {
                ChallengeReplyCard(card: card, placement: placement)
            }
        case .session where center.session(card.sessionID) != nil || !card.challengeScores.isEmpty:
            ChallengeSessionCard(card: card, placement: placement)
        default:
            BubbleChatCardFallback(card: card, placement: placement)
        }
    }
}
