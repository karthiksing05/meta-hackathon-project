import Foundation

extension BubbleSurfaceHooks {
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
