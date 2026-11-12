import SwiftUI

/// The "Bubbles" tab on a profile: their Bubbles, best scores and chains.
struct BubbleProfileSection: View {
    let user: User

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    var body: some View {
        let made = bubbleStore.bubbles(by: user)
        let best = bubbleStore.worldBestScores(of: user)
        let chains = bubbleStore.worldChains(by: user)
        VStack(spacing: 0) {
            BubbleProfileSectionSlots(user: user)
            if user.isMe {
                blowRow
                ProfileGap()
            }
            if made.isEmpty && best.isEmpty {
                empty
            } else {
                if !made.isEmpty {
                    card(title: "Bubbles") {
                        LazyVGrid(columns: columns, spacing: 8) {
                            ForEach(made) { bubble in
                                NavigationLink(value: Route.bubble(bubble.id)) {
                                    BubbleCard(bubble: bubble, style: .compact)
                                }
                                .buttonStyle(.pressable)
                                .accessibilityLabel(bubble.title)
                            }
                        }
                    }
                }
                if !best.isEmpty {
                    ProfileGap()
                    card(title: "Best scores") {
                        VStack(spacing: 0) {
                            ForEach(Array(best.enumerated()), id: \.element.score.id) { index, row in
                                if index > 0 { HairlineDivider() }
                                scoreRow(row.bubble, row.score)
                            }
                        }
                    }
                }
                if !chains.isEmpty {
                    ProfileGap()
                    card(title: "Bubble Chains") {
                        VStack(spacing: 0) {
                            ForEach(Array(chains.enumerated()), id: \.offset) { index, levels in
                                if index > 0 { HairlineDivider() }
                                chainRow(levels)
                            }
                        }
                    }
                }
            }
        }
    }

    private func card<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private var blowRow: some View {
        Button {
            Haptics.light()
            router.openStudio(StudioLaunch(mode: .create))
        } label: {
            HStack(spacing: 12) {
                BubbleOrb(size: 34)
                    .padding(6)
                    .background(BubbleGlow.brandGradient.opacity(0.55), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Blow a bubble")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Describe a game and Muse builds it")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(16)
            .background(FBColor.surface)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Blow a bubble")
    }

    private var empty: some View {
        VStack(spacing: 10) {
            BubbleOrb(size: 44)
            Text(user.isMe ? "You haven't blown a bubble yet" : "\(user.firstName) hasn't blown a bubble yet")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
            Text(user.isMe ? "Describe a game in a sentence and Muse builds it." : "Their Bubbles and best scores will show up here.")
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity)
        .background(FBColor.surface)
    }

    private func scoreRow(_ bubble: Bubble, _ score: BubbleScore) -> some View {
        Button {
            Haptics.light()
            router.push(.bubbleBoard(bubble.id))
        } label: {
            HStack(spacing: 12) {
                BubbleCoverView(bubble: bubble, showsEmoji: true)
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(bubble.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text(score.achievedAt.fbShort)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 0)
                Text(score.score.withCommas)
                    .font(.fbHeadline)
                    .monospacedDigit()
                    .foregroundStyle(FBColor.primaryText)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(bubble.title), best score \(score.score)")
    }

    private func chainRow(_ levels: [Bubble]) -> some View {
        let first = levels.first
        return Button {
            Haptics.light()
            if let chainID = first?.chainID { router.push(.bubbleChain(chainID)) }
        } label: {
            HStack(spacing: 12) {
                if let first {
                    BubbleCoverView(bubble: first, showsEmoji: true)
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(first?.manifest.chain?.title ?? first?.title ?? "Bubble Chain")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text("\(levels.count) \(levels.count == 1 ? "level" : "levels")")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}
