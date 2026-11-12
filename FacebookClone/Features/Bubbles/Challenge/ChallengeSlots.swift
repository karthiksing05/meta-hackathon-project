import SwiftUI

// Slot views for the "challenge" feature (docs/BUBBLES.md 7.2). Owner: challenge.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// Head-to-head line on the result sheet when the play was a challenge or session ('You 41, Maya 34').
struct ChallengeResultHeadToHead: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// 'Challenge Me' next to Save and Share; opens the picker; 'Challenge back' after a challenge.
struct ChallengeResultAction: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// 'Challenge a friend' row on the Bubble page.
struct ChallengeDetailRow: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// 'Beat Maya's 34' banner while playing a challenge or session.
struct ChallengePlayerBanner: View {
    let bubble: Bubble
    let request: BubblePlayRequest
    let score: Int

    var body: some View {
        EmptyView()
    }
}

/// Rivalry line and Challenge button on a person's profile ('You vs Maya: 3-2 this week').
struct ChallengeProfileRivalry: View {
    let user: User

    var body: some View {
        EmptyView()
    }
}

/// Challenge button on friend rows (pick a game).
struct ChallengeFriendButton: View {
    let user: User

    var body: some View {
        EmptyView()
    }
}

/// Challenge, session and share cards in chats and posts.
struct ChallengeCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        BubbleChatCardFallback(card: card, placement: placement)
    }
}
