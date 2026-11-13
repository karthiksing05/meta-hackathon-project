import SwiftUI

// Slot views for the "saves" feature (docs/BUBBLES.md 7.10). Owner: saves.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift.

/// Save as the result sheet's primary action.
struct SavesResultAction: View {
    let slot: BubbleResultSlotContext

    @Environment(BubbleStore.self) private var bubbleStore
    @State private var bounce = 0

    var body: some View {
        let bubble = slot.bubble
        VStack(spacing: 6) {
            Button {
                bounce += 1
                Haptics.medium()
                bubbleStore.toggleSave(bubble, source: .result)
                SavesHintCenter.shared.dismiss()
            } label: {
                Label(bubble.isSaved ? SavesCopy.saved : SavesCopy.save, systemImage: bubble.isSaved ? "bookmark.fill" : "bookmark")
                    .symbolEffect(.bounce, value: bounce)
            }
            .buttonStyle(.fb(.tinted, height: 44))
            .accessibilityLabel(bubble.isSaved ? "Unsave \(bubble.title)" : "Save \(bubble.title)")
            .accessibilityValue(SavesCopy.savesCount(bubble.saveCount))
            if let proof = SavesSocialProof.text(for: bubble, in: bubbleStore) {
                Text(proof)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
        }
        .task(id: bubble.id) { bubbleStore.loadSavers(for: bubble) }
    }
}

/// 'Saved by Maya and 37 others' on feed pages, plus the first-run hint.
struct SavesCaptionProof: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if SavesHintCenter.shared.isVisible {
                SavesHintView { SavesHintCenter.shared.dismiss() }
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            if let text = SavesSocialProof.text(for: bubble, in: bubbleStore) {
                let savers = Array(SavesSocialProof.savers(for: bubble, in: bubbleStore, limit: 3))
                // Tap to see who saved it, friends first, with Add friend for the rest.
                Button {
                    router.push(.bubbleFeature(BubbleFeatureRoute(.saves, "stats", bubble.id)))
                } label: {
                    HStack(spacing: 6) {
                        if !savers.isEmpty {
                            AvatarStack(users: savers, size: 18, maxCount: 3)
                        }
                        Text(text)
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(Color.white)
                            .lineLimit(1)
                    }
                    .frame(minHeight: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(text)
                .accessibilityHint(SavesCopy.seeAll)
            }
        }
        .task(id: bubble.id) { bubbleStore.loadSavers(for: bubble) }
    }
}

/// Saves stats on the Bubble page: who saved it, saves this week, and for your own Bubbles who
/// saved it, friends first.
struct SavesDetailStats: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        if bubble.saveCount > 0 {
            let savers = SavesSocialProof.savers(for: bubble, in: bubbleStore, limit: 4)
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    AvatarStack(users: savers, size: 28, maxCount: 4)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(SavesSocialProof.text(for: bubble, in: bubbleStore) ?? SavesCopy.savesCount(bubble.saveCount))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(2)
                        Text(SavesCopy.savesThisWeek(SavesSocialProof.savesThisWeek(bubble)))
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                if bubble.creator.isMe {
                    mine(savers)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .task(id: bubble.id) { bubbleStore.loadSavers(for: bubble) }
        }
    }

    private func mine(_ savers: [User]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Text(SavesCopy.whoSaved)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
                .padding(.vertical, 8)
                .accessibilityAddTraits(.isHeader)
            ForEach(savers.filter { !$0.isMe }.prefix(3)) { user in
                SavesSaverRow(user: user, bubble: bubble)
                    .padding(.horizontal, -12)
            }
            Button {
                router.push(.bubbleFeature(BubbleFeatureRoute(.saves, "stats", bubble.id)))
            } label: {
                Text(SavesCopy.seeAll)
                    .font(.fbButton)
                    .foregroundStyle(FBColor.accent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

/// One-tap Save in the player's top bar that never leaves the game. No sheet, no toast, no pause:
/// the bookmark fills with a bounce and a light haptic.
struct SavesPlayerButton: View {
    let bubble: Bubble
    let request: BubblePlayRequest

    @Environment(BubbleStore.self) private var bubbleStore
    @State private var bounce = 0
    @State private var hintTask: Task<Void, Never>?

    var body: some View {
        Button {
            bounce += 1
            Haptics.light()
            bubbleStore.toggleSave(bubble, source: .game)
            SavesHintCenter.shared.dismiss()
        } label: {
            Image(systemName: bubble.isSaved ? "bookmark.fill" : "bookmark")
                .font(.system(size: FBIconSize.medium, weight: .bold))
                .foregroundStyle(bubble.isSaved ? Color(hex: 0x6EA8FF) : Color.white)
                .symbolEffect(.bounce, value: bounce)
                .frame(width: 36, height: 36)
                .background(Color.black.opacity(0.32), in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(bubble.isSaved ? "Unsave \(bubble.title)" : "Save \(bubble.title)")
        .accessibilityValue(SavesCopy.savesCount(bubble.saveCount))
        .overlay(alignment: .topTrailing) {
            if SavesHintCenter.shared.isVisible {
                SavesHintView { SavesHintCenter.shared.dismiss() }
                    .frame(width: 250)
                    .offset(x: 0, y: 50)
                    .transition(.opacity)
            }
        }
        .zIndex(1)
        .task {
            guard SavesHintCenter.shared.isVisible else { return }
            // Closing the player cancels this; only a full 12 s on screen counts as seen.
            guard (try? await Task.sleep(nanoseconds: 12_000_000_000)) != nil else { return }
            withAnimation(.easeOut(duration: 0.2)) { SavesHintCenter.shared.dismiss() }
        }
    }
}

/// Saves stats above the Library sections: how often your games were saved this week and your
/// most-saved game.
struct SavesLibraryStats: View {
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let mine = SavesSocialProof.myBubblesBySaves(bubbleStore)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "bookmark.fill")
                    .foregroundStyle(FBColor.accent)
                Text(mine.isEmpty ? SavesCopy.libraryEmptyTitle : SavesCopy.libraryWeekly(SavesSocialProof.myWeeklySaves(bubbleStore)))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            if let top = mine.first {
                topRow(top)
            } else {
                Text(SavesCopy.libraryEmptyBody)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .padding(.horizontal, FBMetrics.screenPadding)
    }

    private func topRow(_ top: Bubble) -> some View {
        HStack(spacing: 12) {
            Button {
                router.push(.bubbleFeature(BubbleFeatureRoute(.saves, "stats", top.id)))
            } label: {
                HStack(spacing: 12) {
                    BubbleCoverView(bubble: top, showsEmoji: false)
                        .frame(width: 48, height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(SavesCopy.mostSaved)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                        Text("\(top.title) · \(SavesCopy.savesCount(top.saveCount))")
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(SavesCopy.mostSaved): \(top.title), \(SavesCopy.savesCount(top.saveCount)). See who saved it")
            Button {
                Haptics.light()
                bubbleStore.toggleSave(top, source: .library)
            } label: {
                Image(systemName: top.isSaved ? "bookmark.fill" : "bookmark")
                    .font(.system(size: FBIconSize.large, weight: .semibold))
                    .foregroundStyle(top.isSaved ? FBColor.accent : FBColor.secondaryText)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(top.isSaved ? "Unsave \(top.title)" : "Save \(top.title)")
        }
    }
}
