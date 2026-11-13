import Foundation

// Who plays the Bubbles in the feed: the synthetic New in SF cast (docs/BUBBLES.md, 4.7), your
// friends and a few people from everywhere. Their scores come from real bot runs of the runtime
// (`BubbleJSRuntime.simulate`), so every score has a replay that plays back as a Burst. Runtimes
// that don't record replays (the stub) get deterministic synthetic scores instead.

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

/// One bot run to simulate for the roster.
struct BubbleBotJob: Sendable {
    var bubbleID: String
    var manifest: BubbleManifest
    var userID: String
    var botSeed: Int
    var botSkill: Double
}

/// A finished bot run, cached on disk by runtime build so later launches start with Bursts.
struct BubbleBotRun: Codable, Sendable {
    var bubbleID: String
    var manifestKey: String
    var userID: String
    var score: Int
    var replay: BubbleInputLog
}

/// The headless runtime on its own serial queue (`BubbleJSRuntime` isn't thread-safe): bot runs
/// for the roster and replay checks for your scores. Everything here runs off the main thread.
final class BubbleRuntimeWorker {
    /// Internal (not private) so `BubbleOpponentRuns.swift` can queue one-off bot runs here too.
    let queue = DispatchQueue(label: "com.karthiksing05.fbclone.bubbles.runtime", qos: .utility)
    /// Touched only on `queue`.
    private var runtime: BubbleJSRuntime?
    private var didFailToLoad = false

    /// Longest bot run, in ticks (60 per second). Bursts are short clips.
    static let botMaxTicks = 60 * 60

    /// Simulates `jobs` in order. Delivers cached runs first, then fresh ones in small batches.
    /// `onStub` fires instead when the runtime can't record replays.
    func runBots(
        _ jobs: [BubbleBotJob],
        onRuns: @escaping ([BubbleBotRun]) -> Void,
        onStub: @escaping () -> Void
    ) {
        queue.async { [weak self] in
            guard let self else { return }
            let fingerprint = Self.runtimeFingerprint()
            var cache = BubbleBotCache.load(fingerprint: fingerprint)
            var pending: [BubbleBotJob] = []
            var cached: [BubbleBotRun] = []
            for job in jobs {
                if let run = cache.runs[Self.cacheKey(job)] {
                    cached.append(run)
                } else {
                    pending.append(job)
                }
            }
            if !cached.isEmpty {
                BubbleRuntimePerf.note("bot runs: \(cached.count) cached, \(pending.count) to simulate")
                DispatchQueue.main.async { onRuns(cached) }
            }
            guard !pending.isEmpty, let runtime = self.loadRuntime() else {
                if cached.isEmpty && !pending.isEmpty {
                    DispatchQueue.main.async { onStub() }
                }
                return
            }
            var batch: [BubbleBotRun] = []
            let began = CFAbsoluteTimeGetCurrent()
            var simulated = 0
            for (index, job) in pending.enumerated() {
                let simulation = runtime.simulate(
                    job.manifest,
                    seed: job.manifest.seed,
                    maxTicks: Self.botMaxTicks,
                    bot: true,
                    botSeed: job.botSeed,
                    botSkill: job.botSkill
                )
                guard simulation.ok, let replay = simulation.replay else {
                    if index == 0 && cached.isEmpty {
                        // The runtime doesn't record replays (the stub): keep synthetic scores.
                        DispatchQueue.main.async { onStub() }
                        return
                    }
                    continue
                }
                simulated += 1
                let run = BubbleBotRun(
                    bubbleID: job.bubbleID,
                    manifestKey: BubbleBotCache.manifestKey(job.manifest),
                    userID: job.userID,
                    score: simulation.score,
                    replay: replay
                )
                cache.runs[Self.cacheKey(job)] = run
                batch.append(run)
                if batch.count >= 6 || index == pending.count - 1 {
                    let delivered = batch
                    batch.removeAll()
                    DispatchQueue.main.async { onRuns(delivered) }
                }
            }
            cache.save()
            let ms = (CFAbsoluteTimeGetCurrent() - began) * 1000
            BubbleRuntimePerf.note(String(format: "bot runs: %d simulated in %.0fms (%.1fms each), %d cached", simulated, ms, ms / Double(max(1, simulated)), cached.count))
        }
    }

    /// Re-simulates a recorded run headless and checks that it reaches `claimedScore`.
    func verify(_ manifest: BubbleManifest, replay: BubbleInputLog, claimedScore: Int, completion: @escaping (Bool) -> Void) {
        queue.async { [weak self] in
            let began = CFAbsoluteTimeGetCurrent()
            let ok = self?.loadRuntime()?.verify(manifest, replay: replay, claimedScore: claimedScore) ?? false
            BubbleRuntimePerf.note(String(format: "verify %@ score=%d ok=%@ in %.0fms", manifest.id, claimedScore, ok ? "yes" : "no", (CFAbsoluteTimeGetCurrent() - began) * 1000))
            DispatchQueue.main.async { completion(ok) }
        }
    }

