import SwiftUI

/// "Challenge" from a friend row or a profile: pick a game to challenge them in. Games you've
/// played come first, best score first; each sends your best run on its seed. Games you haven't
/// played can still go out: they play first, then it's your turn.
struct ChallengeGamePickerSheet: View {
    let userID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss

    @State private var sentIDs: Set<String> = []

    private var center: ChallengeCenter { ChallengeCenter.shared }

    var body: some View {
        let person = bubbleStore.resolvePerson(userID)
        NavigationStack {
            content(person)
                .background(FBColor.surface)
                .navigationTitle(ChallengeCopy.gamePickerTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(ChallengeCopy.done) { dismiss() }
                            .font(.fbButton)
                    }
                }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .overlay(alignment: .bottom) {
            ToastHost().padding(.bottom, 16)
        }
    }

    private func content(_ person: User) -> some View {
        let played = bubbleStore.feedBubbles
            .compactMap { bubble in bubbleStore.bestScore(of: appStore.me, in: bubble).map { (bubble, $0.score) } }
            .sorted { $0.1 > $1.1 }
        let playedIDs = Set(played.map { $0.0.id })
        let others = bubbleStore.feedBubbles.filter { !playedIDs.contains($0.id) && !$0.isDaily }.prefix(6)
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header(person)
                if played.isEmpty {
                    ContentUnavailableView(ChallengeCopy.noGames, systemImage: "gamecontroller", description: Text(ChallengeCopy.noGamesNote))
                        .frame(minHeight: 160)
                } else {
                    sectionTitle(ChallengeCopy.gamesYouPlayed, note: nil)
                    ForEach(played, id: \.0.id) { bubble, best in
                        row(bubble, detail: ChallengeCopy.yourBest(best), person: person)
                    }
                }
                if !others.isEmpty {
                    sectionTitle(ChallengeCopy.tryThese, note: ChallengeCopy.tryTheseNote)
                    ForEach(Array(others)) { bubble in
                        row(bubble, detail: bubble.formula.title, person: person)
                    }
                }
            }
            .padding(.bottom, 32)
        }
    }

    private func header(_ person: User) -> some View {
        HStack(spacing: 12) {
            AvatarView(user: person, size: FBAvatarSize.compact)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(ChallengeCopy.challenge) \(person.firstName)")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                let record = center.rivalry(with: person.id)
                Text(record.wins + record.losses > 0
                     ? ChallengeCopy.rivalry(person.firstName, wins: record.wins, losses: record.losses)
                     : ChallengeCopy.sameSeedNote)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }

    private func sectionTitle(_ title: String, note: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            if let note {
                Text(note)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }

    private func row(_ bubble: Bubble, detail: String, person: User) -> some View {
        let isSent = sentIDs.contains(bubble.id)
        return HStack(spacing: 12) {
            BubbleCoverView(bubble: bubble, showsEmoji: true)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(bubble.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(detail)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                send(bubble, to: person)
            } label: {
                if isSent {
                    Label(ChallengeCopy.sent, systemImage: "checkmark")
                } else {
                    Text(ChallengeCopy.challenge)
                }
            }
            .buttonStyle(.fb(isSent ? .secondary : .primary, expand: false, height: 32))
            .disabled(isSent)
            .accessibilityLabel(isSent ? "Challenge sent" : "Challenge \(person.firstName) in \(bubble.title)")
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.vertical, 6)
    }

    private func send(_ bubble: Bubble, to person: User) {
        let draft = center.bestDraft(for: bubble)
        let target = BubbleShareTarget(kind: .friend, targetID: person.id, title: person.firstName)
        if center.send(draft, to: target, bubble: bubble) {
            Haptics.success()
            withAnimation(.easeInOut(duration: 0.2)) {
                _ = sentIDs.insert(bubble.id)
            }
        }
    }
}
