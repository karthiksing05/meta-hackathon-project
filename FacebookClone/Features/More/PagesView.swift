import SwiftUI

private enum MorePagesFilter: String, CaseIterable, Identifiable {
    case liked = "Liked Pages"
    case discover = "Discover"
    case invites = "Invites"

    var id: String { rawValue }
}

private struct MorePageInvite: Identifiable {
    let page: User
    let inviter: User
    var id: String { page.id }
}

struct PagesView: View {
    @Environment(AppStore.self) private var store

    @State private var filter: MorePagesFilter = .liked
    @State private var dismissedInvites: Set<String> = []

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                chips
                content
            }
        }
        .background(FBColor.background)
        .navigationTitle("Pages")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Create") {
                    store.showToast("Page creation isn't available in this demo", symbol: "info.circle")
                }
            }
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(MorePagesFilter.allCases) { item in
                    ChipView(title: item.rawValue, isSelected: filter == item) {
                        filter = item
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(FBColor.surface)
    }

    @ViewBuilder
    private var content: some View {
        switch filter {
        case .liked:
            pageList(store.followedPages, emptyTitle: "No liked Pages", emptyText: "Pages you follow will show up here.")
        case .discover:
            pageList(store.pages.filter { !$0.isFollowing }, emptyTitle: "You're following every Page", emptyText: "Check back later to discover more.")
        case .invites:
            invitesList
        }
    }

    @ViewBuilder
    private func pageList(_ pages: [User], emptyTitle: String, emptyText: String) -> some View {
        if pages.isEmpty {
            ContentUnavailableView(emptyTitle, systemImage: "flag", description: Text(emptyText))
                .padding(.top, 50)
        } else {
            VStack(spacing: 0) {
                ForEach(pages) { page in
                    MorePageRow(page: page)
                }
            }
            .background(FBColor.surface)
            .padding(.top, 8)
        }
    }

    private var invites: [MorePageInvite] {
        let candidates = store.pages.filter { !$0.isFollowing }.prefix(3)
        let friends = store.friends
        guard !friends.isEmpty else { return [] }
        var result: [MorePageInvite] = []
        for (index, page) in candidates.enumerated() {
            result.append(MorePageInvite(page: page, inviter: friends[index % friends.count]))
        }
        return result.filter { !dismissedInvites.contains($0.id) }
    }

    @ViewBuilder
    private var invitesList: some View {
        let items = invites
        if items.isEmpty {
            ContentUnavailableView(
                "No invites",
                systemImage: "envelope.open",
                description: Text("When friends invite you to like a Page, it will show up here.")
            )
            .padding(.top, 50)
        } else {
            VStack(spacing: 0) {
                ForEach(items) { invite in
                    inviteRow(invite)
                }
            }
            .background(FBColor.surface)
            .padding(.top, 8)
        }
    }

    private func inviteRow(_ invite: MorePageInvite) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(user: invite.page, size: 60)
            VStack(alignment: .leading, spacing: 4) {
                NameWithBadge(user: invite.page)
                Text("\(invite.inviter.name) invited you to like this Page")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                HStack(spacing: 8) {
                    Button {
                        store.follow(invite.page)
                        dismissedInvites.insert(invite.id)
                    } label: {
                        Text("Like")
                    }
                    .buttonStyle(.fbPrimary)
                    Button {
                        dismissedInvites.insert(invite.id)
                    } label: {
                        Text("Delete")
                    }
                    .buttonStyle(.fbSecondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

private struct MorePageRow: View {
    let page: User
    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.profile(page)) {
                HStack(spacing: 12) {
                    AvatarView(user: page, size: 60)
                    VStack(alignment: .leading, spacing: 2) {
                        NameWithBadge(user: page)
                        if let category = page.category {
                            Text(category)
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                        }
                        Text("\(page.followerCount.fbCompact) followers")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button {
                Haptics.light()
                if page.isFollowing {
                    store.unfollow(page)
                } else {
                    store.follow(page)
                }
            } label: {
                Text(page.isFollowing ? "Following" : "Follow")
            }
            .buttonStyle(.fb(page.isFollowing ? .secondary : .primary, expand: false))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}
