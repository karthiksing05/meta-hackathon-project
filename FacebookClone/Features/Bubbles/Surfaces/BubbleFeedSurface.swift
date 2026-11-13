import Foundation

extension BubbleSurfaceHooks {
    /// Floats a Bubble as a post: into `group` when given, otherwise to my feed. Pass `result` to
    /// attach the run as a Burst ("I got 42, beat it"). Returns the new post. `showsToast: false`
    /// when the caller confirms the post itself (Studio's "Posted to your feed").
    @discardableResult
    static func float(_ bubble: Bubble, result: BubbleRunResult?, to group: FBGroup?, message: String, appStore: AppStore, bubbleStore: BubbleStore, showsToast: Bool = true) -> Post? {
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
        if let group {
            let eventID = post.id // one stable server event per post, including a retry
            Task { @MainActor in
                do {
                    try await GamesAPILive.shared.shareGameToGroup(gameID: bubble.id, groupID: group.id, eventID: eventID)
                } catch {
                    appStore.showToast("Your post was created, but Group alerts couldn't be sent. Check your connection.", symbol: "exclamationmark.circle")
                }
            }
        }
        FeedEventReporter.shared.note(.floated, gameID: bubble.id)
        if showsToast {
            appStore.showToast(group.map { "Shared to \($0.name)" } ?? "Shared to your feed", symbol: "sparkles")
        }
        return post
    }
}
