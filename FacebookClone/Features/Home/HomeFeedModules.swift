import SwiftUI

// MARK: - Module header

/// Title row used by the feed modules ("Reels and short videos", "People you may know").
struct HomeModuleHeader: View {
    let title: String
    var symbol: String? = nil
    var symbolColor: Color = FBColor.primaryText
    var subtitle: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(symbolColor)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Spacer(minLength: 8)
            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, FBMetrics.gutter)
    }
}

// MARK: - Reels

/// "Reels and short videos": a horizontal row of 9:16 reel posters.
struct HomeReelsTray: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        let reels = Array(store.reels.prefix(12))
        if !reels.isEmpty {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    HomeModuleHeader(
                        title: "Reels and short videos",
                        symbol: "play.rectangle.fill",
                        symbolColor: FBColor.reelsPink,
                        actionTitle: "See all",
                        action: { router.openReels() }
                    )
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 8) {
                            ForEach(reels) { reel in
                                HomeReelCard(reel: reel) {
                                    Haptics.light()
                                    router.openReels(startingAt: reel)
                                }
                            }
                        }
                        .padding(.horizontal, FBMetrics.gutter)
                    }
                }
                .padding(.vertical, 12)
                .background(FBColor.surface)
                FeedSeparator()
            }
        }
    }
}

private struct HomeReelCard: View {
    let reel: Post
    let action: () -> Void

    private let width: CGFloat = 132
    private let height: CGFloat = 235

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                RemoteImage(url: reel.media.first?.url)
                    .frame(width: width, height: height)
                LinearGradient(
                    colors: [Color.black.opacity(0.3), Color.clear, Color.clear, Color.black.opacity(0.75)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                details
            }
            .frame(width: width, height: height)
            .overlay(alignment: .topLeading) {
                AvatarView(user: reel.author, size: 28)
                    .overlay {
                        Circle().stroke(Color.white, lineWidth: 1.5)
                    }
                    .padding(8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(accessibilityText)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !reel.text.isEmpty {
                Text(reel.text)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Text(reel.author.name)
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.85))
                .lineLimit(1)
            HStack(spacing: 4) {
                Image(systemName: "play.fill")
                    .font(.system(size: 10, weight: .bold))
                Text(reel.viewCount.fbCompact)
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(.white)
        }
        .shadow(color: Color.black.opacity(0.35), radius: 2, y: 1)
        .padding(8)
    }

    private var accessibilityText: String {
        "Reel by \(reel.author.name), \(reel.viewCount.fbCompact) views"
    }
}

// MARK: - People you may know

/// Friend suggestions carousel with Add friend / Cancel / Remove.
struct HomePeopleYouMayKnow: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        let people = Array(store.suggestions.prefix(12))
        if !people.isEmpty {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    HomeModuleHeader(
                        title: "People you may know",
                        actionTitle: "See all",
                        action: { router.push(.friendSuggestions) }
                    )
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: 8) {
                            ForEach(people) { person in
                                HomeSuggestionCard(person: person)
                                    .transition(.scale(scale: 0.9).combined(with: .opacity))
                            }
                        }
                        .padding(.horizontal, FBMetrics.gutter)
                    }
                }
                .padding(.vertical, 12)
                .background(FBColor.surface)
                FeedSeparator()
            }
        }
    }
}

