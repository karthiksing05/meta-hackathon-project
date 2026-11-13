import Foundation

/// Groups and Events from the games server (`GET /v1/groups/{id}`), as the app's `FBGroup`s.
extension BubbleStore {
    /// Fetches a Group once per session and keeps it in `serverGroups`. Games made for it pick it
    /// up when it arrives.
    func loadGroup(id: String) {
        guard !isPreview, !id.isEmpty, serverGroups[id] == nil, groupRequests.insert(id).inserted else { return }
        Task { @MainActor [weak self] in
            guard let self, let detail = try? await api.group(id: id) else { return }
            let group = adopt(detail)
            for bubble in bubbles where bubble.group == nil && bubble.manifest.structure.groupID == id {
                bubble.group = group
                noteDaily(bubble)
            }
        }
    }

    /// The app's Group for a server Group (kept in `serverGroups`, updated in place).
    @discardableResult
    func adopt(_ remote: RemoteGroup) -> FBGroup {
        let group = serverGroups[remote.id] ?? FBGroup(id: remote.id, name: remote.name)
        group.name = remote.name
        group.isPrivate = remote.isPrivate
        group.memberCount = remote.memberCount
        group.isMember = remote.isMember
        group.about = remote.about ?? ""
        group.category = remote.category ?? ""
        serverGroups[remote.id] = group
        return group
    }

    /// A Group with its members.
    @discardableResult
    func adopt(_ detail: RemoteGroupDetail) -> FBGroup {
        let group = adopt(detail.group)
        group.memberSample = detail.members.map(person)
        return group
    }
}
