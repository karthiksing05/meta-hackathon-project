import SwiftUI

private enum GroupsDetailTab: String, CaseIterable, Identifiable {
    case featured = "Featured"
    case about = "About"
    case members = "Members"
    case media = "Media"
    case events = "Events"

    var id: String { rawValue }
}

private struct GroupsViewerItem: Identifiable {
    let id = UUID()
    let media: [Media]
    let index: Int
}

struct GroupDetailView: View {
    let group: FBGroup

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var tab: GroupsDetailTab = .featured
    @State private var showLeaveConfirm = false
    @State private var showInvite = false
    @State private var isFollowing = true
    @State private var notificationsOn = true
    @State private var viewer: GroupsViewerItem?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                tabChips
                tabContent
            }
        }
        .background(FBColor.background)
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            group.unreadCount = 0
            group.lastVisited = Date()
        }
        .sheet(isPresented: $showInvite) {
            GroupsFriendPickerSheet(title: "Invite friends", confirmTitle: "Send") { _ in
                store.showToast("Invites sent", symbol: "paperplane.fill")
            }
        }
        .fullScreenCover(item: $viewer) { item in
            PhotoViewer(media: item.media, startIndex: item.index)
        }
        .confirmationDialog("Leave \(group.name)?", isPresented: $showLeaveConfirm, titleVisibility: .visible) {
            Button("Leave group", role: .destructive) {
                store.toggleMembership(group)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll stop seeing posts from this group in your feed.")
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            GroupsCoverImage(group: group)
                .frame(height: 190)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .bottom) {
                    LinearGradient(colors: [.clear, Color.black.opacity(0.25)], startPoint: .top, endPoint: .bottom)
                        .frame(height: 70)
                        .allowsHitTesting(false)
                }
                .clipped()
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text(group.name)
                        .font(.fbTabTitle)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.medium, weight: .bold))
                        .foregroundStyle(FBColor.secondaryText)
                }
                HStack(spacing: 6) {
                    Image(systemName: group.privacySymbol)
                        .font(.system(size: FBIconSize.small))
                    Text("\(group.privacyText) · \(group.memberCount.fbCompact) members")
                        .font(.fbBody)
                }
                .foregroundStyle(FBColor.secondaryText)
                if !group.memberSample.isEmpty {
                    AvatarStack(users: group.memberSample, size: FBAvatarSize.reply, maxCount: 6)
                }
                actionButtons
            }
            .padding(16)
        }
        .background(FBColor.surface)
    }

    private var actionButtons: some View {
        HStack(spacing: 8) {
            if group.isMember {
                joinedMenu
            } else {
                Button {
                    Haptics.light()
                    store.toggleMembership(group)
                } label: {
                    Text("Join group")
                }
                .buttonStyle(.fbPrimary)
            }
            Button {
                showInvite = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text("Invite")
                }
            }
            .buttonStyle(.fbSecondary)
            ShareLink(item: "Check out \(group.name) on Facebook") {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 44, height: 36)
                    .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
            }
            .accessibilityLabel("Share group")
        }
    }

    private var joinedMenu: some View {
        Menu {
            Button {
                Haptics.light()
                isFollowing.toggle()
                store.showToast(isFollowing ? "You're following \(group.name)" : "You unfollowed \(group.name)")
            } label: {
                Label(isFollowing ? "Unfollow group" : "Follow group", systemImage: isFollowing ? "bell.slash" : "bell")
            }
            Button {
                Haptics.light()
                notificationsOn.toggle()
                store.showToast(notificationsOn ? "Notifications turned on" : "Notifications turned off", symbol: "bell.fill")
            } label: {
                Label(notificationsOn ? "Turn off notifications" : "Turn on notifications", systemImage: "bell.badge")
            }
            Button(role: .destructive) {
                Haptics.warning()
                showLeaveConfirm = true
            } label: {
                Label("Leave group", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            HStack(spacing: 6) {
                Text("Joined")
                Image(systemName: "chevron.down")
                    .font(.system(size: FBIconSize.small, weight: .bold))
            }
            .font(.fbButton)
            .foregroundStyle(FBColor.primaryText)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
        }
    }

    private var tabChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(GroupsDetailTab.allCases) { item in
                    ChipView(title: item.rawValue, isSelected: tab == item) {
                        Haptics.selection()
                        tab = item
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(FBColor.surface)
        .overlay(alignment: .bottom) { HairlineDivider() }
    }

    // MARK: Tabs

    private var canSeeContent: Bool { group.isMember || !group.isPrivate }

    @ViewBuilder
    private var tabContent: some View {
        switch tab {
        case .featured:
            featuredContent
        case .about:
            aboutContent
        case .members:
            membersContent
        case .media:
            mediaContent
        case .events:
            eventsContent
        }
    }

    @ViewBuilder
    private var featuredContent: some View {
        if canSeeContent {
            let posts = store.posts(in: group)
            VStack(spacing: 0) {
                FeedSeparator()
                BubbleGroupSection(group: group)
                GroupBlendSection(group: group)
                if group.isMember {
                    FeedSeparator()
                    ComposerBar(placeholder: "Write something...", group: group)
                }
                FeedSeparator()
                if posts.isEmpty {
                    ContentUnavailableView(
                        "No posts yet",
                        systemImage: "text.bubble",
                        description: Text("Be the first to start a discussion.")
                    )
                    .padding(.vertical, 30)
                    .background(FBColor.surface)
                } else {
                    ForEach(posts) { post in
                        PostCard(post: post)
                        FeedSeparator()
                    }
                }
            }
        } else {
            lockCard
        }
    }

    private var lockCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.system(size: FBIconSize.xxl))
                .foregroundStyle(FBColor.secondaryText)
            Text("Join this group to see the discussion")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
            Text("Only members can see who's in the group and what they post.")
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .padding(12)
    }

    private var aboutContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !group.about.isEmpty {
                Text(group.about)
                    .font(.fbBodyLarge)
                    .foregroundStyle(FBColor.primaryText)
            }
            aboutRow(
                symbol: group.isPrivate ? "lock.fill" : "globe.americas.fill",
                title: group.privacyText,
                detail: group.isPrivate
                    ? "Only members can see who's in the group and what they post."
                    : "Anyone can see who's in the group and what they post."
            )
            aboutRow(symbol: "eye.fill", title: "Visible", detail: "Anyone can find this group.")
            aboutRow(symbol: "clock.fill", title: "History", detail: "Group created on \(creationText)")
            if !group.category.isEmpty {
                aboutRow(symbol: "tag.fill", title: group.category, detail: "Category")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .padding(.top, 6)
    }

    private var creationText: String {
        let date = Calendar.current.date(byAdding: .month, value: -(8 + group.postsPerDay % 20), to: Date()) ?? Date()
        return DateFormatters.fullMonthDayYear.string(from: date)
    }

    private func aboutRow(symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.regular))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(detail)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
    }

    @ViewBuilder
    private var membersContent: some View {
        if canSeeContent {
            VStack(spacing: 0) {
                HStack {
                    Text("\(group.memberCount.withCommas) members")
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    Spacer()
                }
                .padding(16)
                ForEach(group.memberSample) { member in
                    GroupsMemberRow(user: member)
                }
            }
            .background(FBColor.surface)
            .padding(.top, 6)
        } else {
            lockCard
        }
    }

    @ViewBuilder
    private var mediaContent: some View {
        if canSeeContent {
            let items = store.posts(in: group).flatMap { $0.photos }
            if items.isEmpty {
                ContentUnavailableView(
                    "No photos yet",
                    systemImage: "photo.on.rectangle",
                    description: Text("Photos shared in this group will appear here.")
                )
                .padding(.top, 30)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, media in
                        Button {
                            viewer = GroupsViewerItem(media: items, index: index)
                        } label: {
                            Color.clear
                                .aspectRatio(1, contentMode: .fit)
                                .overlay {
                                    RemoteImage(url: media.url, data: media.data)
                                }
                                .clipped()
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Photo \(index + 1)")
                    }
                }
                .padding(.top, 2)
            }
        } else {
            lockCard
        }
    }

    private var eventsContent: some View {
        ContentUnavailableView(
            "No upcoming events",
            systemImage: "calendar",
            description: Text("Events created in this group will show up here.")
        )
        .padding(.top, 30)
    }
}

private struct GroupsMemberRow: View {
    let user: User
    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.profile(user)) {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: FBAvatarSize.compact)
                    VStack(alignment: .leading, spacing: 2) {
                        NameWithBadge(user: user)
                        if user.mutualFriendCount > 0 && !user.isMe {
                            Text("\(user.mutualFriendCount) mutual friends")
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer()
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var trailing: some View {
        switch user.friendship {
        case .me:
            EmptyView()
        case .friends:
            Text("Friends")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        case .requestSent:
            Text("Request sent")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        case .requestReceived:
            Button {
                Haptics.success()
                store.confirmRequest(from: user)
            } label: {
                Text("Confirm")
            }
            .buttonStyle(.fb(.primary, expand: false))
        case .none:
            Button {
                Haptics.light()
                store.sendRequest(to: user)
            } label: {
                Text("Add friend")
            }
            .buttonStyle(.fb(.tinted, expand: false))
        }
    }
}
