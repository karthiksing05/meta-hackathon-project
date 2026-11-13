import SwiftUI
import UIKit

/// The six tabs plus Facebook's bottom tab bar. Every tab stays alive so scroll
/// position and navigation survive tab switches. Also hosts the app-wide covers.
struct MainTabView: View {
    @Environment(AppStore.self) private var store
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    /// The keyboard covers the tab bar in the real app, so hide it while typing.
    @State private var isKeyboardVisible = false

    var body: some View {
        @Bindable var router = router

        ZStack {
            ForEach(AppTab.tabBarTabs) { tab in
                TabRootContainer(tab: tab)
                    .opacity(router.selectedTab == tab ? 1 : 0)
                    .allowsHitTesting(router.selectedTab == tab)
                    .accessibilityHidden(router.selectedTab != tab)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !isKeyboardVisible {
                VStack(spacing: 0) {
                    // Minimized game builds, like a mini-player (GameBuildDock).
                    GameBuildDock()
                    FBTabBar()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            // Only a text field in the tabs themselves (search, a post's comment box) hides the
            // tab bar. A keyboard in a sheet or cover leaves the tab bar, and so the size of every
            // tab's scroll view underneath, alone.
            let isCovered = MainTabView.isPresentingOverTabs
            FBScrollLog.home.log("keyboard will show (sheet or cover up: \(isCovered))")
            guard !isCovered else { return }
            isKeyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            if isKeyboardVisible {
                FBScrollLog.home.log("keyboard will hide")
            }
            isKeyboardVisible = false
        }
        #if DEBUG
        .onChange(of: router.selectedTab) { oldTab, newTab in
            FBScrollLog.home.log("tab \(oldTab.rawValue) -> \(newTab.rawValue)")
        }
        #endif
        .fullScreenCover(isPresented: $router.isMessengerPresented) {
            MessengerContainer()
        }
        .fullScreenCover(item: $router.createPostRequest) { request in
            CreatePostView(request: request)
        }
        .fullScreenCover(isPresented: $router.isCreateStoryPresented) {
            CreateStoryView()
        }
        .fullScreenCover(item: $router.reelsRequest) { request in
            ReelsView(startReelID: request.startReelID)
        }
        .fullScreenCover(item: $router.bubblePlayRequest) { request in
            BubblePlayerView(request: request)
        }
        .fullScreenCover(item: $router.studioLaunch) { launch in
            StudioView(launch: launch)
        }
        .sheet(isPresented: $router.isCreateMenuPresented) {
            CreateMenuSheet()
        }
        .sheet(item: $router.bubbleSheet) { route in
            BubbleFeatureRouter.sheet(route)
        }
        .onAppear {
            store.imagePrefetcher = { urls in
                ImageLoader.shared.prefetch(urls)
            }
        }
        .task {
            // DEBUG-only: FB_TAB / FB_OPEN launch routing for screenshots.
            try? await Task.sleep(nanoseconds: 300_000_000)
            DebugLaunch.apply(router: router, appStore: store, bubbleStore: bubbleStore)
        }
    }

    /// True while a sheet or full-screen cover is presented over the tabs.
    private static var isPresentingOverTabs: Bool {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .contains { $0.isKeyWindow && $0.rootViewController?.presentedViewController != nil }
    }
}

private struct TabRootContainer: View {
    let tab: AppTab
    @Environment(Router.self) private var router

    var body: some View {
        NavigationStack(path: router.path(for: tab)) {
            root
                .appDestinations()
        }
        // Feed videos pause when their own tab isn't the one on screen.
        .environment(\.postOwningTab, tab)
    }

    @ViewBuilder
    private var root: some View {
        switch tab {
        case .home:
            HomeView()
        case .video:
            VideoTabView()
        case .bubbles:
            BubblesTabView()
        case .friends:
            FriendsView()
        case .marketplace:
            MarketplaceView()
        case .notifications:
            NotificationsView()
        case .menu:
            MenuView()
        }
    }
}

/// Messenger lives in its own full-screen stack, like the real app.
private struct MessengerContainer: View {
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.messengerPath) {
            ChatsListView()
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    GameBuildDock()
                }
                .appDestinations()
        }
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 24)
        }
    }
}

struct FBTabBar: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.tabBarTabs) { tab in
                Button {
                    if router.selectedTab != tab {
                        Haptics.selection()
                    }
                    router.select(tab)
                } label: {
                    FBTabBarItem(
                        tab: tab,
                        isSelected: router.selectedTab == tab,
                        badge: badge(for: tab),
                        me: store.me
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(router.selectedTab == tab ? .isSelected : [])
            }
        }
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background {
            FBColor.surface
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            HairlineDivider()
        }
    }

    private func badge(for tab: AppTab) -> Int {
        switch tab {
        case .notifications:
            return store.notifications.filter { !$0.kind.isBubble && !$0.isRead }.count + GameNotificationInbox.shared.unreadCount
        case .friends:
            return store.friendRequests.count
        default:
            return 0
        }
    }
}

private struct FBTabBarItem: View {
    let tab: AppTab
    let isSelected: Bool
    let badge: Int
    let me: User

    var body: some View {
        VStack(spacing: 3) {
            icon
                .frame(height: 26)
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        BadgeCount(count: badge)
                            .offset(x: 12, y: -6)
                    }
                }
            Text(tab.title)
                .font(.system(size: 10, weight: isSelected ? .semibold : .regular)) // Display text: fixed tab-bar label
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var icon: some View {
        if tab == .menu {
            AvatarView(user: me, size: 26)
                .overlay {
                    if isSelected {
                        Circle()
                            .stroke(FBColor.brandBlue, lineWidth: 2)
                            .frame(width: 30, height: 30)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 7, weight: .bold)) // Tiny badge glyph
                        .foregroundStyle(FBColor.primaryText)
                        .frame(width: 13, height: 13)
                        .background(FBColor.buttonGray, in: Circle())
                        .overlay {
                            Circle().stroke(FBColor.surface, lineWidth: 1.5)
                        }
                        .offset(x: 3, y: 3)
                }
        } else {
            Image(systemName: isSelected ? tab.selectedSymbol : tab.symbol)
                .font(.system(size: FBIconSize.xl, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.secondaryText)
                .symbolEffect(.bounce, value: isSelected)
        }
    }
}
