import Foundation

extension BubbleSurfaceHooks {
    /// Stories with Bubbles. Called once at launch from `BubbleSurfaceHooks.install`.
    ///
    /// Gives a few friends a Bubble item on their story so the tray shows Bubbles from day one.
    /// Demo-world people are used when they exist; otherwise the first friends with stories.
    static func installStories(appStore: AppStore, bubbleStore: BubbleStore) {
        let picks: [(userID: String, bubbleID: String, minutesAgo: Int)] = [
            ("sf-maya-okafor", "hill-hopper", 26),
            ("sf-diego-ramirez", "newinsf-daily-fog-words", 58),
            ("sf-priya-natarajan", "bay-bubbles", 95),
        ]
        var usedAuthors: Set<String> = []
        var fallbackIndex = 0
        for pick in picks {
            guard let bubble = bubbleStore.bubble(id: pick.bubbleID) else { continue }

            var author = appStore.user(id: pick.userID)
            if author == nil {
                while fallbackIndex < appStore.stories.count, author == nil {
                    let candidate = appStore.stories[fallbackIndex].author
                    fallbackIndex += 1
                    if !usedAuthors.contains(candidate.id) { author = candidate }
                }
            }
            guard let author, !usedAuthors.contains(author.id) else { continue }
            usedAuthors.insert(author.id)

            let run = bubble.featuredRun
            let item = StoryItem(
                id: "item-bubble-\(bubble.id)-\(author.id)",
                content: .bubble(id: bubble.id, replay: run?.replay, score: run?.score ?? 42),
                createdAt: Date().addingTimeInterval(-Double(pick.minutesAgo) * 60),
                duration: storyDuration(for: run?.replay),
                viewerCount: 40 + pick.minutesAgo
            )
            if let existing = appStore.stories.first(where: { $0.author.id == author.id }) {
                // Lead with the Bubble so its ring opens on it.
                existing.items.insert(item, at: 0)
            } else {
                appStore.stories.insert(Story(id: "story-bubble-\(author.id)", author: author, items: [item]), at: 0)
            }
        }
    }

    /// Adds a run to my story as a Burst ("Beat my 42 in Fog Words"). Called from the result sheet.
    /// Returns false if it could not be shared.
    @discardableResult
    static func shareToStory(_ bubble: Bubble, result: BubbleRunResult, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        let story = appStore.addStory(.bubble(id: bubble.id, replay: result.replay, score: result.score))
        if let index = story.items.indices.last {
            story.items[index].duration = storyDuration(for: result.replay)
        }
        // addStory shows its own toast; replace it with ours.
        appStore.showToast("Added to your story", symbol: "checkmark.circle.fill")
        return true
    }

    /// A Burst plays for as long as the run lasted, kept between 6 and 12 seconds.
    private static func storyDuration(for replay: BubbleInputLog?) -> TimeInterval {
        min(max(replay?.durationSec ?? 8, 6), 12)
    }
}
