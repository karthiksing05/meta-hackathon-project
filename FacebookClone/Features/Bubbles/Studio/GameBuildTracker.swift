import Foundation
import Observation
import SwiftUI
import UIKit
import UserNotifications

// Minimized builds: a game takes 2–6 minutes on the server (`/v1/generate`), so the person can
// minimize Studio and keep using the app. `GameBuildTracker` keeps every build in flight, app-wide:
//
// - While the app runs, a minimized Studio's `StudioModel` is kept alive here and keeps its own
//   job stream (the same `StudioGenerateBridge` polling). Reopening Studio hands that same model
//   back, so it opens on the step the build reached (Build, or Try it once it's ready).
// - Each build's job id is saved. After a relaunch the tracker polls the saved jobs itself
//   (`GameGenerator.job`), and reopening one starts a Studio that re-attaches to the job instead of
//   starting a new one (`TrackedGameGenerator.start` returns the saved id), so the Build step
//   replays the server's steps and finishes on Try it.
// - `GameBuildDock` shows the builds above the tab bar. A local notification says when one is
//   ready (or didn't work) while the app is in the background.
//
// Hooks in Artem's files (hooks.patch): Studio asks `model(for:)` for its model, reports
// `studioDidAppear` / `studioDidDisappear`, minimizes through `minimize(_:)`, and makes its
// generator with `generator(for:)`. `MainTabView` and Messenger show `GameBuildDock`.

/// One game being made on the server, as the dock shows it.
struct GameBuild: Identifiable, Equatable {
    enum Status: String, Codable {
        case building, ready, failed
    }

    let id: UUID
    /// The server's job id, once `POST /v1/generate` answered.
    var jobID: String?
    /// What the person asked for.
    var request: String
    /// A short working title (the plan's title, else the first words of the request).
    var title: String
    var status: Status = .building
    /// "Muse is playtesting…", or the failure reason.
    var stepText: String
    /// 0...1.
    var progress: Double
    var startedAt: Date
    /// The finished game's cover, when Studio has it.
    var poster: Data?
    var posterURL: URL?
    /// Shown in the dock (Studio isn't on screen for it).
    var isMinimized: Bool
    /// The last event `seq` seen while the tracker polls the job itself.
    var lastSeq: Int?
    #if DEBUG
    /// A DEBUG screenshot fixture: never polled or saved.
    var isFixture = false
    #endif
}

@MainActor
@Observable
final class GameBuildTracker {
    static let shared = GameBuildTracker()

    /// Every build this app is tracking, oldest first.
    private(set) var builds: [GameBuild] = []

    /// The builds the dock shows: minimized, or restored after a relaunch.
    var docked: [GameBuild] { builds.filter(\.isMinimized) }

    /// Studio models kept alive while minimized (and while Studio is open), by build id.
    @ObservationIgnored private var models: [UUID: StudioModel] = [:]
    /// Which build each Studio model is making.
    @ObservationIgnored private var buildIDs: [ObjectIdentifier: UUID] = [:]
    /// Studio launches the dock opened, to the build they reopen.
    @ObservationIgnored private var launches: [UUID: UUID] = [:]
    /// Models that re-attach to a saved job on their next start, by model.
    @ObservationIgnored private var resumeJobs: [ObjectIdentifier: String] = [:]
    @ObservationIgnored private var monitor: Task<Void, Never>?
    @ObservationIgnored private var lastPoll: [UUID: Date] = [:]
    @ObservationIgnored private var pollMisses: [UUID: Int] = [:]
    @ObservationIgnored private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    @ObservationIgnored private var didLookForServerJobs = false
    /// The server. Swappable for tests.
    @ObservationIgnored var makeGenerator: () -> any GameGenerator = { GameGeneratorFactory.current }

    private static let savedKey = "game-builds.saved.v1"
    private static let askedNotificationsKey = "game-builds.asked-notifications"
    /// Saved builds older than this are dropped on launch.
    private static let savedLifetime: TimeInterval = 24 * 60 * 60

