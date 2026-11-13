import Foundation
import Observation

/// What the learn kit reports in `share.tag` ("mastery=7/8;topic=hills-of-sf;miss=2,5"),
/// parsed (docs/BUBBLES.md 7.8).
struct LearnResultTag: Hashable {
    var right: Int
    var asked: Int
    var topic: String?
    /// Content indexes of the questions missed.
    var missed: [Int]

    var mastery: Double { asked > 0 ? Double(right) / Double(asked) : 0 }
    var text: String { "\(right)/\(asked)" }

    init(right: Int, asked: Int, topic: String? = nil, missed: [Int] = []) {
        self.right = right
        self.asked = asked
        self.topic = topic
        self.missed = missed
    }

    init?(_ tag: String?) {
        guard let tag, !tag.isEmpty else { return nil }
        var fields: [String: String] = [:]
        for pair in tag.split(separator: ";") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 { fields[parts[0]] = parts[1] }
        }
        guard let mastery = fields["mastery"] else { return nil }
        let numbers = mastery.split(separator: "/").compactMap { Int($0) }
        guard numbers.count == 2, numbers[1] > 0 else { return nil }
        self.init(
            right: numbers[0],
            asked: numbers[1],
            topic: fields["topic"],
            missed: fields["miss"]?.split(separator: ",").compactMap { Int($0) } ?? []
        )
    }
}

/// A lesson Bubble's content, read from its manifest (`learn` formula).
struct LearnLesson {
    struct Question {
        var q: String
        var point: Int?
    }

    var topic: String
    /// "the hills": the Group meter's noun phrase.
    var subject: String
    var title: String
    var points: [String]
    var questions: [Question]

    init(_ bubble: Bubble) {
        let content = bubble.manifest.content
        topic = content["topic"]?.string ?? bubble.title
        subject = content["subject"]?.string ?? topic.lowercased()
        title = content["lesson"]?["title"]?.string ?? bubble.title
        points = content["lesson"]?["points"]?.strings ?? []
        questions = (content["questions"]?.array ?? []).map {
            Question(q: $0["q"]?.string ?? "", point: $0["point"]?.int)
        }
    }

    /// Which lesson points you know after a run: true when no missed question practices it.
    func knownPoints(missed: [Int]) -> [Bool] {
        let missedPoints = Set(missed.compactMap { questions.indices.contains($0) ? questions[$0].point : nil })
        return points.indices.map { !missedPoints.contains($0) }
    }

    /// The best possible score with the default score.mastery params (100 a right answer, +20 per
    /// streak step up to 5), for turning a board score into an approximate mastery.
    static func maxScore(for bubble: Bubble) -> Int {
        let count = max(1, bubble.manifest.content["questions"]?.array?.count ?? 8)
        var params: [String: JSONValue] = [:]
        for concept in bubble.manifest.concepts where concept.use == "score.mastery" {
            params = concept.params ?? [:]
        }
        let points = params["points"]?.int ?? 100
        let bonus = params["streak_bonus"]?.int ?? 20
        return (0..<count).reduce(0) { $0 + points + bonus * min(5, $1) }
    }
}

/// Mastery, streaks and Group meters for the learn feature (docs/BUBBLES.md 7.8). Owner: learn.
///
/// - Your learning days (one per day you finish a lesson) make your streak; your best mastery
///   per lesson persists. Both live in UserDefaults; the demo world gives Alex the two days
///   before today, so the first lesson today makes a 3-day streak.
/// - Friends' and Group members' mastery comes from real bot runs of the lesson
///   (`BubbleStore.simulateRun`, its `mastery` tag), cached for the launch. Until a run lands, a
///   member's best board score stands in (score / best possible score).
/// - Friends' streaks are deterministic and synthetic, like the rest of the demo world.
@MainActor
@Observable
final class LearnProgressStore {
    static let shared = LearnProgressStore()

    private struct Saved: Codable {
        var days: [String] = []
        var best: [String: Double] = [:]
        var lastTag: [String: String] = [:]
    }

    private static let defaultsKey = "learn.progress.v1"

    /// "yyyy-MM-dd" days you finished a lesson.
    private(set) var days: Set<String> = []
    /// Your best mastery (0–1) per lesson id.
    private(set) var best: [String: Double] = [:]
    /// Your latest result tag per lesson id (for the recap on the lesson page).
    private(set) var lastTag: [String: String] = [:]
    /// Members' mastery from bot runs: lesson id → user id → 0–1.
    private(set) var memberMastery: [String: [String: Double]] = [:]
    @ObservationIgnored private var seededDemo = false
    @ObservationIgnored private var warming: Set<String> = []

