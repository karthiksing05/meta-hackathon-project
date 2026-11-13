import Foundation

/// Why a Bubble is on a page of the Bubbles tab. Drives its tags and its "best" line.
enum BubbleFeedReason: String, Hashable {
    /// A friend's run plays as the Burst.
    case friendBurst
    /// A Group member's run plays as the Burst.
    case groupBurst
    /// Today's Daily Bubble for a Group you're in.
    case daily
    /// An Event's icebreaker.
    case icebreaker
    /// New from someone near you.
    case nearby
    /// A later level of a Bubble Chain.
    case nextLevel
    /// One of yours.
    case yours
    /// Popular around you.
    case popular
}

/// One page of the Bubbles tab. The same Bubble can come back later with another Burst.
struct BubbleFeedItem: Identifiable, Hashable {
    let id: String
    let bubbleID: String
    let reason: BubbleFeedReason
    /// Whose best run plays as the Burst. Nil lets the bot play a demo.
    let runUserID: String?
}

/// Something the feed could show next, with how much it wants to.
struct BubbleFeedCandidate {
    let bubbleID: String
    let reason: BubbleFeedReason
    let runUserID: String?
    let weight: Double

    var key: String { "\(bubbleID)|\(reason.rawValue)|\(runUserID ?? "-")" }
}

/// Makes the feed: endless, varied, never the same Bubble twice in a row, and the same order
/// for the whole session because it is seeded.
struct BubbleFeedGenerator {
    private var rng: SeededGenerator
    private var serial = 0
    private var uses: [String: Int] = [:]

    init(seed: UInt64) {
        rng = SeededGenerator(seed: seed)
    }

    /// Items for an ordered list of favorites, one per Bubble.
    mutating func head(from candidates: [BubbleFeedCandidate]) -> [BubbleFeedItem] {
        var seen = Set<String>()
        var items: [BubbleFeedItem] = []
        for candidate in candidates where seen.insert(candidate.bubbleID).inserted {
            items.append(makeItem(candidate))
        }
        return items
    }

    /// `count` more items. Skips the Bubbles of the last few pages and favors candidates that
    /// haven't been shown yet.
    mutating func makeItems(count: Int, after existing: [BubbleFeedItem], candidates: [BubbleFeedCandidate]) -> [BubbleFeedItem] {
        guard !candidates.isEmpty, count > 0 else { return [] }
        let distinct = Set(candidates.map(\.bubbleID)).count
        let window = max(0, min(4, distinct - 1))
        var recent = existing.suffix(window).map(\.bubbleID)
        var items: [BubbleFeedItem] = []
        for _ in 0..<count {
            let blocked = Set(recent.suffix(window))
            var pool = candidates.filter { !blocked.contains($0.bubbleID) }
            if pool.isEmpty {
                pool = candidates.filter { $0.bubbleID != recent.last }
            }
            if pool.isEmpty {
                pool = candidates
            }
            let weights = pool.map { $0.weight / (1 + 1.6 * Double(uses[$0.key, default: 0])) }
            let pick = pool[weightedIndex(weights)]
            items.append(makeItem(pick))
            recent.append(pick.bubbleID)
        }
        return items
    }

    mutating func makeItem(_ candidate: BubbleFeedCandidate) -> BubbleFeedItem {
        serial += 1
        uses[candidate.key, default: 0] += 1
        return BubbleFeedItem(
            id: "feed-\(serial)-\(candidate.bubbleID)",
            bubbleID: candidate.bubbleID,
            reason: candidate.reason,
            runUserID: candidate.runUserID
        )
    }

    private mutating func weightedIndex(_ weights: [Double]) -> Int {
        let total = weights.reduce(0, +)
        guard total > 0 else { return 0 }
        var remaining = Double.random(in: 0..<total, using: &rng)
        for (index, weight) in weights.enumerated() {
            if remaining < weight { return index }
            remaining -= weight
        }
        return weights.count - 1
    }
}

// MARK: - Feed in the store

extension BubbleStore {
    /// Grows the Bubbles tab's feed. The first pages are a curated opening (a friend's Burst,
    /// your Group's Daily Bubble, something new nearby, the icebreaker); the rest is varied.
    func extendFeed(by count: Int) {
        let candidates = feedCandidates()
        var items = feedItems
        if items.isEmpty {
            items = feedGenerator.head(from: openingCandidates(from: candidates))
        }
        let wanted = max(count - (items.count - feedItems.count), 4)
        // The recommender orders everything after the curated opening (StoreRecommendations.swift).
        // The generator is the fallback: FB_RECS=off, or the recommender failed.
        let more = recommendedItems(count: wanted, after: items, candidates: candidates)
            ?? feedGenerator.makeItems(count: wanted, after: items, candidates: candidates)
        feedItems = items + more
    }

