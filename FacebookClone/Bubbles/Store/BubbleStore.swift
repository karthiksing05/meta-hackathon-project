import Foundation
import Observation
import UIKit

/// App state for games: the games fetched from the server this session, their boards, the games
/// tab's feed (pages chosen by the server's recommender) and the Studio service.
/// Injected with `.environment(bubbleStore)`; read with `@Environment(BubbleStore.self)`.
///
/// Everything here comes from the games API (`GamesAPILive`, backend/README.md): games and their
/// manifests, covers, plays and saves, boards and the people on them. The store keeps no game data
/// of its own, ranks nothing and invents nothing: a screen with no server data shows its empty or
/// error state. Playing a game still runs on the phone (runtime, kits, engine).
///
/// Call from the main thread (SwiftUI views and their actions), like `AppStore`.
@Observable
final class BubbleStore {
    /// Every game fetched this session (feed pages, search, Groups, your games), newest first.
    var bubbles: [Bubble] = []
    /// Today's Daily game id for each Group id, from the fetched games' manifests.
    var dailyBubbleIDs: [String: String] = [:]
    /// "yyyy-MM-dd" for today. Daily boards only count runs from this day.
    private(set) var todayKey: String = BubbleStore.dayKey(Date())
    /// The games tab's feed for this session: the server's pages, in its order.
    var feedItems: [BubbleFeedItem] = []
    /// Where the feed stands: loading, failed (with the server's message) or at its end.
    var feedState: FeedLoadState = .idle
    /// Games whose board is loading, and boards that failed, by game id.
    var boardStates: [String: FeedLoadState] = [:]
    /// Friends and Group boards from the server, by `boardKey` (the everyone board is `bubble.scores`).
    var scopedBoards: [String: [BubbleScore]] = [:]

    @ObservationIgnored let appStore: AppStore

    @ObservationIgnored let runtimeWorker = BubbleRuntimeWorker()
    /// The page the games tab shows, so the feed loads ahead of it.
    @ObservationIgnored var feedPosition = 0
    /// One id per app launch; the server keeps what it showed this session under it.
    @ObservationIgnored let feedSessionID = UUID().uuidString
    /// Server people seen this session (game owners, board rows), as app users.
    @ObservationIgnored var serverPeople: [String: User] = [:]
    /// Server Groups seen this session, as app Groups.
    @ObservationIgnored var serverGroups: [String: FBGroup] = [:]
    /// Game id → server game, for the server's counters and URLs.
    @ObservationIgnored var remoteGames: [String: RemoteGame] = [:]
    @ObservationIgnored var groupRequests: Set<String> = []
    @ObservationIgnored var feedTask: Task<Void, Never>?
    @ObservationIgnored var gameRequests: [String: Task<Bubble?, Never>] = [:]
    @ObservationIgnored private var dayObservers: [NSObjectProtocol] = []
    @ObservationIgnored let isPreview: Bool

    var api: GamesAPILive { GamesAPIFactory.current }

    init(appStore: AppStore) {
        self.appStore = appStore
        isPreview = ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
        guard !isPreview else { return }
        // Warm runtime hosts load in the background right after the first frame.
        DispatchQueue.main.async {
            BubbleRuntimePool.warmUp()
        }
        observeDayChanges()
        loadMoreFeed()
    }

    // MARK: - Queries

    func bubble(id: String) -> Bubble? {
        bubbles.first { $0.id == id } ?? remoteGames[id].flatMap { game in bubbles.first { $0.serverID == game.id } }
    }

    /// Games in the order the feed shows them first, then everything else, without repeats.
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

    /// The levels of a chain that have been fetched, in order.
    func chain(_ chainID: String) -> [Bubble] {
        bubbles
            .filter { $0.chainID == chainID }
            .sorted { ($0.levelIndex ?? 0) < ($1.levelIndex ?? 0) }
    }

    /// The level after `bubble` in its chain, if it has been fetched.
    func nextLevel(after bubble: Bubble) -> Bubble? {
        if let next = bubble.manifest.chain?.next, let found = self.bubble(id: next) {
            return found
        }
        guard let chainID = bubble.chainID else { return nil }
        let levels = chain(chainID)
        guard let index = levels.firstIndex(where: { $0.id == bubble.id }), index + 1 < levels.count else { return nil }
        return levels[index + 1]
    }

