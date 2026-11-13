import Foundation

/// What the recommender needs to know about one game: its manifest's formula, mood, energy,
/// competition, look and scope, plus bot runs for the quality prior (`game-recs.js`).
struct GameRecSummary: Encodable {
    struct BotRun: Encodable {
        let skill: Double
        let score: Int
        let sec: Double?
    }

    let id: String
    let formula: String
    let mood: [String]
    let energy: String
    let competition: String
    let look: String
    let scope: String
    let isDaily: Bool
    let bots: [BotRun]
    /// For Group Blend's social plus: made by someone in the Group, or made for the Group.
    let creatorID: String
    let groupID: String?

    init(_ bubble: Bubble) {
        let manifest = bubble.manifest
        id = bubble.id
        formula = manifest.formula.rawValue
        mood = manifest.brief.mood
        energy = manifest.brief.energy
        competition = manifest.brief.competition
        look = manifest.style.look
        let scope = manifest.structure.scope
        self.scope = scope.hasPrefix("group") ? "group" : scope.hasPrefix("event") ? "event" : "everyone"
        isDaily = bubble.isDaily
        creatorID = bubble.creator.id
        groupID = bubble.group?.id ?? manifest.structure.groupID
        // The cast's scores are bot runs of the real runtime (BubbleFeedRoster.swift): how well
        // each bot plays is its skill, so skill-vs-score says whether skill matters in this game.
        bots = bubble.scores
            .filter { !$0.user.isMe }
            .prefix(16)
            .map { BotRun(skill: BubbleRoster.skill(of: $0.user.id), score: $0.score, sec: $0.replay.map(\.durationSec)) }
    }
}

extension BubbleStore {
    /// The next `count` feed pages, ordered by the recommender, or nil to fall back to
    /// `BubbleFeedGenerator` (recommender off or failed).
    func recommendedItems(count: Int, after existing: [BubbleFeedItem], candidates: [BubbleFeedCandidate]) -> [BubbleFeedItem]? {
        let recommender = GameRecommender.shared
        guard recommender.isEnabled, count > 0, !candidates.isEmpty else { return nil }
        let ids = Set(candidates.map(\.bubbleID))
        let summaries = bubbles.filter { ids.contains($0.id) }.map(GameRecSummary.init)
        let seed = SeededGenerator.stableHash("bubbles-recs|\(todayKey)|\(existing.count)")
        guard let picks = recommender.rank(candidates: candidates, summaries: summaries, feed: existing, count: count, seed: seed),
              !picks.isEmpty else { return nil }
        var items: [BubbleFeedItem] = []
        for pick in picks {
            let match = candidates.first { $0.bubbleID == pick.gameID && $0.reason.rawValue == pick.reason && $0.runUserID == pick.runUserID }
                ?? candidates.first { $0.bubbleID == pick.gameID }
            if let match {
                items.append(feedGenerator.makeItem(match))
            }
        }
        return items.isEmpty ? nil : items
    }
}
