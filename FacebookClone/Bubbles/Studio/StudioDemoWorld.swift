import Foundation

/// The synthetic New in SF world (`Bubbles/Seeds/bubble-demo-world.json`, docs/BUBBLES.md 4.7):
/// the Group, the newcomers' picnic, ten newcomers with intros and facts, and SF words. The
/// offline composer and the CLI read it. Synthetic people only.
struct StudioDemoWorld: Sendable {
    struct Person: Sendable, Hashable {
        var id: String
        var firstName: String
        var lastName: String
        var hometown: String
        var work: String
        var neighborhood: String
        var intro: String
        var facts: [String]
        var isFriend: Bool
        var goingToPicnic: Bool
        /// Synthetic portrait (randomuser.me id), as the app's mock people use.
        var portrait: Int?
        var female: Bool

        var avatarURL: String? {
            portrait.map { "https://randomuser.me/api/portraits/\(female ? "women" : "men")/\($0).jpg" }
        }
    }

    var groupID: String
    var groupName: String
    var groupAbout: String
    var eventID: String
    var eventTitle: String
    var eventLocation: String
    var people: [Person]
    var sfWords: [String]

    static let resourceName = "bubble-demo-world"

    /// From the app bundle (resources are copied flat into its root).
    static func load(bundle: Bundle = .main) -> StudioDemoWorld? {
        guard let url = bundle.url(forResource: resourceName, withExtension: "json") else { return nil }
        return load(url: url)
    }

    static func load(url: URL) -> StudioDemoWorld? {
        guard let data = try? Data(contentsOf: url), let value = try? JSONValue.parse(data) else { return nil }
        return StudioDemoWorld(json: value)
    }

    init?(json: JSONValue) {
        guard let group = json["group"], let groupID = group["id"]?.string else { return nil }
        self.groupID = groupID
        groupName = group["name"]?.string ?? "New in SF"
        groupAbout = group["about"]?.string ?? ""
        let event = json["event"]
        eventID = event?["id"]?.string ?? "event-newcomers-picnic"
        eventTitle = event?["title"]?.string ?? "Newcomers' picnic"
        eventLocation = event?["location_name"]?.string ?? "Dolores Park"
        people = (json["people"]?.array ?? []).compactMap { item in
            guard let id = item["id"]?.string, let first = item["first_name"]?.string else { return nil }
            return Person(
                id: id,
                firstName: first,
                lastName: item["last_name"]?.string ?? "",
                hometown: item["hometown"]?.string ?? "",
                work: item["work"]?.string ?? "",
                neighborhood: item["neighborhood"]?.string ?? "",
                intro: item["intro"]?.string ?? "",
                facts: item["facts"]?.strings ?? [],
                isFriend: item["is_friend"]?.bool ?? false,
                goingToPicnic: item["going_to_picnic"]?.bool ?? false,
                portrait: item["portrait"]?.int,
                female: item["female"]?.bool ?? false
            )
        }
        sfWords = json["sf_words"]?.strings ?? []
    }

    var picnicGoers: [Person] { people.filter(\.goingToPicnic) }

    func person(named name: String) -> Person? {
        let key = name.trimmingCharacters(in: .whitespaces).lowercased()
        return people.first { $0.firstName.lowercased() == key || "\($0.firstName) \($0.lastName)".lowercased() == key }
    }

    /// Adds demo portraits to people Muse named in content (`people[]` and `choices[]` objects
    /// with a `name` and no `avatar`). Returns how many it filled.
    func fillAvatars(in content: inout JSONValue) -> Int {
        var filled = 0
        func walk(_ value: JSONValue) -> JSONValue {
            switch value {
            case .array(let items):
                return .array(items.map(walk))
            case .object(var object):
                if let name = object["name"]?.string, object["avatar"] == nil || object["avatar"]?.string?.isEmpty == true,
                   let url = person(named: name)?.avatarURL {
                    object["avatar"] = .string(url)
                    filled += 1
                }
                return .object(object.mapValues(walk))
            default:
                return value
            }
        }
        content = walk(content)
        return filled
    }

    /// Opted-in intros posted in New in SF, as Daily Bubble sources.
    func groupSources(limit: Int? = nil) -> [StudioSource] {
        let sources = people.filter { !$0.intro.isEmpty }.map { StudioSource(author: $0.firstName, text: $0.intro) }
        guard let limit else { return sources }
        return Array(sources.prefix(limit))
    }

    /// What picnic attendees shared about themselves, as icebreaker sources.
    func eventSources(limit: Int? = nil) -> [StudioSource] {
        let sources = picnicGoers.map { person in
            StudioSource(author: person.firstName, text: person.facts.joined(separator: ". ") + ".")
        }
        guard let limit else { return sources }
        return Array(sources.prefix(limit))
    }

    /// A ready request for a scope in the demo world: `group:<id>` or `event:<id>`.
    func scope(for id: String) -> (scope: String, name: String, audience: [String])? {
        if id == groupID || id == "group:\(groupID)" {
            return ("group:\(groupID)", groupName, people.map(\.firstName))
        }
        if id == eventID || id == "event:\(eventID)" {
            return ("event:\(eventID)", eventTitle, picnicGoers.map(\.firstName))
        }
        return nil
    }
}
