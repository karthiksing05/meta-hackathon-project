import SwiftUI

/// The bracket with someone: both faces, the standing, and three rounds (theme, game, both scores,
/// who took it). Each round's Play opens the game on the round's seed and length.
struct BracketCardView: View {
    let bracket: FriendBracket
    let opponent: User

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            header
            VStack(spacing: FBSpacing.s) {
                ForEach(bracket.rounds) { round in
                    roundRow(round)
                }
            }
            if bracket.isFinished {
                Label(BracketCopy.winner(bracket, opponent.firstName), systemImage: "trophy.fill")
                    .font(.fbHeadline)
                    .foregroundStyle(bracket.winner == .me ? FBColor.accent : FBColor.primaryText)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
            }
        }
        .padding(FBSpacing.m)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(BubbleGlow.lilac.opacity(0.45), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: FBSpacing.s) {
            ZStack(alignment: .bottomTrailing) {
                AvatarView(user: appStore.me, size: FBAvatarSize.post)
                AvatarView(user: opponent, size: FBAvatarSize.comment)
                    .overlay(Circle().strokeBorder(FBColor.surface, lineWidth: 2))
                    .offset(x: 14, y: 6)
            }
            .padding(.trailing, 12)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(BracketCopy.title(opponent.firstName))
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                Text(BracketCopy.subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 4)
            Text(BracketCopy.standing(bracket.myWins, opponent.firstName, bracket.theirWins))
                .font(.fbMetaEmphasized)
                .monospacedDigit()
                .foregroundStyle(FBColor.primaryText)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(FBColor.tintedBlueBackground, in: Capsule())
        }
    }

    private func roundRow(_ round: BracketRound) -> some View {
        let game = bubbleStore.bubble(id: round.gameID)
        return HStack(spacing: FBSpacing.s) {
            Image(systemName: round.theme.symbol)
                .font(.system(size: FBIconSize.small, weight: .bold))
                .foregroundStyle(Color.white)
                .frame(width: 32, height: 32)
                .background(BubbleGlow.brandGradient, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(BracketCopy.roundTitle(round.index)) · \(round.theme.title)")
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
                Text(game.map { "\($0.emoji) \($0.title)" } ?? round.gameID)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(status(round))
                    .font(.fbMeta)
                    .foregroundStyle(round.winner == .me ? FBColor.accent : FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if !bracket.isFinished || round.mine == nil {
                Button {
                    Haptics.light()
                    router.play(BubblePlayRequest(bubbleID: round.gameID, seed: round.seed, length: round.length))
                } label: {
                    Text(round.mine == nil ? BracketCopy.play : BracketCopy.replay)
                }
                .buttonStyle(.fb(round.mine == nil ? .primary : .secondary, expand: false, height: 32))
                .disabled(game == nil || bracket.isFinished)
            } else if let winner = round.winner {
                Image(systemName: winner == .me ? "checkmark.circle.fill" : winner == .tie ? "equal.circle.fill" : "xmark.circle")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(winner == .me ? FBColor.accent : FBColor.tertiaryText)
            }
        }
        .padding(FBSpacing.s)
        .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func status(_ round: BracketRound) -> String {
        let name = opponent.firstName
        switch (round.mine, round.theirs) {
        case let (mine?, theirs?): return BracketCopy.score(mine, name, theirs)
        case (nil, _?): return BracketCopy.theirTurn(name) + " · your turn"
        case (_?, nil): return BracketCopy.waiting(name)
        case (nil, nil): return BracketCopy.waiting(name)
        }
    }
}

/// On someone's profile (not yours): your bracket with them, or one tap to start one.
struct BracketProfileCard: View {
    let user: User

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @State private var service = LocalBracketService.shared

    var body: some View {
        if !user.isMe && !user.isPage {
            Group {
                if let bracket = service.bracket(with: user.id) {
                    BracketCardView(bracket: bracket, opponent: user)
                } else {
                    Button {
                        Haptics.light()
                        service.install(appStore: appStore, bubbleStore: bubbleStore)
                        service.propose(with: user, origin: .newFriend)
                    } label: {
                        Label(BracketCopy.start(user.firstName), systemImage: "trophy.fill")
                    }
                    .buttonStyle(.fb(.tinted, height: 40))
                }
            }
            .padding(.top, 8)
        }
    }
}
