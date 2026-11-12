import SwiftUI

// Slot views for the "saves" feature (docs/BUBBLES.md 7.10). Owner: saves.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// Save as the result sheet's primary action.
struct SavesResultAction: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// 'Saved by Maya and 37 others' on feed pages.
struct SavesCaptionProof: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// Saves stats on the Bubble page.
struct SavesDetailStats: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// One-tap Save in the player's top bar that never leaves the game.
struct SavesPlayerButton: View {
    let bubble: Bubble
    let request: BubblePlayRequest

    var body: some View {
        EmptyView()
    }
}

/// Saves stats above the Library sections.
struct SavesLibraryStats: View {

    var body: some View {
        EmptyView()
    }
}
