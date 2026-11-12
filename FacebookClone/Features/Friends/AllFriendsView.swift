import SwiftUI

/// A person's full friends list (pushed from Route.friendsList).
struct AllFriendsView: View {
    let user: User

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    enum SortOrder: String, CaseIterable, Identifiable {
        case standard = "Default"
        case firstName = "First name"
        case lastName = "Last name"
        case recent = "Recently added"
        var id: String { rawValue }
    }

    @State private var query = ""
    @State private var sortOrder: SortOrder = .standard
    @State private var selected: User?
    @State private var showOptions = false
    @State private var showUnfriend = false

    private var allFriends: [User] { store.friends(of: user) }

    private var visibleFriends: [User] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let filtered: [User] = trimmed.isEmpty
            ? allFriends
            : allFriends.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
        switch sortOrder {
        case .standard:
            return filtered
        case .firstName:
            return filtered.sorted { $0.firstName.localizedCaseInsensitiveCompare($1.firstName) == .orderedAscending }
        case .lastName:
            return filtered.sorted { $0.lastName.localizedCaseInsensitiveCompare($1.lastName) == .orderedAscending }
        case .recent:
            return Array(filtered.reversed())
        }
    }

    private var totalCount: Int {
        user.isMe ? store.friends.count : max(user.friendCount, allFriends.count)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                headerBlock
                if user.isMe {
                    birthdaysRow
                }
                if visibleFriends.isEmpty {
                    ContentUnavailableView.search(text: query)
                        .padding(.top, 40)
                } else {
                    ForEach(visibleFriends) { friend in
                        row(for: friend)
                    }
                }
            }
        }
        .background(FBColor.surface)
        .navigationTitle(user.isMe ? "Friends" : user.firstName)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            selected?.name ?? "",
            isPresented: $showOptions,
            titleVisibility: .visible,
            presenting: selected
        ) { friend in
            Button("Message") {
                router.openChat(store.conversation(with: friend))
            }
            Button(friend.isFollowing ? "Unfollow" : "Follow") {
                if friend.isFollowing { store.unfollow(friend) } else { store.follow(friend) }
            }
            if friend.isFriend {
                Button("Unfriend", role: .destructive) {
                    showUnfriend = true
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert(
            "Unfriend \(selected?.name ?? "")?",
            isPresented: $showUnfriend
        ) {
            Button("Unfriend", role: .destructive) {
                if let friend = selected { store.unfriend(friend) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll no longer see each other's friends-only posts.")
        }
    }

    private var headerBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(totalCount.withCommas) friends")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                Menu {
                    Picker("Sort", selection: $sortOrder) {
                        ForEach(SortOrder.allCases) { order in
                            Text(order.rawValue).tag(order)
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(sortOrder.rawValue)
                            .font(.fbBody)
                        Image(systemName: "arrow.up.arrow.down")
                            .font(.system(size: FBIconSize.small, weight: .semibold))
                    }
                    .foregroundStyle(FBColor.accent)
                }
                .accessibilityLabel("Sort friends")
            }
            SearchField(placeholder: "Search friends", text: $query)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var birthdaysRow: some View {
        Button {
            router.push(.birthdays)
        } label: {
            HStack(spacing: 12) {
                Circle()
                    .fill(FBColor.buttonGray)
                    .frame(width: FBAvatarSize.row, height: FBAvatarSize.row)
                    .overlay {
                        Image(systemName: "gift.fill")
                            .font(.system(size: FBIconSize.xl))
                            .foregroundStyle(FBColor.eventRed)
                    }
                Text("Birthdays")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func row(for friend: User) -> some View {
        HStack(spacing: 12) {
            Button {
                router.push(.profile(friend))
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: friend, size: FBAvatarSize.row)
                    VStack(alignment: .leading, spacing: 2) {
                        NameWithBadge(user: friend, font: .fbHeadline)
                        if !user.isMe && friend.mutualFriendCount > 0 {
                            Text("\(friend.mutualFriendCount) mutual friends")
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            BubbleFriendRowSlots(user: friend)

            CircleButton(symbol: "ellipsis", size: 34, accessibilityLabel: "More options for \(friend.name)") {
                selected = friend
                showOptions = true
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }
}
