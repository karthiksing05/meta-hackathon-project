import SwiftUI

/// The Home tab root: Facebook's header, the composer, the stories tray and the
/// infinite feed with Reels, People You May Know and Suggested Groups mixed in.
struct HomeView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var storyPresentation: HomeStoryPresentation?
    @State private var isScrolledDown = false
    @State private var showsNewPostsPill = false

    static let topAnchorID = "home.top"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    HomeHeader()
                        .id(HomeView.topAnchorID)
                        .background {
                            HomeScrollTracker(isScrolledDown: $isScrolledDown)
                        }
                    ComposerBar()
                    FeedSeparator()
                    HomeStoriesTray { stories, index in
                        openStories(stories, startIndex: index)
                    }
                    FeedSeparator()
                    birthdaySection
                    feed
                }
            }
            .background(FBColor.surface)
            .refreshable {
                await store.refreshFeed()
            }
            .overlay(alignment: .top) {
                newPostsPill(proxy: proxy)
            }
            .onChange(of: router.scrollToTopSignal(for: .home)) {
                scrollToTop(proxy)
            }
            .onChange(of: store.feedPosts.first?.id) {
                handleNewTopPost(proxy)
            }
            .onChange(of: isScrolledDown) { _, scrolled in
                guard !scrolled, showsNewPostsPill else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    showsNewPostsPill = false
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HomeStatusBarBackdrop()
        }
        .toolbar(.hidden, for: .navigationBar)
        .fullScreenCover(item: $storyPresentation) { presentation in
            StoryViewer(stories: presentation.stories, startIndex: presentation.startIndex)
        }
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
    private var feed: some View {
        if store.isFeedLoading {
            ForEach(0..<3, id: \.self) { _ in
                PostSkeletonView()
                FeedSeparator()
            }
        } else if store.feedPosts.isEmpty {
            ContentUnavailableView(
                "No posts to show",
                systemImage: "newspaper",
                description: Text("Posts from friends, groups and Pages you follow will show up here.")
            )
            .padding(.vertical, 48)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(Array(store.feedPosts.enumerated()), id: \.element.id) { index, post in
                    HomeFeedRow(post: post, position: index)
                }
                if store.isLoadingMoreFeed {
                    PostSkeletonView()
                }
            }
        }
    }

    @ViewBuilder
    private func newPostsPill(proxy: ScrollViewProxy) -> some View {
        if showsNewPostsPill {
            Button {
                Haptics.light()
                scrollToTop(proxy)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                    Text("New posts")
                        .font(.system(size: 15, weight: .semibold))
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

    private func scrollToTop(_ proxy: ScrollViewProxy) {
        withAnimation(.easeInOut(duration: 0.35)) {
            proxy.scrollTo(HomeView.topAnchorID, anchor: .top)
        }
        if showsNewPostsPill {
            withAnimation(.easeOut(duration: 0.2)) {
                showsNewPostsPill = false
            }
        }
    }

    /// New posts landed on top of the feed: jump up to show my own upload,
    /// or offer the "New posts" pill when someone else's arrive while scrolled down.
    private func handleNewTopPost(_ proxy: ScrollViewProxy) {
        guard let first = store.feedPosts.first else { return }
        if first.author.isMe {
            if first.isUploading {
                scrollToTop(proxy)
            }
        } else if isScrolledDown {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                showsNewPostsPill = true
            }
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

// MARK: - Helpers

/// Reports whether the header has scrolled well out of view.
private struct HomeScrollTracker: View {
    @Binding var isScrolledDown: Bool

    var body: some View {
        GeometryReader { proxy in
            Color.clear
                .onChange(of: proxy.frame(in: .global).minY < -320) { _, scrolled in
                    if isScrolledDown != scrolled {
                        isScrolledDown = scrolled
                    }
                }
        }
    }
}

/// Paints the status bar area so feed content doesn't scroll visibly behind the clock.
private struct HomeStatusBarBackdrop: View {
    var body: some View {
        Color.clear
            .frame(height: 0)
            .background(FBColor.surface.ignoresSafeArea(edges: .top))
            .allowsHitTesting(false)
    }
}

#Preview {
    NavigationStack {
        HomeView()
    }
    .previewEnvironment()
}
