import SwiftUI

/// The Home tab root: Facebook's header, the composer, the stories tray and the
/// infinite feed with Reels, People You May Know and Suggested Groups mixed in.
///
/// Scrolling rules that keep the feed still under the reader's thumb on every iOS version:
/// - Only three things move the feed in code: tapping Home again, tapping "New posts", and my
///   own post starting to upload. All of them go through `scrollToTop(_:reason:)`.
/// - Posts that land on top while the feed is scrolled away from the top wait behind the
///   "New posts" pill and appear once the header is back on screen, so nothing above the post
///   being read changes height.
/// - Whether the feed is at the top is read from the scroll view itself
///   (`onScrollGeometryChange`, iOS 18 and later), and only crossing the top writes state.
///
/// DEBUG: `FB_HOME_AUTOSCROLL_LOG=1` logs every scroll the user didn't make (`FBScrollLog`).
/// `FB_HOME_SCRIPT` drives the feed without touches for simulator checks, as comma-separated
/// `seconds:action` steps: `scroll=<post index>`, `arrive` (fresh posts land on top), `pill`,
/// `top` (tap Home again), `tab=<tab>` and `post` (publish my own post),
/// e.g. `2:scroll=6,5:arrive,12:pill`.
struct HomeView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var storyPresentation: HomeStoryPresentation?
    /// The header is fully on screen (or the feed is being pulled to refresh).
    @State private var isAtTop = true
    @State private var showsNewPostsPill = false
    /// The posts on the feed when it left the top. Posts that land on top after that aren't
    /// rendered until the feed is back at the top (see `waitingCount(in:)`).
    @State private var idsWhenLeftTop: Set<String>?

    static let topAnchorID = "home.top"
    static let scrollSpace = "home.scroll"

    var body: some View {
        let feed = store.feedPosts
        ScrollViewReader { proxy in
            feedScrollView(feed: feed, proxy: proxy)
        }
        .fbStatusBarBackdrop()
        .toolbar(.hidden, for: .navigationBar)
        .fullScreenCover(item: $storyPresentation) { presentation in
            StoryViewer(stories: presentation.stories, startIndex: presentation.startIndex)
        }
    }

    private func feedScrollView(feed: [Post], proxy: ScrollViewProxy) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                HomeHeader()
                    .id(HomeView.topAnchorID)
                    .background {
                        HomeScrollProbes(isAtTop: $isAtTop)
                    }
                ComposerBar()
                FeedSeparator()
                HomeStoriesTray { stories, index in
                    openStories(stories, startIndex: index)
                }
                FeedSeparator()
                birthdaySection
                feedSection(shownPosts(in: feed))
            }
        }
        .coordinateSpace(.named(HomeView.scrollSpace))
        .homeTracksTop($isAtTop)
        .background(FBColor.surface)
        .refreshable {
            await store.refreshFeed()
        }
        .overlay(alignment: .top) {
            newPostsPill(proxy: proxy)
        }
        .onChange(of: router.scrollToTopSignal(for: .home)) {
            scrollToTop(proxy, reason: "Home tapped again")
        }
        .onChange(of: feed.map(\.id)) { oldIDs, newIDs in
            handleFeedChange(from: oldIDs, to: newIDs, proxy: proxy)
        }
        .onChange(of: isAtTop) { _, atTop in
            handleTopChange(atTop)
        }
        #if DEBUG
        .modifier(HomeDebugLogging())
        .task {
            await runDebugScript(proxy)
        }
        #endif
    }

    // MARK: Sections

    @ViewBuilder
    private var birthdaySection: some View {
        let people = store.birthdaysToday
        if !people.isEmpty && !store.isFeedLoading {
            HomeBirthdayCard(people: people)
            FeedSeparator()
        }
    }

    @ViewBuilder
    private func feedSection(_ posts: [Post]) -> some View {
        if store.isFeedLoading {
            ForEach(0..<3, id: \.self) { _ in
                PostSkeletonView()
                FeedSeparator()
            }
        } else if posts.isEmpty {
            ContentUnavailableView(
                "No posts to show",
                systemImage: "newspaper",
                description: Text("Posts from friends, groups and Pages you follow will show up here.")
            )
            .padding(.vertical, 48)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(Array(posts.enumerated()), id: \.element.id) { index, post in
                    HomeFeedRow(post: post, position: index)
                }
                if store.isLoadingMoreFeed {
                    PostSkeletonView()
                }
            }
        }
    }

    /// The feed minus the posts waiting behind the pill.
    private func shownPosts(in feed: [Post]) -> [Post] {
        let waiting = waitingCount(in: feed)
        return waiting == 0 ? feed : Array(feed.dropFirst(waiting))
    }

    /// Posts that landed on top since the feed left the top: the leading run of posts it hadn't
    /// seen then. Worked out here in `body`, not in an `onChange`, so they never render above
    /// the reader, not even for one frame (SwiftUI would shift the scroll offset to make room).
    private func waitingCount(in feed: [Post]) -> Int {
        guard let known = idsWhenLeftTop else { return 0 }
        let count = feed.prefix(while: { !known.contains($0.id) }).count
        return count == feed.count ? 0 : count
    }

    @ViewBuilder
    private func newPostsPill(proxy: ScrollViewProxy) -> some View {
        if showsNewPostsPill {
            Button {
                Haptics.light()
                tapNewPostsPill(proxy)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: FBIconSize.small, weight: .bold))
                    Text("New posts")
                        .font(.fbButton)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(FBColor.brandBlue, in: Capsule())
                .shadow(color: Color.black.opacity(0.22), radius: 8, y: 3)
            }
            .buttonStyle(.pressable)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityLabel("New posts")
            .accessibilityHint("Scrolls to the top of your feed")
        }
    }

    // MARK: Actions

    private func openStories(_ stories: [Story], startIndex: Int) {
        guard !stories.isEmpty else { return }
        Haptics.light()
        storyPresentation = HomeStoryPresentation(stories: stories, startIndex: startIndex)
    }

    private func tapNewPostsPill(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            showsNewPostsPill = false
        }
        // The waiting posts appear when the header is back on screen (`handleTopChange`).
        scrollToTop(proxy, reason: "New posts pill")
    }

    /// The only way the feed scrolls in code.
    private func scrollToTop(_ proxy: ScrollViewProxy, reason: String) {
        FBScrollLog.home.log("scroll to top: \(reason) (at top: \(isAtTop))")
        withAnimation(.easeInOut(duration: 0.35)) {
            proxy.scrollTo(HomeView.topAnchorID, anchor: .top)
        }
    }

    /// Posts landed on top: pull to refresh, my own post or share, a floated Bubble. While I'm
    /// further down they already wait (`waitingCount(in:)`); here someone else's offer the pill,
    /// and my own post that's uploading takes me up to it.
    private func handleFeedChange(from oldIDs: [String], to newIDs: [String], proxy: ScrollViewProxy) {
        let known = Set(oldIDs)
        let arrivals = newIDs.prefix(while: { !known.contains($0) })
        FBScrollLog.home.log("feed \(oldIDs.count) -> \(newIDs.count) posts, \(arrivals.count) new on top, \(waitingCount(in: store.feedPosts)) waiting, at top: \(isAtTop)")
        guard !oldIDs.isEmpty, !arrivals.isEmpty else { return }

        let arrived = arrivals.compactMap { store.post(id: $0) }
        if arrived.contains(where: { $0.author.isMe && $0.isUploading }) {
            scrollToTop(proxy, reason: "my new post")
        } else if !isAtTop, !showsNewPostsPill, arrived.contains(where: { !$0.author.isMe }) {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                showsNewPostsPill = true
            }
        }
    }

    /// Leaving the top remembers which posts were there; coming back shows what arrived since.
    private func handleTopChange(_ atTop: Bool) {
        if atTop {
            let waiting = waitingCount(in: store.feedPosts)
            FBScrollLog.home.log("feed is at the top, showing \(waiting) waiting posts")
            idsWhenLeftTop = nil
            if showsNewPostsPill {
                withAnimation(.easeOut(duration: 0.2)) {
                    showsNewPostsPill = false
                }
            }
        } else {
            FBScrollLog.home.log("feed left the top")
            idsWhenLeftTop = Set(store.feedPosts.map(\.id))
        }
    }
}

