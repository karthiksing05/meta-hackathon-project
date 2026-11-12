import SwiftUI

// Slot views for the "remix" feature (docs/BUBBLES.md 7.5). Owner: remix.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift.

/// Remix and Share on the result sheet, plus 'Send it back' for your own remix of someone's game.
struct RemixResultAction: View {
    let slot: BubbleResultSlotContext

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var showShare = false
    @State private var showSendBack = false

    var body: some View {
        let bubble = slot.bubble
        VStack(spacing: 8) {
            if RemixSendBack.canSendBack(bubble, store: bubbleStore),
               let name = RemixLineage.originalCreator(of: bubble, store: bubbleStore)?.firstName {
                let sent = RemixCenter.shared.sentBack.contains(bubble.id)
                Button {
                    Haptics.light()
                    showSendBack = true
                } label: {
                    Label(sent ? RemixCopy.sentBackTo(name) : RemixCopy.sendBackTo(name),
                          systemImage: sent ? "checkmark" : "arrowshape.turn.up.backward.fill")
                }
                .buttonStyle(.fb(.tinted, height: 44))
            }
            HStack(spacing: 8) {
                Button {
                    Haptics.light()
                    remix(bubble)
                } label: {
                    Label(RemixCopy.remix, systemImage: "wand.and.sparkles")
                }
                .buttonStyle(.fb(.tinted, height: 44))
                .accessibilityHint(RemixCopy.remixHint(bubble.title))
                Button {
                    Haptics.light()
                    showShare = true
                } label: {
                    Label(RemixCopy.share, systemImage: "paperplane.fill")
                }
                .buttonStyle(.fb(.tinted, height: 44))
                .accessibilityHint(RemixCopy.shareSubtitle)
            }
        }
        // The result sheet sits under the player's cover: present locally.
        .sheet(isPresented: $showShare) {
            RemixShareSheet(bubble: bubble, result: slot.result.result, request: slot.request)
        }
        .sheet(isPresented: $showSendBack) {
            RemixSendBackSheet(bubbleID: bubble.id, exitPlayer: slot.exitPlayer)
        }
    }

    private func remix(_ bubble: Bubble) {
        let id = bubble.id
        if slot.exitPlayer != nil {
            slot.leavingPlayer {
                router.openStudio(StudioLaunch(mode: .remix, baseBubbleID: id))
            }
        } else {
            // Shown from the Bubbles feed: close this sheet first, then open Studio.
            RemixNav.openStudio(remixing: id, router: router, dismiss: { dismiss() })
        }
    }
}

/// 'Remixed by Diego · from Maya' / 'Remix of Hill Hopper by Diego' on feed pages, or '3 remixes'
/// on an original that friends have riffed on. White on the page's dark scrim.
struct RemixCaptionCredit: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        if let text = Self.text(for: bubble, in: bubbleStore) {
            HStack(spacing: 5) {
                Image(systemName: "wand.and.sparkles")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                Text(text)
                    .font(.fbCaptionEmphasized)
                    .lineLimit(1)
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.black.opacity(0.32), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(text)
        }
    }

    /// The credit text alone, for the feed page's one-line meta row.
    static func text(for bubble: Bubble, in bubbleStore: BubbleStore) -> String? {
        if RemixLineage.isRemix(bubble) {
            let creator = bubble.creator
            if creator.isFriend {
                let original = RemixLineage.originalCreator(of: bubble, store: bubbleStore)
                let from: String
                if let original, original.isMe {
                    from = RemixCopy.yourGame
                } else {
                    from = original?.firstName ?? bubble.manifest.lineage.remixOfTitle ?? ""
                }
                return from.isEmpty ? RemixCopy.remixedBy(creator.firstName) : RemixCopy.remixedByFrom(creator.firstName, original: from)
            }
            return RemixLineage.credit(for: bubble, store: bubbleStore)
        }
        let count = RemixLineage.descendants(of: bubble, in: bubbleStore.bubbles).count
        return count > 0 ? RemixCopy.remixCount(count) : nil
    }
}

/// Remix count and a small remix tree on the Bubble page, the credit for a remix with 'Open
/// original', and 'Send it back' for your own remix of someone else's game.
struct RemixDetailTree: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    @State private var showSendBack = false

    var body: some View {
        let isRemix = RemixLineage.isRemix(bubble)
        let tree = RemixLineage.tree(around: bubble, in: bubbleStore.bubbles)
        let mine = RemixLineage.descendants(of: bubble, in: bubbleStore.bubbles).count
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(RemixCopy.treeTitle)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                if mine > 0 {
                    Text(RemixCopy.remixCount(mine))
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer()
                if tree.totalRemixes > 0 {
                    Button(RemixCopy.seeAll) {
                        router.push(.bubbleFeature(RemixScreens.route(RemixScreens.tree, bubble.id)))
                    }
                    .font(.fbButton)
                    .foregroundStyle(FBColor.accent)
                    .accessibilityLabel(RemixCopy.seeAllLabel)
                }
            }
            if isRemix {
                creditRow
            }
            if tree.totalRemixes > 0 {
                RemixTreeView(bubble: bubble)
                    .padding(6)
                    .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                RemixPeopleRow(bubble: bubble)
            } else {
                Text(RemixCopy.treeEmpty)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if RemixSendBack.canSendBack(bubble, store: bubbleStore),
               let name = RemixLineage.originalCreator(of: bubble, store: bubbleStore)?.firstName {
                let sent = RemixCenter.shared.sentBack.contains(bubble.id)
                Button {
                    Haptics.light()
                    showSendBack = true
                } label: {
                    Label(sent ? RemixCopy.sentBackTo(name) : RemixCopy.sendBackTo(name),
                          systemImage: sent ? "checkmark" : "arrowshape.turn.up.backward.fill")
                }
                .buttonStyle(.fb(.primary, height: 40))
            }
        }
        .sheet(isPresented: $showSendBack) {
            RemixSendBackSheet(bubbleID: bubble.id)
        }
    }

    @ViewBuilder
    private var creditRow: some View {
        HStack(spacing: 8) {
            if let credit = RemixLineage.credit(for: bubble, store: bubbleStore) {
                RemixCreditPill(text: credit)
            }
            Spacer(minLength: 0)
            if let original = RemixLineage.original(of: bubble, in: bubbleStore.bubbles) {
                Button {
                    Haptics.light()
                    router.push(.bubble(original.id))
                } label: {
                    Text(RemixCopy.openOriginal)
                        .font(.fbButton)
                        .foregroundStyle(FBColor.accent)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(RemixCopy.openOriginalLabel(original.title))
            }
        }
    }
}