    /// The Bubbles tab reports the page on screen; the feed grows ahead of it.
    func noteFeedPosition(_ index: Int) {
        feedPosition = index
        if index >= feedItems.count - 6 {
            extendFeed(by: 12)
        }
    }

    /// A Bubble you just made shows up as the next page.
    func insertIntoFeed(_ bubble: Bubble) {
        guard !feedItems.isEmpty else { return }
        let item = feedGenerator.makeItem(BubbleFeedCandidate(bubbleID: bubble.id, reason: .yours, runUserID: nil, weight: 1))
        feedItems.insert(item, at: min(feedPosition + 1, feedItems.count))
    }

    /// Every Burst, Daily Bubble, icebreaker and new Bubble the feed can show.
    func feedCandidates() -> [BubbleFeedCandidate] {
        let me = appStore.me
        let dailyIDs = Set(dailyBubbleIDs.values)
        var result: [BubbleFeedCandidate] = []
        for bubble in bubbles {
            let board = leaderboard(for: bubble, scope: .everyone).filter { $0.user.id != me.id }
            let friendRuns = board.filter { $0.user.isFriend }
            let memberRuns = board.filter { !$0.user.isFriend && isGroupMember($0.user, for: bubble) }
            func add(_ reason: BubbleFeedReason, _ run: BubbleScore?, _ weight: Double) {
                result.append(BubbleFeedCandidate(bubbleID: bubble.id, reason: reason, runUserID: run?.user.id, weight: weight))
            }
            if dailyIDs.contains(bubble.id) {
                add(.daily, friendRuns.first ?? memberRuns.first, 3)
            }
            if bubble.isIcebreaker {
                add(.icebreaker, memberRuns.first ?? friendRuns.first, 2)
            }
            if bubble.creator.id == me.id {
                add(.yours, board.first, 0.6)
            }
            for run in friendRuns.prefix(3) {
                add(.friendBurst, run, 2.2)
            }
            for run in memberRuns.prefix(2) {
                add(.groupBurst, run, 1.6)
            }
            let isNew = Date().timeIntervalSince(bubble.createdAt) < 3 * 86_400
            if isNew && !bubble.creator.isFriend && bubble.creator.id != me.id {
                let creatorRun = board.first { $0.user.id == bubble.creator.id }
                add(.nearby, creatorRun ?? board.first, 1.8)
            }
            if (bubble.levelIndex ?? 1) > 1 {
                add(.nextLevel, friendRuns.first ?? board.first, 1.2)
            }
            add(.popular, board.first, 0.8)
        }
        return result
    }

    /// The first pages, in order: a friend's Burst of a dodge Bubble (the most watchable), your
    /// Group's Daily Bubble, something new nearby, the icebreaker, another friend's Burst, a
    /// chain level and a Group member's Burst. Each slot takes a Bubble no earlier slot took.
    private func openingCandidates(from candidates: [BubbleFeedCandidate]) -> [BubbleFeedCandidate] {
        var chosen: [BubbleFeedCandidate] = []
        func take(_ reason: BubbleFeedReason, by rank: (Bubble) -> Double, where condition: (Bubble) -> Bool = { _ in true }) {
            let taken = Set(chosen.map(\.bubbleID))
            let pick = candidates
                .filter { $0.reason == reason && !taken.contains($0.bubbleID) }
                .compactMap { candidate in bubble(id: candidate.bubbleID).map { (candidate, $0) } }
                .filter { condition($0.1) }
                .max { rank($0.1) < rank($1.1) }
            if let pick {
                chosen.append(pick.0)
            }
        }
        let plays: (Bubble) -> Double = { Double($0.playCount) }
        let newest: (Bubble) -> Double = { $0.createdAt.timeIntervalSince1970 }
        take(.friendBurst, by: plays) { $0.formula == .dodge && ($0.levelIndex ?? 1) == 1 }
        take(.daily, by: plays)
        take(.nearby, by: newest) { !$0.isDaily }
        take(.icebreaker, by: plays)
        take(.friendBurst, by: plays) { $0.formula != .dodge }
        take(.nextLevel, by: plays)
        take(.groupBurst, by: plays) { !$0.isDaily }
        return chosen
    }
}