    private init() {
        load()
    }

    // MARK: Lifecycle

    /// Once at launch: the demo world's learning history for Alex (the two days before today).
    /// Seeded relative to today on every launch (not once ever), so a demo on a later day still
    /// opens on a 2-day streak and a lesson today makes it 3.
    func install() {
        guard !seededDemo else { return }
        seededDemo = true
        let calendar = Calendar.current
        for offset in [1, 2] {
            if let day = calendar.date(byAdding: .day, value: -offset, to: Date()) {
                days.insert(BubbleStore.dayKey(day))
            }
        }
        save()
    }

    /// Records one of your lesson runs (idempotent per day). Returns the parsed tag.
    @discardableResult
    func notePlay(_ bubble: Bubble, tag: String?) -> LearnResultTag? {
        guard bubble.formula == .learn else { return nil }
        days.insert(BubbleStore.dayKey(Date()))
        let parsed = LearnResultTag(tag)
        if let parsed {
            best[bubble.id] = max(best[bubble.id] ?? 0, parsed.mastery)
            lastTag[bubble.id] = tag
        }
        save()
        return parsed
    }

    // MARK: Streaks

    /// Days in a row you've learned something, ending today or yesterday.
    var myStreak: Int {
        let calendar = Calendar.current
        var cursor = Date()
        if !days.contains(BubbleStore.dayKey(cursor)) {
            cursor = calendar.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        }
        var streak = 0
        while days.contains(BubbleStore.dayKey(cursor)) {
            streak += 1
            cursor = calendar.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        }
        return streak
    }

    var learnedToday: Bool { days.contains(BubbleStore.dayKey(Date())) }

    /// Someone's learning streak in days: yours from your plays; the demo world's from a
    /// hand-tuned table; everyone else's from a stable hash (some have none).
    func streak(of user: User) -> Int {
        if user.isMe { return myStreak }
        let tuned: [String: Int] = [
            "sf-aiko-tanaka": 9,
            "sf-maya-okafor": 6,
            "sf-diego-ramirez": 4,
            "sf-lena-fischer": 5,
            "sf-priya-natarajan": 3,
            "sf-theo-adeyemi": 2,
            "sf-jordan-brooks": 2,
            "sf-chloe-nguyen": 1,
            "sf-omar-haddad": 1,
            "sf-sam-whitfield": 0,
        ]
        if let value = tuned[user.id] { return value }
        let unit = BubbleRoster.unit("learn-streak|\(user.id)")
        return unit < 0.45 ? 0 : Int(unit * 8)
    }

    /// You and your friends with a streak, longest first (you always included).
    func friendsStreaks(appStore: AppStore, bubbleStore: BubbleStore) -> [(user: User, days: Int)] {
        var people: [User] = BubbleSocialCast.friendIDs.map { bubbleStore.resolvePerson($0) }
        people += appStore.friends.prefix(8)
        people += BubbleSocialCast.groupMembers(bubbleStore).prefix(4)
        var seen = Set<String>()
        var rows: [(user: User, days: Int)] = []
        for user in people where !user.isMe && seen.insert(user.id).inserted {
            let days = streak(of: user)
            if days > 0 { rows.append((user, days)) }
        }
        rows.sort { $0.days != $1.days ? $0.days > $1.days : $0.user.firstName < $1.user.firstName }
        return [(appStore.me, myStreak)] + rows.prefix(10)
    }

    // MARK: Mastery

    /// Someone's best mastery (0–1) in a lesson, or nil when they haven't learned it.
    func mastery(of user: User, in bubble: Bubble, bubbleStore: BubbleStore) -> Double? {
        if user.isMe { return best[bubble.id] }
        if let simulated = memberMastery[bubble.id]?[user.id] { return simulated }
        // Only real runs (bot runs with a replay) stand in; synthetic placeholder scores don't.
        let runs = bubble.scores.filter { $0.user.id == user.id && $0.replay != nil }
        guard let score = runs.map(\.score).max() else { return nil }
        return min(1, max(0, Double(score) / Double(LearnLesson.maxScore(for: bubble))))
    }

