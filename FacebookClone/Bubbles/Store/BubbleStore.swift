import Foundation
import Observation
import UIKit

/// App state for Bubbles: the library, runs and boards, Daily Bubbles and streaks, the Bubbles
/// tab's infinite feed, and the Muse Studio service.
/// Injected with `.environment(bubbleStore)`; read with `@Environment(BubbleStore.self)`.
///
/// - Seeds (`bubble-seed-*.json`) load with their `_seed` metadata: creator, Group, Event,
///   created date, plays and likes (docs/BUBBLES.md, 4.9).
/// - Friends and Group members get scores from bot runs of the real runtime, with replays that
///   play as their Bursts (`BubbleFeedRoster.swift`).
/// - Your Bubbles, edits, covers, scores, likes, saves and streak persist as JSON in
///   Application Support.
///
/// Call from the main thread (SwiftUI views and their actions), like `AppStore`.
@Observable
final class BubbleStore {
    /// Every Bubble in the library, newest first.
    var bubbles: [Bubble] = []
    /// Today's Daily Bubble id for each Group id.
    var dailyBubbleIDs: [String: String] = [:]
    /// "yyyy-MM-dd" for today. Daily Bubble boards only count runs from this day.
    private(set) var todayKey: String = BubbleStore.dayKey(Date())
    /// The Bubbles tab's infinite feed for this session. Grows with `extendFeed(by:)`.
    var feedItems: [BubbleFeedItem] = []
    /// Nil until known: whether the bundled runtime records replays (false for the stub, which
    /// leaves the roster with synthetic scores and no Bursts).
    var runtimeMakesReplays: Bool?

    @ObservationIgnored let appStore: AppStore
    /// Muse Studio. Set at launch; nil only in previews.
    @ObservationIgnored var studio: BubbleStudioService?

    @ObservationIgnored let runtimeWorker = BubbleRuntimeWorker()
    @ObservationIgnored var feedGenerator = BubbleFeedGenerator(seed: 0)
    /// The page the Bubbles tab shows, so new Bubbles slot in right after it.
    @ObservationIgnored var feedPosition = 0
    /// Demo-world people, Group and Event built from `bubble-demo-world.json` when the app's
    /// mock data doesn't have them (see `resolvePerson`).
    @ObservationIgnored var castUsers: [String: User] = [:]
    @ObservationIgnored var castGroups: [String: FBGroup] = [:]
    @ObservationIgnored var castEvents: [String: FBEvent] = [:]

    private var streak = BubbleStreak()
    /// Bundled seed ids. Seeds are rebuilt at launch, so only edits to them are saved.
    @ObservationIgnored private var seedIDs: Set<String> = []
    @ObservationIgnored private var editedIDs: Set<String> = []
    @ObservationIgnored private var pendingSave: DispatchWorkItem?
    @ObservationIgnored private let persists: Bool
    @ObservationIgnored private var dayObservers: [NSObjectProtocol] = []

    init(appStore: AppStore) {
        self.appStore = appStore
        let isPreview = ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
        persists = !isPreview
        loadSeeds()
        if persists {
            restoreArchive()
        }
        assignDailyBubbles()
        seedRosterScores()
        bubbles.forEach(refreshFeaturedRun)
        feedGenerator = BubbleFeedGenerator(seed: SeededGenerator.stableHash("bubbles-feed|\(todayKey)"))
        extendFeed(by: 16)
        guard !isPreview else { return }
        // Warm runtime hosts load in the background right after the first frame. Once they're
        // up, they draw every Bubble's poster frame (in its own look) for cards and feed pages.
        DispatchQueue.main.async {
            BubbleRuntimePool.warmUp()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let bubbles = self?.feedBubbles else { return }
            MainActor.assumeIsolated {
                BubbleRuntimePool.shared.preparePosters(for: bubbles)
            }
        }
        startBotRuns()
        observeDayChanges()
    }

    // MARK: - Queries

    func bubble(id: String) -> Bubble? {
        bubbles.first { $0.id == id }
    }

