import Foundation
import Observation

/// A Facebook group. Named `FBGroup` so it doesn't shadow SwiftUI's `Group`.
@Observable
final class FBGroup: Identifiable, Hashable {
    let id: String
    var name: String
    var coverURL: URL?
    var isPrivate: Bool
    var memberCount: Int
    var isMember: Bool
    var isAdmin: Bool
    var about: String
    var category: String
    var postsPerDay: Int
    /// New posts since the last visit.
    var unreadCount: Int
    var lastVisited: Date?
    var memberSample: [User]

    // From the games server (`GET /v1/groups/{id}`); a Group the server doesn't know keeps the
    // defaults and joins on the phone only.
    /// The server sent this Group, so joining, adding people and settings go through the API.
    var isOnServer = false
    var ownerID: String?
    var joinPolicy: GroupJoinPolicy = .open
    /// The Group says it wants new members.
    var isRecruiting = false
    /// `"#RRGGBB"`, the cover when the Group has no picture.
    var coverColor: String?
    /// I asked to join and the owner hasn't answered yet.
    var hasRequested = false
    /// The owner only: people waiting to join.
    var requestCount = 0

    init(
        id: String = UUID().uuidString,
        name: String,
        coverURL: URL? = nil,
        isPrivate: Bool = false,
        memberCount: Int = 0,
        isMember: Bool = false,
        isAdmin: Bool = false,
        about: String = "",
        category: String = "",
        postsPerDay: Int = 0,
        unreadCount: Int = 0,
        lastVisited: Date? = nil,
        memberSample: [User] = []
    ) {
        self.id = id
        self.name = name
        self.coverURL = coverURL
        self.isPrivate = isPrivate
        self.memberCount = memberCount
        self.isMember = isMember
        self.isAdmin = isAdmin
        self.about = about
        self.category = category
        self.postsPerDay = postsPerDay
        self.unreadCount = unreadCount
        self.lastVisited = lastVisited
        self.memberSample = memberSample
    }

    var privacyText: String { isPrivate ? "Private group" : "Public group" }
    var privacySymbol: String { isPrivate ? "lock.fill" : "globe.americas.fill" }

    static func == (lhs: FBGroup, rhs: FBGroup) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// How people get into a Group (the server's `joinPolicy`).
enum GroupJoinPolicy: String, CaseIterable, Identifiable, Hashable {
    /// Anyone joins.
    case open
    /// People ask; the owner approves.
    case request
    /// A member adds people.
    case invite

    var id: String { rawValue }

    init(server: String) {
        self = GroupJoinPolicy(rawValue: server) ?? .open
    }

    var title: String {
        switch self {
        case .open: return "Anyone can join"
        case .request: return "Ask to join"
        case .invite: return "Invite only"
        }
    }

    var detail: String {
        switch self {
        case .open: return "Anyone can join right away."
        case .request: return "People ask to join and you approve them."
        case .invite: return "Only members can add people."
        }
    }

    /// SF Symbol name.
    var symbol: String {
        switch self {
        case .open: return "person.3.fill"
        case .request: return "person.badge.clock.fill"
        case .invite: return "lock.fill"
        }
    }
}

enum EventResponse: String, CaseIterable, Identifiable, Hashable {
    case going
    case interested
    case notGoing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .going: return "Going"
        case .interested: return "Interested"
        case .notGoing: return "Can't go"
        }
    }

    /// SF Symbol name.
    var symbol: String {
        switch self {
        case .going: return "checkmark.circle.fill"
        case .interested: return "star.fill"
        case .notGoing: return "xmark.circle.fill"
        }
    }
}

/// An event. Named `FBEvent` to keep it distinct from system event types.
@Observable
final class FBEvent: Identifiable, Hashable {
    let id: String
    var title: String
    var coverURL: URL?
    var startDate: Date
    var endDate: Date?
    var locationName: String
    var address: String
    var latitude: Double
    var longitude: Double
    var isOnline: Bool
    var hostName: String
    var details: String
    var category: String
    var goingCount: Int
    var interestedCount: Int
    var response: EventResponse?
    var friendsGoing: [User]
    var isPrivate: Bool

    init(
        id: String = UUID().uuidString,
        title: String,
        coverURL: URL? = nil,
        startDate: Date,
        endDate: Date? = nil,
        locationName: String,
        address: String = "",
        latitude: Double = 0,
        longitude: Double = 0,
        isOnline: Bool = false,
        hostName: String,
        details: String = "",
        category: String = "",
        goingCount: Int = 0,
        interestedCount: Int = 0,
        response: EventResponse? = nil,
        friendsGoing: [User] = [],
        isPrivate: Bool = false
    ) {
        self.id = id
        self.title = title
        self.coverURL = coverURL
        self.startDate = startDate
        self.endDate = endDate
        self.locationName = locationName
        self.address = address
        self.latitude = latitude
        self.longitude = longitude
        self.isOnline = isOnline
        self.hostName = hostName
        self.details = details
        self.category = category
        self.goingCount = goingCount
        self.interestedCount = interestedCount
        self.response = response
        self.friendsGoing = friendsGoing
        self.isPrivate = isPrivate
    }

    static func == (lhs: FBEvent, rhs: FBEvent) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
