import SwiftUI
import UIKit

/// The Bubbles tab: a full-screen, infinite vertical feed of Bubbles, paged like Reels.
///
/// Only the settled page runs the live runtime (a friend's Burst, or a bot demo), with sound unless
/// the app-wide game mute (`GameSound.isMuted`, the header's speaker) is on. Its neighbors show poster frames. Tap a page to take over and play it right there;
/// the result sheet follows. See `BubbleFeedModel` for the runtime side.
///
/// DEBUG launch variables (see `DebugLaunch`):
/// - `FB_FEED_INDEX=n`: start on page n.
/// - `FB_FEED_GAME=<id>`: that game (a server id or slug) is the first page.
/// - `FB_FAKE_RESULT=1`: show the result sheet for the first page without playing.
/// - `FB_FEED_TAKEOVER=1`: take over the first page as if it were tapped.
/// - `FB_FEED_PLAYER=s`: open the current page in the full-screen player, and close it s seconds later.
/// - `FB_FEED_TAKEOVER_END=s`: with `FB_FEED_TAKEOVER=1`, close the game (the X) s seconds after it starts.
/// - `FB_FEED_AUTOSCROLL=s`: move to the next page every s seconds (for timing warm switches).
/// - `FB_PERF=1`: the perf overlay (prepare, activate, switch time, fps).
struct BubblesTabView: View {
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase

    @State private var model = BubbleFeedModel()
    @State private var floatTarget: Bubble?
    @State private var didApplyDebug = false
    /// "Play again" closes the result sheet without leaving the game.
    @State private var isPlayingAgain = false
    /// Fades the pager in after a jump (scroll to top).
    @State private var pagerOpacity: Double = 1
    /// The page to come back to after you close a game (the X) or a screen over the tab closes.
    @State private var returnPageID: String?
    /// Bumped to snap the pager back onto a whole page (`realignPager`).
    @State private var realignToken = 0

    /// Header height below the status bar.
    private static let headerHeight: CGFloat = 52
    /// `FBTabBar`'s height above the home indicator. MainTabView adds the tab bar with
    /// `safeAreaInset`, which doesn't reach this view's safe area inside the NavigationStack.
    private static let tabBarHeight: CGFloat = 49

    /// How much of the bottom the tab bar covers: the home indicator plus the tab bar. Measured
    /// from the window in `updateLayout`; reading insets (the proxy's or the window's) in `body`
    /// next to the pager makes an AttributeGraph cycle.
    @State private var bottomClearance: CGFloat = 34 + tabBarHeight

    private static func windowTabBarClearance() -> CGFloat {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        let window = windows.first(where: \.isKeyWindow) ?? windows.first
        return (window?.safeAreaInsets.bottom ?? 34) + tabBarHeight
    }

