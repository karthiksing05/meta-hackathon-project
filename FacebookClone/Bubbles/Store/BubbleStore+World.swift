import Foundation

/// Queries for the Group, Event and Profile surfaces. They read only the store's existing API plus
/// each Bubble's manifest scope, so they keep working as seed loading gets richer.
extension BubbleStore {
    // MARK: Groups

    /// Today's Daily Bubble for a Group.
    func worldDailyBubble(for group: FBGroup) -> Bubble? {
        if let bubble = dailyBubble(for: group) { return bubble }
        return bubbles.first { $0.isDaily && ($0.manifest.structure.groupID == group.id || $0.group?.id == group.id) }
    }

    /// Every Bubble made for a Group, Daily Bubble first.
    func worldBubbles(in group: FBGroup) -> [Bubble] {
        let all = bubbles.filter { $0.group?.id == group.id || $0.manifest.structure.groupID == group.id }
        let daily = worldDailyBubble(for: group)
        return all.sorted { lhs, _ in lhs.id == daily?.id }
    }

    /// Runs on today's board (runs with no day count as today's).
    private func todaysBest(in bubble: Bubble) -> [BubbleScore] {
        let today = BubbleStore.dayKey(Date())
        var best: [String: BubbleScore] = [:]
        for entry in bubble.scores where entry.day == nil || entry.day == today {
            if let current = best[entry.user.id], current.score >= entry.score { continue }
            best[entry.user.id] = entry
        }
        return best.values.sorted { $0.score > $1.score }
    }

    /// Today's best runs, highest first.
    func worldTopToday(in bubble: Bubble, limit: Int = 3) -> [BubbleScore] {
        Array(todaysBest(in: bubble).prefix(limit))
    }

    /// Your score and rank on today's board, if you've played.
    func worldMyStanding(in bubble: Bubble) -> (score: Int, rank: Int, of: Int)? {
        let board = todaysBest(in: bubble)
        guard let index = board.firstIndex(where: { $0.user.id == appStore.me.id }) else { return nil }
        return (board[index].score, index + 1, board.count)
    }

    /// Days in a row you've played this Group's Daily Bubbles, ending today or yesterday.
    func worldStreak(in group: FBGroup) -> Int {
        let me = appStore.me.id
        var days = Set<String>()
        for bubble in bubbles where bubble.isDaily && (bubble.group?.id == group.id || bubble.manifest.structure.groupID == group.id) {
            for entry in bubble.scores where entry.user.id == me {
                if let day = entry.day { days.insert(day) }
            }
        }
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

    // MARK: Events

    /// The icebreaker Bubble for an Event.
    func worldIcebreaker(for event: FBEvent) -> Bubble? {
        bubbles.first { $0.manifest.structure.eventID == event.id || $0.event?.id == event.id }
    }

    /// People who have played a Bubble, most recent first.
    func worldPlayers(of bubble: Bubble) -> [User] {
        var seen = Set<String>()
        return bubble.scores
            .sorted { $0.achievedAt > $1.achievedAt }
            .compactMap { seen.insert($0.user.id).inserted ? $0.user : nil }
    }

    // MARK: Profiles

    /// A person's best runs, highest first (one per Bubble).
    func worldBestScores(of user: User, limit: Int = 5) -> [(bubble: Bubble, score: BubbleScore)] {
        let rows: [(bubble: Bubble, score: BubbleScore)] = bubbles.compactMap { bubble in
            bestScore(of: user, in: bubble).map { (bubble, $0) }
        }
        return Array(rows.sorted { $0.score.score > $1.score.score }.prefix(limit))
    }

    /// Chains a person has started, each as its ordered levels.
    func worldChains(by user: User) -> [[Bubble]] {
        var seen = Set<String>()
        var result: [[Bubble]] = []
        for bubble in bubbles(by: user) {
            guard let chainID = bubble.chainID, seen.insert(chainID).inserted else { continue }
            result.append(chain(chainID))
        }
        return result
    }
}
