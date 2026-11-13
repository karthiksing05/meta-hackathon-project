import Foundation

/// People, friends and Groups from the games server, as the app's `User`s and `FBGroup`s.
extension BubbleStore {
    /// A person by server id: you, someone the server already sent, or (until their profile
    /// arrives from `GET /v1/users/{id}`) a nameless placeholder. Never a made-up person.
    func resolvePerson(_ id: String?) -> User {
        guard let id, !id.isEmpty, id != "me", id != appStore.me.id else { return appStore.me }
        if let known = serverPeople[id] { return known }
        let user = person(id: id, name: "")
        loadPerson(id: id)
        return user
    }

    private func loadPerson(id: String) {
        guard !isPreview, GameIDMap.isServerID(id) else { return }
        Task { @MainActor [weak self] in
            guard let self, let profile = try? await api.user(id: id) else { return }
            _ = person(profile)
        }
    }

    /// A Group the server sent, or nil (and a fetch starts) when it isn't known yet.
    func resolveGroup(_ id: String?) -> FBGroup? {
        guard let id, !id.isEmpty else { return nil }
        if let group = serverGroups[id] { return group }
        loadGroup(id: id)
        return nil
    }

    /// Your friends on the server (`GET /v1/me/friends`).
    @MainActor
    func loadFriends() async -> [User] {
        guard !isPreview, await GamesAccount.shared.waitForUser() != nil,
              let profiles = try? await api.friends() else { return [] }
        return profiles.map(person)
    }

    /// Your Groups on the server (`GET /v1/groups?mine=1`).
    @MainActor
    func loadMyGroups() async -> [FBGroup] {
        guard !isPreview, await GamesAccount.shared.waitForUser() != nil,
              let groups = try? await api.groups(kind: "group", mine: true) else { return [] }
        return groups.map { adopt($0) }
    }

    /// Games made for a Group (`GET /v1/groups/{id}/games`). Throws the server's error.
    @MainActor
    func loadGames(inGroup id: String) async throws -> [Bubble] {
        let games = try await api.groupGames(id: id)
        var result: [Bubble] = []
        for game in games {
            if let bubble = await adopt(game) { result.append(bubble) }
        }
        return result
    }

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
