import Foundation

/// Fixed IDs for the demo world (docs/BUBBLES.md, section 4.7).
enum BubbleDemo {
    /// The "New in SF" Group: the Daily Bubble and the main demo.
    static let groupID = "group-newinsf"
    /// The newcomers' picnic Event: the icebreaker Bubble.
    static let eventID = "event-newcomers-picnic"
}

/// Puts Bubbles into the rest of Facebook once, at launch, after both stores exist.
///
/// Each surface lives in its own file under `Features/Bubbles/Surfaces/` and fills in its own
/// function, so the people working on different surfaces never edit the same file.
enum BubbleSurfaceHooks {
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        installGroupsAndEvents(appStore: appStore, bubbleStore: bubbleStore)
        installFeed(appStore: appStore, bubbleStore: bubbleStore)
        installNotifications(appStore: appStore, bubbleStore: bubbleStore)
        installStories(appStore: appStore, bubbleStore: bubbleStore)
        installReels(appStore: appStore, bubbleStore: bubbleStore)
        // Collaboration (docs/BUBBLES.md 7): the shared synthetic chats first, then each feature.
        BubbleSocialCast.install(appStore: appStore, bubbleStore: bubbleStore)
        BubbleFeatureRouter.installAll(appStore: appStore, bubbleStore: bubbleStore)
    }
}
