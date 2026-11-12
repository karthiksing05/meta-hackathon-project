import SwiftUI

/// The levels of a Bubble Chain in order, with your best per level. A level unlocks after you
/// finish the one before it.
struct BubbleChainView: View {
    let chainID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        let levels = bubbleStore.chain(chainID)
        Group {
            if levels.isEmpty {
                ContentUnavailableView("Chain not found", systemImage: "link", description: Text("It may have been removed."))
            } else {
                content(levels)
            }
        }
        .background(FBColor.surface)
        .navigationTitle("Bubble Chain")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ levels: [Bubble]) -> some View {
        let name = bubbleStore.chainName(chainID)
        let done = levels.filter { bubbleStore.bestScore(of: appStore.me, in: $0) != nil }.count
        let last = levels.last
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(name)
                        .font(.fbTabTitle)
                        .foregroundStyle(FBColor.primaryText)
                        .accessibilityAddTraits(.isHeader)
                    Text("\(levels.count) \(levels.count == 1 ? "level" : "levels") · \(done) cleared")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                    ProgressView(value: Double(done), total: Double(max(levels.count, 1)))
                        .tint(BubbleGlow.pink)
                        .padding(.top, 6)
                }
                VStack(spacing: 0) {
                    ForEach(Array(levels.enumerated()), id: \.element.id) { index, level in
                        levelRow(level, number: level.levelIndex ?? index + 1, unlocked: bubbleStore.isLevelUnlocked(level, in: levels), isLast: index == levels.count - 1)
                    }
                }
                if let last, bubbleStore.isMine(last) {
                    Button {
                        router.openStudio(StudioLaunch(mode: .nextLevel, baseBubbleID: last.id))
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "plus.circle.fill")
                            Text("Make the next level")
                        }
                    }
                    .buttonStyle(.fb(.primary, expand: true, height: 44))
                }
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .onAppear {
            #if DEBUG
            levels.forEach { bubbleStore.seedSampleScoresIfNeeded($0) }
            #endif
        }
    }

    private func levelRow(_ level: Bubble, number: Int, unlocked: Bool, isLast: Bool) -> some View {
        let best = bubbleStore.bestScore(of: appStore.me, in: level)
        return HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Text("\(number)")
                    .font(.fbHeadline)
                    .foregroundStyle(unlocked ? BubbleGlow.ink : FBColor.secondaryText)
                    .frame(width: 32, height: 32)
                    .background(unlocked ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(FBColor.buttonGray), in: Circle())
                if !isLast {
                    Rectangle().fill(FBColor.divider).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            Button {
                if unlocked { router.push(.bubble(level.id)) }
            } label: {
                HStack(spacing: 12) {
                    BubbleCoverView(bubble: level, showsEmoji: unlocked)
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                        .overlay {
                            if !unlocked {
                                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).fill(.black.opacity(0.45))
                                Image(systemName: "lock.fill")
                                    .font(.system(size: FBIconSize.large))
                                    .foregroundStyle(.white)
                            }
                        }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(level.title)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(2)
                        if !unlocked {
                            Text("Finish level \(number - 1) to unlock")
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                        } else if let best {
                            Label("Your best: \(best.score.withCommas)", systemImage: "trophy.fill")
                                .font(.fbMetaEmphasized)
                                .foregroundStyle(FBColor.accent)
                        } else {
                            Text(level.rule)
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(unlocked ? "Level \(number), \(level.title)" : "Level \(number), locked")
            if unlocked {
                Button {
                    router.play(level.id)
                } label: {
                    Text(best == nil ? "Pop in" : "Again")
                }
                .buttonStyle(.fb(.tinted, expand: false, height: 34))
                .padding(.top, 19)
            }
        }
        .padding(.bottom, isLast ? 0 : 16)
        .opacity(unlocked ? 1 : 0.85)
    }
}

#Preview {
    NavigationStack { BubbleChainView(chainID: "chain-hill-hopper") }.previewEnvironment()
}
