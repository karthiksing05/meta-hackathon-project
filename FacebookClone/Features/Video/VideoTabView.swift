import SwiftUI

/// The Video tab: header, filter chips, a Reels tray and a feed of long-form videos.
/// Only the card nearest the middle of the screen plays (muted), and nothing plays while
/// the tab is hidden, something covers it, or autoplay is turned off in Settings.
struct VideoTabView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @AppStorage(SettingsKey.autoplayVideos) private var autoplayVideos = true

    @State private var selectedChip: VideoFeedChip = .forYou
    @State private var tracker = VideoPlaybackTracker()
    /// With autoplay off, the card whose play button was tapped.
    @State private var manualPlayID: String?
    /// Post ids in pull-to-refresh order. Empty means the store's order.
    @State private var shuffledOrder: [String] = []
    @State private var hiddenIDs: Set<String> = []
    @State private var sheetRoute: VideoSheetRoute?
    @State private var fullScreenItem: VideoFullScreenItem?
    /// Players load only once the tab has been opened.
    @State private var hasActivated = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    header
                        .id(VideoFeedLayout.topAnchor)
                    chipsRow
                    FeedSeparator()
                    feedBody
                }
            }
            .coordinateSpace(.named(VideoFeedLayout.scrollSpace))
            .background {
                VideoViewportReader(tracker: tracker)
            }
            .background(FBColor.surface)
            .refreshable {
                await refresh()
            }
            .onChange(of: router.scrollToTopSignal(for: .video)) {
                withAnimation(.easeInOut(duration: 0.3)) {
                    proxy.scrollTo(VideoFeedLayout.topAnchor, anchor: .top)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            if router.selectedTab == .video {
                hasActivated = true
            }
        }
        .onChange(of: router.selectedTab) { _, tab in
            if tab == .video {
                hasActivated = true
            }
        }
        .onChange(of: tracker.activeID) { _, newID in
            // Scrolling another video into the middle stops a manually started one.
            if let playing = manualPlayID, playing != newID {
                manualPlayID = nil
            }
        }
        .sheet(item: $sheetRoute) { route in
            VideoSheetContent(route: route)
        }
        .fullScreenCover(item: $fullScreenItem) { item in
            VideoFullScreenPlayer(post: item.post, startTime: item.startTime)
        }
    }

    // MARK: Header and chips

    private var header: some View {
        TabHeader("Video") {
            CircleButton(symbol: "person.fill", accessibilityLabel: "Your profile") {
                router.push(.profile(store.me))
            }
            CircleButton(symbol: "magnifyingglass", accessibilityLabel: "Search videos") {
                router.push(.search(""))
            }
        }
        .background(FBColor.surface)
    }

    private var chipsRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(VideoFeedChip.allCases) { chip in
                    ChipView(title: chip.title, symbol: chip.symbol, isSelected: chip == selectedChip) {
                        select(chip)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
        .scrollIndicators(.hidden)
        .background(FBColor.surface)
    }

    private func select(_ chip: VideoFeedChip) {
        Haptics.selection()
        if chip == .reels {
            router.openReels()
            return
        }
        selectedChip = chip
    }

    // MARK: Feed

    @ViewBuilder
    private var feedBody: some View {
        if store.isFeedLoading {
            ForEach(0..<2, id: \.self) { _ in
                PostSkeletonView()
                FeedSeparator()
            }
        } else {
            let videos = feedVideos
            let liveIDs = store.videoLiveIDs
            if videos.isEmpty {
                emptyState
            } else {
                ForEach(Array(videos.enumerated()), id: \.element.id) { index, post in
                    feedRow(post, isLive: liveIDs.contains(post.id))
                    FeedSeparator()
                    if index == 0 && showsReelsTray {
                        VideoReelsCarousel(reels: store.reels) { reel in
                            router.openReels(startingAt: reel)
                        }
                        FeedSeparator()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func feedRow(_ post: Post, isLive: Bool) -> some View {
        if hiddenIDs.contains(post.id) {
            VideoHiddenRow {
                withAnimation(.easeInOut(duration: 0.2)) {
                    _ = hiddenIDs.remove(post.id)
                }
            }
        } else {
            let isCurrent = post.id == currentPlaybackID
            VideoFeedCard(
                post: post,
                isCurrent: isCurrent,
                isPlaying: isCurrent && playbackAllowed,
                isLive: isLive,
                autoplayEnabled: autoplayVideos,
                tracker: tracker,
                onPlay: { manualPlayID = post.id },
                onOpenFullScreen: { start in
                    fullScreenItem = VideoFullScreenItem(post: post, startTime: start)
                },
                onComment: { sheetRoute = .comments(post) },
                onShare: { sheetRoute = .share(post) },
                onHide: {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        _ = hiddenIDs.insert(post.id)
                    }
                }
            )
        }
    }

    private var showsReelsTray: Bool {
        selectedChip == .forYou && !store.reels.isEmpty
    }

    /// Store order, or the shuffled order after a pull to refresh.
    private var orderedVideos: [Post] {
        let videos = store.watchVideos.filter { !$0.isHidden }
        guard !shuffledOrder.isEmpty else { return videos }
        var rank: [String: Int] = [:]
        for (index, id) in shuffledOrder.enumerated() {
            rank[id] = index
        }
        return videos.sorted { lhs, rhs in
            (rank[lhs.id] ?? Int.max) < (rank[rhs.id] ?? Int.max)
        }
    }

    private var feedVideos: [Post] {
        let videos = orderedVideos
        switch selectedChip {
        case .forYou, .reels:
            return videos
        case .live:
            let live = store.videoLiveIDs
            return videos.filter { live.contains($0.id) }
        case .following:
            return videos.filter { store.videoIsFromFollowed($0) }
        case .saved:
            return videos.filter { $0.isSaved }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        ContentUnavailableView {
            Label(emptyTitle, systemImage: emptySymbol)
        } description: {
            Text(emptyMessage)
        } actions: {
            if selectedChip != .forYou {
                Button("Browse videos") {
                    selectedChip = .forYou
                }
                .buttonStyle(.fb(.primary, expand: false))
            }
        }
        .padding(.vertical, 48)
    }

    private var emptyTitle: String {
        switch selectedChip {
        case .forYou, .reels: return "No videos yet"
        case .live: return "No one is live right now"
        case .following: return "No videos from people you follow"
        case .saved: return "No saved videos"
        }
    }

    private var emptySymbol: String {
        switch selectedChip {
        case .forYou, .reels: return "play.rectangle"
        case .live: return "dot.radiowaves.left.and.right"
        case .following: return "person.2"
        case .saved: return "bookmark"
        }
    }

    private var emptyMessage: String {
        switch selectedChip {
        case .forYou, .reels: return "Pull down to check for new videos."
        case .live: return "Live videos from Pages and people you follow show up here."
        case .following: return "Follow Pages and creators to see their videos here."
        case .saved: return "Save videos from the \"...\" menu to watch them later."
        }
    }

    // MARK: Playback

    /// The card that owns playback: the most centered one, or the tapped one when autoplay is off.
    private var currentPlaybackID: String? {
        guard hasActivated else { return nil }
        return autoplayVideos ? tracker.activeID : manualPlayID
    }

    /// False whenever the feed isn't what the user is looking at.
    private var playbackAllowed: Bool {
        let isAtRoot = router.paths[.video]?.isEmpty ?? true
        let isOnScreen = router.selectedTab == .video && isAtRoot
        let appCoverShown = router.isMessengerPresented
            || router.reelsRequest != nil
            || router.createPostRequest != nil
            || router.isCreateStoryPresented
            || router.isCreateMenuPresented
        let localCoverShown = sheetRoute != nil || fullScreenItem != nil
        return isOnScreen && !appCoverShown && !localCoverShown
    }

    private func refresh() async {
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        withAnimation(.easeInOut(duration: 0.25)) {
            shuffledOrder = store.watchVideos.map { $0.id }.shuffled()
        }
    }
}

// MARK: - Reels tray

/// The horizontal "Reels" tray between feed videos.
struct VideoReelsCarousel: View {
    let reels: [Post]
    /// Opens Reels at the tapped reel, or at the start for "See all".
    let onOpen: (Post?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "film")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.reelsPink)
                Text("Reels")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button {
                    onOpen(nil)
                } label: {
                    Text("See all")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, FBMetrics.gutter)

            ScrollView(.horizontal) {
                LazyHStack(spacing: 8) {
                    ForEach(reels) { reel in
                        Button {
                            onOpen(reel)
                        } label: {
                            VideoReelCard(reel: reel)
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(.horizontal, FBMetrics.gutter)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.vertical, 12)
        .background(FBColor.surface)
    }
}

/// A 9:16 reel card: poster, author, caption and play count.
private struct VideoReelCard: View {
    let reel: Post

    private let width: CGFloat = 112

    var body: some View {
        RemoteImage(url: reel.media.first?.url)
            .frame(width: width, height: width * 16 / 9)
            .overlay {
                LinearGradient(
                    colors: [Color.black.opacity(0.25), Color.clear, Color.black.opacity(0.7)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .overlay(alignment: .topLeading) {
                AvatarView(user: reel.author, size: FBAvatarSize.reply)
                    .overlay {
                        Circle().stroke(FBColor.brandBlue, lineWidth: 2)
                    }
                    .padding(8)
            }
            .overlay(alignment: .bottomLeading) {
                info
            }
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Reel by \(reel.author.name), \(reel.viewCount.fbCompact) plays")
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !reel.text.isEmpty {
                Text(reel.text)
                    .font(.fbCaptionEmphasized)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            HStack(spacing: 3) {
                Image(systemName: "play.fill")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                Text(reel.viewCount.fbCompact)
                    .font(.fbCaptionEmphasized)
            }
        }
        .foregroundStyle(Color.white)
        .shadow(color: Color.black.opacity(0.45), radius: 2, y: 1)
        .padding(8)
    }
}

/// Shown in place of a video the user hid, with Undo.
private struct VideoHiddenRow: View {
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "eye.slash.fill")
                .font(.system(size: FBIconSize.regular))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 36, height: 36)
                .background(FBColor.buttonGray, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Video hidden")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text("You'll see fewer videos like this.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 8)
            Button("Undo", action: onUndo)
                .buttonStyle(.fb(.secondary, expand: false, height: 32))
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.vertical, 14)
        .background(FBColor.surface)
    }
}

#Preview {
    NavigationStack {
        VideoTabView()
    }
    .previewEnvironment()
}
