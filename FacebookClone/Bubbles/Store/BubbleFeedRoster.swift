import Foundation

// The synthetic New in SF cast, still used by the collaboration features until Stage 2 of
// docs/APP_LIVE_DATA_PLAN.md replaces it with the server's people. Games, boards and the feed no
// longer read it.

/// `bubble-demo-world.json`, read for the Bubble roster. Names and ids match the mock data.
struct BubbleRoster: Decodable {
    struct Person: Decodable {
        var id: String
        var firstName: String
        var lastName: String
        var female: Bool
        var portrait: Int
        var hometown: String
        var work: String
        var neighborhood: String
        var movedWeeksAgo: Int
        var intro: String
        var isFriend: Bool
        var goingToPicnic: Bool
    }

    struct GroupInfo: Decodable {
        var id: String
        var name: String
        var category: String
        var about: String
        var memberCount: Int
        var isPrivate: Bool
        var coverSeed: String
    }

    struct EventInfo: Decodable {
        var id: String
        var title: String
        var locationName: String
        var address: String
        var latitude: Double
        var longitude: Double
        var startsInDays: Int
        var startHour: Int
        var durationHours: Int
        var hostName: String
        var category: String
        var details: String
        var goingCount: Int
        var interestedCount: Int
        var coverSeed: String
    }

    var group: GroupInfo
    var event: EventInfo
    var people: [Person]

    static let bundled: BubbleRoster? = {
        guard let url = Bundle.main.url(forResource: "bubble-demo-world", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try? decoder.decode(BubbleRoster.self, from: data)
    }()

    func person(id: String) -> Person? {
        people.first { $0.id == id }
    }

    /// How well someone plays, 0...1. Hand-tuned for the cast so the boards tell the story
    /// (Maya runs Lands End every Saturday; she is good at everything), hashed for everyone else.
    static func skill(of userID: String) -> Double {
        let tuned: [String: Double] = [
            "sf-maya-okafor": 0.9,
            "sf-diego-ramirez": 0.8,
            "sf-aiko-tanaka": 0.84,
            "sf-lena-fischer": 0.74,
            "sf-chloe-nguyen": 0.7,
            "sf-theo-adeyemi": 0.66,
            "sf-priya-natarajan": 0.6,
            "sf-sam-whitfield": 0.55,
            "sf-jordan-brooks": 0.5,
            "sf-omar-haddad": 0.44,
        ]
        if let value = tuned[userID] { return value }
        return 0.34 + unit("skill|\(userID)") * 0.56
    }

    /// A stable number in 0..<1 for `key`.
    static func unit(_ key: String) -> Double {
        Double(SeededGenerator.stableHash(key) % 10_000) / 10_000
    }
}

// MARK: - Cast in the store

extension BubbleStore {
    /// The person behind a demo-world id (collaboration features only, until Stage 2).
    func resolvePerson(_ id: String?) -> User {
        guard let id, !id.isEmpty, id != "me", id != appStore.me.id else { return appStore.me }
        if let user = appStore.user(id: id) { return user }
        if let person = BubbleRoster.bundled?.person(id: id) {
            let user = User(
                id: person.id,
                firstName: person.firstName,
                lastName: person.lastName,
                avatarURL: MockDataFactory.portrait(female: person.female, index: person.portrait),
                bio: person.intro,
                city: "San Francisco, California",
                hometown: person.hometown,
                work: person.work,
                friendCount: 60 + person.portrait * 3,
                mutualFriendCount: person.isFriend ? 0 : 2 + person.portrait % 7,
                friendship: person.isFriend ? .friends : .none,
                isFollowing: person.isFriend
            )
            return user
        }
        return appStore.friends.first ?? appStore.me
    }

    /// A Group the server sent, or nil (and a fetch starts) when it isn't known yet.
    func resolveGroup(_ id: String?) -> FBGroup? {
        guard let id, !id.isEmpty else { return nil }
        if let group = serverGroups[id] { return group }
        loadGroup(id: id)
        return nil
    }

    func resolveEvent(_ id: String?) -> FBEvent? {
        guard let id, !id.isEmpty else { return nil }
        if let event = appStore.event(id: id) { return event }
        guard let roster = BubbleRoster.bundled, roster.event.id == id else { return nil }
        let info = roster.event
        let calendar = Calendar.current
        let day = calendar.date(byAdding: .day, value: info.startsInDays, to: calendar.startOfDay(for: Date())) ?? Date()
        let start = calendar.date(bySettingHour: info.startHour, minute: 0, second: 0, of: day) ?? day
        let event = FBEvent(
            id: info.id,
            title: info.title,
            coverURL: MockDataFactory.photo(info.coverSeed, 1200, 600),
            startDate: start,
            endDate: start.addingTimeInterval(Double(info.durationHours) * 3600),
            locationName: info.locationName,
            address: info.address,
            latitude: info.latitude,
            longitude: info.longitude,
            hostName: info.hostName,
            details: info.details,
            category: info.category,
            goingCount: info.goingCount,
            interestedCount: info.interestedCount,
            response: .going,
            friendsGoing: roster.people.filter { $0.goingToPicnic && $0.isFriend }.map { resolvePerson($0.id) }
        )
        return event
    }

    /// Plausible "higher is better" ranges per formula, for stand-in scores.
    static func scoreRange(for formula: BubbleFormula) -> ClosedRange<Double> {
        switch formula {
        case .dodge: return 4...58
        case .time: return 3...34
        case .merge: return 180...2_600
        case .guess: return 10...60
        case .group: return 4...16
        case .answer: return 2...10
        case .make: return 1...20
        case .story: return 20...120
        case .nextline: return 200...1_600
        case .learn: return 3...12
        case .microgame: return 10...400
        }
    }

    static func syntheticScore(for bubble: Bubble, userID: String) -> Int {
        let range = scoreRange(for: bubble.formula)
        let noise = BubbleRoster.unit("score|\(bubble.id)|\(userID)")
        let level = min(1, max(0.04, BubbleRoster.skill(of: userID) * (0.72 + 0.5 * noise)))
        let value = range.lowerBound + (range.upperBound - range.lowerBound) * level
        return bubble.formula == .merge ? Int(value / 10) * 10 : Int(value.rounded())
    }

}
