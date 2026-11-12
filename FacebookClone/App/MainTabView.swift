import SwiftUI
import UIKit

/// The six tabs plus Facebook's bottom tab bar. Every tab stays alive so scroll
/// position and navigation survive tab switches. Also hosts the app-wide covers.
struct MainTabView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    /// The keyboard covers the tab bar in the real app, so hide it while typing.
    @State private var isKeyboardVisible = false

    var body: some View {
        @Bindable var router = router

        ZStack {
            ForEach(AppTab.allCases) { tab in
                TabRootContainer(tab: tab)
                    .opacity(router.selectedTab == tab ? 1 : 0)
                    .allowsHitTesting(router.selectedTab == tab)
                    .accessibilityHidden(router.selectedTab != tab)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !isKeyboardVisible {
                FBTabBar()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            isKeyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            isKeyboardVisible = false
        }
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
        .sheet(isPresented: $router.isCreateMenuPresented) {
            CreateMenuSheet()
        }
        .onAppear {
            store.imagePrefetcher = { urls in
                ImageLoader.shared.prefetch(urls)
            }
        }
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
    }

    @ViewBuilder
    private var root: some View {
        switch tab {
        case .home:
            HomeView()
        case .video:
            VideoTabView()
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
            ForEach(AppTab.allCases) { tab in
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
            return store.unreadNotificationCount
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
                .font(.system(size: 10, weight: isSelected ? .semibold : .regular))
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
                        .font(.system(size: 7, weight: .bold))
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
                .font(.system(size: 22, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.secondaryText)
                .symbolEffect(.bounce, value: isSelected)
        }
    }
}