    /// Bubbles in the order the feed shows them first, then everything else, without repeats.
    var feedBubbles: [Bubble] {
        var seen = Set<String>()
        var result: [Bubble] = []
        for item in feedItems where !seen.contains(item.bubbleID) {
            if let bubble = bubble(id: item.bubbleID) {
                seen.insert(bubble.id)
                result.append(bubble)
            }
        }
        for bubble in bubbles where !seen.contains(bubble.id) {
            seen.insert(bubble.id)
            result.append(bubble)
        }
        return result
    }

    func bubbles(by user: User) -> [Bubble] {
        bubbles.filter { $0.creator.id == user.id }
    }

    func bubbles(in group: FBGroup) -> [Bubble] {
        bubbles.filter { $0.group?.id == group.id || $0.manifest.structure.groupID == group.id }
    }

    func dailyBubble(for group: FBGroup) -> Bubble? {
        dailyBubbleIDs[group.id].flatMap { bubble(id: $0) }
    }

    /// The levels of a chain, in order.
    func chain(_ chainID: String) -> [Bubble] {
        bubbles
            .filter { $0.chainID == chainID }
            .sorted { ($0.levelIndex ?? 0) < ($1.levelIndex ?? 0) }
    }

    /// The level after `bubble` in its Bubble Chain, if there is one.
    func nextLevel(after bubble: Bubble) -> Bubble? {
        if let next = bubble.manifest.chain?.next, let found = self.bubble(id: next) {
            return found
        }
        guard let chainID = bubble.chainID else { return nil }
        let levels = chain(chainID)
        guard let index = levels.firstIndex(where: { $0.id == bubble.id }), index + 1 < levels.count else { return nil }
        return levels[index + 1]
    }

    /// Best run per person, highest first (earlier wins a tie).
    ///
    /// - `.group`: members of the Bubble's Group (for Bubbles without one, of your Groups).
    /// - `.friends`: your friends and you.
    /// - `.everyone`: everybody.
    ///
    /// Daily Bubble boards only count today's runs.
    func leaderboard(for bubble: Bubble, scope: BubbleBoardScope) -> [BubbleScore] {
        let members = scope == .group ? boardMemberIDs(for: bubble) : []
        var best: [String: BubbleScore] = [:]
        for entry in bubble.scores {
            if bubble.isDaily, let day = entry.day, day != todayKey { continue }
            switch scope {
            case .everyone:
                break
            case .friends:
                guard entry.user.isMe || entry.user.isFriend else { continue }
            case .group:
                guard members.contains(entry.user.id) else { continue }
            }
            if let current = best[entry.user.id], current.score >= entry.score { continue }
            best[entry.user.id] = entry
        }
        return best.values.sorted { lhs, rhs in
            lhs.score != rhs.score ? lhs.score > rhs.score : lhs.achievedAt < rhs.achievedAt
        }
    }

    func bestScore(of user: User, in bubble: Bubble) -> BubbleScore? {
        bestScore(ofUserID: user.id, in: bubble)
    }

    /// Someone's best run. For Daily Bubbles, today's best.
    func bestScore(ofUserID userID: String, in bubble: Bubble) -> BubbleScore? {
        bubble.scores
            .filter { $0.user.id == userID && (!bubble.isDaily || $0.day == nil || $0.day == todayKey) }
            .max { $0.score < $1.score }
    }

    /// Whether `user` counts on the Bubble's Group board.
    func isGroupMember(_ user: User, for bubble: Bubble) -> Bool {
        boardMemberIDs(for: bubble).contains(user.id)
    }

    /// The Groups a Bubble's `.group` board compares: its own Group, or every Group you're in.
    func boardGroups(for bubble: Bubble) -> [FBGroup] {
        if let group = bubble.group ?? resolveGroup(bubble.manifest.structure.groupID) {
            return [group]
        }
        var groups = appStore.myGroups
        if let home = resolveGroup(BubbleDemo.groupID), home.isMember, !groups.contains(home) {
            groups.insert(home, at: 0)
        }
        return groups
    }

