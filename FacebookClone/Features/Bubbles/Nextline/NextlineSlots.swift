import SwiftUI

// Slot views for the "nextline" feature (docs/BUBBLES.md 7.7). Owner: nextline.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// Quiz night round summary and podium on the result sheet.
struct NextlineResultSummary: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// 'Start a quiz night' row on the Bubble page.
struct NextlineDetailRow: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// Live 'who has answered' strip during a quiz night.
struct NextlinePlayerBanner: View {
    let bubble: Bubble
    let request: BubblePlayRequest
    let score: Int

    var body: some View {
        EmptyView()
    }
}

/// Quiz night card on the Group's Games tab.
struct NextlineGroupGameNight: View {
    let group: FBGroup

    var body: some View {
        EmptyView()
    }
}

/// 'Quiz night tonight' banner in the Featured tab.
struct NextlineFeaturedBanner: View {
    let group: FBGroup

    var body: some View {
        EmptyView()
    }
}

/// Game night cards in chats and Group posts.
struct NextlineCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        BubbleChatCardFallback(card: card, placement: placement)
    }
}