/// What the story viewer opens with. A snapshot of the tray so paging follows its order.
struct HomeStoryPresentation: Identifiable {
    let id = UUID()
    let stories: [Story]
    let startIndex: Int
}

// MARK: - Header

/// "facebook" wordmark with the create, search and Messenger buttons. Scrolls with the feed.
struct HomeHeader: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        HStack(spacing: 8) {
            FacebookWordmark()
            Spacer(minLength: 8)
            CircleButton(symbol: "plus", accessibilityLabel: "Create", action: {
                Haptics.light()
                router.isCreateMenuPresented = true
            })
            CircleButton(symbol: "magnifyingglass", accessibilityLabel: "Search", action: {
                router.push(.search(""))
            })
            CircleButton(badge: store.unreadChatsCount, accessibilityLabel: "Messenger", action: {
                router.openMessenger()
            }) {
                MessengerGlyph(size: 18)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .padding(.vertical, 6)
        .background(FBColor.surface)
    }
}

// MARK: - Feed row

/// One post plus the module that follows it at fixed positions, like the real feed.
private struct HomeFeedRow: View {
    let post: Post
    let position: Int

    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(spacing: 0) {
            PostCard(post: post)
                .onAppear {
                    store.loadMoreFeedIfNeeded(currentPost: post)
                }
            FeedSeparator()
            module
        }
    }

    @ViewBuilder
    private var module: some View {
        switch position {
        case 2:
            HomeReelsTray()
        case 5:
            HomePeopleYouMayKnow()
        case 9:
            HomeSuggestedGroups()
        default:
            EmptyView()
        }
    }
}

// MARK: - Scroll tracking

private enum HomeScrollMetrics {
    /// How far the feed can move and still count as "at the top".
    static let topTolerance: CGFloat = 12
}