    private init() {
        restoreSaved()
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.didEnterBackground() }
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.endBackgroundTime() }
        }
    }

    // MARK: Studio hooks

    /// The generator a Studio run uses: the server's, reporting its job to this tracker.
    func generator(for model: StudioModel) -> any GameGenerator {
        let key = ObjectIdentifier(model)
        let id = buildIDs[key] ?? UUID()
        buildIDs[key] = id
        models[id] = model
        let title = Self.workingTitle(for: model)
        if let index = builds.firstIndex(where: { $0.id == id }) {
            // A retry, tweak or next level of the same Studio session: a new job for this build.
            builds[index].jobID = nil
            builds[index].status = .building
            builds[index].progress = 0
            builds[index].stepText = Self.stepText(for: model)
            builds[index].poster = nil
            builds[index].title = title
        } else {
            builds.append(GameBuild(
                id: id, request: model.prompt, title: title, stepText: "Muse is starting…",
                progress: 0, startedAt: Date(), isMinimized: false
            ))
        }
        return TrackedGameGenerator(inner: makeGenerator(), tracker: self, key: key)
    }

    /// The model a Studio launch from the dock reopens; nil for a new Studio.
    func model(for launch: StudioLaunch) -> StudioModel? {
        launches[launch.id].flatMap { models[$0] }
    }

    /// Studio is on screen for `model`: take it out of the dock, and re-attach a restored build to
    /// its job. Call after `model.attach`.
    func studioDidAppear(_ model: StudioModel) {
        let key = ObjectIdentifier(model)
        guard let id = buildIDs[key], let index = builds.firstIndex(where: { $0.id == id }) else { return }
        builds[index].isMinimized = false
        if resumeJobs[key] != nil, model.stage == .ask, !model.isComposing {
            model.startCompose(.create)
        }
    }

    /// Studio left the screen. Returns true when Studio really closed (shared or discarded), so its
    /// work should stop; false when it was minimized and keeps building.
    @discardableResult
    func studioDidDisappear(_ model: StudioModel) -> Bool {
        let key = ObjectIdentifier(model)
        guard let id = buildIDs[key] else { return true }
        if builds.first(where: { $0.id == id })?.isMinimized == true { return false }
        forget(id)
        return true
    }

    /// Minimize: Studio goes away, the build keeps going and shows in the dock.
    func minimize(_ model: StudioModel) {
        let key = ObjectIdentifier(model)
        let id = buildIDs[key] ?? UUID()
        buildIDs[key] = id
        models[id] = model
        if let index = builds.firstIndex(where: { $0.id == id }) {
            builds[index].isMinimized = true
        } else {
            builds.append(GameBuild(
                id: id, request: model.prompt, title: Self.workingTitle(for: model),
                stepText: Self.stepText(for: model), progress: model.reachedProgress,
                startedAt: model.composeStartedAt ?? Date(), isMinimized: true
            ))
        }
        sync(id)
        save()
        askForNotificationsOnce()
        startMonitor()
    }

    /// True while `model` builds in the dock (Studio isn't on screen for it).
    func isMinimized(_ model: StudioModel) -> Bool {
        guard let id = buildIDs[ObjectIdentifier(model)] else { return false }
        return builds.first { $0.id == id }?.isMinimized ?? false
    }

    // MARK: Dock actions

    /// Reopens Studio for a build: the same Studio session while the app has run, or a new one that
    /// re-attaches to the saved job after a relaunch.
    func open(_ buildID: UUID, router: Router) {
        guard let build = builds.first(where: { $0.id == buildID }) else { return }
        Haptics.light()
        if models[buildID] == nil {
            if build.status == .failed || build.jobID == nil {
                // Nothing to come back to on the server: start over from their words.
                forget(buildID)
                router.openStudio(StudioLaunch(prompt: build.request))
                return
            }
            let model = StudioModel(launch: StudioLaunch(prompt: build.request))
            let key = ObjectIdentifier(model)
            models[buildID] = model
            buildIDs[key] = buildID
            resumeJobs[key] = build.jobID
        }
        let launch = StudioLaunch(prompt: build.request)
        launches[launch.id] = buildID
        router.openStudio(launch)
    }

    /// "Try again" in the dock: the same Studio session builds again (still minimized); after a
    /// relaunch, Studio opens with their words.
    func retry(_ buildID: UUID, router: Router) {
        guard let model = models[buildID], model.lastRequest != nil else {
            open(buildID, router: router)
            return
        }
        Haptics.light()
        model.retry()
        sync(buildID)
        startMonitor()
    }

    /// Removes a build from the dock (a failed one; ready games are kept until opened).
    func dismiss(_ buildID: UUID) {
        if let model = models[buildID] {
            model.stopAll()
            model.discardDrafts()
        }
        forget(buildID)
    }

    // MARK: Job reports (`TrackedGameGenerator`)

    fileprivate func takeResumeJob(for key: ObjectIdentifier) -> String? {
        guard let jobID = resumeJobs.removeValue(forKey: key) else { return nil }
        if let id = buildIDs[key], let index = builds.firstIndex(where: { $0.id == id }) {
            builds[index].jobID = jobID
        }
        return jobID
    }

    fileprivate func jobStarted(_ jobID: String, key: ObjectIdentifier) {
        guard let id = buildIDs[key], let index = builds.firstIndex(where: { $0.id == id }) else { return }
        builds[index].jobID = jobID
        save()
    }

    fileprivate func jobCancelled(_ jobID: String) {
        // Only the job that build is on now (a retry's old job may cancel after the new one began).
        guard let index = builds.firstIndex(where: { $0.jobID == jobID }) else { return }
        builds[index].jobID = nil
        save()
    }

    // MARK: Watching

    private func startMonitor() {
        guard monitor == nil else { return }
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let active = await self.tick()
                if !active { break }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
            self?.monitor = nil
            self?.endBackgroundTime()
        }
    }

    /// One pass over the docked builds. Returns false when nothing is left to watch.
    private func tick() async -> Bool {
        var active = false
        for build in builds where build.status == .building {
            #if DEBUG
            if build.isFixture { continue }
            #endif
            if models[build.id] != nil {
                sync(build.id)
                active = true
            } else if build.jobID != nil {
                active = true
                await poll(build.id)
            }
        }
        if !didLookForServerJobs {
            didLookForServerJobs = true
            await lookForServerJobs()
        }
        return active || builds.contains { $0.status == .building && models[$0.id] != nil }
    }

    /// Copies a live Studio model's state onto its build.
    private func sync(_ id: UUID) {
        guard let model = models[id], let index = builds.firstIndex(where: { $0.id == id }) else { return }
        let before = builds[index].status
        if let failure = model.failure {
            builds[index].status = .failed
            builds[index].stepText = failure.message
        } else if model.isFinished || (!model.isComposing && !model.levels.isEmpty && model.stage >= .tryIt) {
            let result = model.levels.indices.contains(model.selectedLevel) ? model.levels[model.selectedLevel] : model.levels.last
            builds[index].status = .ready
            builds[index].progress = 1
            if let result {
                builds[index].title = result.manifest.title
                builds[index].poster = result.cover
            }
        } else if model.isComposing {
            builds[index].status = .building
            builds[index].stepText = Self.stepText(for: model)
            builds[index].progress = max(0.04, model.reachedProgress)
        }
        if before != builds[index].status { statusChanged(index, from: before, haptic: builds[index].status == .ready) }
    }

    /// Polls a restored build's job (no Studio model since the relaunch).
    private func poll(_ id: UUID) async {
        guard let build = builds.first(where: { $0.id == id }), let jobID = build.jobID else { return }
        let generator = makeGenerator()
        if let last = lastPoll[id], Date().timeIntervalSince(last) < generator.pollInterval * 2 { return }
        lastPoll[id] = Date()
        do {
            let job = try await generator.job(id: jobID, after: build.lastSeq)
            pollMisses[id] = 0
            guard let index = builds.firstIndex(where: { $0.id == id }), models[id] == nil else { return }
            apply(job, to: index)
        } catch {
            let misses = (pollMisses[id] ?? 0) + 1
            pollMisses[id] = misses
            guard let index = builds.firstIndex(where: { $0.id == id }), models[id] == nil else { return }
            if case GamesAPIError.notFound = error {
                fail(index, "The server lost this job.")
            } else if misses >= 40 {
                fail(index, StudioGenerateBridge.message(for: error))
            } else if misses >= 3 {
                builds[index].stepText = "Waiting for the game server…"
            }
        }
    }

    private func apply(_ job: GenerationJob, to index: Int) {
        if let last = job.events.map(\.seq).max() {
            builds[index].lastSeq = max(builds[index].lastSeq ?? last, last)
        }
        switch job.status {
        case .queued:
            builds[index].stepText = job.position.map { "Waiting for Muse (\($0) ahead)…" } ?? "Waiting for Muse…"
        case .running:
            if let event = job.events.filter({ $0.kind != .other }).max(by: { $0.seq < $1.seq }) {
                builds[index].stepText = Self.stepText(for: event.kind)
                builds[index].progress = max(builds[index].progress, Self.progress(for: event.kind))
            }
        case .done:
            if let game = job.game {
                builds[index].title = game.title
                builds[index].posterURL = game.coverURL
            }
            builds[index].status = .ready
            builds[index].progress = 1
            statusChanged(index, from: .building, haptic: true)
            save()
        case .failed:
            let reason = StudioGenerateBridge.message(for: GameGenerationError.failed(
                code: job.code, message: job.error ?? job.events.last(where: { $0.kind == .failed })?.summary))
            fail(index, reason)
        }
    }

    private func fail(_ index: Int, _ reason: String) {
        builds[index].status = .failed
        builds[index].stepText = reason
        statusChanged(index, from: .building, haptic: false)
        Haptics.warning()
        save()
    }

    /// Ready or failed: a gentle haptic in the app, a notification out of it.
    private func statusChanged(_ index: Int, from old: GameBuild.Status, haptic: Bool) {
        let build = builds[index]
        guard old == .building, build.status != .building else { return }
        save()
        guard build.isMinimized else { return }
        if haptic { Haptics.light() }
        if UIApplication.shared.applicationState != .active {
            notify(build)
        }
    }

    /// Jobs of this account still running on the server that this app doesn't know about (another
    /// device, or a reinstall). `GET /v1/generate`; best effort.
    private func lookForServerJobs() async {
        #if DEBUG
        if DebugLaunch.value("FB_BUILDS") != nil { return }
        #endif
        guard await GamesAPILive.shared.isSignedIn,
              let data = try? await GamesAPILive.shared.generationJobs(),
              let list = try? GamesAPICoding.decoder().decode(ServerJobList.self, from: data) else { return }
        let known = Set(builds.compactMap(\.jobID))
        let recent = Date().addingTimeInterval(-15 * 60)
        for item in list.items where !known.contains(item.jobID) && (item.status == "queued" || item.status == "running") {
            if let created = item.createdAt, created < recent { continue }
            builds.append(GameBuild(
                id: UUID(), jobID: item.jobID, request: item.request ?? "",
                title: Self.workingTitle(from: item.request ?? ""), stepText: "Muse is working on it…",
                progress: 0.05, startedAt: item.createdAt ?? Date(), isMinimized: true
            ))
        }
        save()
    }

    private func forget(_ id: UUID) {
        builds.removeAll { $0.id == id }
        if let model = models.removeValue(forKey: id) {
            let key = ObjectIdentifier(model)
            buildIDs[key] = nil
            resumeJobs[key] = nil
        }
        launches = launches.filter { $0.value != id }
        lastPoll[id] = nil
        pollMisses[id] = nil
        save()
    }

    // MARK: Background and notifications

    private func didEnterBackground() {
        guard builds.contains(where: { $0.status == .building && $0.isMinimized }) else { return }
        // A little time to keep polling; the server's push would cover the rest (asked of Max).
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "game-build") { [weak self] in
            MainActor.assumeIsolated { self?.endBackgroundTime() }
        }
    }

    private func endBackgroundTime() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    /// The first minimize asks to send "your game is ready" notifications.
    private func askForNotificationsOnce() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.askedNotificationsKey) else { return }
        #if DEBUG
        if DebugLaunch.value("FB_BUILDS") != nil { return }
        #endif
        defaults.set(true, forKey: Self.askedNotificationsKey)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func notify(_ build: GameBuild) {
        let content = UNMutableNotificationContent()
        switch build.status {
        case .ready:
            content.title = "Your \(ProductName.singular) is ready"
            content.body = "\(build.title) is made. Tap to play it."
        case .failed:
            content.title = "\(build.title) didn't work"
            content.body = "Tap to try again."
        case .building:
            return
        }
        content.sound = .default
        let request = UNNotificationRequest(identifier: "game-build-\(build.id.uuidString)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { _ in }
    }

    // MARK: Saving

    private struct Saved: Codable {
        var id: UUID
        var jobID: String
        var request: String
        var title: String
        var status: GameBuild.Status
        var stepText: String
        var startedAt: Date
        var posterURL: URL?
    }

    private func save() {
        let saved: [Saved] = builds.compactMap { build in
            #if DEBUG
            if build.isFixture { return nil }
            #endif
            guard let jobID = build.jobID else { return nil }
            return Saved(id: build.id, jobID: jobID, request: build.request, title: build.title, status: build.status,
                         stepText: build.stepText, startedAt: build.startedAt, posterURL: build.posterURL)
        }
        if saved.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.savedKey)
        } else if let data = try? JSONEncoder().encode(saved) {
            UserDefaults.standard.set(data, forKey: Self.savedKey)
        }
    }

    private func restoreSaved() {
        #if DEBUG
        if DebugLaunch.value("FB_BUILDS") != nil { return }
        #endif
        guard let data = UserDefaults.standard.data(forKey: Self.savedKey),
              let saved = try? JSONDecoder().decode([Saved].self, from: data) else { return }
        let cutoff = Date().addingTimeInterval(-Self.savedLifetime)
        builds = saved.filter { $0.startedAt > cutoff }.map { item in
            GameBuild(
                id: item.id, jobID: item.jobID, request: item.request, title: item.title, status: item.status,
                stepText: item.status == .building ? "Checking on Muse…" : item.stepText,
                progress: item.status == .building ? 0.05 : 1, startedAt: item.startedAt,
                posterURL: item.posterURL, isMinimized: true
            )
        }
    }

    /// Starts watching restored builds. The dock calls this when the tabs appear.
    func resumeIfNeeded() {
        startMonitor()
    }

    // MARK: Copy

    /// The plan's working title, else the first words of the request ("Pancake rush game").
    static func workingTitle(for model: StudioModel) -> String {
        if let title = StudioPlanMemory.existing(for: model)?.plan?.title.trimmingCharacters(in: .whitespacesAndNewlines),
           !title.isEmpty {
            return title
        }
        return workingTitle(from: model.prompt)
    }

    nonisolated static func workingTitle(from request: String) -> String {
        var words = request.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace).map(String.init)
        if let first = words.first?.lowercased(), ["a", "an", "the", "make", "build"].contains(first), words.count > 2 {
            words.removeFirst()
        }
        // Stop before who or where it's for: "pancake rush game | for my running club".
        if let cut = words.indices.dropFirst(2).first(where: { ["for", "with", "where", "that", "about", "in"].contains(words[$0].lowercased()) }) {
            words = Array(words[..<cut])
        }
        let short = words.prefix(5).joined(separator: " ").trimmingCharacters(in: .punctuationCharacters)
        guard !short.isEmpty else { return "Your new \(ProductName.singular)" }
        return short.prefix(1).uppercased() + short.dropFirst() + (words.count > 5 ? "…" : "")
    }

    /// The step line for a live Studio run.
    static func stepText(for model: StudioModel) -> String {
        if let wait = model.generationWait {
            return wait.position.map { "Waiting for Muse (\($0) ahead)…" } ?? "Waiting for Muse…"
        }
        switch model.currentEvent?.step {
        case .compose?: return "Muse is drafting…"
        case .validate?: return "Muse is building it…"
        case .repair?: return "Muse is fixing a few things…"
        case .playtest?: return "Muse is playtesting…"
        case .cover?, .polish?: return "Muse is polishing…"
        default: return "Muse is starting…"
        }
    }

    nonisolated static func stepText(for kind: GenerationEvent.Kind) -> String {
        switch kind {
        case .drafting: return "Muse is drafting…"
        case .expanding: return "Muse is building it…"
        case .repairing: return "Muse is fixing a few things…"
        case .playtesting: return "Muse is playtesting…"
        case .polishing, .playtested, .done: return "Muse is polishing…"
        case .scoreChecking, .scoreReviewing, .scoreRepairing, .scoreChecked: return "Muse is checking the scoring…"
        case .painting, .painted: return "Muse is drawing the art…"
        case .failed, .other: return "Muse is working on it…"
        }
    }

    nonisolated static func progress(for kind: GenerationEvent.Kind) -> Double {
        switch kind {
        case .drafting: return 0.2
        case .expanding: return 0.4
        case .repairing: return 0.55
        case .playtesting: return 0.72
        case .scoreChecking, .scoreReviewing, .scoreRepairing, .scoreChecked: return 0.8
        case .playtested: return 0.85
        case .painting, .painted: return 0.9
        case .polishing: return 0.94
        case .done: return 1
        case .failed, .other: return 0.1
        }
    }

    // MARK: DEBUG fixtures

    #if DEBUG
    /// Screenshot fixtures (`GameBuildFixtures`): replaces the builds, never polled or saved.
    func debugShow(_ fixtures: [GameBuild]) {
        builds = fixtures.map { var build = $0; build.isFixture = true; return build }
    }
    #endif
}