    /// The Group's lessons, newest first.
    func lessons(in group: FBGroup, bubbleStore: BubbleStore) -> [Bubble] {
        bubbleStore.bubbles.filter {
            $0.formula == .learn && ($0.group?.id == group.id || $0.manifest.structure.groupID == group.id)
        }
    }

    /// Who counts for a Group's meter: the demo world's members for New in SF, else everyone with
    /// a run on its lessons, plus you once you've learned one.
    func learners(in group: FBGroup, lessons: [Bubble], bubbleStore: BubbleStore) -> [User] {
        var people: [User] = group.id == BubbleDemo.groupID ? BubbleSocialCast.groupMembers(bubbleStore) : []
        for bubble in lessons {
            people += bubble.scores.map(\.user)
        }
        var seen = Set<String>()
        return people.filter { !$0.isMe && seen.insert($0.id).inserted }
    }

    /// The Group's mastery of one lesson: the average of members' best mastery (you included once
    /// you've learned it). 0 when nobody has.
    func groupMastery(of bubble: Bubble, group: FBGroup, bubbleStore: BubbleStore) -> Double {
        let people = learners(in: group, lessons: [bubble], bubbleStore: bubbleStore)
        var values = people.compactMap { mastery(of: $0, in: bubble, bubbleStore: bubbleStore) }
        if let mine = best[bubble.id] { values.append(mine) }
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    /// The Group meter across all its lessons (0–1): the average of each lesson's Group mastery.
    func groupMastery(group: FBGroup, in bubbleStore: BubbleStore) -> Double {
        let list = lessons(in: group, bubbleStore: bubbleStore)
        guard !list.isEmpty else { return 0 }
        let values = list.map { groupMastery(of: $0, group: group, bubbleStore: bubbleStore) }
        return values.reduce(0, +) / Double(values.count)
    }

    /// The top learners of a lesson in a Group, best first.
    func topLearners(of bubble: Bubble, group: FBGroup, bubbleStore: BubbleStore, limit: Int = 3) -> [(user: User, mastery: Double)] {
        let people = learners(in: group, lessons: [bubble], bubbleStore: bubbleStore)
        let rows = people.compactMap { user in mastery(of: user, in: bubble, bubbleStore: bubbleStore).map { (user: user, mastery: $0) } }
        return Array(rows.sorted { $0.mastery != $1.mastery ? $0.mastery > $1.mastery : streak(of: $0.user) > streak(of: $1.user) }.prefix(limit))
    }

    /// Plays every learner's run of these lessons with the real runtime's bot (once per launch),
    /// so the meter shows exact mastery from each run's tag. Results land one by one.
    func warmUp(_ lessons: [Bubble], people: [User], bubbleStore: BubbleStore) {
        for bubble in lessons {
            for user in people where !user.isMe {
                let key = "\(bubble.id)|\(user.id)"
                guard memberMastery[bubble.id]?[user.id] == nil, warming.insert(key).inserted else { continue }
                bubbleStore.simulateRun(of: user, on: bubble, manifest: bubble.manifest) { [weak self] score in
                    guard let self, let tag = LearnResultTag(score.share?.tag) else { return }
                    self.memberMastery[bubble.id, default: [:]][user.id] = tag.mastery
                }
            }
        }
    }

    /// Warms a Group's lessons for its learners.
    func warmUp(group: FBGroup, bubbleStore: BubbleStore) {
        let list = lessons(in: group, bubbleStore: bubbleStore)
        warmUp(list, people: learners(in: group, lessons: list, bubbleStore: bubbleStore), bubbleStore: bubbleStore)
    }

    /// Records a friend's run from a lesson card (their bot run's tag).
    func noteMember(_ user: User, in bubble: Bubble, tag: LearnResultTag) {
        guard !user.isMe else { return }
        let current = memberMastery[bubble.id]?[user.id] ?? 0
        memberMastery[bubble.id, default: [:]][user.id] = max(current, tag.mastery)
    }

    // MARK: Persistence

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: Self.defaultsKey),
              let saved = try? JSONDecoder().decode(Saved.self, from: data) else { return }
        days = Set(saved.days)
        best = saved.best
        lastTag = saved.lastTag
    }

    private func save() {
        let saved = Saved(days: days.sorted().suffix(120).map { $0 }, best: best, lastTag: lastTag)
        if let data = try? JSONEncoder().encode(saved) {
            UserDefaults.standard.set(data, forKey: Self.defaultsKey)
        }
    }
}