    /// The board for `scope`, best first, as the server sent it. The server keeps one global
    /// board per game, so `.friends` and `.group` are empty until it serves those scopes
    /// (docs/APP_LIVE_DATA_PLAN.md, Stage 4); screens say so.
    func leaderboard(for bubble: Bubble, scope: BubbleBoardScope) -> [BubbleScore] {
        guard scope != .everyone else { return bubble.scores }
        return scopedBoards[Self.boardKey(bubble.id, scope, groupID: scope == .group ? bubble.group?.id : nil)] ?? []
    }

    /// The server serves every scope (`GET /v1/games/{id}/leaderboard?scope=`).
    static func serves(_ scope: BubbleBoardScope) -> Bool { true }

    static func boardKey(_ bubbleID: String, _ scope: BubbleBoardScope, groupID: String?) -> String {
        "\(bubbleID)|\(scope.rawValue)|\(groupID ?? "")"
    }

    func bestScore(of user: User, in bubble: Bubble) -> BubbleScore? {
        bestScore(ofUserID: user.id, in: bubble)
    }

    /// Someone's row on the server's board.
    func bestScore(ofUserID userID: String, in bubble: Bubble) -> BubbleScore? {
        bubble.scores.filter { $0.user.id == userID }.max { $0.score < $1.score }
    }

    /// Whether `user` counts on the game's Group board. Group boards aren't served yet.
    func isGroupMember(_ user: User, for bubble: Bubble) -> Bool {
        false
    }

    /// The Group a game was made for, when the server says so.
    func boardGroups(for bubble: Bubble) -> [FBGroup] {
        if let group = bubble.group ?? resolveGroup(bubble.manifest.structure.groupID) {
            return [group]
        }
        return []
    }

    // MARK: Library

    /// Games you made, newest first.
    var yourBubbles: [Bubble] {
        bubbles.filter { $0.creator.isMe }
    }

    var savedBubbles: [Bubble] {
        bubbles.filter(\.isSaved)
    }

    /// Games made for Groups you're in, Daily games first.
    var yourGroupsBubbles: [Bubble] {
        bubbles
            .filter { $0.group?.isMember ?? false }
            .sorted { $0.isDaily && !$1.isDaily }
    }

    /// Games your friends made.
    var friendsBubbles: [Bubble] {
        bubbles.filter { $0.creator.isFriend }
    }

    /// The first level of every chain, newest first.
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

    // MARK: Daily games

    /// Days in a row you've played a Daily game. The server doesn't keep streaks yet, so this is
    /// 0 and screens hide the streak.
    var dailyStreak: Int { 0 }

    /// Whether your row on this Daily game's board is from today.
    func hasPlayedToday(_ bubble: Bubble) -> Bool {
        bubble.scores.contains { $0.user.isMe && $0.day == todayKey }
    }

    // MARK: - Actions

