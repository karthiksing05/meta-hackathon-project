import Foundation
import Observation

enum NotificationKind: Hashable {
    case reaction(ReactionType)
    case comment
    case reply
    case mention
    case tag
    case share
    case friendRequest
    case friendAccepted
    case birthday
    case groupPost
    case groupInvite
    case event
    case memory
    case live
    case marketplace
    case pageInvite
    case video
    case suggestion
}

enum FriendRequestAction: String, Hashable {
    case confirmed
    case deleted
}

/// A row in the Notifications tab. Named `AppNotification` to avoid Foundation's `Notification`.
@Observable
final class AppNotification: Identifiable, Hashable {
    let id: String
    var kind: NotificationKind
    var actors: [User]
    /// Extra people beyond `actors`, shown as "and 12 others".
    var extraActorCount: Int
    /// Text after the actor names, e.g. "commented on your post: \"So true!\"".
    var message: String
    var createdAt: Date
    var isRead: Bool
    var postID: String?
    var userID: String?
    var groupID: String?
    var eventID: String?
    var listingID: String?
    var thumbnailURL: URL?
    /// Friend requests answered from the notification row.
    var requestAction: FriendRequestAction?

    init(
        id: String = UUID().uuidString,
        kind: NotificationKind,
        actors: [User] = [],
        extraActorCount: Int = 0,
        message: String,
        createdAt: Date = Date(),
        isRead: Bool = false,
        postID: String? = nil,
        userID: String? = nil,
        groupID: String? = nil,
        eventID: String? = nil,
        listingID: String? = nil,
        thumbnailURL: URL? = nil
    ) {
        self.id = id
        self.kind = kind
        self.actors = actors
        self.extraActorCount = extraActorCount
        self.message = message
        self.createdAt = createdAt
        self.isRead = isRead
        self.postID = postID
        self.userID = userID
        self.groupID = groupID
        self.eventID = eventID
        self.listingID = listingID
        self.thumbnailURL = thumbnailURL
        self.requestAction = nil
    }

    /// "Maria Lopez", "Maria Lopez and Sam Lee", "Maria Lopez, Sam Lee and 3 others".
    var actorsText: String {
        guard let first = actors.first else { return "" }
        if actors.count == 1 {
            if extraActorCount == 0 { return first.name }
            return "\(first.name) and \(extraActorCount) \(extraActorCount == 1 ? "other" : "others")"
        }
        let second = actors[1]
        let others = actors.count - 2 + extraActorCount
        if others == 0 { return "\(first.name) and \(second.name)" }
        return "\(first.name), \(second.name) and \(others) \(others == 1 ? "other" : "others")"
    }

    static func == (lhs: AppNotification, rhs: AppNotification) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
