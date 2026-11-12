import Foundation
import Observation

@Observable
final class Comment: Identifiable, Hashable {
    let id: String
    let author: User
    var text: String
    /// Optional photo or GIF attached to the comment.
    var imageURL: URL?
    var createdAt: Date
    /// Reactions from other people. The signed-in user's reaction lives in `myReaction`.
    var reactionCounts: [ReactionType: Int]
    var myReaction: ReactionType?
    var replies: [Comment]
    var isEdited: Bool

    init(
        id: String = UUID().uuidString,
        author: User,
        text: String,
        imageURL: URL? = nil,
        createdAt: Date = Date(),
        reactionCounts: [ReactionType: Int] = [:],
        myReaction: ReactionType? = nil,
        replies: [Comment] = []
    ) {
        self.id = id
        self.author = author
        self.text = text
        self.imageURL = imageURL
        self.createdAt = createdAt
        self.reactionCounts = reactionCounts
        self.myReaction = myReaction
        self.replies = replies
        self.isEdited = false
    }

    var totalReactions: Int { ReactionMath.total(reactionCounts, mine: myReaction) }
    var topReactions: [ReactionType] { ReactionMath.top(reactionCounts, mine: myReaction) }

    static func == (lhs: Comment, rhs: Comment) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
