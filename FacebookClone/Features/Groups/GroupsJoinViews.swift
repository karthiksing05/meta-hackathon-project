import SwiftUI

// A Group's join button by its policy, the "Recruiting" pill, and the owner's tools: requests,
// adding people and the join settings. The data comes from the games API through `BubbleStore`
// (Bubbles/Store/GroupMembership+Store.swift).

/// "Recruiting": the Group says it wants new members.
struct GroupsRecruitingPill: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "person.badge.plus")
                .font(.system(size: FBIconSize.xs, weight: .semibold))
            Text(GroupJoinCopy.recruiting)
                .font(.fbCaptionEmphasized)
        }
        .foregroundStyle(FBColor.accent)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(FBColor.tintedBlueBackground, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// The non-member's button: "Join", "Request to join" then "Requested", or "Invite only".
struct GroupsJoinButton: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @State private var showCancel = false

    var body: some View {
        switch group.joinPolicy {
        case .open:
            Button {
                Haptics.light()
                bubbleStore.join(group)
            } label: {
                Text(GroupJoinCopy.join)
            }
            .buttonStyle(.fbPrimary)
        case .request:
            if group.hasRequested {
                Button {
                    showCancel = true
                } label: {
                    GroupsMutedLabel(symbol: "clock", title: GroupJoinCopy.requested)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Waiting for the group's owner. Double-tap to cancel your request.")
                .confirmationDialog("Cancel your request to join \(group.name)?", isPresented: $showCancel, titleVisibility: .visible) {
                    Button("Cancel request", role: .destructive) {
                        Haptics.warning()
                        bubbleStore.cancelJoinRequest(group)
                    }
                    Button("Keep request", role: .cancel) {}
                }
            } else {
                Button {
                    Haptics.light()
                    bubbleStore.join(group)
                } label: {
                    Text(GroupJoinCopy.requestToJoin)
                }
                .buttonStyle(.fbPrimary)
            }
        case .invite:
            GroupsMutedLabel(symbol: "lock.fill", title: GroupJoinCopy.inviteOnlyLabel)
                .accessibilityHint("A member has to add you.")
        }
    }
}

/// A greyed-out, button-shaped label for a state you can't act on.
private struct GroupsMutedLabel: View {
    let symbol: String
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.small, weight: .semibold))
            Text(title)
        }
        .font(.fbButton)
        .foregroundStyle(FBColor.secondaryText)
        .frame(maxWidth: .infinity)
        .frame(height: 36)
        .background(FBColor.buttonGray.opacity(0.6), in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Requests (the owner)

/// The owner's "Requests" row: the first few asks with Approve buttons, and "See all".
struct GroupsRequestsSection: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @State private var people: [User] = []
    @State private var approving: Set<String> = []
    @State private var showAll = false

    private static let shownInline = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !people.isEmpty {
                HairlineDivider()
                SectionHeader(
                    title: "\(GroupJoinCopy.requests) · \(people.count)",
                    actionTitle: people.count > Self.shownInline ? "See all" : nil
                ) {
                    showAll = true
                }
                ForEach(people.prefix(Self.shownInline)) { user in
                    GroupsRequestRow(user: user, isApproving: approving.contains(user.id)) {
                        approve(user)
                    }
                }
            }
        }
        .task(id: "\(group.id)|\(group.requestCount)|\(group.joinPolicy.rawValue)") {
            await load()
        }
        .sheet(isPresented: $showAll) {
            GroupsRequestsSheet(group: group, people: $people)
        }
    }

    private func load() async {
        guard group.isAdmin, group.isOnServer else { return }
        if let loaded = try? await bubbleStore.loadJoinRequests(for: group) {
            people = loaded
        }
    }

    private func approve(_ user: User) {
        Haptics.success()
        approving.insert(user.id)
        Task { @MainActor in
            if await bubbleStore.approve(user, in: group) {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                    people.removeAll { $0.id == user.id }
                }
            }
            approving.remove(user.id)
        }
    }
}

/// Everyone asking to join.
private struct GroupsRequestsSheet: View {
    let group: FBGroup
    @Binding var people: [User]

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss
    @State private var approving: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 0) {
                    if people.isEmpty {
                        ContentUnavailableView(
                            "No requests",
                            systemImage: "person.badge.clock",
                            description: Text("People who ask to join will show up here.")
                        )
                        .padding(.top, 30)
                    }
                    ForEach(people) { user in
                        GroupsRequestRow(user: user, isApproving: approving.contains(user.id)) {
                            approve(user)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 4)
                    }
                }
                .padding(.top, 8)
            }
            .background(FBColor.surface)
            .navigationTitle(GroupJoinCopy.requests)
            .navigationBarTitleDisplayMode(.inline)
            .appDestinations()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func approve(_ user: User) {
        Haptics.success()
        approving.insert(user.id)
        Task { @MainActor in
            if await bubbleStore.approve(user, in: group) {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                    people.removeAll { $0.id == user.id }
                }
            }
            approving.remove(user.id)
        }
    }
}