    /// Sends your run to the server (`POST /v1/games/{id}/scores`) and shows the board it returns.
    /// Until the reply arrives your run shows on its own, so the result sheet has it.
    @discardableResult
    func record(_ result: BubbleRunResult, in bubble: Bubble) -> BubbleScore {
        refreshDayIfNeeded()
        let entry = BubbleScore(
            user: appStore.me,
            score: result.score,
            achievedAt: Date(),
            day: todayKey,
            replay: result.replay,
            share: result.share
        )
        if (bestScore(of: appStore.me, in: bubble)?.score ?? Int.min) < entry.score {
            bubble.scores.removeAll { $0.user.isMe }
            bubble.scores.append(entry)
            bubble.scores.sort { $0.score > $1.score }
        }
        bubble.playCount += 1
        let gameID = bubble.serverID
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let rows = try await api.submitScore(entry.score, gameID: gameID)
                apply(rows, to: bubble, keepingReplay: entry)
            } catch {
                boardStates[bubble.id] = .failed(error.localizedDescription)
            }
        }
        return entry
    }

    /// Adds a game the server just made (Studio) and shows it next in the feed.
    @discardableResult
    func publish(_ manifest: BubbleManifest, cover: Data? = nil, group: FBGroup? = nil, event: FBEvent? = nil, remote: RemoteGame? = nil) -> Bubble {
        let bubble = Bubble(
            manifest: manifest,
            creator: appStore.me,
            group: group ?? resolveGroup(remote?.groupID ?? manifest.structure.groupID),
            event: event,
            createdAt: remote?.createdAt ?? Date(),
            coverImageData: cover,
            playCount: remote?.plays ?? 0,
            likeCount: remote?.likes ?? 0,
            isLiked: remote?.likedByMe ?? false,
            isSaved: remote?.likedByMe ?? false,
            saveCount: remote?.likes ?? 0
        )
        if let remote {
            bubble.serverID = remote.id
            remoteGames[bubble.id] = remote
        }
        bubbles.removeAll { $0.id == bubble.id }
        bubbles.insert(bubble, at: 0)
        noteDaily(bubble)
        insertIntoFeed(bubble)
        return bubble
    }

    /// Replaces a game's manifest with an edited version for this session and keeps the old one
    /// in history. The server doesn't take edits yet.
    func update(_ bubble: Bubble, to manifest: BubbleManifest, cover: Data? = nil) {
        bubble.history.append(bubble.manifest)
        bubble.manifest = manifest
        if let cover {
            bubble.coverImageData = cover
        }
    }

    /// Kept for callers that saved after changing a game; the server is the only store now.
    func scheduleSave() {}

    func toggleLike(_ bubble: Bubble) {
        setSaved(!bubble.isSaved, on: bubble, source: .feed)
    }

    /// Saves or unsaves a game. Saves are the likes on the server (`PUT`/`DELETE /like`): every
    /// save in the app goes through here, and it posts `Notification.Name.bubbleSaveChanged` with
    /// `["bubbleID": String, "isSaved": Bool, "source": String]` for the feed's page events.
    func toggleSave(_ bubble: Bubble, source: BubbleSaveSource = .feed) {
        setSaved(!bubble.isSaved, on: bubble, source: source)
    }

    private func setSaved(_ saved: Bool, on bubble: Bubble, source: BubbleSaveSource) {
        // Shown at once; the server's reply sets the real count.
        bubble.isSaved = saved
        bubble.isLiked = saved
        bubble.saveCount = max(0, bubble.saveCount + (saved ? 1 : -1))
        bubble.likeCount = bubble.saveCount
        BubbleSaveSignals.post(bubbleID: bubble.id, isSaved: saved, source: source)
        let gameID = bubble.serverID
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let state = try await api.setSaved(saved, gameID: gameID)
                bubble.isSaved = state.likedByMe
                bubble.isLiked = state.likedByMe
                bubble.saveCount = state.likes
                bubble.likeCount = state.likes
            } catch {
                bubble.isSaved = !saved
                bubble.isLiked = !saved
                bubble.saveCount = max(0, bubble.saveCount + (saved ? -1 : 1))
                bubble.likeCount = bubble.saveCount
                appStore.showToast("Couldn't save: \(error.localizedDescription)", symbol: "exclamationmark.circle")
            }
        }
    }

    // MARK: - Days

    /// Moves to a new day after midnight.
    func refreshDayIfNeeded() {
        let now = Self.dayKey(Date())
        guard now != todayKey else { return }
        todayKey = now
    }

    private func observeDayChanges() {
        let center = NotificationCenter.default
        for name in [UIApplication.significantTimeChangeNotification, Notification.Name.NSCalendarDayChanged] {
            dayObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.refreshDayIfNeeded()
            })
        }
        // A different account (signed in, signed up, guest) means a different personalized feed.
        dayObservers.append(center.addObserver(forName: .gamesAccountChanged, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.feedItems.removeAll()
            self.reloadFeed()
        })
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
}

/// Where a server-backed list stands.
enum FeedLoadState: Equatable {
    case idle
    case loading
    /// The server answered with nothing more.
    case end
    case failed(String)

    var isLoading: Bool { self == .loading }
    var failure: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}
