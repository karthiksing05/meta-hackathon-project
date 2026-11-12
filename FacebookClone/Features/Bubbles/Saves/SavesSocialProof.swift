import Foundation

/// Who saved a Bubble, and how to say it. Saves are the likes (docs/BUBBLES.md 7.10), so every
/// surface that shows social proof names the people you know first.
///
/// The demo world has no server, so savers are chosen deterministically: the same Bubble always
/// shows the same friends. Friends come first, then people from the demo roster; you are first
/// of all when you saved it yourself. Other features may call these.
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

    /// The people who saved `bubble`, friends first, at most `limit`. Includes you (first) when you
    /// saved it. Never more people than `saveCount`, and never the Bubble's creator.
    static func savers(for bubble: Bubble, in bubbleStore: BubbleStore, limit: Int = 12) -> [User] {
        let me = bubbleStore.appStore.me
        var result: [User] = []
        if bubble.isSaved { result.append(me) }
        let room = min(limit - result.count, bubble.saveCount - result.count)
        guard room > 0 else { return Array(result.prefix(limit)) }

        func ranked(_ users: [User]) -> [User] {
            users
                .filter { $0.id != me.id && $0.id != bubble.creator.id }
                .sorted { stableHash(bubble.id + "|" + $0.id) < stableHash(bubble.id + "|" + $1.id) }
        }
        var seen = Set(result.map(\.id))
        var friends = ranked(bubbleStore.appStore.friends)
        // Roster people who are friends in the demo world come before strangers.
        let roster = ranked(BubbleSocialCast.groupMembers(bubbleStore))
        friends = (friends + roster.filter { $0.isFriend }).filter { seen.insert($0.id).inserted }
        let strangers = roster.filter { !$0.isFriend && seen.insert($0.id).inserted }

        // A popular game was saved by more of your friends; a quiet one by one or two.
        let friendShare = min(friends.count, bubble.saveCount >= 40 ? 4 : bubble.saveCount >= 10 ? 3 : 2)
        let pool = Array(friends.prefix(max(friendShare, 1))) + strangers + Array(friends.dropFirst(max(friendShare, 1)))
        let ordered = Array(pool.prefix(room)).sorted { ($0.isFriend ? 0 : 1) < ($1.isFriend ? 0 : 1) }
        return result + ordered
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

    /// Saves in the last week: all of them for a new game, a share for an older one.
    static func savesThisWeek(_ bubble: Bubble) -> Int {
        guard bubble.saveCount > 0 else { return 0 }
        if Date().timeIntervalSince(bubble.createdAt) < 7 * 86_400 { return bubble.saveCount }
        let percent = 12 + Int(stableHash("week|" + bubble.id) % 19)
        return max(1, bubble.saveCount * percent / 100)
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
