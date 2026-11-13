import Foundation

/// Joining Groups by their policy, the owner's requests and settings, adding people, and the profile
/// fields people set themselves. Everything goes through the games API (backend/README.md, Groups):
/// the phone keeps no membership of its own for a Group the server knows.
extension BubbleStore {
    // MARK: Group state

    /// Every app object for a Group id: the one a screen holds, the server's, and the demo world's
    /// (`group-newinsf` exists on the phone and on the server under one id).
    private func instances(of group: FBGroup) -> [FBGroup] {
        var out = [group]
        for other in [serverGroups[group.id], appStore.group(id: group.id)].compactMap({ $0 }) where !out.contains(where: { $0 === other }) {
            out.append(other)
        }
        return out
    }

    /// Fetches a Group with its members (`GET /v1/groups/{id}`) and copies it onto every app object
    /// for it. A Group the server doesn't know (404) stays as it is.
    @MainActor
    func refreshGroup(_ group: FBGroup) async {
        guard !isPreview, !group.id.isEmpty else { return }
        _ = await GamesAccount.shared.waitForUser()
        guard let detail = try? await api.group(id: group.id) else { return }
        let members = detail.members.map(person)
        for target in instances(of: group) {
            apply(detail.group, to: target)
            target.memberSample = members
        }
        if serverGroups[group.id] == nil { serverGroups[group.id] = group }
    }

    /// Whether I may add people here: any member in an open or invite Group, only the owner in a
    /// request Group.
    func canAddPeople(to group: FBGroup) -> Bool {
        guard group.isOnServer else { return group.isMember }
        return group.isMember && (group.joinPolicy != .request || group.isAdmin)
    }

    // MARK: Joining