    private func boardMemberIDs(for bubble: Bubble) -> Set<String> {
        var ids = Set<String>()
        for group in boardGroups(for: bubble) {
            ids.formUnion(group.memberSample.map(\.id))
            if group.id == BubbleDemo.groupID {
                ids.formUnion(BubbleRoster.bundled?.people.map(\.id) ?? [])
            }
            if group.isMember {
                ids.insert(appStore.me.id)
            }
        }
        return ids
    }

    // MARK: Library

    /// Bubbles you made, newest first.
    var yourBubbles: [Bubble] {
        bubbles.filter { $0.creator.id == appStore.me.id }
    }

    var savedBubbles: [Bubble] {
        bubbles.filter(\.isSaved)
    }

    /// Bubbles made for Groups you're in, Daily Bubbles first.
    var yourGroupsBubbles: [Bubble] {
        let memberGroupIDs = Set(appStore.myGroups.map(\.id))
        return bubbles
            .filter { bubble in
                guard let group = bubble.group ?? resolveGroup(bubble.manifest.structure.groupID) else { return false }
                return group.isMember || memberGroupIDs.contains(group.id)
            }
            .sorted { $0.isDaily && !$1.isDaily }
    }

    /// Bubbles your friends made.
    var friendsBubbles: [Bubble] {
        bubbles.filter { $0.creator.isFriend }
    }

    /// The first level of every Bubble Chain, newest first.
    var chainHeads: [Bubble] {
        var seen = Set<String>()
        var heads: [Bubble] = []
        for bubble in bubbles {
            guard let chainID = bubble.chainID, seen.insert(chainID).inserted,
                  let first = chain(chainID).first else { continue }
            heads.append(first)
        }
        return heads
    }

    // MARK: Daily Bubbles

    /// Days in a row you've played a Daily Bubble, counting today or yesterday. Zero once a day
    /// is missed.
    var dailyStreak: Int {
        guard let last = streak.lastDay else { return 0 }
        return last == todayKey || last == Self.dayKey(Self.yesterday()) ? streak.count : 0
    }

    /// Whether you've played this Daily Bubble today.
    func hasPlayedToday(_ bubble: Bubble) -> Bool {
        bubble.scores.contains { $0.user.id == appStore.me.id && $0.day == todayKey }
    }

    // MARK: - Actions

    /// Records your run on the Bubble Board, checks its replay in the background and tells the
    /// surfaces (`BubbleSurfaceHooks.didRecord`).
    @discardableResult
    func record(_ result: BubbleRunResult, in bubble: Bubble) -> BubbleScore {
        refreshDayIfNeeded()
        let entry = BubbleScore(
            user: appStore.me,
            score: result.score,
            achievedAt: Date(),
            day: bubble.isDaily ? todayKey : nil,
            replay: result.replay,
            share: result.share
        )
        bubble.scores.append(entry)
        bubble.playCount += 1
        if bubble.isDaily {
            advanceStreak()
        }
        scheduleSave()
        verify(entry, in: bubble)
        BubbleSurfaceHooks.didRecord(entry, in: bubble, appStore: appStore, bubbleStore: self)
        return entry
    }

    /// Adds a Bubble that Muse Studio just made. It shows up next in the Bubbles feed.
    @discardableResult
    func publish(_ manifest: BubbleManifest, cover: Data? = nil, group: FBGroup? = nil, event: FBEvent? = nil) -> Bubble {
        let previous = bubble(id: manifest.id)
        let bubble = Bubble(
            manifest: manifest,
            creator: appStore.me,
            group: group ?? resolveGroup(manifest.structure.groupID),
            event: event ?? resolveEvent(manifest.structure.eventID),
            coverImageData: cover,
            scores: previous?.scores ?? []
        )
        bubbles.removeAll { $0.id == manifest.id }
        bubbles.insert(bubble, at: 0)
        if manifest.structure.isDaily, let groupID = bubble.group?.id ?? manifest.structure.groupID {
            dailyBubbleIDs[groupID] = bubble.id
        }
        insertIntoFeed(bubble)
        scheduleSave()
        return bubble
    }

