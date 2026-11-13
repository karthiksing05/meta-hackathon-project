import Foundation
import Observation

/// The Group's weekly games leaderboard (docs/BUBBLES.md 7.3). Owner: groups-search.
///
/// Every Group game gives points by rank each day: 1st 5, 2nd 3, 3rd 2, anyone else who played 1.
/// "This week" is the last 7 days, today included; "last week" is the 7 days before that.
///
/// - Today's points come from the real Group boards (`BubbleStore.leaderboard(for:scope: .group)`),
///   so a run you just played moves you up right away.
/// - Earlier days for the demo cast come from a stable synthetic history (a hash of the Group,
///   person, game and date), so the board looks lived-in and never changes within a day.
/// - Your own earlier days count only real runs (1 point per game played that day). Your score is
///   never made up.
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

    /// The weekly board for a Group, best first. Empty when the Group has no games.
    func weeklyStandings(group: FBGroup, in bubbleStore: BubbleStore, now: Date = Date()) -> [Standing] {
        let games = bubbleStore.worldBubbles(in: group).filter { !$0.isIcebreaker }
        guard !games.isEmpty else { return [] }
        let me = bubbleStore.appStore.me
        let members = memberIDs(of: group, in: bubbleStore)
        let memberSet = Set(members).union([me.id])
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)

        var thisWeek: [String: Int] = [:]
        var lastWeek: [String: Int] = [:]
        var played: [String: Int] = [:]

        // Today: the real Group boards. Your entry is your best run from today only, so a run from
        // an earlier day isn't counted twice (it already scores in the earlier-days loop below).
        for game in games {
            var board = bubbleStore.leaderboard(for: game, scope: .group).filter { memberSet.contains($0.user.id) && $0.user.id != me.id }
            if let myToday = game.scores
                .filter({ $0.user.id == me.id && calendar.isDate($0.achievedAt, inSameDayAs: now) })
                .max(by: { $0.score < $1.score }) {
                board.append(myToday)
                board.sort { lhs, rhs in lhs.score != rhs.score ? lhs.score > rhs.score : lhs.achievedAt < rhs.achievedAt }
            }
            for (index, entry) in board.enumerated() {
                thisWeek[entry.user.id, default: 0] += Self.points(forRankIndex: index)
                played[entry.user.id, default: 0] += 1
            }
        }

        // Earlier days: synthetic history for the cast, real runs for you.
        let gameIDs = games.map(\.id)
        for offset in 1...13 {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else { continue }
            let key = BubbleStore.dayKey(day)
            let isThisWeek = offset < 7
            let dayPoints = Self.syntheticDay(groupID: group.id, dayKey: key, gameIDs: gameIDs, memberIDs: members, thisWeek: isThisWeek)
            for (id, value) in dayPoints {
                if isThisWeek {
                    thisWeek[id, default: 0] += value.points
                    played[id, default: 0] += value.games
                } else {
                    lastWeek[id, default: 0] += value.points
                }
            }
            let mine = Self.myGamesPlayed(on: day, games: games, meID: me.id, calendar: calendar)
            if mine > 0 {
                if isThisWeek {
                    thisWeek[me.id, default: 0] += mine
                    played[me.id, default: 0] += mine
                } else {
                    lastWeek[me.id, default: 0] += mine
                }
            }
        }

        let lastRanks = Self.ranks(lastWeek)
        let ordered = thisWeek.filter { $0.value > 0 }.sorted { lhs, rhs in
            lhs.value != rhs.value ? lhs.value > rhs.value : lhs.key < rhs.key
        }
        guard !ordered.isEmpty else { return [] }
        let leaderID = ordered.first?.key
        var improvedID: String?
        var bestGain = 0
        for pair in ordered where pair.key != leaderID {
            let gain: Int = pair.value - lastWeek[pair.key, default: 0]
            if gain > bestGain {
                bestGain = gain
                improvedID = pair.key
            }
        }

        return ordered.enumerated().map { index, pair in
            let rank = index + 1
            let previous = lastRanks[pair.key]
            return Standing(
                user: bubbleStore.resolvePerson(pair.key == me.id ? "me" : pair.key),
                points: pair.value,
                lastWeekPoints: lastWeek[pair.key, default: 0],
                rank: rank,
                rankChange: previous.map { $0 - rank },
                isMostImproved: pair.key == improvedID,
                gamesPlayed: played[pair.key, default: 0]
            )
        }
    }

    /// Who's on a Group's board besides you: the demo cast for New in SF, otherwise the Group's
    /// member sample.
    func memberIDs(of group: FBGroup, in bubbleStore: BubbleStore) -> [String] {
        let me = bubbleStore.appStore.me.id
        var ids: [String] = []
        if group.id == BubbleDemo.groupID {
            ids = BubbleSocialCast.groupMembers(bubbleStore).map(\.id)
        }
        for user in group.memberSample where !ids.contains(user.id) {
            ids.append(user.id)
        }
        return ids.filter { $0 != me }
    }

    /// Last week's winner, for the "Champion last week" line.
    func lastWeekChampion(group: FBGroup, in bubbleStore: BubbleStore, now: Date = Date()) -> User? {
        let games = bubbleStore.worldBubbles(in: group).filter { !$0.isIcebreaker }
        guard !games.isEmpty else { return nil }
        let members = memberIDs(of: group, in: bubbleStore)
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        var totals: [String: Int] = [:]
        for offset in 7...13 {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else { continue }
            let points = Self.syntheticDay(groupID: group.id, dayKey: BubbleStore.dayKey(day), gameIDs: games.map(\.id), memberIDs: members, thisWeek: false)
            for (id, value) in points { totals[id, default: 0] += value.points }
        }
        guard let best = totals.max(by: { lhs, rhs in lhs.value != rhs.value ? lhs.value < rhs.value : lhs.key > rhs.key }) else { return nil }
        return bubbleStore.resolvePerson(best.key)
    }

    // MARK: - Synthetic history (pure)

    /// One earlier day: every member who "played" each game that day, ranked by skill, this
    /// week's form and a stable bit of luck. Returns points and games played per member.
    nonisolated static func syntheticDay(groupID: String, dayKey: String, gameIDs: [String], memberIDs: [String], thisWeek: Bool) -> [String: (points: Int, games: Int)] {
        var out: [String: (points: Int, games: Int)] = [:]
        for gameID in gameIDs {
            let players = memberIDs.filter { id in
                BubbleRoster.unit("gs-play|\(groupID)|\(id)|\(gameID)|\(dayKey)") < participation(of: id, groupID: groupID, thisWeek: thisWeek)
            }
            let ranked = players
                .map { id in
                    (id: id, perf: BubbleRoster.skill(of: id) + form(of: id, groupID: groupID, thisWeek: thisWeek)
                        + (BubbleRoster.unit("gs-perf|\(groupID)|\(id)|\(gameID)|\(dayKey)") - 0.5) * 0.4)
                }
                .sorted { lhs, rhs in lhs.perf != rhs.perf ? lhs.perf > rhs.perf : lhs.id < rhs.id }
            for (index, row) in ranked.enumerated() {
                let current = out[row.id] ?? (0, 0)
                out[row.id] = (current.points + points(forRankIndex: index), current.games + 1)
            }
        }
        return out
    }

    /// The New in SF story: Diego is on a tear this week, Chloe found her groove after a quiet
    /// week, and Maya (last week's champion) has been busy. Everyone else plays to their skill.
    nonisolated static func form(of id: String, groupID: String, thisWeek: Bool) -> Double {
        guard groupID == BubbleDemo.groupID else { return 0 }
        let tuned: [String: (this: Double, last: Double)] = [
            "sf-diego-ramirez": (0.5, 0),
            "sf-chloe-nguyen": (0.26, -0.4),
            "sf-maya-okafor": (-0.2, 0.25),
        ]
        guard let value = tuned[id] else { return 0 }
        return thisWeek ? value.this : value.last
    }

    /// The chance someone plays a given Group game on a given day.
    nonisolated static func participation(of id: String, groupID: String, thisWeek: Bool) -> Double {
        if groupID == BubbleDemo.groupID {
            switch (id, thisWeek) {
            case ("sf-diego-ramirez", true): return 1
            case ("sf-chloe-nguyen", true): return 0.95
            case ("sf-chloe-nguyen", false): return 0.2
            case ("sf-maya-okafor", true): return 0.45
            default: break
            }
        }
        return 0.35 + BubbleRoster.skill(of: id) * 0.3
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
