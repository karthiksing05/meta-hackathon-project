import Foundation
import JavaScriptCore
import UIKit

/// Orders the games feed with `game-recs.js` (stages 1–4 plus a per-person bait appetite; the
/// header of that file explains the model) and teaches it from what you do on each page.
///
/// - **Ranking.** `BubbleStore.extendFeed` asks for the next pages (`StoreRecommendations.swift`).
///   If the recommender is off or anything fails, the feed falls back to `BubbleFeedGenerator`.
///   The curated opening pages stay as they are.
/// - **Learning.** One impression per feed page. `BubbleFeedModel` reports page changes,
///   visibility, takeovers, replays and finished runs. The tab, floats and the game Board report
///   saves, likes, floats, remixes, board opens and Add friend with `note(_:gameID:)`. Leaving
///   the tab only pauses the page, so Add friend on a pushed game Board still counts for the
///   game you came from. Three minutes away ends the session.
/// - **Saves and social moments** (docs/BUBBLES.md 7.1). The recommender listens for
///   `.bubbleSaveChanged` and `.bubbleSocialSignal`. A moment about the open page's game joins
///   that page's reward; one anywhere else (Messenger, a Group, a profile) goes to `signal` in
///   game-recs.js as off-feed evidence.
/// - **State** (posteriors, your taste and bait lean) persists as
///   `Application Support/Bubbles/game-recs-state.json`.
///
/// Launch variables:
/// - `FB_RECS=off` uses the old feed. `FB_RECS=reward,bandit` turns on only the listed stages
///   (`reward`, `bandit`, `calibration`, `coldStart`, `bait`).
/// - `FB_RECS_RESET=1` starts from scratch.
/// - `FB_RECS_LOG=1` prints every ranking and page to the console.
///
/// Main thread only, like `BubbleStore`: JavaScriptCore contexts aren't thread-safe.
final class GameRecommender {
    static let shared = GameRecommender()

    /// Something you did on a feed page.
    enum Signal {
        case runStarted, runFinished, saved, liked, floated, openedBoard, addedFriend, remixed
        /// A `BubbleSocialSignalKind` raw value, with the other people involved.
        case social(String, with: [String])
    }

    /// One ranked page from `game-recs.js`.
    struct Pick: Decodable {
        let gameID: String
        let reason: String
        let runUserID: String?
        let score: Double?
        let hook: Double?
        let tier: String?
        let pSlop: Double?
        let unproven: Bool?
        let why: String?
    }

    /// False when `FB_RECS=off`, in previews, or if the script didn't load.
    private(set) var isEnabled: Bool
    /// Your current bait lean, from the last ranking (for debug overlays).
    private(set) var lastBaitLean: Double?

    private let logs: Bool
    private var bridge: JSValue?
    private var context: JSContext?
    private var exception: String?
    private var current: Impression?
    private var pendingSave: DispatchWorkItem?
    private var backgroundObserver: NSObjectProtocol?
    private var signalObservers: [NSObjectProtocol] = []
    /// Away from the feed this long ends the session.
    private let sessionGap: TimeInterval = 180