    /// Replaces a Bubble's manifest with an edited version and keeps the old one in history.
    func update(_ bubble: Bubble, to manifest: BubbleManifest, cover: Data? = nil) {
        bubble.history.append(bubble.manifest)
        bubble.manifest = manifest
        if let cover {
            bubble.coverImageData = cover
        }
        editedIDs.insert(bubble.id)
        scheduleSave()
    }

    func toggleLike(_ bubble: Bubble) {
        bubble.isLiked.toggle()
        bubble.likeCount += bubble.isLiked ? 1 : -1
        scheduleSave()
    }

    func toggleSave(_ bubble: Bubble) {
        bubble.isSaved.toggle()
        scheduleSave()
    }

    // MARK: - Featured runs

    /// The run a Bubble's Burst plays: the best run with a replay from a friend or Group member,
    /// then anyone's; without replays (the stub runtime), the best friend or member run.
    func refreshFeaturedRun(_ bubble: Bubble) {
        let others = leaderboard(for: bubble, scope: .everyone).filter { !$0.user.isMe }
        let close = others.filter { $0.user.isFriend || isGroupMember($0.user, for: bubble) }
        bubble.featuredRun = close.first { $0.replay != nil }
            ?? others.first { $0.replay != nil }
            ?? close.first
            ?? others.first
    }

    // MARK: - Seeds

