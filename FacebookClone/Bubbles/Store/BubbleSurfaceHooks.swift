import Foundation

/// Puts games into the rest of Facebook once, at launch, after both stores exist. No game posts,
/// stories, reels or notifications are made up at launch: games reach those surfaces only when
/// you share them (`float`, `shareToStory`).
enum BubbleSurfaceHooks {
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        // Collaboration (docs/BUBBLES.md 7): each feature's launch hook. No chats are made up.
        BubbleFeatureRouter.installAll(appStore: appStore, bubbleStore: bubbleStore)
    }
}