    /// `PUT /v1/groups/{id}/members/me`: joins an open Group, asks to join a request Group. An
    /// invite Group can't be joined this way. The button changes right away and goes back if the
    /// server says no.
    @MainActor
    func requestToJoin(_ group: FBGroup, then done: (() -> Void)? = nil) {
        guard !group.isMember else { done?(); return }
        switch group.joinPolicy {
        case .invite:
            appStore.showToast(GroupJoinCopy.inviteOnly(group.name), symbol: "lock.fill")
            done?()
            return
        case .request where group.hasRequested:
            done?()
            return
        default:
            break
        }
        let asking = group.joinPolicy == .request
        let targets = instances(of: group)
        for target in targets {
            if asking {
                target.hasRequested = true
            } else if !target.isMember {
                target.isMember = true
                target.memberCount += 1
                target.lastVisited = Date()
            }
        }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                switch try await api.joinGroup(id: group.id) {
                case .joined:
                    appStore.showToast("You joined \(group.name)", symbol: "person.3.fill")
                case .requested:
                    appStore.showToast(GroupJoinCopy.requestSent, symbol: "paperplane.fill")
                }
                await refreshGroup(group)
            } catch {
                for target in targets {
                    if asking {
                        target.hasRequested = false
                    } else if target.isMember {
                        target.isMember = false
                        target.memberCount -= 1
                    }
                }
                if let error = error as? GamesAPIError, error.isInviteOnly {
                    targets.forEach { $0.joinPolicy = .invite }
                    appStore.showToast(GroupJoinCopy.inviteOnly(group.name), symbol: "lock.fill")
                } else {
                    appStore.showToast("Couldn't join \(group.name). Try again.", symbol: "exclamationmark.circle")
                }
            }
            done?()
        }
    }

    /// `DELETE /v1/groups/{id}/members/me`, which also withdraws an ask.
    @MainActor
    func cancelJoinRequest(_ group: FBGroup) {
        guard group.hasRequested else { return }
        let targets = instances(of: group)
        targets.forEach { $0.hasRequested = false }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await api.setMember(false, groupID: group.id)
                appStore.showToast(GroupJoinCopy.requestCanceled)
            } catch {
                targets.forEach { $0.hasRequested = true }
                appStore.showToast("Couldn't cancel your request. Try again.", symbol: "exclamationmark.circle")
            }
        }
    }

    /// Leaves a Group: on the server too when it has the Group.
    @MainActor
    func leave(_ group: FBGroup) {
        guard group.isMember else { return }
        guard !isPreview, group.isOnServer else {
            appStore.toggleMembership(group)
            return
        }
        let targets = instances(of: group)
        for target in targets where target.isMember {
            target.isMember = false
            target.memberCount -= 1
        }
        appStore.showToast("You left \(group.name)", symbol: "rectangle.portrait.and.arrow.right")
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await api.setMember(false, groupID: group.id)
                await refreshGroup(group)
            } catch {
                for target in targets where !target.isMember {
                    target.isMember = true
                    target.memberCount += 1
                }
                appStore.showToast("Couldn't leave \(group.name). Try again.", symbol: "exclamationmark.circle")
            }
        }
    }

    // MARK: The owner

    /// The people asking to join, oldest first (`GET /v1/groups/{id}/requests`, the owner only).
    @MainActor
    func loadJoinRequests(for group: FBGroup) async throws -> [User] {
        let profiles = try await api.groupJoinRequests(groupID: group.id)
        let people = profiles.map(person)
        instances(of: group).forEach { $0.requestCount = people.count }
        return people
    }

    /// Approves an ask (`PUT /v1/groups/{id}/members/{userId}`). True when the server took it.
    @MainActor
    func approve(_ user: User, in group: FBGroup) async -> Bool {
        do {
            try await api.addGroupMember(groupID: group.id, userID: user.id)
        } catch {
            appStore.showToast("Couldn't approve \(user.firstName). Try again.", symbol: "exclamationmark.circle")
            return false
        }
        for target in instances(of: group) {
            target.requestCount = max(0, target.requestCount - 1)
            if !target.memberSample.contains(user) {
                target.memberSample.append(user)
                target.memberCount += 1
            }
        }
        appStore.showToast("\(user.firstName) joined \(group.name)", symbol: "person.badge.plus")
        return true
    }

    /// Changes the Group's join policy and recruiting flag (`PATCH /v1/groups/{id}`, the owner only).
    @MainActor
    func updateSettings(of group: FBGroup, policy: GroupJoinPolicy, recruiting: Bool) async -> Bool {
        let change = GroupSettingsChange(joinPolicy: policy.rawValue, recruiting: recruiting)
        do {
            let remote = try await api.updateGroup(id: group.id, change)
            instances(of: group).forEach { apply(remote, to: $0) }
            appStore.showToast("Group settings saved", symbol: "checkmark.circle.fill")
            return true
        } catch {
            appStore.showToast("Couldn't save the settings. Try again.", symbol: "exclamationmark.circle")
            return false
        }
    }

    // MARK: Adding people

    /// My friends on the server who aren't in the Group yet.
    @MainActor
    func friendsToAdd(to group: FBGroup) async -> [User] {
        let inGroup = Set(group.memberSample.map(\.id))
        return await loadFriends().filter { !$0.isMe && !inGroup.contains($0.id) }
    }

    /// Adds each person (`PUT /v1/groups/{id}/members/{userId}`); returns how many the server took.
    @MainActor
    func add(_ people: [User], to group: FBGroup) async -> Int {
        var added: [User] = []
        for user in people {
            if (try? await api.addGroupMember(groupID: group.id, userID: user.id)) != nil {
                added.append(user)
            }
        }
        for target in instances(of: group) {
            for user in added where !target.memberSample.contains(user) {
                target.memberSample.append(user)
                target.memberCount += 1
            }
        }
        if added.count == people.count {
            appStore.showToast(added.count == 1 ? "Added \(added[0].firstName)" : "Added \(added.count) people", symbol: "person.badge.plus")
        } else {
            appStore.showToast("Added \(added.count) of \(people.count). Try the rest again.", symbol: "exclamationmark.circle")
        }
        return added.count
    }

    // MARK: Profiles

    /// Refreshes a profile from the server: someone else's (`GET /v1/users/{id}`) or mine
    /// (`GET /v1/auth/me`; the phone's guest account keeps the demo identity).
    @MainActor
    func refreshProfile(_ user: User) async {
        guard !isPreview else { return }
        if user.isMe {
            guard await GamesAccount.shared.waitForUser() != nil, !GamesAccount.shared.isGuest,
                  let mine = try? await api.me() else { return }
            user.coverColor = mine.coverColor
            // The account's own cover color wins over the demo world's stock cover photo.
            if mine.coverColor != nil, user.coverData == nil { user.coverURL = nil }
            if let bio = mine.bio, !bio.isEmpty { user.bio = bio }
            if user.avatarData == nil, let picture = PersonAvatarURL.displayable(mine.avatarURL) { user.avatarURL = picture }
            return
        }
        guard GameIDMap.isServerID(user.id), let profile = try? await api.user(id: user.id) else { return }
        apply(profile, to: user)
        let cached = person(profile)
        if cached !== user { apply(profile, to: cached) }
    }

    /// Saves my name, bio and cover color to the server (`PATCH /v1/me/profile`). The guest account
    /// keeps the demo identity, so it saves nothing.
    @MainActor
    func saveMyProfile(displayName: String?, bio: String?, coverColor: String?) {
        guard !isPreview, GamesAccount.shared.userID != nil, !GamesAccount.shared.isGuest else { return }
        var change = ProfileChange()
        if let displayName {
            let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty { change.displayName = String(name.prefix(60)) }
        }
        if let bio { change.bio = String(bio.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300)) }
        change.coverColor = coverColor
        guard change != ProfileChange() else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await api.updateMyProfile(change)
            } catch {
                appStore.showToast("Couldn't save your profile to the server", symbol: "exclamationmark.circle")
            }
        }
    }
}

/// Copy for joining Groups.
enum GroupJoinCopy {
    static let join = "Join"
    static let requestToJoin = "Request to join"
    static let requested = "Requested"
    static let inviteOnlyLabel = "Invite only"
    static let recruiting = "Recruiting"
    static let requestSent = "Request sent"
    static let requestCanceled = "Request canceled"
    static let addPeople = "Add people"
    static let requests = "Requests"
    static let approve = "Approve"
    static let settings = "Group settings"

    static func inviteOnly(_ name: String) -> String { "Only members can add people to \(name)" }
}
