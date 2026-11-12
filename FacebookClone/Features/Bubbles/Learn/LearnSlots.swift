import SwiftUI

// Slot views for the "learn" feature (docs/BUBBLES.md 7.8). Owner: learn.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// What you learned, mastery and streak on the result sheet.
struct LearnResultRecap: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// Mastery and friends' streaks on a lesson's page.
struct LearnDetailMastery: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// Group mastery meter ('New in SF knows 82% of the hills').
struct LearnGroupMastery: View {
    let group: FBGroup

    var body: some View {
        EmptyView()
    }
}

/// Learning streak on a profile's Bubbles tab.
struct LearnProfileStreak: View {
    let user: User

    var body: some View {
        EmptyView()
    }
}

/// Friends' streaks above the Library sections.
struct LearnLibraryStreaks: View {

    var body: some View {
        EmptyView()
    }
}

/// Studio Ask entry: turn a topic or notes into a lesson.
struct LearnStudioEntry: View {
    let model: StudioModel

    var body: some View {
        EmptyView()
    }
}

/// Shared lesson cards.
struct LearnCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        BubbleChatCardFallback(card: card, placement: placement)
    }
}
