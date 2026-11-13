import Foundation

/// Fixed IDs for the demo world (docs/BUBBLES.md, section 4.7).
enum BubbleDemo {
    /// The "New in SF" Group: the Daily Bubble and the main demo.
    static let groupID = "group-newinsf"
    /// The newcomers' picnic Event: the icebreaker Bubble.
    static let eventID = "event-newcomers-picnic"
}

/// Puts games into the rest of Facebook once, at launch, after both stores exist. No game posts,
/// stories, reels or notifications are made up at launch: games reach those surfaces only when
/// you share them (`float`, `shareToStory`).
enum BubbleSurfaceHooks {
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        // Collaboration (docs/BUBBLES.md 7): the shared synthetic chats first, then each feature.
        BubbleSocialCast.install(appStore: appStore, bubbleStore: bubbleStore)
        BubbleFeatureRouter.installAll(appStore: appStore, bubbleStore: bubbleStore)
    }
}
