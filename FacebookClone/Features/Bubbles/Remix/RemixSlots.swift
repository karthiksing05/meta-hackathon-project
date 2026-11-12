import SwiftUI

// Slot views for the "remix" feature (docs/BUBBLES.md 7.5). Owner: remix.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// Remix (and Share) on the result sheet.
struct RemixResultAction: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// 'Remixed by Maya' / 'Remix of Hill Drift by Leo' on feed pages.
struct RemixCaptionCredit: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// Remix count and a small remix tree on the Bubble page.
struct RemixDetailTree: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// 'Send it back' remix cards.
struct RemixCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        BubbleChatCardFallback(card: card, placement: placement)
    }
}
