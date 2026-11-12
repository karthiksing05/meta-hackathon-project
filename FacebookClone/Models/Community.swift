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
