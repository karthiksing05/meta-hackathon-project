import SwiftUI

// Slot views for the "story" feature (docs/BUBBLES.md 7.6). Owner: story.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// After an ending: endings found, friends' endings, 'Maya took the ferry', send your path.
struct StoryResultEndings: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// Endings found and friends' paths on the Bubble page.
struct StoryDetailEndings: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// Studio Ask entry: turn your own story into an adventure.
struct StoryStudioEntry: View {
    let model: StudioModel

    var body: some View {
        EmptyView()
    }
}

/// Path cards ('Maya took the ferry').
struct StoryCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        BubbleChatCardFallback(card: card, placement: placement)
    }
}
