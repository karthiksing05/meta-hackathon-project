import Foundation

extension AppStore {
    /// Applies the composer's extra edits to an existing post. `updatePost(_:text:audience:)`
    /// covers the text and audience; this covers feeling, check-in, tags and background.
    func homeApplyEdits(to post: Post, feeling: Feeling?, location: String?, taggedUsers: [User], backgroundIndex: Int?) {
        post.feeling = feeling
        post.location = location
        post.taggedUsers = taggedUsers
        if post.media.isEmpty && post.link == nil && post.sharedPost == nil && post.poll == nil {
            post.backgroundIndex = backgroundIndex
        }
    }

    /// "Share > Write post" counts as a share of the original post.
    func homeCountShare(of post: Post) {
        post.shareCount += 1
    }
}
