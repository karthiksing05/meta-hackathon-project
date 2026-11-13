import Foundation

/// Who saved a game, and how to say it. Saves are the likes (docs/BUBBLES.md 7.10).
///
/// The server sends how many people saved a game (`likes`) and whether you did; which of your
/// friends saved it comes from `GET /v1/games/{id}/likes` (`BubbleStore.loadSavers`). Nobody else
/// is named, so the rest are a count.
@MainActor
enum SavesSocialProof {
    /// A stable hash (Swift's `hashValue` changes every launch).
    static func stableHash(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return hash
    }

    /// The people who saved `bubble` that the app knows of: you, when you did, then your friends
    /// who did (once `BubbleStore.loadSavers` has heard from the server).
    static func savers(for bubble: Bubble, in bubbleStore: BubbleStore, limit: Int = 12) -> [User] {
        guard limit > 0 else { return [] }
        var people: [User] = bubble.isSaved ? [bubbleStore.appStore.me] : []
        people += bubbleStore.saverStates[bubble.id]?.savers?.friends ?? []
        return Array(people.prefix(limit))
    }

    /// 'Saved by Diego and 37 others', 'Saved by you, Diego and 36 others', 'Saved by Diego',
    /// or nil when nobody has saved it.
    static func text(for bubble: Bubble, in bubbleStore: BubbleStore) -> String? {
        let total = bubble.saveCount
        guard total > 0 else { return nil }
        let savers = savers(for: bubble, in: bubbleStore, limit: 3)
        var names: [String] = []
        if bubble.isSaved { names.append("you") }
        if let first = savers.first(where: { !$0.isMe }) { names.append(first.firstName) }
        guard !names.isEmpty else { return SavesCopy.savedByCount(total) }
        let others = total - names.count
        if others <= 0 { return SavesCopy.savedBy(names.joined(separator: " and ")) }
        return SavesCopy.savedBy("\(names.joined(separator: ", ")) and \(others) \(others == 1 ? "other" : "others")")
    }

    /// Saves in the last week. The server has no dated saves, so only a game made this week can
    /// say (all its saves are this week's); older games report 0.
    static func savesThisWeek(_ bubble: Bubble) -> Int {
        guard bubble.saveCount > 0, Date().timeIntervalSince(bubble.createdAt) < 7 * 86_400 else { return 0 }
        return bubble.saveCount
    }

    /// Your Bubbles, most saved first.
    static func myBubblesBySaves(_ bubbleStore: BubbleStore) -> [Bubble] {
        bubbleStore.bubbles
            .filter { $0.creator.isMe && $0.saveCount > 0 }
            .sorted { $0.saveCount > $1.saveCount }
    }

    /// Saves this week across all your Bubbles.
    static func myWeeklySaves(_ bubbleStore: BubbleStore) -> Int {
        myBubblesBySaves(bubbleStore).reduce(0) { $0 + savesThisWeek($1) }
    }

    /// The text of a creator notification: 'Diego Ramirez and 37 others saved Moving Day.'
    static func notificationMessage(for bubble: Bubble) -> String {
        "saved \(bubble.title)."
    }
}
