import Foundation

extension BubbleSurfaceHooks {
    /// Floats a Bubble as a post: into `group` when given, otherwise to my feed. Pass `result` to
    /// attach the run as a Burst ("I got 42, beat it"). Returns the new post.
    @discardableResult
    static func float(_ bubble: Bubble, result: BubbleRunResult?, to group: FBGroup?, message: String, appStore: AppStore, bubbleStore: BubbleStore) -> Post? {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let text: String
        if !trimmed.isEmpty {
            text = trimmed
        } else if let result {
            text = "Scored \(result.score) in \(bubble.title). Beat it?"
        } else if let group {
            text = "Shared \(bubble.title) to \(group.name) ✨"
        } else {
            text = "Shared \(bubble.title) ✨"
        }
        let post = appStore.createPost(text: text, audience: group == nil ? .friends : .everyone, group: group)
        post.bubbleID = bubble.id
        post.bubbleReplay = result?.replay ?? bubble.featuredRun?.replay
        post.isUploading = false
        FeedEventReporter.shared.note(.floated, gameID: bubble.id)
        appStore.showToast(group.map { "Shared to \($0.name)" } ?? "Shared to your feed", symbol: "sparkles")
        return post
    }
}
