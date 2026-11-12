import SwiftUI

// Slot views for the "together" feature (docs/BUBBLES.md 7.4). Owner: together.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// 'Made by Maya, Leo and you' credits on the Bubble page.
struct TogetherDetailCredits: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// 'Make a game together' row on the Group's Games tab.
struct TogetherGroupMakeRow: View {
    let group: FBGroup

    var body: some View {
        EmptyView()
    }
}

/// 'Games about me' section on a profile's Bubbles tab, with who knows them best.
struct TogetherProfileAboutMe: View {
    let user: User

    var body: some View {
        EmptyView()
    }
}

/// Studio Ask entries: Make it together, Games about me.
struct TogetherStudioEntry: View {
    let model: StudioModel

    var body: some View {
        EmptyView()
    }
}

/// Contribution and invite cards.
struct TogetherCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        BubbleChatCardFallback(card: card, placement: placement)
    }
}
