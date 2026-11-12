import SwiftUI
import UIKit

/// The Bubbles tab: a full-screen, infinite vertical feed of Bubbles, paged like Reels.
///
/// Only the settled page runs the live runtime (a friend's Burst, or a bot demo), muted until you
/// unmute. Its neighbors show poster frames. Tap a page to take over and play it right there;
/// the result sheet follows. See `BubbleFeedModel` for the runtime side.
///
/// DEBUG launch variables (see `DebugLaunch`):
/// - `FB_FEED_INDEX=n`: start on page n.
/// - `FB_FAKE_RESULT=1`: show the result sheet for the first page without playing.
/// - `FB_FEED_TAKEOVER=1`: take over the first page as if it were tapped.
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
                    BubbleFeedHeader(isMuted: model.isMuted, onToggleMute: toggleMute)
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
            .ignoresSafeArea(edges: [.top, .bottom])
            .onAppear {
                updateLayout(geometry)
            }
            .onChange(of: geometry.size) { _, _ in
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
            model.setVisible(visible)
        }
        .onChange(of: model.currentID) { _, id in
            model.pageDidChange(to: id)
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
        return ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(bubbleStore.feedItems) { item in
                    page(for: item)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(item.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $model.currentID, anchor: .top)
        .scrollDisabled(model.isTakenOver)
        .ignoresSafeArea(edges: [.top, .bottom])
        .padding(.bottom, bottomInset)
        .opacity(pagerOpacity)
        .modifier(BubbleFeedScrollProbe())
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
            },
            openBoard: { bubble in
                router.push(.bubbleBoard(bubble.id))
            },
            remix: { bubble in
                Haptics.light()
                router.openStudio(StudioLaunch(mode: .remix, baseBubbleID: bubble.id))
            },
            float: { bubble in
                Haptics.light()
                floatTarget = bubble
            },
            save: { bubble in
                Haptics.light()
                bubbleStore.toggleSave(bubble)
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

    private func toggleMute() {
        Haptics.light()
        model.toggleMute()
    }

    /// Jumps to the first page and fades it in. An animated programmatic scroll doesn't draw the
    /// pages it passes (they flash black), unlike a swipe.
    private func scrollToTop() {
        guard let first = bubbleStore.feedItems.first, model.currentID != first.id else { return }
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
        model.result = nil
        model.endTakeover()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            router.push(.bubbleBoard(bubble.id))
        }
    }

    private func playNextLevel(_ next: Bubble) {
        model.result = nil
        model.endTakeover()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            router.play(next.id)
        }
    }

    @ViewBuilder
    private func floatButtons(for bubble: Bubble) -> some View {
        if let group = bubble.group ?? bubbleStore.boardGroups(for: bubble).first(where: { $0.isMember }) {
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
            appStore.showToast(group.map { "Shared to \($0.name)" } ?? "Shared to your feed", symbol: "sparkles")
        } else {
            appStore.showToast("Couldn't share this \(ProductName.singular) right now", symbol: "exclamationmark.circle")
        }
    }

    // MARK: Debug

    #if DEBUG
    private func applyDebugLaunch() {
        guard !didApplyDebug else { return }
        didApplyDebug = true
        if let index = DebugLaunch.value("FB_FEED_INDEX").flatMap(Int.init), index > 0 {
            while bubbleStore.feedItems.count <= index + 3 {
                bubbleStore.extendFeed(by: 12)
            }
            // One page at a time: a long jump in a lazy stack lands on estimated heights.
            Task { @MainActor in
                for step in 1...index {
                    try? await Task.sleep(nanoseconds: 60_000_000)
                    model.currentID = bubbleStore.feedItems[step].id
                }
            }
        }
        if DebugLaunch.value("FB_FAKE_RESULT") == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                model.showFakeResult()
            }
        }
        if DebugLaunch.value("FB_FEED_TAKEOVER") == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                model.takeOver()
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

    var body: some View {
        HStack(spacing: 8) {
            BubbleWordmark(size: 26)
                // Stays legible over light looks (paper, glow) as well as dark ones.
                .shadow(color: Color.black.opacity(0.3), radius: 6, y: 1)
                .padding(.leading, 2)
                .fixedSize()
                .layoutPriority(1)
            Spacer(minLength: 4)
            iconButton(isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill", label: isMuted ? "Turn sound on" : "Turn sound off", action: onToggleMute)
            iconButton("books.vertical.fill", label: "Library") {
                router.push(.bubbleLibrary)
            }
            ViewThatFits(in: .horizontal) {
                blowButton(showsTitle: true)
                blowButton(showsTitle: false)
            }
        }
        .padding(.horizontal, FBMetrics.screenPadding)
    }

    private func iconButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.medium, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: 36, height: 36)
                .background(Color.black.opacity(0.28), in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 0.5))
                .frame(width: 44, height: 44)
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