/// `GET /v1/generate`: my recent jobs (no events).
private struct ServerJobList: Decodable {
    struct Item: Decodable {
        var jobID: String
        var status: String
        var request: String?
        var createdAt: Date?

        enum CodingKeys: String, CodingKey {
            case jobID = "jobId", status, request, createdAt
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            jobID = try c.decode(String.self, forKey: .jobID)
            status = ((try? c.decode(String.self, forKey: .status)) ?? "").lowercased()
            request = try? c.decodeIfPresent(String.self, forKey: .request)
            createdAt = (try? c.decodeIfPresent(Date.self, forKey: .createdAt)) ?? nil
        }
    }

    var items: [Item]
}

/// The server's generator, telling `GameBuildTracker` which job a Studio run is on (so it can be
/// saved and resumed), and re-attaching a restored build to its job instead of starting a new one.
struct TrackedGameGenerator: GameGenerator {
    let inner: any GameGenerator
    let tracker: GameBuildTracker
    let key: ObjectIdentifier

    var pollInterval: TimeInterval { inner.pollInterval }

    func start(request: String, brief: BubbleBrief, anatomy: String?, draft: Bool, sound: RemoteGameSound?, media: GameMediaInput) async throws -> String {
        if let jobID = await tracker.takeResumeJob(for: key) { return jobID }
        let jobID = try await inner.start(request: request, brief: brief, anatomy: anatomy, draft: draft, sound: sound, media: media)
        await tracker.jobStarted(jobID, key: key)
        return jobID
    }

    func start(revision: GameRevision) async throws -> String {
        if let jobID = await tracker.takeResumeJob(for: key) { return jobID }
        let jobID = try await inner.start(revision: revision)
        await tracker.jobStarted(jobID, key: key)
        return jobID
    }

    func job(id: String, after: Int?) async throws -> GenerationJob {
        try await inner.job(id: id, after: after)
    }

    func cancel(id: String) async {
        await tracker.jobCancelled(id)
        await inner.cancel(id: id)
    }

    func publish(gameID: String) async throws {
        try await inner.publish(gameID: gameID)
    }

    func discard(gameID: String) async {
        await inner.discard(gameID: gameID)
    }

    func manifest(for game: RemoteGame) async throws -> BubbleManifest {
        try await inner.manifest(for: game)
    }
}