    var body: some View {
        GeometryReader { geometry in
            let topInset = geometry.safeAreaInsets.top
            ZStack(alignment: .top) {
                Color.black
                pager(bottomInset: bottomClearance)
                if bubbleStore.feedItems.isEmpty {
                    feedState
                        .padding(.bottom, bottomClearance)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if model.isTakenOver {
                    BubbleFeedTakeoverBar(
                        title: liveBubble?.title ?? "",
                        score: model.liveScore,
                        onClose: model.endTakeover
                    )
                    .padding(.top, topInset)
                    .transition(.move(edge: .top).combined(with: .opacity))
                } else {
                    topScrim(height: topInset + Self.headerHeight + 40)
                    BubbleFeedHeader(isMuted: GameSound.isMuted, onToggleMute: toggleMute)
                        .frame(height: Self.headerHeight)
                        .padding(.top, topInset)
                        .transition(.opacity)
                }
                #if DEBUG
                if BubbleRuntimePerf.isEnabled {
                    BubbleFeedPerfOverlay()
                        .padding(.top, topInset + Self.headerHeight + 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 12)
                        .allowsHitTesting(false)
                }
                #endif
            }
            // Exactly the screen's width: nothing inside (an overflowing row) can widen the tab
            // and push the right side of the pages off screen.
            .frame(width: geometry.size.width)
            .clipped()
            .ignoresSafeArea(edges: [.top, .bottom])
            .onAppear {
                updateLayout(geometry)
            }
            .onChange(of: geometry.size) { _, _ in
                updateLayout(geometry)
            }
            .onChange(of: realignToken) { _, _ in
                updateLayout(geometry)
            }
        }
        .background(Color.black)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(item: resultBinding, onDismiss: resultSheetDismissed) { context in
            BubbleResultSheet(
                context: context,
                onPlayAgain: playAgain,
                onSeeBoard: openBoardFromResult,
                onNextLevel: playNextLevel
            )
        }
        .confirmationDialog(floatTitle, isPresented: floatDialogBinding, titleVisibility: .visible, presenting: floatTarget) { bubble in
            floatButtons(for: bubble)
        }
        .onAppear(perform: appear)
        .onChange(of: isVisible) { _, visible in
            if !visible {
                returnPageID = model.currentID
            }
            model.setVisible(visible)
            if visible {
                realignPager()
            }
        }
        .onChange(of: model.isTakenOver) { _, takenOver in
            if takenOver {
                returnPageID = model.currentID
            } else {
                realignPager()
            }
        }
        .onChange(of: GameSound.isMuted) { _, _ in
            model.applyMute()
        }
        .onChange(of: model.currentID) { _, id in
            model.pageDidChange(to: id)
        }
        .onChange(of: bubbleStore.feedItems.count) { _, _ in
            model.feedDidLoad()
        }
        .onChange(of: router.scrollToTopSignal(for: .bubbles)) { _, _ in
            scrollToTop()
        }
        #if DEBUG
        .task(id: isVisible) {
            await autoScrollIfRequested()
        }
        #endif
    }

    // MARK: Pager

    /// Pages run from the top of the screen to the tab bar. The tab spans the whole screen and the
    /// scroll view is padded above the tab bar, so it never scrolls under it and every page is
    /// exactly the visible height.
    private func pager(bottomInset: CGFloat) -> some View {
        @Bindable var model = model
        return ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(bubbleStore.feedItems) { item in
                        page(for: item)
                            .containerRelativeFrame([.horizontal, .vertical])
                            .id(item.id)
                    }
                }
                .scrollTargetLayout()
                .background {
                    // Pauses the live page while the pager moves and activates only the page
                    // it settles on (iOS 17 and 18; see FeedPagerScrollObserver).
                    FeedPagerScrollObserver(
                        onBegin: { byUser in model.scrollDidBegin(byUser: byUser) },
                        onSettle: { index in model.scrollDidSettle(at: index) },
                        onAttach: { pageBy in model.pageBy = pageBy },
                        lockedIndex: lockedPageIndex
                    )
                }
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(FeedPagingBehavior())
            .scrollPosition(id: $model.currentID, anchor: .top)
            .onChange(of: realignToken) { _, _ in
                // Puts the page's top back at the top, even when the pager kept the page id but
                // was left between pages.
                guard let id = model.currentID else { return }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    proxy.scrollTo(id, anchor: .top)
                }
            }
        }
        .ignoresSafeArea(edges: [.top, .bottom])
        .padding(.bottom, bottomInset)
        .opacity(pagerOpacity)
        .modifier(BubbleFeedScrollProbe())
    }

    /// While you play, the pager is held on the game's page: its pan is switched off in UIKit and
    /// any drift (the keyboard, a cover) snaps back to this page. `.scrollDisabled` isn't used:
    /// toggling it made the paged ScrollView jump to the top (offset 10 on the phone) or stop
    /// between pages when the game ended. With the result card up, the feed scrolls again (one
    /// swipe moves on); a clearly vertical swipe on a tap-only game also pages (`swipeWhilePlaying`).
    private var lockedPageIndex: Int? {
        guard model.isTakenOver, model.result == nil, let live = model.liveItemID else { return nil }
        return bubbleStore.feedItems.firstIndex { $0.id == live }
    }

    @ViewBuilder
    private func page(for item: BubbleFeedItem) -> some View {
        if let bubble = bubbleStore.bubble(id: item.bubbleID) {
            BubbleFeedPage(
                item: item,
                bubble: bubble,
                model: model,
                actions: pageActions
            )
        } else {
            Color.black
        }
    }

    private var pageActions: BubbleFeedPageActions {
        BubbleFeedPageActions(
            takeOver: model.takeOver,
            like: { bubble in
                Haptics.light()
                bubbleStore.toggleLike(bubble)
                if bubble.isLiked {
                    FeedEventReporter.shared.note(.liked, gameID: bubble.id)
                }
            },
            openBoard: { bubble in
                FeedEventReporter.shared.note(.openedBoard, gameID: bubble.id)
                router.push(.bubbleBoard(bubble.id))
            },
            remix: { bubble in
                Haptics.light()
                FeedEventReporter.shared.note(.remixed, gameID: bubble.id)
                router.openStudio(StudioLaunch(mode: .remix, baseBubbleID: bubble.id))
            },
            float: { bubble in
                Haptics.light()
                // Only ask where when there's a choice; with no Group to offer, share to the feed.
                if shareGroup(for: bubble) == nil {
                    float(bubble, to: nil)
                } else {
                    floatTarget = bubble
                }
            },
            save: { bubble in
                Haptics.light()
                bubbleStore.toggleSave(bubble)
                if bubble.isSaved {
                    FeedEventReporter.shared.note(.saved, gameID: bubble.id)
                }
                appStore.showToast(
                    bubble.isSaved ? "Saved to your Library" : "Removed from your Library",
                    symbol: bubble.isSaved ? "bookmark.fill" : "bookmark.slash"
                )
            },
            openProfile: { user in
                router.push(.profile(user))
            }
        )
    }

    /// Before the first page: loading, the server's error, or an empty server.
    @ViewBuilder
    private var feedState: some View {
        switch bubbleStore.feedState {
        case .failed(let message):
            LiveDataStateView(kind: .failed(message), title: "Couldn't load \(ProductName.plural)", retry: bubbleStore.reloadFeed, onDark: true,
                              action: LiveDataStateView.Action(title: "Make one instead") { router.openStudio() })
        case .end:
            LiveDataStateView(kind: .empty("Be the first. Describe a game and Muse makes it in a few minutes."), title: "No \(ProductName.plural) yet",
                              retry: bubbleStore.reloadFeed, onDark: true,
                              action: LiveDataStateView.Action(title: "Make \(ProductName.withArticle)", symbol: "sparkles") { router.openStudio() })
        case .idle, .loading:
            LiveDataStateView(kind: .loading, title: "Loading \(ProductName.plural)…", onDark: true)
        }
    }

    private func topScrim(height: CGFloat) -> some View {
        LinearGradient(
            colors: [Color.black.opacity(0.5), Color.black.opacity(0)],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: height)
        .allowsHitTesting(false)
    }

    // MARK: State

    private var liveBubble: Bubble? {
        model.item(id: model.liveItemID).flatMap { bubbleStore.bubble(id: $0.bubbleID) }
    }

    /// On screen: this tab is selected at its root, nothing covers it, and the app is active.
    private var isVisible: Bool {
        router.selectedTab == .bubbles
            && (router.paths[.bubbles]?.isEmpty ?? true)
            && router.bubblePlayRequest == nil
            && router.studioLaunch == nil
            && router.reelsRequest == nil
            && router.createPostRequest == nil
            && !router.isMessengerPresented
            && !router.isCreateStoryPresented
            && scenePhase == .active
    }

    private var resultBinding: Binding<BubbleResultContext?> {
        Binding(get: { model.result }, set: { model.result = $0 })
    }

    private var floatDialogBinding: Binding<Bool> {
        Binding(get: { floatTarget != nil }, set: { if !$0 { floatTarget = nil } })
    }

    private var floatTitle: String {
        floatTarget.map { "Share \($0.title)" } ?? "Share"
    }

    // MARK: Actions

    private func appear() {
        model.configure(store: bubbleStore)
        model.setVisible(isVisible)
        #if DEBUG
        applyDebugLaunch()
        #endif
    }

    private func updateLayout(_ geometry: GeometryProxy) {
        let clearance = Self.windowTabBarClearance()
        if bottomClearance != clearance {
            bottomClearance = clearance
        }
        let insets = geometry.safeAreaInsets
        let height = geometry.size.height + insets.top + insets.bottom - clearance
        model.pageSize = CGSize(width: geometry.size.width, height: height)
        model.insetTop = insets.top + Self.headerHeight
    }

    /// After you close a game (the X, or the result sheet) or come back from a screen over the tab:
    /// the keyboard a game's text field left up goes, and the pager goes back to the page you were
    /// on, on a whole page. Toggling scrolling during the game, the keyboard, and a full-screen
    /// cover closing can each leave a paged ScrollView off its page (iOS 18) or reset to the top.
    /// Once on the next run loop, and once more after a cover's close animation has finished.
    private func realignPager() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        guard let id = returnPageID ?? model.currentID else { return }
        // A swipe after this was asked for wins: never pull the pager back to the page you left.
        let generation = model.scrollGeneration
        let snap = {
            guard !model.isTakenOver, model.scrollGeneration == generation,
                  bubbleStore.feedItems.contains(where: { $0.id == id }) else {
                FeedScrollLog.log("realign skipped (scrolled since, or playing)")
                return
            }
            if model.currentID != id {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    model.currentID = id
                }
            }
            realignToken += 1
        }
        DispatchQueue.main.async(execute: snap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: snap)
    }

    /// The header button flips the app-wide game mute (`GameSound`); the feed follows it.
    private func toggleMute() {
        Haptics.light()
        GameSound.toggleMute()
    }

    /// Jumps to the first page and fades it in. An animated programmatic scroll doesn't draw the
    /// pages it passes (they flash black), unlike a swipe.
    private func scrollToTop() {
        guard let first = bubbleStore.feedItems.first, model.currentID != first.id else { return }
        returnPageID = first.id
        if model.isTakenOver {
            model.endTakeover()
        }
        pagerOpacity = 0
        model.currentID = first.id
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.25)) {
                pagerOpacity = 1
            }
        }
    }

    /// Dismissed by swiping down or "Done": back to watching.
    private func resultSheetDismissed() {
        if model.isTakenOver && model.result == nil && !isPlayingAgain {
            model.endTakeover()
        }
        isPlayingAgain = false
    }

    private func playAgain() {
        isPlayingAgain = true
        model.playAgain()
    }

    private func openBoardFromResult(_ bubble: Bubble) {
        FeedEventReporter.shared.note(.openedBoard, gameID: bubble.id)
        model.result = nil
        model.endTakeover()
        let id = bubble.id
        PresentationGate.afterDismissal { [router] in
            router.push(.bubbleBoard(id))
        }
    }

    /// Opens the next level in the player once the result sheet has finished closing (a cover
    /// presented while the sheet is still moving can be dropped).
    private func playNextLevel(_ next: Bubble) {
        model.result = nil
        model.endTakeover()
        let id = next.id
        PresentationGate.afterDismissal { [router] in
            router.play(id)
        }
    }

    /// The Group a game can be shared to from the feed: its own, or one of yours it's played in.
    private func shareGroup(for bubble: Bubble) -> FBGroup? {
        bubble.group ?? bubbleStore.boardGroups(for: bubble).first(where: { $0.isMember })
    }

    @ViewBuilder
    private func floatButtons(for bubble: Bubble) -> some View {
        if let group = shareGroup(for: bubble) {
            Button("Share to \(group.name)") {
                float(bubble, to: group)
            }
        }
        Button("Share to your feed") {
            float(bubble, to: nil)
        }
        Button("Cancel", role: .cancel) {}
    }

    private func float(_ bubble: Bubble, to group: FBGroup?) {
        let message = "Play \(bubble.title) with me ✨"
        let post = BubbleSurfaceHooks.float(bubble, result: nil, to: group, message: message, appStore: appStore, bubbleStore: bubbleStore)
        if post != nil {
            Haptics.success()
            // BubbleSurfaceHooks.float shows the "Shared to …" toast itself.
        } else {
            appStore.showToast("Couldn't share this \(ProductName.singular) right now", symbol: "exclamationmark.circle")
        }
    }

    // MARK: Debug

    #if DEBUG
    private func applyDebugLaunch() {
        guard !didApplyDebug else { return }
        didApplyDebug = true
        let index = DebugLaunch.value("FB_FEED_INDEX").flatMap(Int.init) ?? 0
        let takesOver = DebugLaunch.value("FB_FEED_TAKEOVER") == "1"
        let endAfter = DebugLaunch.value("FB_FEED_TAKEOVER_END").flatMap(Double.init)
        let playerFor = DebugLaunch.value("FB_FEED_PLAYER").flatMap(Double.init)
        if index > 0 || takesOver || playerFor != nil {
            Task { @MainActor in
                // The live feed can arrive after the tab appears: wait for the page (up to 20 s).
                for _ in 0..<200 where bubbleStore.feedItems.count <= index {
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
                // One page at a time: a long jump in a lazy stack lands on estimated heights.
                if index > 0 {
                    for step in 1...index where step < bubbleStore.feedItems.count {
                        try? await Task.sleep(nanoseconds: 60_000_000)
                        model.currentID = bubbleStore.feedItems[step].id
                    }
                }
                if let playerFor, let item = model.currentItem {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    router.play(item.bubbleID)
                    try? await Task.sleep(nanoseconds: UInt64(playerFor * 1_000_000_000))
                    router.bubblePlayRequest = nil
                }
                guard takesOver else { return }
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                model.takeOver()
                guard let endAfter, endAfter > 0 else { return }
                for _ in 0..<200 where !model.isTakenOver {
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
                try? await Task.sleep(nanoseconds: UInt64(endAfter * 1_000_000_000))
                model.endTakeover()
            }
        }
        if DebugLaunch.value("FB_FAKE_RESULT") == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                model.showFakeResult()
            }
        }
    }

    /// `FB_FEED_AUTOSCROLL=s`: pages forward every s seconds while the tab is visible. For
    /// timing switches only: an animated programmatic scroll doesn't draw the pages it passes
    /// (they flash black mid-scroll), which a swipe doesn't do.
    private func autoScrollIfRequested() async {
        guard isVisible, let seconds = DebugLaunch.value("FB_FEED_AUTOSCROLL").flatMap(Double.init), seconds > 0 else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled, !model.isTakenOver else { continue }
            let items = bubbleStore.feedItems
            guard let index = items.firstIndex(where: { $0.id == model.currentID }), index + 1 < items.count else { continue }
            withAnimation(.easeInOut(duration: 0.35)) {
                model.currentID = items[index + 1].id
            }
        }
    }
    #endif
}

