import Foundation

/// Queries for the Bubble detail, board, Library and Chain screens.
extension BubbleStore {
    /// The Library's sections, in display order. Empty sections are left out by the view.
    struct LibrarySection: Identifiable {
        let id: String
        let title: String
        let symbol: String
        var bubbles: [Bubble]
    }

    func chainName(_ chainID: String) -> String {
        let levels = chain(chainID)
        return levels.first?.manifest.chain?.title ?? levels.first?.title ?? "Level chain"
    }

    func isMine(_ bubble: Bubble) -> Bool {
        bubble.creator.id == appStore.me.id
    }

    /// A Bubble Board for `scope`, best first. Daily Bubbles only count today's runs.
    func board(for bubble: Bubble, scope: BubbleBoardScope) -> [BubbleScore] {
        var rows = leaderboard(for: bubble, scope: scope)
        if scope == .friends {
            rows = rows.filter { $0.user.isMe || $0.user.isFriend }
        }
        if bubble.isDaily {
            let today = BubbleStore.dayKey(Date())
            rows = rows.filter { $0.day == nil || $0.day == today }
        }
        return rows
    }

    /// Scopes worth offering for this Bubble.
    func boardScopes(for bubble: Bubble) -> [BubbleBoardScope] {
        bubble.group == nil ? [.friends, .everyone] : BubbleBoardScope.allCases
    }

    /// Chain levels you can play: the first, plus any level after one you have finished.
    func isLevelUnlocked(_ level: Bubble, in levels: [Bubble]) -> Bool {
        guard let index = levels.firstIndex(where: { $0.id == level.id }), index > 0 else { return true }
        if isMine(level) { return true }
        return bestScore(of: appStore.me, in: levels[index - 1]) != nil
    }

    /// Library sections for the current search text and formula filter.
    func librarySections(query: String, formula: BubbleFormula?) -> [LibrarySection] {
        let me = appStore.me
        let text = query.trimmingCharacters(in: .whitespaces)
        func matches(_ bubble: Bubble) -> Bool {
            if let formula, bubble.formula != formula { return false }
            if text.isEmpty { return true }
            return bubble.title.localizedCaseInsensitiveContains(text)
                || bubble.rule.localizedCaseInsensitiveContains(text)
                || bubble.formula.title.localizedCaseInsensitiveContains(text)
        }
        let pool = bubbles.filter(matches)

        var chainHeads: [Bubble] = []
        var seen = Set<String>()
        for bubble in pool {
            guard let id = bubble.chainID, !seen.contains(id) else { continue }
            seen.insert(id)
            chainHeads.append(chain(id).first(where: matches) ?? bubble)
        }

        let sections = [
            LibrarySection(id: "mine", title: "Your \(ProductName.plural)", symbol: "person.crop.circle", bubbles: pool.filter { $0.creator.id == me.id }),
            LibrarySection(id: "daily", title: "Daily \(ProductName.plural) from your Groups", symbol: "sun.max", bubbles: pool.filter { $0.isDaily && ($0.group?.isMember ?? false) }),
            LibrarySection(id: "friends", title: "From friends", symbol: "person.2", bubbles: pool.filter { $0.creator.isFriend }),
            LibrarySection(id: "chains", title: "Chains", symbol: "link", bubbles: chainHeads),
            LibrarySection(id: "saved", title: "Saved", symbol: "bookmark", bubbles: pool.filter { $0.isSaved }),
            LibrarySection(id: "popular", title: "Popular", symbol: "flame", bubbles: Array(pool.sorted { $0.playCount > $1.playCount }.prefix(8)))
        ]
        return sections.filter { !$0.bubbles.isEmpty }
    }

    /// "Made with Muse in 41 s · Wonder, Ember, Image", or "Made with Muse Studio" when offline.
    func studioStampText(for bubble: Bubble) -> String? {
        guard let stamp = bubble.manifest.studio else { return nil }
        if stamp.offline == true { return "Made with Muse Studio" }
        let models = stamp.models.map { id -> String in
            var name = id
            if name.hasPrefix("muse-") { name.removeFirst(5) }
            if let dash = name.firstIndex(of: "-") { name = String(name[..<dash]) }
            return name.prefix(1).uppercased() + name.dropFirst()
        }
        var text = "Made with Muse"
        if let seconds = stamp.durationSec { text += " in \(Int(seconds)) s" }
        if !models.isEmpty { text += " · " + models.joined(separator: ", ") }
        return text
    }
}

extension BubbleScore {
    /// True when the score carries a `verified` or `isVerified` flag that is set. Reads the flag
    /// by name so this compiles whether or not the feed agent has added it.
    var isVerifiedRun: Bool {
        for child in Mirror(reflecting: self).children where child.label == "verified" || child.label == "isVerified" {
            if let flag = child.value as? Bool { return flag }
        }
        return false
    }
}

#if DEBUG
extension BubbleStore {
    /// DEBUG only: fills an empty board with sample runs so screens can be reviewed. Never called
    /// from BubbleStore itself.
    func seedSampleScoresIfNeeded(_ bubble: Bubble) {
        guard bubble.scores.isEmpty, DebugLaunch.value("FB_SAMPLE_SCORES") != "0" else { return }
        let day = bubble.isDaily ? BubbleStore.dayKey(Date()) : nil
        let people = Array(appStore.people.prefix(6))
        let base = 40 + (bubble.id.count * 7) % 30
        var scores: [BubbleScore] = people.enumerated().map { index, user in
            BubbleScore(user: user, score: base * (8 - index) + index * 3, achievedAt: Date().addingTimeInterval(Double(-index * 1800)), day: day,
                        replay: index < 3 ? BubbleInputLog(seed: bubble.manifest.seed, totalTicks: 600) : nil)
        }
        if bubble.id != "moving-day" && (bubble.levelIndex ?? 1) <= 1 {
            scores.append(BubbleScore(user: appStore.me, score: base * 2, day: day))
        }
        bubble.scores = scores
        if bubble.featuredRun == nil { bubble.featuredRun = scores.first }
    }
}
#endif