    /// Loads every `bubble-seed-*.json` manifest bundled with the app, with its `_seed` metadata.
    private func loadSeeds() {
        let urls = (Bundle.main.urls(forResourcesWithExtension: "json", subdirectory: nil) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("bubble-seed-") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        let now = Date()
        var loaded: [Bubble] = []
        for url in urls {
            guard let data = try? Data(contentsOf: url),
                  let manifest = try? BubbleManifest.decode(data) else { continue }
            let meta = (try? JSONValue.parse(data))?["_seed"] ?? .null
            let groupID = meta["group_id"]?.string ?? manifest.structure.groupID
            let eventID = meta["event_id"]?.string ?? manifest.structure.eventID
            let hoursAgo = meta["created_hours_ago"]?.double ?? 24
            loaded.append(Bubble(
                manifest: manifest,
                creator: resolvePerson(meta["creator_id"]?.string),
                group: resolveGroup(groupID),
                event: resolveEvent(eventID),
                createdAt: now.addingTimeInterval(-hoursAgo * 3600),
                coverImageData: Self.bundledCover(for: manifest.id),
                playCount: meta["play_count"]?.int ?? 0,
                likeCount: meta["like_count"]?.int ?? 0
            ))
        }
        bubbles = loaded.sorted { $0.createdAt > $1.createdAt }
        seedIDs = Set(loaded.map(\.id))
    }

    /// A seed's Muse-painted cover art, bundled next to the seeds as `bubble-cover-<id>.jpg`.
    private static func bundledCover(for id: String) -> Data? {
        for ext in ["jpg", "webp", "png"] {
            if let url = Bundle.main.url(forResource: "bubble-cover-\(id)", withExtension: ext) {
                return try? Data(contentsOf: url)
            }
        }
        return nil
    }

    /// Daily Bubbles are those with a daily cadence, one per Group (the newest wins).
    private func assignDailyBubbles() {
        for bubble in bubbles.reversed() where bubble.isDaily {
            if let groupID = bubble.group?.id ?? bubble.manifest.structure.groupID {
                dailyBubbleIDs[groupID] = bubble.id
            }
        }
    }

    // MARK: - Verification

    private func verify(_ entry: BubbleScore, in bubble: Bubble) {
        guard let replay = entry.replay else { return }
        let manifest = bubble.manifest
        let bubbleID = bubble.id
        runtimeWorker.verify(manifest, replay: replay, claimedScore: entry.score) { [weak self] ok in
            guard ok, let self, let bubble = self.bubble(id: bubbleID),
                  let index = bubble.scores.firstIndex(where: { $0.id == entry.id }) else { return }
            bubble.scores[index].isVerified = true
            self.scheduleSave()
        }
    }

    // MARK: - Days and streaks

    private func advanceStreak() {
        if streak.lastDay == todayKey { return }
        if streak.lastDay == Self.dayKey(Self.yesterday()) {
            streak.count += 1
        } else {
            streak.count = 1
        }
        streak.lastDay = todayKey
    }

    /// Moves to a new day after midnight: Daily Bubble boards start over (the roster's runs move
    /// to the new day, since they play every day too).
    func refreshDayIfNeeded() {
        let now = Self.dayKey(Date())
        guard now != todayKey else { return }
        let previous = todayKey
        todayKey = now
        for bubble in bubbles where bubble.isDaily {
            for index in bubble.scores.indices where !bubble.scores[index].user.isMe && bubble.scores[index].day == previous {
                bubble.scores[index].day = now
            }
        }
    }

    private func observeDayChanges() {
        let center = NotificationCenter.default
        for name in [UIApplication.significantTimeChangeNotification, Notification.Name.NSCalendarDayChanged] {
            dayObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.refreshDayIfNeeded()
            })
        }
    }

    // MARK: - Persistence

    /// `Application Support/Bubbles`: your Bubbles, edits, covers and runs.
    static var storageDirectory: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let directory = base.appendingPathComponent("Bubbles", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static var archiveURL: URL? {
        storageDirectory?.appendingPathComponent("bubbles-library.json")
    }

    private static var coversDirectory: URL? {
        guard let directory = storageDirectory?.appendingPathComponent("covers", isDirectory: true) else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func coverURL(for id: String) -> URL? {
        let safe = id.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" }
        return coversDirectory?.appendingPathComponent(String(safe) + ".cover")
    }

    /// Saves shortly after a change, off the main thread.
    func scheduleSave() {
        guard persists else { return }
        pendingSave?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.saveNow()
        }
        pendingSave = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }

    private func saveNow() {
        let me = appStore.me.id
        var archive = BubbleArchive()
        var covers: [(String, Data)] = []
        for bubble in bubbles {
            if bubble.creator.id == me && !seedIDs.contains(bubble.id) {
                archive.published.append(BubbleArchive.Published(
                    manifest: bubble.manifest,
                    groupID: bubble.group?.id,
                    eventID: bubble.event?.id,
                    createdAt: bubble.createdAt,
                    playCount: bubble.playCount,
                    likeCount: bubble.likeCount,
                    history: bubble.history,
                    hasCover: bubble.coverImageData != nil
                ))
                if let cover = bubble.coverImageData {
                    covers.append((bubble.id, cover))
                }
            } else if editedIDs.contains(bubble.id) {
                archive.edits.append(BubbleArchive.Edit(id: bubble.id, manifest: bubble.manifest, history: bubble.history, hasCover: bubble.coverImageData != nil))
                if let cover = bubble.coverImageData {
                    covers.append((bubble.id, cover))
                }
            }
            let mine = bubble.scores.filter { $0.user.id == me }.map(BubbleArchive.Run.init)
            if !mine.isEmpty {
                archive.runs[bubble.id] = mine
            }
            if bubble.isLiked {
                archive.liked.append(bubble.id)
            }
            if bubble.isSaved {
                archive.saved.append(bubble.id)
            }
        }
        archive.streak = streak
        guard let url = Self.archiveURL else { return }
        DispatchQueue.global(qos: .utility).async {
            for (id, data) in covers {
                guard let coverURL = Self.coverURL(for: id) else { continue }
                if (try? Data(contentsOf: coverURL)) != data {
                    try? data.write(to: coverURL, options: .atomic)
                }
            }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            if let data = try? encoder.encode(archive) {
                try? data.write(to: url, options: .atomic)
            }
        }
    }

    /// Brings back your Bubbles, edits, covers, runs, likes, saves and streak.
    private func restoreArchive() {
        guard let url = Self.archiveURL, let data = try? Data(contentsOf: url) else {
            // A first launch: Alex has played New in SF's Daily Bubble the last three days.
            streak = BubbleStreak(count: 3, lastDay: Self.dayKey(Self.yesterday()))
            return
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let archive = try? decoder.decode(BubbleArchive.self, from: data) else { return }
        streak = archive.streak

        for edit in archive.edits {
            guard let bubble = bubble(id: edit.id) else { continue }
            bubble.manifest = edit.manifest
            bubble.history = edit.history
            if edit.hasCover, let coverURL = Self.coverURL(for: edit.id) {
                bubble.coverImageData = try? Data(contentsOf: coverURL)
            }
            editedIDs.insert(edit.id)
        }
        for saved in archive.published.reversed() {
            let existing = bubble(id: saved.manifest.id)
            let cover = saved.hasCover ? Self.coverURL(for: saved.manifest.id).flatMap { try? Data(contentsOf: $0) } : nil
            let bubble = Bubble(
                manifest: saved.manifest,
                creator: appStore.me,
                group: resolveGroup(saved.groupID ?? saved.manifest.structure.groupID),
                event: resolveEvent(saved.eventID ?? saved.manifest.structure.eventID),
                createdAt: saved.createdAt,
                coverImageData: cover ?? existing?.coverImageData,
                playCount: max(saved.playCount, existing?.playCount ?? 0),
                likeCount: max(saved.likeCount, existing?.likeCount ?? 0),
                history: saved.history
            )
            bubbles.removeAll { $0.id == bubble.id }
            bubbles.append(bubble)
        }
        bubbles.sort { $0.createdAt > $1.createdAt }

        let me = appStore.me
        for (id, runs) in archive.runs {
            guard let bubble = bubble(id: id) else { continue }
            bubble.scores.append(contentsOf: runs.map { $0.score(for: me) })
        }
        for id in archive.liked {
            guard let bubble = bubble(id: id), !bubble.isLiked else { continue }
            bubble.isLiked = true
            // Seed like counts don't include yours; your own Bubbles saved theirs with it.
            if seedIDs.contains(id) {
                bubble.likeCount += 1
            }
        }
        for id in archive.saved {
            bubble(id: id)?.isSaved = true
        }
    }

    // MARK: - Helpers

    /// "yyyy-MM-dd" in the user's time zone.
    static func dayKey(_ date: Date) -> String {
        dayFormatter.string(from: date)
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static func yesterday() -> Date {
        Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date().addingTimeInterval(-86_400)
    }
}

// MARK: - Archive

/// Daily Bubble streak: how many days in a row, ending on `lastDay`.
struct BubbleStreak: Codable, Hashable {
    var count = 0
    var lastDay: String?
}

/// What `BubbleStore` saves: only what you made or did. Seeds and the roster rebuild at launch.
private struct BubbleArchive: Codable {
    struct Published: Codable {
        var manifest: BubbleManifest
        var groupID: String?
        var eventID: String?
        var createdAt: Date
        var playCount: Int
        var likeCount: Int
        var history: [BubbleManifest]
        var hasCover: Bool
    }

    struct Edit: Codable {
        var id: String
        var manifest: BubbleManifest
        var history: [BubbleManifest]
        var hasCover: Bool
    }

    struct Run: Codable {
        var id: String
        var score: Int
        var achievedAt: Date
        var day: String?
        var replay: BubbleInputLog?
        var share: BubbleShareArtifact?
        var isVerified: Bool

        init(_ score: BubbleScore) {
            id = score.id
            self.score = score.score
            achievedAt = score.achievedAt
            day = score.day
            replay = score.replay
            share = score.share
            isVerified = score.isVerified
        }

        func score(for user: User) -> BubbleScore {
            BubbleScore(id: id, user: user, score: score, achievedAt: achievedAt, day: day, replay: replay, share: share, isVerified: isVerified)
        }
    }

    var version = 1
    var published: [Published] = []
    var edits: [Edit] = []
    var runs: [String: [Run]] = [:]
    var liked: [String] = []
    var saved: [String] = []
    var streak = BubbleStreak()
}