    private init() {
        let env = ProcessInfo.processInfo.environment
        let setting = (env["FB_RECS"] ?? "on").trimmingCharacters(in: .whitespaces)
        logs = env["FB_RECS_LOG"] == "1"
        isEnabled = false
        guard setting.lowercased() != "off", setting != "0", env["XCODE_RUNNING_FOR_PREVIEWS"] != "1" else { return }

        guard let url = Bundle.main.url(forResource: "game-recs", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8),
              let context = JSContext() else {
            print("[recs] game-recs.js is missing; using the old feed")
            return
        }
        context.exceptionHandler = { [weak self] _, value in
            self?.exception = value?.toString() ?? "unknown error"
        }
        context.evaluateScript(source, withSourceURL: URL(string: "recs:///game-recs.js"))
        guard exception == nil,
              let api = context.objectForKeyedSubscript("GameRecs"), api.isObject,
              let bridge = api.objectForKeyedSubscript("app"), bridge.isObject else {
            print("[recs] game-recs.js failed to load (\(exception ?? "no GameRecs.app")); using the old feed")
            return
        }
        self.context = context
        self.bridge = bridge

        let saved = env["FB_RECS_RESET"] == "1" ? nil : Self.stateURL.flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        guard let reply = call("load", [saved ?? "", Self.overrides(for: setting) ?? ""]) else {
            print("[recs] load failed; using the old feed")
            self.bridge = nil
            return
        }
        isEnabled = true
        log("loaded \(reply)")

        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.feedHidden()
            self?.saveNow()
        }
        observeMoments()
    }

    // MARK: - Ranking

    /// The next `count` pages, or nil to fall back to the old generator.
    func rank(candidates: [BubbleFeedCandidate], summaries: [GameRecSummary], feed: [BubbleFeedItem], count: Int, seed: UInt64) -> [Pick]? {
        guard isEnabled else { return nil }
        let input = RankInput(
            candidates: candidates.map { RankInput.Candidate(gameID: $0.bubbleID, reason: $0.reason.rawValue, runUserID: $0.runUserID, weight: $0.weight) },
            summaries: summaries,
            feed: feed.map(\.bubbleID),
            feedKeys: feed.map { "\($0.bubbleID)|\($0.reason.rawValue)|\($0.runUserID ?? "-")" },
            count: count,
            seed: UInt32(truncatingIfNeeded: seed),
            day: Self.today()
        )
        guard let json = Self.encode(input),
              let reply = call("rank", [json]),
              let decoded = try? JSONDecoder().decode(RankReply.self, from: Data(reply.utf8)) else {
            log("rank failed; using the old feed for these pages")
            return nil
        }
        lastBaitLean = decoded.bait?.lean
        if logs {
            let lean = decoded.bait.map { String(format: "%.2f", $0.lean) } ?? "-"
            print("[recs] ranked \(decoded.picks.count) pages (bait lean \(lean))")
            for pick in decoded.picks {
                print(String(format: "[recs]   %@ %@ hook %.2f slop %.2f%@ (%@)",
                             pick.gameID, pick.reason, pick.hook ?? 0, pick.pSlop ?? 0,
                             pick.unproven == true ? " new" : "", pick.why ?? ""))
            }
        }
        return decoded.picks
    }

    // MARK: - Group Blend

    /// A Group's Blend (`groupBlend` in game-recs.js), or nil when the recommender is off or failed.
    func groupBlend(_ input: GroupBlendInput) -> GroupBlend? {
        guard isEnabled, let json = Self.encode(input), let reply = call("groupBlend", [json]) else { return nil }
        guard let blend = try? JSONDecoder().decode(GroupBlend.self, from: Data(reply.utf8)) else {
            log("groupBlend reply didn't decode")
            return nil
        }
        if logs {
            print(String(format: "[recs] Blend for %@: %d games, cohesion %.2f", input.group.name, blend.picks.count, blend.cohesion))
            for pick in blend.picks {
                print(String(format: "[recs]   %@ %@ (all-enjoy %.2f, min %.2f) %@", pick.gameID, pick.label, pick.everyone, pick.minEnjoy, pick.why))
            }
        }
        return blend
    }

    // MARK: - Learning

    /// The feed settled on a page while the tab is on screen.
    func pageShown(feedItemID: String, gameID: String) {
        guard isEnabled else { return }
        if let current, current.feedItemID == feedItemID {
            resume()
            return
        }
        finishCurrent(endedSession: false)
        current = Impression(feedItemID: feedItemID, gameID: gameID, visibleSince: Date())
    }

    /// The games tab is on screen again, on `feedItemID`.
    func feedVisible(feedItemID: String?, gameID: String?) {
        guard isEnabled else { return }
        if let hiddenAt = current?.hiddenAt, Date().timeIntervalSince(hiddenAt) > sessionGap {
            finishCurrent(endedSession: true)
            endSession()
        }
        if let feedItemID, let gameID {
            pageShown(feedItemID: feedItemID, gameID: gameID)
        }
    }

    /// The games tab left the screen: another tab, a pushed page such as the game Board, a
    /// sheet, or the app in the background. The page stays open so later actions still count.
    func feedHidden() {
        guard isEnabled, var page = current, page.hiddenAt == nil else { return }
        if let since = page.visibleSince {
            page.dwell += Date().timeIntervalSince(since)
        }
        page.visibleSince = nil
        page.hiddenAt = Date()
        current = page
    }

    /// Records a signal for the open page, if it's showing `gameID`.
    func note(_ signal: Signal, gameID: String) {
        guard isEnabled, var page = current, page.gameID == gameID else { return }
        switch signal {
        case .runStarted:
            page.tookOver = true
            page.runsStarted += 1
        case .runFinished:
            page.runsFinished += 1
            page.runsStarted = max(page.runsStarted, page.runsFinished)
        case .saved: page.saved = true
        case .liked: page.liked = true
        case .floated: page.floated = true
        case .openedBoard: page.openedBoard = true
        case .addedFriend: page.addedFriend = true
        case .remixed: page.remixed = true
        case let .social(kind, with: people):
            page.social.insert(kind)
            page.with.formUnion(people)
        }
        current = page
        log("\(signal) on \(gameID)")
    }

    // MARK: - Saves and social moments

    private func observeMoments() {
        let center = NotificationCenter.default
        // The names and userInfo keys are the contract in docs/BUBBLES.md 7.1 (`BubbleSaveSignals`,
        // `BubbleSocialSignals`), spelled out so this file doesn't depend on when that lands.
        signalObservers.append(center.addObserver(forName: Notification.Name("bubbleSaveChanged"), object: nil, queue: .main) { [weak self] note in
            guard let info = note.userInfo,
                  let gameID = info["bubbleID"] as? String,
                  info["isSaved"] as? Bool == true else { return }
            self?.moment("saved", gameID: gameID, with: [])
        })
        signalObservers.append(center.addObserver(forName: Notification.Name("bubbleSocialSignal"), object: nil, queue: .main) { [weak self] note in
            guard let info = note.userInfo,
                  let kind = info["kind"] as? String,
                  let gameID = info["bubbleID"] as? String else { return }
            let with = info["with"] as? [String] ?? []
            self?.moment(kind, gameID: gameID, with: with)
        })
    }

    /// A save or social moment. About the open page's game, it joins that page's reward (even if
    /// the tab is hidden, e.g. you're in Messenger sending the challenge). Anywhere else it's
    /// off-feed evidence. Unsaves are ignored.
    private func moment(_ kind: String, gameID: String, with userIDs: [String]) {
        guard isEnabled else { return }
        if let page = current, page.gameID == gameID {
            switch kind {
            case "saved": note(.saved, gameID: gameID)
            case "remix": note(.remixed, gameID: gameID)
            case "add_friend_from_game": note(.addedFriend, gameID: gameID)
            default: note(.social(kind, with: userIDs), gameID: gameID)
            }
            return
        }
        let input = SignalInput(id: gameID, kind: kind, with: userIDs, day: Self.today())
        guard let json = Self.encode(input), let reply = call("signal", [json]) else { return }
        log("off-feed \(kind) on \(gameID): \(reply)")
        scheduleSave()
    }

    private func resume() {
        guard var page = current else { return }
        if let hiddenAt = page.hiddenAt, Date().timeIntervalSince(hiddenAt) > sessionGap {
            // Back on the same page after a long time: that was a new session.
            finishCurrent(endedSession: true)
            endSession()
            current = Impression(feedItemID: page.feedItemID, gameID: page.gameID, visibleSince: Date())
            return
        }
        if page.visibleSince == nil {
            page.visibleSince = Date()
        }
        page.hiddenAt = nil
        current = page
    }

    private func finishCurrent(endedSession: Bool) {
        guard var page = current else { return }
        current = nil
        if let since = page.visibleSince {
            page.dwell += Date().timeIntervalSince(since)
        }
        let impression = ImpressionInput(
            id: page.gameID,
            dwellSec: page.dwell,
            tookOver: page.tookOver,
            runsFinished: page.runsFinished,
            replays: max(0, page.runsStarted - 1),
            saved: page.saved,
            liked: page.liked,
            floated: page.floated,
            openedBoard: page.openedBoard,
            addedFriend: page.addedFriend,
            remixed: page.remixed,
            social: page.social.sorted(),
            with: page.with.sorted(),
            quitMidRun: page.runsStarted > page.runsFinished,
            endedSession: endedSession,
            day: Self.today()
        )
        guard let json = Self.encode(impression), let reply = call("observe", [json]) else { return }
        log(String(format: "page %@ %.1fs: ", page.gameID, page.dwell) + reply)
        scheduleSave()
    }

    private func endSession() {
        _ = call("endSession", [])
        scheduleSave()
    }

    // MARK: - Persistence

    private static var stateURL: URL? {
        BubbleStore.storageDirectory?.appendingPathComponent("game-recs-state.json")
    }

    private func scheduleSave() {
        pendingSave?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.saveNow()
        }
        pendingSave = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    func saveNow() {
        pendingSave?.cancel()
        pendingSave = nil
        guard isEnabled, let json = call("exportState", []), let url = Self.stateURL else { return }
        let data = Data(json.utf8)
        DispatchQueue.global(qos: .utility).async {
            try? data.write(to: url, options: .atomic)
        }
    }

    // MARK: - Bridge

    private func call(_ method: String, _ arguments: [Any]) -> String? {
        guard let bridge else { return nil }
        exception = nil
        let value = bridge.invokeMethod(method, withArguments: arguments)
        if let exception {
            print("[recs] \(method) threw: \(exception)")
            return nil
        }
        guard let value, value.isString else { return nil }
        return value.toString()
    }

    private func log(_ message: @autoclosure () -> String) {
        if logs {
            print("[recs] " + message())
        }
    }

    /// `FB_RECS=reward,bandit` → only those stages on.
    private static func overrides(for setting: String) -> String? {
        let lowered = setting.lowercased()
        guard !lowered.isEmpty, lowered != "on", lowered != "1", lowered != "all" else { return nil }
        let wanted = Set(lowered.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) })
        var stages: [String: Bool] = [:]
        for stage in ["reward", "bandit", "calibration", "coldStart", "bait"] {
            stages[stage] = wanted.contains(stage.lowercased())
        }
        return encode(["stages": stages])
    }

    static func today() -> Int {
        Int(Date().timeIntervalSince1970 / 86_400)
    }

    private static func encode<T: Encodable>(_ value: T) -> String? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Payloads

    private struct Impression {
        let feedItemID: String
        let gameID: String
        var visibleSince: Date?
        var hiddenAt: Date?
        var dwell: TimeInterval = 0
        var tookOver = false
        var runsStarted = 0
        var runsFinished = 0
        var saved = false
        var liked = false
        var floated = false
        var openedBoard = false
        var addedFriend = false
        var remixed = false
        var social: Set<String> = []
        var with: Set<String> = []

        init(feedItemID: String, gameID: String, visibleSince: Date?) {
            self.feedItemID = feedItemID
            self.gameID = gameID
            self.visibleSince = visibleSince
        }
    }

    private struct RankInput: Encodable {
        struct Candidate: Encodable {
            let gameID: String
            let reason: String
            let runUserID: String?
            let weight: Double
        }
        let candidates: [Candidate]
        let summaries: [GameRecSummary]
        let feed: [String]
        let feedKeys: [String]
        let count: Int
        let seed: UInt32
        let day: Int
    }

    private struct ImpressionInput: Encodable {
        let id: String
        let dwellSec: Double
        let tookOver: Bool
        let runsFinished: Int
        let replays: Int
        let saved: Bool
        let liked: Bool
        let floated: Bool
        let openedBoard: Bool
        let addedFriend: Bool
        let remixed: Bool
        let social: [String]
        let with: [String]
        let quitMidRun: Bool
        let endedSession: Bool
        let day: Int
    }

    private struct SignalInput: Encodable {
        let id: String
        let kind: String
        let with: [String]
        let day: Int
    }

    private struct RankReply: Decodable {
        struct Bait: Decodable {
            let lean: Double
            let tolerance: Double
        }
        let picks: [Pick]
        let bait: Bait?
    }
}
