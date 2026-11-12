import Foundation

/// Remix family trees, built from `lineage.remix_of` (docs/BUBBLES.md 7.5). Chains stay separate:
/// a Chain is levels of one game; a remix tree is who riffed on whose game.
enum RemixLineage {
    // MARK: Family

    /// Direct remixes of `bubble`: friends' first, then yours, then newest.
    static func remixes(of bubble: Bubble, in bubbles: [Bubble]) -> [Bubble] {
        bubbles
            .filter { $0.manifest.lineage.remixOf == bubble.id && $0.id != bubble.id }
            .sorted(by: closerFirst)
    }

    /// Every remix of `bubble`, remixes of remixes included (breadth first, each once).
    static func descendants(of bubble: Bubble, in bubbles: [Bubble]) -> [Bubble] {
        var children: [String: [Bubble]] = [:]
        for candidate in bubbles {
            if let parent = candidate.manifest.lineage.remixOf, parent != candidate.id {
                children[parent, default: []].append(candidate)
            }
        }
        var seen: Set<String> = [bubble.id]
        var queue = [bubble.id]
        var out: [Bubble] = []
        while !queue.isEmpty {
            let id = queue.removeFirst()
            for child in (children[id] ?? []).sorted(by: closerFirst) where seen.insert(child.id).inserted {
                out.append(child)
                queue.append(child.id)
            }
        }
        return out
    }

    /// The Bubble this one remixes, when it's in the library.
    static func original(of bubble: Bubble, in bubbles: [Bubble]) -> Bubble? {
        guard let id = bubble.manifest.lineage.remixOf, id != bubble.id else { return nil }
        return bubbles.first { $0.id == id }
    }

    /// The first game of the family: walk `remix_of` up as far as the library goes.
    static func root(of bubble: Bubble, in bubbles: [Bubble]) -> Bubble {
        var current = bubble
        var seen: Set<String> = [bubble.id]
        while let up = original(of: current, in: bubbles), seen.insert(up.id).inserted {
            current = up
        }
        return current
    }

    static func isRemix(_ bubble: Bubble) -> Bool {
        guard let id = bubble.manifest.lineage.remixOf else { return false }
        return id != bubble.id
    }

    // MARK: Credit

    /// "Remix of Hill Hopper by Diego". Nil for an original. Reads only the manifest's lineage.
    static func credit(for bubble: Bubble) -> String? {
        guard isRemix(bubble) else { return nil }
        let lineage = bubble.manifest.lineage
        let title = lineage.remixOfTitle ?? "another Bubble"
        if lineage.remixOfCreatorID == "me" {
            return RemixCopy.creditByYou(title)
        }
        if let name = lineage.remixOfCreatorName, !name.isEmpty {
            return RemixCopy.credit(title, by: name)
        }
        return RemixCopy.credit(title, by: nil)
    }

    /// The credit with the library's help: fills a missing title or name from the original, and
    /// says "by you" for your own games.
    static func credit(for bubble: Bubble, store: BubbleStore) -> String? {
        guard isRemix(bubble) else { return nil }
        let lineage = bubble.manifest.lineage
        let original = original(of: bubble, in: store.bubbles)
        let title = lineage.remixOfTitle ?? original?.title ?? "another Bubble"
        if let creator = originalCreator(of: bubble, store: store), creator.id == store.appStore.me.id {
            return RemixCopy.creditByYou(title)
        }
        let name = lineage.remixOfCreatorName ?? originalCreator(of: bubble, store: store)?.firstName
        return RemixCopy.credit(title, by: name)
    }

    /// Who made the game this one remixes: the original's creator when it's in the library, else
    /// the credit's creator id.
    static func originalCreator(of bubble: Bubble, store: BubbleStore) -> User? {
        guard isRemix(bubble) else { return nil }
        if let original = original(of: bubble, in: store.bubbles) {
            return original.creator
        }
        guard let id = bubble.manifest.lineage.remixOfCreatorID, !id.isEmpty else { return nil }
        return store.resolvePerson(id)
    }

