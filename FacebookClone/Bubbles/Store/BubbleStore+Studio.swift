import Foundation

/// Muse Studio's store helpers: publishing one or more levels at once and linking chains.
extension BubbleStore {
    /// Publishes what Muse Studio made, in order. Several manifests become one Bubble Chain; with
    /// `continuing`, they continue that Bubble's chain and it gets a `next` link. With `dailyFor`,
    /// the first becomes that Group's Daily Bubble. Returns the new Bubbles, first level first.
    @discardableResult
    func publishFromStudio(
        _ manifests: [BubbleManifest],
        covers: [Data?],
        group: FBGroup?,
        event: FBEvent?,
        continuing base: Bubble?,
        dailyFor dailyGroup: FBGroup?
    ) -> [Bubble] {
        guard !manifests.isEmpty else { return [] }
        let linked = BubbleStore.linkStudioLevels(manifests, after: base?.manifest)
        var published: [Bubble] = []
        for (index, manifest) in linked.enumerated() {
            let cover = covers.indices.contains(index) ? covers[index] : nil
            published.append(publish(manifest, cover: cover, group: group, event: event))
        }
        if let base, let first = linked.first, let link = first.chain {
            var baseChain = base.manifest.chain ?? BubbleChainLink(id: link.id, index: 1, title: link.title ?? base.title)
            baseChain.next = first.id
            base.manifest.chain = baseChain
        }
        if let dailyGroup, let first = published.first {
            dailyBubbleIDs[dailyGroup.id] = first.id
        }
        return published
    }

    /// Gives a run of new levels consistent chain links. With `base`, they continue its chain;
    /// otherwise a single manifest is left alone and several start a new chain.
    static func linkStudioLevels(_ manifests: [BubbleManifest], after base: BubbleManifest?) -> [BubbleManifest] {
        guard manifests.count > 1 || base != nil else { return manifests }
        var result = manifests
        let first = result[0]
        let chainID = base?.chain?.id
            ?? result.compactMap { $0.chain?.id }.first
            ?? "chain-\(base?.id ?? first.id)"
        let chainTitle = base?.chain?.title ?? base?.title ?? first.title
        var previousID = base?.id
        var index = base.map { $0.chain?.index ?? 1 } ?? 0
        for position in result.indices {
            index += 1
            let nextID = position + 1 < result.count ? result[position + 1].id : nil
            result[position].chain = BubbleChainLink(id: chainID, index: index, title: chainTitle, prev: previousID, next: nextID)
            previousID = result[position].id
        }
        return result
    }
}