    /// Call on `queue` only.
    func loadRuntime() -> BubbleJSRuntime? {
        if let runtime { return runtime }
        guard !didFailToLoad else { return nil }
        do {
            runtime = try BubbleJSRuntime(bundle: .main)
        } catch {
            didFailToLoad = true
        }
        return runtime
    }

    private static func cacheKey(_ job: BubbleBotJob) -> String {
        "\(BubbleBotCache.manifestKey(job.manifest))|\(job.userID)|\(job.botSeed)|\(Int(job.botSkill * 1000))"
    }

    /// Identifies this build of the runtime scripts (name, size and date of every `.js` file), so
    /// cached replays are never played on an engine they weren't recorded with.
    static func runtimeFingerprint() -> String {
        let urls = (Bundle.main.urls(forResourcesWithExtension: "js", subdirectory: nil) ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var parts: [String] = []
        for url in urls {
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
            let date = (attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            parts.append("\(url.lastPathComponent):\(size):\(Int(date))")
        }
        return String(SeededGenerator.stableHash(parts.joined(separator: "|")), radix: 36)
    }
}

/// Bot runs on disk (Application Support), keyed by runtime build.
private struct BubbleBotCache: Codable {
    var fingerprint: String
    var runs: [String: BubbleBotRun]

    static func manifestKey(_ manifest: BubbleManifest) -> String {
        "\(manifest.id)#\(manifest.version)#\(String(SeededGenerator.stableHash(manifest.jsonString()) & 0xFFFF_FFFF, radix: 36))"
    }

    static var url: URL? {
        BubbleStore.storageDirectory?.appendingPathComponent("bubble-bot-runs.json")
    }

    static func load(fingerprint: String) -> BubbleBotCache {
        guard let url, let data = try? Data(contentsOf: url),
              let cache = try? JSONDecoder().decode(BubbleBotCache.self, from: data),
              cache.fingerprint == fingerprint else {
            return BubbleBotCache(fingerprint: fingerprint, runs: [:])
        }
        return cache
    }

    func save() {
        guard let url = Self.url, let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

// MARK: - Roster in the store

extension BubbleStore {
    /// The person behind a demo-world id. Uses the app's people when they exist; otherwise
    /// builds them from `bubble-demo-world.json` so names always match the seeds; falls back to a
    /// friend, then to you.
    func resolvePerson(_ id: String?) -> User {
        guard let id, !id.isEmpty, id != "me", id != appStore.me.id else { return appStore.me }
        if let user = appStore.user(id: id) { return user }
        if let user = castUsers[id] { return user }
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
            castUsers[id] = user
            return user
        }
        return appStore.friends.first ?? appStore.me
    }

    /// The New in SF Group and the picnic Event from the app's data, or built from
    /// `bubble-demo-world.json` until the mock data has them.
    func resolveGroup(_ id: String?) -> FBGroup? {
        guard let id, !id.isEmpty else { return nil }
        if let group = appStore.group(id: id) { return group }
        if let group = castGroups[id] { return group }
        guard let roster = BubbleRoster.bundled, roster.group.id == id else { return nil }
        let info = roster.group
        let group = FBGroup(
            id: info.id,
            name: info.name,
            coverURL: MockDataFactory.photo(info.coverSeed, 1200, 600),
            isPrivate: info.isPrivate,
            memberCount: info.memberCount,
            isMember: true,
            about: info.about,
            category: info.category,
            postsPerDay: 14,
            memberSample: roster.people.map { resolvePerson($0.id) }
        )
        castGroups[id] = group
        return group
    }

    func resolveEvent(_ id: String?) -> FBEvent? {
        guard let id, !id.isEmpty else { return nil }
        if let event = appStore.event(id: id) { return event }
        if let event = castEvents[id] { return event }
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
        castEvents[id] = event
        return event
    }

    /// The SF neighborhood of a cast member ("Hayes Valley"), for "new near you".
    func neighborhood(of user: User) -> String? {
        BubbleRoster.bundled?.person(id: user.id)?.neighborhood
    }

    /// Everyone who has a run on `bubble`'s boards besides you: its creator, the New in SF cast
    /// (all of them for New in SF Bubbles, the picnic crowd for the icebreaker, five for the
    /// rest), three more of your friends and two people from everywhere.
    func rosterPlayers(for bubble: Bubble) -> [User] {
        let roster = BubbleRoster.bundled
        var ids: [String] = []
        if !bubble.creator.isMe {
            ids.append(bubble.creator.id)
        }
        var cast = roster?.people ?? []
        if bubble.isIcebreaker {
            cast = cast.filter { $0.goingToPicnic || $0.isFriend }
        } else if bubble.manifest.structure.groupID != BubbleDemo.groupID {
            var rng = SeededGenerator(seed: SeededGenerator.stableHash("cast|\(bubble.id)"))
            cast = Array(cast.shuffled(using: &rng).prefix(5))
        }
        ids += cast.map(\.id)

        let castIDs = Set(roster?.people.map(\.id) ?? [])
        var rng = SeededGenerator(seed: SeededGenerator.stableHash("friends|\(bubble.id)"))
        let friends = appStore.friends.filter { !castIDs.contains($0.id) }.shuffled(using: &rng)
        ids += friends.prefix(3).map(\.id)
        let strangers = appStore.people.filter { $0.friendship == .none && !castIDs.contains($0.id) }.shuffled(using: &rng)
        ids += strangers.prefix(2).map(\.id)

        var seen = Set<String>()
        return ids.compactMap { id in
            guard seen.insert(id).inserted else { return nil }
            let user = resolvePerson(id)
            return user.isMe ? nil : user
        }
    }

    /// Deterministic stand-in scores (no replays) for everyone on the roster. Bot runs replace
    /// them when the runtime can record replays.
    func seedRosterScores() {
        let now = Date()
        let startOfDay = Calendar.current.startOfDay(for: now)
        for bubble in bubbles {
            let players = rosterPlayers(for: bubble)
            var synthetic: [BubbleScore] = []
            for user in players {
                let entry = BubbleScore(
                    id: "roster-\(bubble.id)-\(user.id)",
                    user: user,
                    score: Self.syntheticScore(for: bubble, userID: user.id),
                    achievedAt: Self.rosterDate(for: bubble, userID: user.id, now: now, startOfDay: startOfDay),
                    day: bubble.isDaily ? todayKey : nil
                )
                synthetic.append(entry)
            }
            bubble.scores = synthetic + bubble.scores.filter { $0.user.isMe }
        }
    }

    /// Bot runs for the whole roster, off the main thread: the first Bubbles in the feed first.
    func startBotRuns() {
        var jobs: [BubbleBotJob] = []
        for bubble in feedBubbles {
            let players = rosterPlayers(for: bubble).sorted { BubbleRoster.skill(of: $0.id) > BubbleRoster.skill(of: $1.id) }
            for user in players {
                jobs.append(BubbleBotJob(
                    bubbleID: bubble.id,
                    manifest: bubble.manifest,
                    userID: user.id,
                    botSeed: Int(SeededGenerator.stableHash("bot|\(bubble.id)|\(user.id)") % 1_000_000),
                    botSkill: BubbleRoster.skill(of: user.id)
                ))
            }
        }
        // Each Bubble's best two players go first, so every page has a Burst quickly.
        var firstPass: [BubbleBotJob] = []
        var secondPass: [BubbleBotJob] = []
        var perBubble: [String: Int] = [:]
        for job in jobs {
            let count = perBubble[job.bubbleID, default: 0]
            perBubble[job.bubbleID] = count + 1
            if count < 2 {
                firstPass.append(job)
            } else {
                secondPass.append(job)
            }
        }
        runtimeWorker.runBots(
            firstPass + secondPass,
            onRuns: { [weak self] runs in self?.applyBotRuns(runs) },
            onStub: { [weak self] in self?.runtimeMakesReplays = false }
        )
    }

    private func applyBotRuns(_ runs: [BubbleBotRun]) {
        runtimeMakesReplays = true
        var touched = Set<String>()
        for run in runs {
            guard let bubble = bubble(id: run.bubbleID),
                  BubbleBotCache.manifestKey(bubble.manifest) == run.manifestKey,
                  let index = bubble.scores.firstIndex(where: { $0.user.id == run.userID && !$0.user.isMe }) else { continue }
            let old = bubble.scores[index]
            bubble.scores[index] = BubbleScore(
                id: old.id,
                user: old.user,
                score: run.score,
                achievedAt: old.achievedAt,
                day: old.day,
                replay: run.replay,
                share: nil,
                isVerified: true
            )
            touched.insert(bubble.id)
        }
        for id in touched {
            if let bubble = bubble(id: id) {
                refreshFeaturedRun(bubble)
            }
        }
    }

    // MARK: Synthetic scores

    /// Plausible "higher is better" ranges per formula, for stand-in scores.
    private static func scoreRange(for formula: BubbleFormula) -> ClosedRange<Double> {
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

    /// When their best run happened: today for Daily Bubbles, otherwise since the Bubble was made.
    private static func rosterDate(for bubble: Bubble, userID: String, now: Date, startOfDay: Date) -> Date {
        let fraction = BubbleRoster.unit("when|\(bubble.id)|\(userID)")
        if bubble.isDaily {
            let span = max(now.timeIntervalSince(startOfDay) - 600, 60)
            return startOfDay.addingTimeInterval(span * fraction)
        }
        let span = max(now.timeIntervalSince(bubble.createdAt) - 600, 600)
        return now.addingTimeInterval(-span * fraction - 300)
    }
}