private extension View {
    /// iOS 18 and later: whether the feed rests at the top, read from the scroll view itself
    /// rather than from a geometry reader in the content.
    @ViewBuilder
    func homeTracksTop(_ isAtTop: Binding<Bool>) -> some View {
        if #available(iOS 18, *) {
            onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top < HomeScrollMetrics.topTolerance
            } action: { _, atTop in
                if isAtTop.wrappedValue != atTop {
                    isAtTop.wrappedValue = atTop
                }
            }
        } else {
            self
        }
    }
}

/// Behind the header: on iOS 17 the geometry reader that tells whether the feed is at the top
/// (iOS 18 reads the scroll view directly), and in DEBUG with logging on, the scroll probe.
private struct HomeScrollProbes: View {
    @Binding var isAtTop: Bool

    var body: some View {
        ZStack {
            if #available(iOS 18, *) {
                Color.clear
            } else {
                HomeLegacyTopTracker(isAtTop: $isAtTop)
            }
            #if DEBUG
            if FBScrollLog.home.isEnabled {
                FBScrollProbe(log: .home)
            }
            #endif
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// iOS 17: reads the header's position in the scroll view's coordinate space.
private struct HomeLegacyTopTracker: View {
    @Binding var isAtTop: Bool

    var body: some View {
        GeometryReader { proxy in
            Color.clear
                .onChange(of: proxy.frame(in: .named(HomeView.scrollSpace)).minY > -HomeScrollMetrics.topTolerance) { _, atTop in
                    if isAtTop != atTop {
                        isAtTop = atTop
                    }
                }
        }
    }
}

// MARK: - Debug

#if DEBUG
/// With `FB_HOME_AUTOSCROLL_LOG=1`: SwiftUI's scroll phases and insets, plus the ambient activity
/// that changes what's on screen (notifications, stories, chats). Reads nothing when it's off.
private struct HomeDebugLogging: ViewModifier {
    func body(content: Content) -> some View {
        if FBScrollLog.home.isEnabled {
            content.modifier(HomeDebugLoggingActive())
        } else {
            content
        }
    }
}

private struct HomeDebugLoggingActive: ViewModifier {
    @Environment(AppStore.self) private var store

    func body(content: Content) -> some View {
        phases(content)
            .onChange(of: store.notifications.count) { oldCount, newCount in
                FBScrollLog.home.log("ambient: notifications \(oldCount) -> \(newCount)")
            }
            .onChange(of: store.storiesForTray.map(\.id)) {
                FBScrollLog.home.log("ambient: stories tray order changed")
            }
            .onChange(of: store.unreadChatsCount) { oldCount, newCount in
                FBScrollLog.home.log("ambient: unread chats \(oldCount) -> \(newCount)")
            }
    }

    @ViewBuilder
    private func phases(_ content: Content) -> some View {
        if #available(iOS 18, *) {
            content
                .onScrollPhaseChange { oldPhase, newPhase in
                    FBScrollLog.home.log("scroll phase \(oldPhase) -> \(newPhase)")
                }
                .onScrollGeometryChange(for: EdgeInsets.self) { geometry in
                    geometry.contentInsets
                } action: { _, insets in
                    FBScrollLog.home.log("SwiftUI content insets top \(insets.top) bottom \(insets.bottom)")
                }
        } else {
            content
        }
    }
}

extension HomeView {
    /// Runs `FB_HOME_SCRIPT` (see the type's documentation).
    fileprivate func runDebugScript(_ proxy: ScrollViewProxy) async {
        guard let script = DebugLaunch.value("FB_HOME_SCRIPT") else { return }
        let steps: [(seconds: Double, action: String)] = script.split(separator: ",").compactMap { step in
            let parts = step.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 2, let seconds = Double(parts[0]) else { return nil }
            return (seconds, parts[1])
        }
        let start = Date()
        for step in steps {
            let wait = step.seconds - Date().timeIntervalSince(start)
            if wait > 0 {
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            FBScrollLog.home.log("script: \(step.action)")
            runDebugAction(step.action, proxy: proxy)
        }
    }

    private func runDebugAction(_ action: String, proxy: ScrollViewProxy) {
        let parts = action.split(separator: "=", maxSplits: 1).map(String.init)
        switch parts.first ?? "" {
        case "scroll":
            let posts = shownPosts(in: store.feedPosts)
            let index = Int(parts.count > 1 ? parts[1] : "") ?? 0
            guard posts.indices.contains(index) else { return }
            proxy.scrollTo(posts[index].id, anchor: .top)
        case "arrive":
            Task { await store.refreshFeed() }
        case "pill":
            if showsNewPostsPill {
                tapNewPostsPill(proxy)
            }
        case "top":
            router.select(.home)
        case "tab":
            if let tab = AppTab(rawValue: parts.count > 1 ? parts[1] : "") {
                router.select(tab)
            }
        case "post":
            store.createPost(text: "Trying out the feed from the debug script")
        default:
            FBScrollLog.home.log("script: unknown action \(action)")
        }
    }
}
#endif

#Preview {
    NavigationStack {
        HomeView()
    }
    .previewEnvironment()
}
