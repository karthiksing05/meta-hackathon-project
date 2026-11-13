import Foundation
import Observation

/// The Group's weekly games leaderboard (docs/BUBBLES.md 7.3). Owner: groups-search.
///
/// The server ranks it (`GET /v1/groups/{id}/leaderboard?week=`): each of the Group's games awards
/// rank points among the members who played it this ISO week (1st 10, 2nd 7, 3rd 5, 4th 3, 5th 2,
/// then 1), summed per member. Nothing is computed or made up on the phone.
@MainActor
@Observable
final class GroupGamesStore {
    static let shared = GroupGamesStore()

    /// One row of the weekly board.
    struct Standing: Identifiable, Hashable {
        let user: User
        /// This week's points.
        let points: Int
        /// Last week's points (for Most improved).
        let lastWeekPoints: Int
        /// 1-based rank this week.
        let rank: Int
        /// Places gained since last week (positive = up). Nil when they weren't on last week's board.
        let rankChange: Int?
        /// The biggest gain on last week, leader excluded, so it isn't only for the best player.
        let isMostImproved: Bool
        /// Group games they played this week.
        let gamesPlayed: Int

        var id: String { user.id }
        var gain: Int { points - lastWeekPoints }

        static func == (lhs: Standing, rhs: Standing) -> Bool {
            lhs.user.id == rhs.user.id && lhs.points == rhs.points && lhs.rank == rhs.rank && lhs.isMostImproved == rhs.isMostImproved
        }

        func hash(into hasher: inout Hasher) {
            hasher.combine(user.id)
            hasher.combine(points)
        }
    }

    /// Points for a rank on one game's board (0-based index).
    nonisolated static func points(forRankIndex index: Int) -> Int {
        switch index {
        case 0: return 5
        case 1: return 3
        case 2: return 2
        default: return 1
        }
    }

    /// Set at launch (`GroupsSearchScreens.install`) so `weeklyStandings(group:)` works without
    /// passing the store around.
    @ObservationIgnored weak var bubbleStore: BubbleStore?

    /// Groups whose trophy moment already played this launch (it plays once).
    private(set) var celebratedGroupIDs: Set<String> = []
    /// "Challenge the Group" posts you made this launch, newest last, by Group id.
    private(set) var challengePostIDs: [String: [String]] = [:]

    func markCelebrated(_ groupID: String) {
        celebratedGroupIDs.insert(groupID)
    }

    func noteChallengePost(_ postID: String, in groupID: String) {
        challengePostIDs[groupID, default: []].append(postID)
    }

    // MARK: - Standings

    /// The weekly board for a Group, best first.
    func weeklyStandings(group: FBGroup) -> [Standing] {
        guard let bubbleStore else { return [] }
        return weeklyStandings(group: group, in: bubbleStore)
    }

    /// The weekly board for a Group, as the server last sent it (`loadWeekly`).
    func weeklyStandings(group: FBGroup, in bubbleStore: BubbleStore, now: Date = Date()) -> [Standing] {
        weekly[group.id] ?? []
    }

    /// Weekly boards by Group id, from `GET /v1/groups/{id}/leaderboard`.
    private(set) var weekly: [String: [Standing]] = [:]
    /// Loading or failed (with the server's message), by Group id.
    private(set) var weeklyStates: [String: FeedLoadState] = [:]

    /// Fetches this week's board. Points and ranks come from the server; the phone only picks the
    /// "Most improved" label (the biggest climb, leader excluded).
    func loadWeekly(group: FBGroup, in bubbleStore: BubbleStore) {
        guard weeklyStates[group.id] != .loading else { return }
        weeklyStates[group.id] = .loading
        Task { @MainActor in
            do {
                let board = try await GamesAPIFactory.current.groupWeeklyBoard(groupID: group.id)
                let improvedID = board.items.filter { $0.rank > 1 && $0.rankChange > 0 }.max { $0.rankChange < $1.rankChange }?.user.id
                weekly[group.id] = board.items.map { row in
                    let user = bubbleStore.person(id: row.user.id, name: row.user.displayName.isEmpty ? row.user.username : row.user.displayName,
                                                  isFriend: row.user.isFriend)
                    return Standing(user: user, points: row.points, lastWeekPoints: 0, rank: row.rank,
                                    rankChange: row.rankChange == 0 ? nil : row.rankChange,
                                    isMostImproved: row.user.id == improvedID, gamesPlayed: row.gamesPlayed)
                }
                weeklyStates[group.id] = .idle
            } catch GamesAPIError.notFound {
                // Not a Group on the games server (the app's own Groups): an empty week, whose
                // empty state offers a game, not a failure to retry forever.
                weekly[group.id] = []
                weeklyStates[group.id] = .idle
            } catch {
                weeklyStates[group.id] = .failed(error.localizedDescription)
            }
        }
    }

    /// Who's in the Group besides you: its members on the server.
    func memberIDs(of group: FBGroup, in bubbleStore: BubbleStore) -> [String] {
        let me = bubbleStore.appStore.me.id
        var ids: [String] = []
        for user in (bubbleStore.serverGroups[group.id] ?? group).memberSample where !ids.contains(user.id) {
            ids.append(user.id)
        }
        return ids.filter { $0 != me }
    }

    /// Last week's winner. Needs the server's Group boards, so none yet.
    func lastWeekChampion(group: FBGroup, in bubbleStore: BubbleStore, now: Date = Date()) -> User? {
        nil
    }

    nonisolated static func ranks(_ totals: [String: Int]) -> [String: Int] {
        let ordered = totals.filter { $0.value > 0 }.sorted { lhs, rhs in
            lhs.value != rhs.value ? lhs.value > rhs.value : lhs.key < rhs.key
        }
        var out: [String: Int] = [:]
        for (index, pair) in ordered.enumerated() { out[pair.key] = index + 1 }
        return out
    }

    /// Group games you really played on `day` (any run that day counts once per game).
    private static func myGamesPlayed(on day: Date, games: [Bubble], meID: String, calendar: Calendar) -> Int {
        games.filter { game in
            game.scores.contains { $0.user.id == meID && calendar.isDate($0.achievedAt, inSameDayAs: day) }
        }.count
    }
}