private struct GroupsRequestRow: View {
    let user: User
    let isApproving: Bool
    let onApprove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.profile(user)) {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: FBAvatarSize.post)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.name)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        if !user.bio.isEmpty {
                            Text(user.bio)
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                                .lineLimit(1)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer(minLength: 8)
            Button(action: onApprove) {
                Text(GroupJoinCopy.approve)
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
            .disabled(isApproving)
            .opacity(isApproving ? 0.6 : 1)
            .accessibilityLabel("Approve \(user.name)")
        }
    }
}

// MARK: - Add people

/// Your friends who aren't in the Group yet; adds the ones you pick.
struct GroupsAddPeopleSheet: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss
    @State private var friends: [User] = []
    @State private var isLoading = true
    @State private var selection: Set<String> = []
    @State private var isAdding = false

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .padding(.top, 4)
            }
            .background(FBColor.surface)
            .navigationTitle(GroupJoinCopy.addPeople)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(selection.count > 1 ? "Add \(selection.count)" : "Add") { add() }
                        .fontWeight(.semibold)
                        .disabled(selection.isEmpty || isAdding)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            friends = await bubbleStore.friendsToAdd(to: group)
            isLoading = false
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            VStack(spacing: 14) {
                ForEach(0..<5, id: \.self) { _ in
                    HStack(spacing: 12) {
                        Circle().fill(FBColor.skeleton).frame(width: FBAvatarSize.post, height: FBAvatarSize.post)
                        SkeletonBlock(width: 160, height: 14)
                        Spacer()
                    }
                }
            }
            .padding(16)
            .shimmering()
        } else if friends.isEmpty {
            ContentUnavailableView(
                "No friends to add",
                systemImage: "person.2",
                description: Text("Your friends are already in \(group.name), or you haven't added any yet.")
            )
            .padding(.top, 30)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(friends) { friend in
                    row(friend)
                }
            }
        }
    }

    private func row(_ friend: User) -> some View {
        let isSelected = selection.contains(friend.id)
        return Button {
            Haptics.selection()
            if isSelected {
                selection.remove(friend.id)
            } else {
                selection.insert(friend.id)
            }
        } label: {
            HStack(spacing: 12) {
                AvatarView(user: friend, size: FBAvatarSize.post)
                Text(friend.name)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: FBIconSize.xl))
                    .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func add() {
        let picked = friends.filter { selection.contains($0.id) }
        guard !picked.isEmpty else { return }
        Haptics.light()
        isAdding = true
        Task { @MainActor in
            _ = await bubbleStore.add(picked, to: group)
            isAdding = false
            dismiss()
        }
    }
}

// MARK: - Settings (the owner)

/// Who can join, and whether the Group is recruiting.
struct GroupsJoinSettingsSheet: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss
    @State private var policy: GroupJoinPolicy = .open
    @State private var recruiting = false
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Who can join")
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                    ForEach(GroupJoinPolicy.allCases) { option in
                        policyRow(option)
                    }
                    HairlineDivider()
                        .padding(.vertical, 8)
                    Toggle(isOn: $recruiting) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(GroupJoinCopy.recruiting)
                                .font(.fbName)
                                .foregroundStyle(FBColor.primaryText)
                            Text("Show people that this group wants new members.")
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                        }
                    }
                    .tint(FBColor.brandBlue)
                    .padding(.horizontal, 16)
                    .onChange(of: recruiting) { Haptics.light() }
                }
            }
            .background(FBColor.surface)
            .navigationTitle(GroupJoinCopy.settings)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { save() }
                        .fontWeight(.semibold)
                        .disabled(!hasChanges || isSaving)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear {
            policy = group.joinPolicy
            recruiting = group.isRecruiting
        }
    }

    private var hasChanges: Bool {
        policy != group.joinPolicy || recruiting != group.isRecruiting
    }

    private func policyRow(_ option: GroupJoinPolicy) -> some View {
        let isSelected = policy == option
        return Button {
            Haptics.selection()
            policy = option
        } label: {
            HStack(spacing: 12) {
                SymbolBadge(symbol: option.symbol, color: isSelected ? FBColor.brandBlue : FBColor.secondaryText, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(option.detail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: FBIconSize.xl))
                    .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func save() {
        isSaving = true
        Task { @MainActor in
            if await bubbleStore.updateSettings(of: group, policy: policy, recruiting: recruiting) {
                Haptics.success()
                dismiss()
            }
            isSaving = false
        }
    }
}
