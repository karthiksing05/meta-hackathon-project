import SwiftUI

/// Menu tab root.
struct MenuView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var showMore = false
    @State private var showLogOut = false
    @State private var showDarkMode = false

    private let topID = "menu.top"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 14) {
                    header.id(topID)
                    profileCard
                    shortcutsSection
                    tileGrid
                    seeMoreButton
                    helpSection
                    settingsSection
                    logOutButton
                }
                .padding(.bottom, 24)
            }
            .onChange(of: router.scrollToTopSignal(for: .menu)) {
                withAnimation { proxy.scrollTo(topID, anchor: .top) }
            }
        }
        .background(FBColor.background)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showDarkMode) {
            MenuDarkModeSheet()
                .presentationDetents([.height(340)])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog("Log out of Facebook?", isPresented: $showLogOut, titleVisibility: .visible) {
            Button("Log out", role: .destructive) { store.logOut() }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: Header

    private var header: some View {
        TabHeader("Menu") {
            CircleButton(symbol: "gearshape.fill", accessibilityLabel: "Settings") {
                router.push(.settings)
            }
            CircleButton(symbol: "magnifyingglass", accessibilityLabel: "Search") {
                router.push(.search(""))
            }
        }
    }

    // MARK: Profile

    private var profileCard: some View {
        VStack(spacing: 0) {
            Button {
                router.push(.profile(store.me))
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: store.me, size: FBAvatarSize.post)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.me.name)
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.primaryText)
                        Text("See your profile")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    Spacer()
                }
                .padding(12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            HairlineDivider(leadingInset: 12)
            Button {
                store.showToast("Creating another profile isn't available yet", symbol: "person.crop.circle.badge.plus")
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "plus")
                        .font(.system(size: FBIconSize.regular, weight: .bold))
                        .foregroundStyle(FBColor.primaryText)
                        .frame(width: 44, height: 44)
                        .background(FBColor.buttonGray, in: Circle())
                    Text("Create another profile")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Spacer()
                }
                .padding(12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 1)
        .padding(.horizontal, 12)
    }

    // MARK: Shortcuts

    @ViewBuilder
    private var shortcutsSection: some View {
        if !store.myGroups.isEmpty || !store.followedPages.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Your shortcuts")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .padding(.horizontal, 16)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(store.myGroups) { group in
                            groupShortcut(group)
                        }
                        ForEach(store.followedPages) { page in
                            pageShortcut(page)
                        }
                    }
                    .padding(.horizontal, 12)
                }
            }
        }
    }

    private func groupShortcut(_ group: FBGroup) -> some View {
        Button {
            router.push(.group(group))
        } label: {
            VStack(spacing: 6) {
                RemoteImage(url: group.coverURL)
                    .frame(width: 60, height: 60)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                Text(group.name)
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(width: 70)
            }
        }
        .buttonStyle(.pressable)
    }

    private func pageShortcut(_ page: User) -> some View {
        Button {
            router.push(.profile(page))
        } label: {
            VStack(spacing: 6) {
                AvatarView(user: page, size: FBAvatarSize.row)
                Text(page.name)
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(width: 70)
            }
        }
        .buttonStyle(.pressable)
    }

    // MARK: Grid

    private var primaryTiles: [MenuTileItem] {
        [
            MenuTileItem(id: "memories", title: "Memories", symbol: "clock.arrow.circlepath", color: FBColor.memoriesBlue) { router.push(.memories) },
            MenuTileItem(id: "saved", title: "Saved", symbol: "bookmark.fill", color: FBColor.savedPurple) { router.push(.saved) },
            MenuTileItem(id: "groups", title: "Groups", symbol: "person.3.fill", color: FBColor.groupsBlue) { router.push(.groups) },
            MenuTileItem(id: "video", title: "Video", symbol: "play.rectangle.fill", color: FBColor.brandBlue) { router.select(.video) },
            MenuTileItem(id: "marketplace", title: "Marketplace", symbol: "storefront.fill", color: FBColor.marketplaceTeal) { router.select(.marketplace) },
            MenuTileItem(id: "friends", title: "Friends", symbol: "person.2.fill", color: FBColor.brandBlue) { router.select(.friends) },
            MenuTileItem(id: "feeds", title: "Feeds", symbol: "newspaper.fill", color: FBColor.brandBlue) { router.push(.feeds) },
            MenuTileItem(id: "events", title: "Events", symbol: "calendar", color: FBColor.eventRed) { router.push(.events) },
            MenuTileItem(id: "birthdays", title: "Birthdays", symbol: "gift.fill", color: FBColor.reelsPink, badge: store.birthdaysToday.count) { router.push(.birthdays) },
            MenuTileItem(id: "pages", title: "Pages", symbol: "flag.fill", color: FBColor.checkInRed) { router.push(.pages) },
            MenuTileItem(id: "reels", title: "Reels", symbol: "film.stack.fill", color: FBColor.reelsPink) { router.openReels() },
            MenuTileItem(id: "messenger", title: "Messenger", symbol: "bubble.left.and.bubble.right.fill", color: FBColor.messengerBlue) { router.openMessenger() }
        ]
    }

    private var extraTiles: [MenuTileItem] {
        let entries: [(String, String, Color)] = [
            ("Gaming", "gamecontroller.fill", FBColor.brandBlue),
            ("Dating", "heart.fill", FBColor.reelsPink),
            ("Fundraisers", "hand.raised.fill", FBColor.feelingYellow),
            ("Ads Manager", "megaphone.fill", FBColor.brandBlue),
            ("Avatars", "face.smiling.fill", FBColor.savedPurple),
            ("Climate Science Center", "leaf.fill", FBColor.online)
        ]
        return entries.map { entry in
            MenuTileItem(id: entry.0, title: entry.0, symbol: entry.1, color: entry.2) {
                router.push(.comingSoon(title: entry.0, symbol: entry.1))
            }
        }
    }

    private var visibleTiles: [MenuTileItem] {
        showMore ? primaryTiles + extraTiles : primaryTiles
    }

    private var tileGrid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
            spacing: 10
        ) {
            ForEach(visibleTiles) { item in
                MenuTile(item: item)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
        .padding(.horizontal, 12)
        .animation(.easeInOut(duration: 0.25), value: showMore)
    }

    private var seeMoreButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.25)) { showMore.toggle() }
        } label: {
            Text(showMore ? "See less" : "See more")
        }
        .buttonStyle(.fb(.secondary, expand: true, height: 40))
        .padding(.horizontal, 12)
    }

    // MARK: Sections

    private var helpSection: some View {
        MenuCollapsibleSection(title: "Help & support", symbol: "questionmark.circle.fill") {
            MenuLinkRow(title: "Help Center", symbol: "questionmark.circle") {
                router.push(.comingSoon(title: "Help Center", symbol: "questionmark.circle.fill"))
            }
            MenuLinkRow(title: "Support inbox", symbol: "tray.full") {
                router.push(.comingSoon(title: "Support inbox", symbol: "tray.full.fill"))
            }
            MenuLinkRow(title: "Report a problem", symbol: "exclamationmark.bubble") {
                store.showToast("Thanks, we'll look into it", symbol: "checkmark.circle.fill")
            }
        }
        .padding(.horizontal, 12)
    }

    private var settingsSection: some View {
        MenuCollapsibleSection(title: "Settings & privacy", symbol: "gearshape.fill") {
            MenuLinkRow(title: "Settings", symbol: "gearshape") {
                router.push(.settings)
            }
            MenuLinkRow(title: "Privacy Checkup", symbol: "lock.shield") {
                router.push(.comingSoon(title: "Privacy Checkup", symbol: "lock.shield.fill"))
            }
            MenuLinkRow(title: "Dark mode", symbol: "moon.fill") {
                showDarkMode = true
            }
            MenuLinkRow(title: "Language", symbol: "globe") {
                router.push(.comingSoon(title: "Language", symbol: "globe"))
            }
            MenuLinkRow(title: "Your time on Facebook", symbol: "clock") {
                router.push(.settings)
            }
        }
        .padding(.horizontal, 12)
    }

    private var logOutButton: some View {
        Button {
            Haptics.warning()
            showLogOut = true
        } label: {
            Text("Log out")
        }
        .buttonStyle(.fb(.secondary, expand: true, height: 40))
        .padding(.horizontal, 12)
    }
}

#Preview {
    NavigationStack { MenuView() }.previewEnvironment()
}
