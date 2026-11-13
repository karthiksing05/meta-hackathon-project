import SwiftUI

private enum GroupsFilter: String, CaseIterable, Identifiable {
    case forYou = "For you"
    case yourGroups = "Your groups"
    case discover = "Discover"

    var id: String { rawValue }
}

/// A group's cover photo with a gradient behind it while loading. A Group with no photo shows its
/// `coverColor` from the server, when it has one.
struct GroupsCoverImage: View {
    let group: FBGroup

    var body: some View {
        ZStack {
            if group.coverURL == nil, let color = Color(serverHex: group.coverColor) {
                LinearGradient(
                    colors: [color, color.opacity(0.75)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            } else {
                LinearGradient(
                    colors: [FBColor.groupsBlue, FBColor.savedPurple],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
            RemoteImage(url: group.coverURL, placeholder: .clear)
        }
    }
}

struct GroupsView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var filter: GroupsFilter = .forYou
    @State private var showCreate = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                chips
                content
            }
        }
        .background(FBColor.background)
        .navigationTitle("Groups")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    router.push(.search(""))
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .accessibilityLabel("Search groups")
                Button {
                    showCreate = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Create group")
            }
        }
        .sheet(isPresented: $showCreate) {
            GroupsCreateSheet()
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(GroupsFilter.allCases) { item in
                    ChipView(title: item.rawValue, isSelected: filter == item) {
                        Haptics.selection()
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
        case .forYou:
            forYouContent
        case .yourGroups:
            yourGroupsList
        case .discover:
            discoverList
        }
    }

    // MARK: For you

    private var forYouContent: some View {
        VStack(spacing: 0) {
            FeedSeparator()
            yourGroupsRow
            BubbleGroupDailyStrip()
            FeedSeparator()
            recentActivity
            if !store.suggestedGroups.isEmpty {
                FeedSeparator()
                VStack(alignment: .leading, spacing: 0) {
                    SectionHeader(title: "Discover groups")
                        .padding(16)
                    discoverList
                }
                .background(FBColor.surface)
            }
        }
    }

    private var yourGroupsRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Your groups", actionTitle: "See all") {
                filter = .yourGroups
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            if store.myGroups.isEmpty {
                Text("Groups you join will show up here.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(store.myGroups) { group in
                            NavigationLink(value: Route.group(group)) {
                                GroupsTile(group: group)
                            }
                            .buttonStyle(.pressable)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private var recentPosts: [Post] {
        store.posts.filter { $0.group?.isMember == true }
    }

    @ViewBuilder
    private var recentActivity: some View {
        let posts = recentPosts
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(title: "Recent activity")
                .padding(16)
                .background(FBColor.surface)
            if posts.isEmpty {
                ContentUnavailableView(
                    "No recent activity",
                    systemImage: "person.3",
                    description: Text("Join a group to see posts from its members here.")
                )
                .padding(.vertical, 24)
                .background(FBColor.surface)
            } else {
                ForEach(posts) { post in
                    PostCard(post: post)
                    FeedSeparator()
                }
            }
        }
    }

    // MARK: Your groups

    @ViewBuilder
    private var yourGroupsList: some View {
        if store.myGroups.isEmpty {
            ContentUnavailableView(
                "No groups yet",
                systemImage: "person.3.fill",
                description: Text("Join groups to connect with people who share your interests.")
            )
            .padding(.top, 40)
        } else {
            VStack(spacing: 0) {
                ForEach(store.myGroups) { group in
                    NavigationLink(value: Route.group(group)) {
                        GroupsRow(group: group)
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(FBColor.surface)
            .padding(.top, 8)
        }
    }

    // MARK: Discover

    @ViewBuilder
    private var discoverList: some View {
        if store.suggestedGroups.isEmpty {
            ContentUnavailableView(
                "You've joined everything",
                systemImage: "checkmark.circle",
                description: Text("Check back later for more groups to discover.")
            )
            .padding(.top, 40)
        } else {
            VStack(spacing: 12) {
                ForEach(store.suggestedGroups) { group in
                    GroupsDiscoverCard(group: group)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
        }
    }
}

// MARK: - Pieces

private struct GroupsTile: View {
    let group: FBGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GroupsCoverImage(group: group)
                .frame(width: 116, height: 116)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if group.unreadCount > 0 {
                        Circle()
                            .fill(FBColor.brandBlue)
                            .frame(width: 14, height: 14)
                            .overlay { Circle().stroke(FBColor.surface, lineWidth: 2) }
                            .padding(6)
                            .accessibilityLabel("New posts")
                    }
                }
            Text(group.name)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(width: 116, alignment: .leading)
        }
    }
}

private struct GroupsRow: View {
    let group: FBGroup

    var body: some View {
        HStack(spacing: 12) {
            GroupsCoverImage(group: group)
                .frame(width: 60, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(group.name)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer()
            if group.unreadCount > 0 {
                BadgeCount(count: group.unreadCount)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        if group.unreadCount > 0 {
            return "\(group.unreadCount) new posts"
        }
        if let visited = group.lastVisited {
            return "Last active \(visited.fbShort)"
        }
        return "\(group.memberCount.fbCompact) members"
    }
}

private struct GroupsDiscoverCard: View {
    let group: FBGroup
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: Route.group(group)) {
                GroupsCoverImage(group: group)
                    .frame(height: 140)
                    .frame(maxWidth: .infinity)
                    .clipped()
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 8) {
                Text(group.name)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                Text("\(group.memberCount.fbCompact) members · \(group.postsPerDay) posts a day")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                if !group.memberSample.isEmpty {
                    HStack(spacing: 8) {
                        AvatarStack(users: group.memberSample, size: FBAvatarSize.tiny, maxCount: 4)
                        Text(memberLine)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                }
                Button {
                    Haptics.light()
                    store.toggleMembership(group)
                } label: {
                    Text(group.isMember ? "Joined" : "Join group")
                }
                .buttonStyle(.fb(group.isMember ? .secondary : .primary))
            }
            .padding(12)
        }
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    private var memberLine: String {
        guard let first = group.memberSample.first else { return "" }
        return "\(first.firstName) and others are members"
    }
}

#Preview {
    NavigationStack { GroupsView() }.previewEnvironment()
}