// MARK: - Scroll probe (DEBUG)

/// DEBUG with `FB_PERF=1`: logs the pager's scroll geometry, to check pages stay aligned.
private struct BubbleFeedScrollProbe: ViewModifier {
    func body(content: Content) -> some View {
        #if DEBUG
        if #available(iOS 18.0, *), BubbleRuntimePerf.isEnabled {
            content.onScrollGeometryChange(for: String.self) { geometry in
                String(format: "offset=%.1f container=%.1f content=%.1f insets=%.1f/%.1f bounds=%.1f",
                       geometry.contentOffset.y, geometry.containerSize.height, geometry.contentSize.height,
                       geometry.contentInsets.top, geometry.contentInsets.bottom, geometry.bounds.height)
            } action: { _, text in
                NSLog("[BubblePerf] scroll %@", text)
            }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

// MARK: - Header

/// Over the top of the feed: the wordmark, sound, Library and the make button.
/// The wordmark keeps its full width; the make button drops its title when space runs short.
private struct BubbleFeedHeader: View {
    let isMuted: Bool
    let onToggleMute: () -> Void

    @Environment(Router.self) private var router

    /// The header never grows wider than the screen: an overflowing row widened the whole tab
    /// (anchored at the leading edge), which cut off the right side of every page on a 393 pt
    /// iPhone. It tightens step by step to fit any width.
    var body: some View {
        ViewThatFits(in: .horizontal) {
            row(wordmark: 24, spacing: 8, button: 44)
            row(wordmark: 21, spacing: 2, button: 42)
            row(wordmark: 18, spacing: 0, button: 38)
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .frame(maxWidth: .infinity)
    }

    private func row(wordmark: CGFloat, spacing: CGFloat, button: CGFloat) -> some View {
        HStack(spacing: spacing) {
            BubbleWordmark(size: wordmark, lead: .white)
                // Stays legible over light looks (paper, glow) as well as dark ones.
                .shadow(color: Color.black.opacity(0.3), radius: 6, y: 1)
                .padding(.leading, 2)
                .fixedSize()
                .layoutPriority(1)
            Spacer(minLength: 4)
            iconButton(isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill", label: isMuted ? "Turn sound on" : "Turn sound off", width: button, action: onToggleMute)
            iconButton("books.vertical.fill", label: "Library", width: button) {
                router.push(.bubbleLibrary)
            }
            iconButton("trophy.fill", label: "Challenges", width: button) {
                router.push(.challengesInbox)
            }
            .overlay(alignment: .topTrailing) {
                let open = ChallengeInbox.shared.openCount + ServerBracketService.shared.yourTurnCount
                if open > 0 {
                    Text("\(open)")
                        .font(.fbMicroEmphasized)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(FBColor.notificationRed, in: Capsule())
                        .offset(x: -2, y: 2)
                        .accessibilityLabel("\(open) open challenges")
                }
            }
            ViewThatFits(in: .horizontal) {
                blowButton(showsTitle: true)
                blowButton(showsTitle: false)
            }
        }
    }

    private func iconButton(_ symbol: String, label: String, width: CGFloat = 44, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.medium, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: 36, height: 36)
                .background(Color.black.opacity(0.28), in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 0.5))
                .frame(width: width, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func blowButton(showsTitle: Bool) -> some View {
        Button {
            Haptics.light()
            router.openStudio()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "plus")
                    .font(.system(size: FBIconSize.medium, weight: .bold))
                if showsTitle {
                    Text("Make \(ProductName.withArticle)")
                        .font(.fbButton)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(GameColor.ink)
            .padding(.horizontal, showsTitle ? 12 : 0)
            .frame(minWidth: 36, minHeight: 36)
            .background(GameColor.gradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Make \(ProductName.withArticle)")
    }
}

// MARK: - Takeover bar

/// While you play a page: close on the left, your score on the right.
private struct BubbleFeedTakeoverBar: View {
    let title: String
    let score: Int
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button {
                Haptics.light()
                onClose()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: FBIconSize.medium, weight: .bold))
                    .foregroundStyle(Color.white)
                    .frame(width: 36, height: 36)
                    .background(Color.black.opacity(0.32), in: Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop playing")
            Text(title)
                .font(.fbName)
                .foregroundStyle(Color.white)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.black.opacity(0.28), in: Capsule())
            Spacer(minLength: 8)
            BubbleScorePill(score: score)
        }
        .padding(.horizontal, 12)
        .frame(height: 52)
        .shadow(color: Color.black.opacity(0.25), radius: 3, y: 1)
    }
}

/// The live score while you play, in the Glow look.
struct BubbleScorePill: View {
    let score: Int

    var body: some View {
        HStack(spacing: 6) {
            BubbleOrb(size: 16)
            Text(score.withCommas)
                .font(.system(.title3, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(BubbleGlow.ink)
                .contentTransition(.numericText(value: Double(score)))
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: score)
        }
        .padding(.leading, 8)
        .padding(.trailing, 14)
        .frame(height: 36)
        .background(BubbleGlow.brandGradient, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Score \(score)")
    }
}

#Preview {
    BubblesTabView()
        .previewEnvironment()
}
