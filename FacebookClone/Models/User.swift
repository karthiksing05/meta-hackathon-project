import Foundation
import Observation

enum AccountKind: String, Hashable {
    case person
    case page
}

enum FriendshipStatus: String, Hashable {
    case me
    case none
    case requestSent
    case requestReceived
    case friends
}

/// A person or a Page. The signed-in user is a `User` whose `friendship` is `.me`.
@Observable
final class User: Identifiable, Hashable {
    let id: String
    var firstName: String
    var lastName: String
    var kind: AccountKind
    /// Pages only, e.g. "Restaurant" or "Science website".
    var category: String?
    var avatarURL: URL?
    var coverURL: URL?
    /// Set when the signed-in user picks a new photo from their library.
    var avatarData: Data?
    var coverData: Data?
    /// `"#RRGGBB"` from the server: the profile cover when there's no cover photo.
    var coverColor: String?
    var bio: String
    var city: String
    var hometown: String
    var work: String
    var school: String
    var relationship: String
    var website: String?
    var joinedDate: Date
    var birthdayMonth: Int
    var birthdayDay: Int
    var friendCount: Int
    var followerCount: Int
    var mutualFriendCount: Int
    var friendship: FriendshipStatus
    /// When a pending friend request was sent or received.
    var requestDate: Date?
    var isFollowing: Bool
    var isFavorite: Bool
    var isSnoozed: Bool
    var isOnline: Bool
    var lastActive: Date
    var isVerified: Bool

    init(
        id: String = UUID().uuidString,
        firstName: String,
        lastName: String = "",
        kind: AccountKind = .person,
        category: String? = nil,
        avatarURL: URL? = nil,
        coverURL: URL? = nil,
        bio: String = "",
        city: String = "",
        hometown: String = "",
        work: String = "",
        school: String = "",
        relationship: String = "",
        website: String? = nil,
        joinedDate: Date = Date(),
        birthdayMonth: Int = 1,
        birthdayDay: Int = 1,
        friendCount: Int = 0,
        followerCount: Int = 0,
        mutualFriendCount: Int = 0,
        friendship: FriendshipStatus = .none,
        requestDate: Date? = nil,
        isFollowing: Bool = true,
        isFavorite: Bool = false,
        isSnoozed: Bool = false,
        isOnline: Bool = false,
        lastActive: Date = Date(),
        isVerified: Bool = false
    ) {
        self.id = id
        self.firstName = firstName
        self.lastName = lastName
        self.kind = kind
        self.category = category
        self.avatarURL = avatarURL
        self.coverURL = coverURL
        self.avatarData = nil
        self.coverData = nil
        self.bio = bio
        self.city = city
        self.hometown = hometown
        self.work = work
        self.school = school
        self.relationship = relationship
        self.website = website
        self.joinedDate = joinedDate
        self.birthdayMonth = birthdayMonth
        self.birthdayDay = birthdayDay
        self.friendCount = friendCount
        self.followerCount = followerCount
        self.mutualFriendCount = mutualFriendCount
        self.friendship = friendship
        self.requestDate = requestDate
        self.isFollowing = isFollowing
        self.isFavorite = isFavorite
        self.isSnoozed = isSnoozed
        self.isOnline = isOnline
        self.lastActive = lastActive
        self.isVerified = isVerified
    }

    var name: String {
        lastName.isEmpty ? firstName : "\(firstName) \(lastName)"
    }

    var initials: String {
        let letters = [firstName.first, lastName.first].compactMap { $0 }
        return String(letters).uppercased()
    }

    var isPage: Bool { kind == .page }
    var isMe: Bool { friendship == .me }
    var isFriend: Bool { friendship == .friends }

    /// "Active now", "Active 5m ago", "Active 2h ago".
    var activeStatusText: String {
        if isOnline { return "Active now" }
        let minutes = Int(Date().timeIntervalSince(lastActive) / 60)
        if minutes < 60 { return "Active \(max(minutes, 1))m ago" }
        let hours = minutes / 60
        if hours < 24 { return "Active \(hours)h ago" }
        return "Active \(hours / 24)d ago"
    }

    var hasBirthdayToday: Bool {
        let today = Calendar.current.dateComponents([.month, .day], from: Date())
        return today.month == birthdayMonth && today.day == birthdayDay
    }

    static func == (lhs: User, rhs: User) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
