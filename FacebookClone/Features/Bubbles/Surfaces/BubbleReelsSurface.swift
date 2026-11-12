import Foundation

extension BubbleSurfaceHooks {
    /// Bursts in Reels and the Video tab. Called once at launch from `BubbleSurfaceHooks.install`.
    ///
    /// Adds a few Burst reels (a `Post` with `isReel`, `bubbleID` and `bubbleReplay`) between the
    /// regular reels. Each is a replay that plays muted and can be taken over.
    static func installReels(appStore: AppStore, bubbleStore: BubbleStore) {
        let picks: [(userID: String, bubbleID: String, text: String, views: Int)] = [
            ("sf-maya-okafor", "hill-hopper", "42 on Hill Hopper. Come beat it", 5_400),
            ("sf-sam-whitfield", "cable-car-catch", "Caught the cable car by a hair", 3_100),
            ("sf-lena-fischer", "bay-bubbles", "Bay Bubbles, one more merge", 2_200),
            ("sf-theo-adeyemi", "fog-drift", "Drifting through the fog", 1_800),
        ]
        let existing = Set(appStore.reels.compactMap(\.bubbleID))
        var fallback = appStore.people.filter { !$0.isMe }.makeIterator()
        var inserted = 0
        for pick in picks where !existing.contains(pick.bubbleID) {
            guard let bubble = bubbleStore.bubble(id: pick.bubbleID) else { continue }
            guard let author = appStore.user(id: pick.userID) ?? fallback.next() else { continue }
            let burst = Post(
                id: "burst-\(bubble.id)",
                author: author,
                text: pick.text,
                createdAt: Date().addingTimeInterval(-Double(1 + inserted) * 5_400),
                isReel: true,
                viewCount: pick.views
            )
            burst.bubbleID = bubble.id
            burst.bubbleReplay = bubble.featuredRun?.replay
            let slot = min(1 + inserted * 2, appStore.reels.count)
            appStore.reels.insert(burst, at: slot)
            inserted += 1
        }
    }
}