private struct HomeSuggestionCard: View {
    let person: User

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    private let width: CGFloat = 164

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                router.push(.profile(person))
            } label: {
                photo
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                dismissButton
            }
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    router.push(.profile(person))
                } label: {
                    Text(person.name)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                statusLine
                    .frame(height: 18, alignment: .leading)
                actions
                    .frame(height: 78, alignment: .top)
            }
            .padding(10)
        }
        .frame(width: width)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(FBColor.divider, lineWidth: 0.5)
        }
        .animation(.easeInOut(duration: 0.2), value: person.friendship)
    }

    private var photo: some View {
        ZStack {
            AvatarView.color(for: person.id)
            Text(person.initials)
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.white)
            RemoteImage(url: person.avatarURL, data: person.avatarData, placeholder: .clear)
        }
        .frame(width: width, height: width)
        .clipped()
    }

    private var dismissButton: some View {
        Button {
            remove()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Color.black.opacity(0.45), in: Circle())
        }
        .buttonStyle(.plain)
        .padding(8)
        .accessibilityLabel("Remove suggestion")
    }

    @ViewBuilder
    private var statusLine: some View {
        if person.friendship == .requestSent {
            Text("Request sent")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        } else {
            let mutual = store.mutualFriends(with: person)
            let count = person.mutualFriendCount > 0 ? person.mutualFriendCount : mutual.count
            if count > 0 {
                HStack(spacing: 4) {
                    if !mutual.isEmpty {
                        AvatarStack(users: Array(mutual.prefix(2)), size: 16, maxCount: 2)
                    }
                    Text(mutualText(count))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
            } else {
                Text("Suggested for you")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        if person.friendship == .requestSent {
            Button("Cancel") {
                Haptics.light()
                store.cancelRequest(to: person)
            }
            .buttonStyle(.fbSecondary)
        } else {
            VStack(spacing: 6) {
                Button {
                    Haptics.light()
                    store.sendRequest(to: person)
                } label: {
                    Label("Add friend", systemImage: "person.fill.badge.plus")
                }
                .buttonStyle(.fbPrimary)
                Button("Remove") {
                    remove()
                }
                .buttonStyle(.fbSecondary)
            }
        }
    }

    private func mutualText(_ count: Int) -> String {
        count == 1 ? "1 mutual friend" : "\(count) mutual friends"
    }

    private func remove() {
        withAnimation(.easeInOut(duration: 0.25)) {
            store.dismissSuggestion(person)
        }
    }
}

// MARK: - Suggested groups

/// "Suggested groups" carousel. Joined groups stay in place with "Visit group".
struct HomeSuggestedGroups: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var joinedHere: Set<String> = []
    @State private var hiddenIDs: Set<String> = []

    var body: some View {
        let groups = visibleGroups
        if !groups.isEmpty {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    HomeModuleHeader(
                        title: "Suggested groups",
                        symbol: "person.3.fill",
                        symbolColor: FBColor.groupsBlue,
                        subtitle: "Groups you might be interested in",
                        actionTitle: "See all",
                        action: { router.push(.groups) }
                    )
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: 8) {
                            ForEach(groups) { group in
                                HomeGroupCard(
                                    group: group,
                                    onJoin: { join(group) },
                                    onOpen: { router.push(.group(group)) },
                                    onHide: { hide(group) }
                                )
                                .transition(.scale(scale: 0.9).combined(with: .opacity))
                            }
                        }
                        .padding(.horizontal, FBMetrics.gutter)
                    }
                }
                .padding(.vertical, 12)
                .background(FBColor.surface)
                FeedSeparator()
            }
        }
    }

    private var visibleGroups: [FBGroup] {
        let candidates = store.groups.filter { group in
            (!group.isMember || joinedHere.contains(group.id)) && !hiddenIDs.contains(group.id)
        }
        return Array(candidates.prefix(10))
    }

    private func join(_ group: FBGroup) {
        Haptics.light()
        if !group.isMember {
            joinedHere.insert(group.id)
        }
        store.toggleMembership(group)
    }

    private func hide(_ group: FBGroup) {
        _ = withAnimation(.easeInOut(duration: 0.25)) {
            hiddenIDs.insert(group.id)
        }
    }
}

private struct HomeGroupCard: View {
    let group: FBGroup
    let onJoin: () -> Void
    let onOpen: () -> Void
    let onHide: () -> Void

    private let width: CGFloat = 220

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onOpen) {
                RemoteImage(url: group.coverURL)
                    .frame(width: width, height: 116)
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                hideButton
            }
            VStack(alignment: .leading, spacing: 4) {
                Button(action: onOpen) {
                    Text(group.name)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                Text(metaText)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Image(systemName: group.privacySymbol)
                    Text(group.privacyText)
                }
                .font(.fbCaption)
                .foregroundStyle(FBColor.secondaryText)
                Spacer(minLength: 6)
                joinButton
            }
            .padding(10)
            .frame(width: width, height: 150, alignment: .topLeading)
        }
        .frame(width: width)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(FBColor.divider, lineWidth: 0.5)
        }
    }

    @ViewBuilder
    private var joinButton: some View {
        if group.isMember {
            Button("Visit group", action: onOpen)
                .buttonStyle(.fbSecondary)
        } else {
            Button(action: onJoin) {
                Label("Join group", systemImage: "person.badge.plus")
            }
            .buttonStyle(.fbTinted)
        }
    }

    private var hideButton: some View {
        Button(action: onHide) {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Color.black.opacity(0.45), in: Circle())
        }
        .buttonStyle(.plain)
        .padding(8)
        .accessibilityLabel("Hide group suggestion")
    }

    private var metaText: String {
        let members = "\(group.memberCount.fbCompact) members"
        guard group.postsPerDay > 0 else { return members }
        let posts = group.postsPerDay == 1 ? "1 post a day" : "\(group.postsPerDay) posts a day"
        return "\(members) · \(posts)"
    }
}

// MARK: - Birthdays

/// "Maria's birthday is today. Help them have a great day!" at the top of the feed.
struct HomeBirthdayCard: View {
    let people: [User]

    @Environment(Router.self) private var router

    var body: some View {
        Button {
            router.push(.birthdays)
        } label: {
            HStack(spacing: 12) {
                avatar
                message
                    .font(.fbBody)
                    .foregroundStyle(FBColor.primaryText)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 12)
            .background(FBColor.surface)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var avatar: some View {
        if let first = people.first {
            AvatarView(user: first, size: 44)
                .overlay(alignment: .bottomTrailing) {
                    Text("🎁")
                        .font(.system(size: 14))
                        .frame(width: 22, height: 22)
                        .background(FBColor.surface, in: Circle())
                        .offset(x: 4, y: 4)
                }
        }
    }

    private var message: Text {
        guard let first = people.first else { return Text("") }
        let name = Text(first.name).fontWeight(.semibold)
        if people.count == 1 {
            return name + Text("'s birthday is today. Help them have a great day!")
        }
        let others = people.count - 1
        let othersLabel = others == 1 ? "1 other" : "\(others) others"
        let othersText = Text(othersLabel).fontWeight(.semibold)
        return name + Text(" and ") + othersText + Text(" have birthdays today. Help them have a great day!")
    }
}
