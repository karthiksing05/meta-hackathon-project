import SwiftUI

/// Your friendly rivalry with someone: "You vs Maya: 3-2 this week", who leads, the last few
/// results, and a Challenge button (pick a game). Shown on profiles and the head-to-head screen.
struct ChallengeRivalryCard: View {
    let user: User
    var showsChallengeButton = true

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    @State private var isPickingGame = false

    private var center: ChallengeCenter { ChallengeCenter.shared }

    var body: some View {
        let record = center.rivalry(with: user.id)
        let recent = recentResults()
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                faceOff
                VStack(alignment: .leading, spacing: 2) {
                    if record.wins + record.losses > 0 {
                        Text(ChallengeCopy.rivalry(user.firstName, wins: record.wins, losses: record.losses))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Text(ChallengeCopy.rivalryLead(user.firstName, wins: record.wins, losses: record.losses))
                            .font(.fbMeta)
                            .foregroundStyle(record.wins > record.losses ? ChallengeStyle.purple : FBColor.secondaryText)
                    } else {
                        Text(ChallengeCopy.noRivalry(user.firstName))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if showsChallengeButton {
                    Button {
                        Haptics.light()
                        isPickingGame = true
                    } label: {
                        Label(ChallengeCopy.challenge, systemImage: "flag.checkered")
                    }
                    .buttonStyle(.fb(.primary, expand: false, height: 34))
                    .accessibilityLabel(ChallengeCopy.challengeToGame(user.firstName))
                }
            }
            if !recent.isEmpty {
                VStack(spacing: 6) {
                    ForEach(recent, id: \.id) { item in
                        historyRow(item)
                    }
                }
            }
        }
        .padding(12)
        .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .sheet(isPresented: $isPickingGame) {
            ChallengeGamePickerSheet(userID: user.id)
        }
    }

    private var faceOff: some View {
        ZStack(alignment: .bottomTrailing) {
            AvatarView(user: appStore.me, size: FBAvatarSize.story)
                .frame(width: 52, height: 40, alignment: .topLeading)
            AvatarView(user: user, size: FBAvatarSize.story)
                .overlay(Circle().stroke(FBColor.tintedBlueBackground, lineWidth: 2))
        }
        .frame(width: 52, height: 48)
        .accessibilityHidden(true)
    }

    /// Live challenges first, then the seeded history; three at most.
    private func recentResults() -> [ChallengeHistoryItem] {
        let live = center.challenges.values
            .filter { $0.opponentID == user.id && $0.isFinished }
            .sorted { $0.createdAt > $1.createdAt }
            .compactMap { challenge -> ChallengeHistoryItem? in
                guard let mine = challenge.mine, let theirs = challenge.theirs else { return nil }
                return ChallengeHistoryItem(id: challenge.id, bubbleID: challenge.bubbleID, myScore: mine.score, theirScore: theirs.score, daysAgo: 0)
            }
        return Array((live + center.history(with: user.id)).prefix(3))
    }

    private func historyRow(_ item: ChallengeHistoryItem) -> some View {
        let bubble = bubbleStore.bubble(id: item.bubbleID)
        return HStack(spacing: 8) {
            Image(systemName: item.outcome == .won ? "trophy.fill" : (item.outcome == .lost ? "flag.fill" : "equal.circle.fill"))
                .font(.system(size: FBIconSize.small))
                .foregroundStyle(item.outcome == .won ? ChallengeStyle.purple : FBColor.secondaryText)
                .frame(width: 18)
            Text(bubble?.title ?? item.bubbleID)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Text(item.daysAgo == 0 ? ChallengeCopy.today : ChallengeCopy.daysAgo(item.daysAgo))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            Spacer(minLength: 4)
            Text(ChallengeCopy.historyRow(item.outcome, mine: item.myScore, theirs: item.theirScore))
                .font(.fbMeta.monospacedDigit())
                .foregroundStyle(FBColor.secondaryText)
        }
        .accessibilityElement(children: .combine)
    }
}
