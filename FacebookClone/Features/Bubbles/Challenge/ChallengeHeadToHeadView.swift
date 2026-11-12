import SwiftUI

/// A challenge, head to head: both players, both scores on the same course, the winner, your
/// rivalry, and what's next (Challenge back, open the chat, watch their run, add them as a friend).
/// Pushed as `feature:challenge/h2h/<challengeID>` (a Bubble id opens your latest challenge on it).
struct ChallengeHeadToHeadView: View {
    let challengeID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    private var center: ChallengeCenter { ChallengeCenter.shared }

    private var challenge: BubbleChallenge? {
        center.challenge(challengeID) ?? center.latestChallenge(on: challengeID)
    }

    var body: some View {
        Group {
            if let challenge, let bubble = bubbleStore.bubble(id: challenge.bubbleID), let opponent = center.person(challenge.opponentID) {
                content(challenge, bubble: bubble, opponent: opponent)
            } else {
                ContentUnavailableView(ChallengeCopy.noGames, systemImage: "flag.checkered", description: Text(ChallengeCopy.noGamesNote))
            }
        }
        .background(FBColor.background)
        .navigationTitle(ChallengeCopy.headToHeadTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ challenge: BubbleChallenge, bubble: Bubble, opponent: User) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                ChallengeHeadToHeadPanel(challenge: challenge, bubble: bubble, me: appStore.me, opponent: opponent)
                ChallengeRivalryCard(user: opponent, showsChallengeButton: false)
                actions(challenge, bubble: bubble, opponent: opponent)
            }
            .padding(FBMetrics.screenPadding)
        }
    }

    private func actions(_ challenge: BubbleChallenge, bubble: Bubble, opponent: User) -> some View {
        VStack(spacing: 8) {
            Button {
                Haptics.light()
                center.rematch(challengeID: challenge.id)
                if let chat = center.conversation(for: challenge.id) {
                    router.openChat(chat)
                }
            } label: {
                Label(ChallengeCopy.challengeBack, systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.fb(.primary, height: 44))

            if let replay = challenge.theirs?.replay {
                Button {
                    Haptics.light()
                    let context = BubblePlayContext(kind: .challenge, id: challenge.id, cardID: challenge.cardID, opponentName: opponent.firstName, target: challenge.theirs?.score)
                    router.play(BubblePlayRequest(bubbleID: bubble.id, replay: replay, seed: challenge.seed, length: challenge.length, context: context))
                } label: {
                    Label(ChallengeCopy.watchRun(opponent.firstName), systemImage: "play.rectangle.fill")
                }
                .buttonStyle(.fb(.secondary, height: 44))
            }

            if let chat = center.conversation(for: challenge.id) {
                Button {
                    Haptics.light()
                    router.openChat(chat)
                } label: {
                    Label(ChallengeCopy.openChat, systemImage: "message.fill")
                }
                .buttonStyle(.fb(.secondary, height: 44))
            }

            ChallengeAddFriendButton(user: opponent, bubbleID: bubble.id)
        }
    }
}

/// Two players facing off: avatars, scores, crown, the winner line and the same-course proof.
/// Used by the head-to-head screen and the result sheet.
struct ChallengeHeadToHeadPanel: View {
    let challenge: BubbleChallenge
    let bubble: Bubble
    let me: User
    let opponent: User
    var compact = false

    var body: some View {
        let line = ChallengeStatusLine.line(for: challenge)
        VStack(spacing: compact ? 8 : 14) {
            if !compact {
                HStack(spacing: 8) {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                    Text(bubble.title)
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    Spacer(minLength: 0)
                    ChallengeBadge(text: ChallengeCopy.sameCourseChip, symbol: "checkmark.seal.fill")
                }
            }
            HStack(alignment: .top, spacing: 0) {
                side(me, entry: challenge.mine, isWinner: challenge.outcome == .won, isPending: false)
                Text("vs")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.top, compact ? 18 : 28)
                side(opponent, entry: challenge.theirs, isWinner: challenge.outcome == .lost, isPending: challenge.isOpponentPlaying)
            }
            Label(line.text, systemImage: line.symbol)
                .font(.fbName)
                .foregroundStyle(challenge.outcome == .won ? ChallengeStyle.purple : FBColor.primaryText)
                .multilineTextAlignment(.center)
        }
        .padding(compact ? 12 : 16)
        .frame(maxWidth: .infinity)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(challenge.outcome == .won ? AnyShapeStyle(ChallengeStyle.gradient) : AnyShapeStyle(FBColor.divider), lineWidth: challenge.outcome == .won ? 2 : 1)
        )
        .accessibilityElement(children: .combine)
    }

    private func side(_ user: User, entry: ChallengeEntry?, isWinner: Bool, isPending: Bool) -> some View {
        VStack(spacing: 4) {
            ZStack(alignment: .top) {
                AvatarView(user: user, size: compact ? FBAvatarSize.compact : FBAvatarSize.row + 12)
                    .padding(.top, 10)
                if isWinner {
                    Image(systemName: "crown.fill")
                        .font(.system(size: FBIconSize.large))
                        .foregroundStyle(ChallengeStyle.purple)
                        .offset(y: -6)
                        .accessibilityLabel("Winner")
                }
            }
            Text(user.isMe ? "You" : user.firstName)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Text(entry.map { $0.score.withCommas } ?? (isPending ? ChallengeCopy.waiting : "–"))
                .font(entry == nil ? .fbMeta : .system(size: compact ? 28 : 40, weight: .bold, design: .rounded)) // Display text: a score
                .monospacedDigit()
                .foregroundStyle(isWinner ? ChallengeStyle.purple : FBColor.primaryText)
                .contentTransition(.numericText())
            if let entry, ChallengeCenter.shared.isVerified(entry, bubbleID: bubble.id) {
                Label(ChallengeCopy.verified, systemImage: "checkmark.seal.fill")
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// "Add friend" for someone you met through a game (Maya isn't your friend yet).
struct ChallengeAddFriendButton: View {
    let user: User
    let bubbleID: String

    @Environment(AppStore.self) private var appStore

    var body: some View {
        if !user.isMe && !user.isPage && user.friendship != .friends {
            Button {
                guard user.friendship == .none || user.friendship == .requestReceived else { return }
                Haptics.success()
                appStore.sendRequest(to: user)
                BubbleSocialSignals.post(.addFriendFromGame, bubbleID: bubbleID, with: [user.id])
            } label: {
                Label(user.friendship == .requestSent ? ChallengeCopy.requestSent : ChallengeCopy.addFriend(user.firstName), systemImage: user.friendship == .requestSent ? "person.badge.clock.fill" : "person.badge.plus")
            }
            .buttonStyle(.fb(.tinted, height: 44))
            .disabled(user.friendship == .requestSent)
        }
    }
}