    /// The credit Studio would write for a remix of `base`, for Bubbles published before the
    /// credit existed (debug fakes, older saves).
    static func fillCredit(_ manifest: inout BubbleManifest, base: Bubble, me: User) {
        manifest.lineage.remixOf = manifest.lineage.remixOf ?? base.id
        if manifest.lineage.remixOfTitle == nil { manifest.lineage.remixOfTitle = base.title }
        if manifest.lineage.remixOfCreatorID == nil {
            manifest.lineage.remixOfCreatorID = base.creator.id == me.id ? "me" : base.creator.id
        }
        if manifest.lineage.remixOfCreatorName == nil, base.creator.id != me.id {
            manifest.lineage.remixOfCreatorName = base.creator.firstName
        }
    }

    // MARK: Tree

    /// One row of a drawn tree.
    struct Row: Identifiable, Hashable {
        let bubble: Bubble
        /// 0 for the original, 1 for its remixes, 2 for theirs.
        let depth: Int
        /// True when this row is the last child of its parent (draws an elbow instead of a tee).
        let isLastSibling: Bool
        /// Remixes of this node that didn't fit.
        let hiddenChildren: Int

        var id: String { bubble.id }
    }

    struct Tree {
        let root: Bubble
        let rows: [Row]
        /// Remixes of the root (all generations).
        let totalRemixes: Int
        /// Remixes that didn't fit in `rows`.
        let hidden: Int
    }

    /// A compact tree from the family's original: the original, its remixes, their remixes, up to
    /// `maxDepth` levels and `maxNodes` rows (the original included). Friends' remixes come first.
    static func tree(around bubble: Bubble, in bubbles: [Bubble], maxDepth: Int = 2, maxNodes: Int = 6) -> Tree {
        let root = root(of: bubble, in: bubbles)
        // Keep the open Bubble's branch visible: its ancestors come first among their siblings.
        var path: Set<String> = [bubble.id]
        var cursor = bubble
        while let up = original(of: cursor, in: bubbles), path.insert(up.id).inserted { cursor = up }
        var children: [String: [Bubble]] = [:]
        for candidate in bubbles {
            if let parent = candidate.manifest.lineage.remixOf, parent != candidate.id {
                children[parent, default: []].append(candidate)
            }
        }
        for key in children.keys {
            children[key]?.sort { a, b in
                let pa = path.contains(a.id), pb = path.contains(b.id)
                if pa != pb { return pa }
                return closerFirst(a, b)
            }
        }

        var rows: [Row] = []
        var seen: Set<String> = [root.id]
        rows.append(Row(bubble: root, depth: 0, isLastSibling: true, hiddenChildren: 0))
        func walk(_ parent: Bubble, depth: Int) {
            guard depth <= maxDepth else { return }
            let kids = (children[parent.id] ?? []).filter { !seen.contains($0.id) }
            for (index, kid) in kids.enumerated() {
                guard rows.count < maxNodes else { return }
                seen.insert(kid.id)
                let grandkids = (children[kid.id] ?? []).count
                rows.append(Row(
                    bubble: kid,
                    depth: depth,
                    isLastSibling: index == kids.count - 1,
                    hiddenChildren: depth == maxDepth ? grandkids : 0
                ))
                walk(kid, depth: depth + 1)
            }
        }
        walk(root, depth: 1)
        let total = descendants(of: root, in: bubbles).count
        return Tree(root: root, rows: rows, totalRemixes: total, hidden: max(0, total - (rows.count - 1)))
    }

    // MARK: Ordering

    /// Friends first, then you, then everyone else; newest first inside each.
    private static func closerFirst(_ a: Bubble, _ b: Bubble) -> Bool {
        let ra = closeness(a.creator), rb = closeness(b.creator)
        if ra != rb { return ra < rb }
        return a.createdAt > b.createdAt
    }

    private static func closeness(_ user: User) -> Int {
        if user.isFriend { return 0 }
        if user.isMe { return 1 }
        return 2
    }
}
