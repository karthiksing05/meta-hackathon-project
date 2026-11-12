import SwiftUI

/// Full-screen story viewer. Pages between authors with a cube transition, plays each
/// item for its duration with segmented progress bars, and supports tap (next/previous),
/// hold (pause), swipe (change author), drag down (dismiss) and swipe up (reply).
struct StoryViewer: View {
    let stories: [Story]
    let startIndex: Int

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    /// With Reduce Motion on, authors slide flat instead of turning like a cube.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var authorIndex: Int
    @State private var itemIndex: Int
    @State private var progress: Double = 0
    @State private var pageWidth: CGFloat = 390
    /// Horizontal offset while swiping between authors.
    @State private var pageDrag: CGFloat = 0
    /// Vertical offset while dragging down to dismiss.
    @State private var dismissDrag: CGFloat = 0
    @State private var dragAxis: HomeStoryDragAxis? = nil
    @State private var touchStart: Date? = nil
    @State private var touchID = UUID()
    @State private var isTouching = false
    @State private var chromeHidden = false
    @State private var isTransitioning = false
    @State private var isClosing = false
    @State private var isInBackground = false
    @State private var showsOptions = false
    @State private var isReplying = false
    @State private var floatingReactions: [HomeFloatingReaction] = []

    init(stories: [Story], startIndex: Int) {
        self.stories = stories
        self.startIndex = startIndex
        let clamped = stories.isEmpty ? 0 : min(max(startIndex, 0), stories.count - 1)
        _authorIndex = State(initialValue: clamped)
        _itemIndex = State(initialValue: stories.isEmpty ? 0 : stories[clamped].firstUnseenIndex)
    }

    var body: some View {
        ZStack {
            Color.black
                .opacity(backgroundOpacity)
                .ignoresSafeArea()

            GeometryReader { proxy in
                pages(size: proxy.size)
                    .onAppear {
                        pageWidth = max(proxy.size.width, 1)
                    }
                    .onChange(of: proxy.size.width) { _, newWidth in
                        pageWidth = max(newWidth, 1)
                    }
            }
            .scaleEffect(1 - dismissProgress * 0.25)
            .offset(y: dismissDrag)
            .ignoresSafeArea(.keyboard)

            floatingLayer

            if isReplying, let story = currentStory {
                HomeStoryReplyComposer(
                    recipient: story.author,
                    onSend: { text in sendReply(text, to: story) },
                    onCancel: { isReplying = false }
                )
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: isReplying)
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 84)
        }
        .statusBarHidden(true)
        .presentationBackground(.clear)
        .task {
            await runClock()
        }
        .onAppear {
            if stories.isEmpty {
                close()
            }
        }
        .onChange(of: visibleItemKey, initial: true) {
            markCurrentSeen()
        }
        .onChange(of: scenePhase) { _, phase in
            isInBackground = phase != .active
        }
        .confirmationDialog("Story options", isPresented: $showsOptions, titleVisibility: .hidden) {
            optionButtons
        }
    }

    // MARK: Derived state

    private var currentStory: Story? {
        stories.indices.contains(authorIndex) ? stories[authorIndex] : nil
    }

    private var currentItem: StoryItem? {
        guard let story = currentStory, story.items.indices.contains(itemIndex) else { return nil }
        return story.items[itemIndex]
    }

    private var isPaused: Bool {
        isTouching || showsOptions || isReplying || isTransitioning || isClosing || isInBackground
    }

    private var dismissProgress: CGFloat {
        min(max(dismissDrag / 500, 0), 1)
    }

    private var backgroundOpacity: Double {
        Double(1 - dismissProgress * 0.85)
    }

    /// Changes whenever a different item comes on screen.
    private var visibleItemKey: String {
        "\(authorIndex)|\(currentItem?.id ?? "-")"
    }

    // MARK: Pages

    private var visibleAuthorIndices: [Int] {
        guard !stories.isEmpty else { return [] }
        let lower = max(0, authorIndex - 1)
        let upper = min(stories.count - 1, authorIndex + 1)
        guard lower <= upper else { return [] }
        return Array(lower...upper)
    }

    private func pages(size: CGSize) -> some View {
        ZStack {
            ForEach(visibleAuthorIndices, id: \.self) { index in
                page(at: index, size: size)
            }
        }
        .frame(width: size.width, height: size.height)
    }

    private func page(at index: Int, size: CGSize) -> some View {
        let story = stories[index]
        let isCurrent = index == authorIndex
        let width = max(size.width, 1)
        let offsetX = CGFloat(index - authorIndex) * width + pageDrag
        let turn = offsetX / width
        return HomeStoryPage(
            story: story,
            itemIndex: isCurrent ? itemIndex : story.firstUnseenIndex,
            progress: isCurrent ? progress : 0,
            chromeHidden: isCurrent && chromeHidden,
            actions: pageActions(),
            isCurrentAuthor: isCurrent && !isClosing && !isInBackground,
            isHeld: isPaused
        )
        .frame(width: size.width, height: size.height)
        .rotation3DEffect(
            .degrees(reduceMotion ? 0 : Double(turn) * 45),
            axis: (x: 0, y: 1, z: 0),
            anchor: turn > 0 ? .leading : .trailing,
            perspective: 2.5
        )
        .offset(x: offsetX)
        .allowsHitTesting(isCurrent)
        .zIndex(isCurrent ? 1 : 0)
    }

    private func pageActions() -> HomeStoryPageActions {
        HomeStoryPageActions(
            onDragChanged: { value in handleDragChanged(value) },
            onDragEnded: { value in handleDragEnded(value) },
            onOptions: { showsOptions = true },
            onClose: { close() },
            onAuthor: { openAuthorProfile() },
            onReply: { isReplying = true },
            onReact: { emoji in react(emoji) },
            onAddToStory: { addToStory() }
        )
    }

    private var floatingLayer: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.clear
            ForEach(floatingReactions) { reaction in
                HomeFloatingEmoji(reaction: reaction)
            }
        }
        .padding(.trailing, 70)
        .padding(.bottom, 64)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var optionButtons: some View {
        if let story = currentStory {
            if story.author.isMe {
                Button("Delete story", role: .destructive) {
                    deleteCurrentItem()
                }
            } else {
                Button("Mute \(story.author.firstName)") {
                    store.showToast("You won't see stories from \(story.author.firstName) anymore", symbol: "speaker.slash.fill")
                }
                Button("Report story", role: .destructive) {
                    store.showToast("Thanks for reporting this story", symbol: "flag.fill")
                }
            }
        }
        Button("Cancel", role: .cancel) {}
    }

    // MARK: Clock

    /// Advances the current item about 30 times a second while nothing pauses it.
    @MainActor
    private func runClock() async {
        var last = Date()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 33_000_000)
            let now = Date()
            let delta = now.timeIntervalSince(last)
            last = now
            tick(delta)
        }
    }

    private func tick(_ delta: TimeInterval) {
        guard !isPaused else { return }
        guard let item = currentItem else {
            goForward()
            return
        }
        let duration = max(item.duration, 1)
        let next = progress + delta / duration
        if next >= 1 {
            progress = 1
            goForward()
        } else {
            progress = next
        }
    }

    private func markCurrentSeen() {
        guard let story = currentStory, let item = currentItem else { return }
        store.markSeen(item, in: story)
    }

    // MARK: Navigation

    private func goForward() {
        guard let story = currentStory else {
            close()
            return
        }
        if itemIndex + 1 < story.items.count {
            itemIndex += 1
            progress = 0
        } else if authorIndex + 1 < stories.count {
            moveToAuthor(authorIndex + 1)
        } else {
            close()
        }
    }

    private func goBackward() {
        if itemIndex > 0 {
            itemIndex -= 1
            progress = 0
        } else if authorIndex > 0 {
            moveToAuthor(authorIndex - 1)
        } else {
            progress = 0
        }
    }

    /// Rotates the cube to `target`, then swaps the current author without animation.
    private func moveToAuthor(_ target: Int) {
        guard stories.indices.contains(target), !isTransitioning, !isClosing else { return }
        isTransitioning = true
        let direction: CGFloat = target > authorIndex ? -1 : 1
        let width = pageWidth
        withAnimation(.easeInOut(duration: 0.32)) {
            pageDrag = direction * width
        }
        Task {
            try? await Task.sleep(nanoseconds: 330_000_000)
            authorIndex = target
            itemIndex = stories[target].firstUnseenIndex
            progress = 0
            pageDrag = 0
            isTransitioning = false
        }
    }

    private func close() {
        guard !isClosing else { return }
        isClosing = true
        dismiss()
    }

    // MARK: Gestures

    private func handleDragChanged(_ value: DragGesture.Value) {
        guard !isTransitioning, !isClosing else { return }
        if touchStart == nil {
            beginTouch()
        }
        let translation = value.translation
        if dragAxis == nil {
            let distance = (translation.width * translation.width + translation.height * translation.height).squareRoot()
            guard distance > 12 else { return }
            let axis: HomeStoryDragAxis = abs(translation.width) > abs(translation.height) ? .horizontal : .vertical
            dragAxis = axis
            if chromeHidden {
                withAnimation(.easeOut(duration: 0.15)) {
                    chromeHidden = false
                }
            }
        }
        switch dragAxis {
        case .some(.horizontal):
            pageDrag = rubberBanded(translation.width)
        case .some(.vertical):
            dismissDrag = max(0, translation.height)
        case .none:
            break
        }
    }

    private func handleDragEnded(_ value: DragGesture.Value) {
        let heldFor = Date().timeIntervalSince(touchStart ?? Date())
        let axis = dragAxis
        touchStart = nil
        dragAxis = nil
        isTouching = false
        if chromeHidden {
            withAnimation(.easeOut(duration: 0.2)) {
                chromeHidden = false
            }
        }
        guard !isTransitioning, !isClosing else { return }
        switch axis {
        case .some(.horizontal):
            finishHorizontalDrag(value)
        case .some(.vertical):
            finishVerticalDrag(value)
        case .none:
            if heldFor < 0.3 {
                handleTap(at: value.location)
            }
        }
    }

    private func beginTouch() {
        let id = UUID()
        touchID = id
        touchStart = Date()
        isTouching = true
        Task {
            try? await Task.sleep(nanoseconds: 260_000_000)
            guard touchID == id, isTouching, dragAxis == nil else { return }
            withAnimation(.easeOut(duration: 0.2)) {
                chromeHidden = true
            }
        }
    }

    private func handleTap(at location: CGPoint) {
        // Bubble items keep the middle of the screen for the game; only the edges navigate.
        if case .bubble = currentItem?.content {
            if location.x < pageWidth * 0.22 {
                goBackward()
            } else if location.x > pageWidth * 0.78 {
                goForward()
            }
            return
        }
        if location.x < pageWidth / 3 {
            goBackward()
        } else {
            goForward()
        }
    }

    private func finishHorizontalDrag(_ value: DragGesture.Value) {
        let width = pageWidth
        let translation = value.translation.width
        let predicted = value.predictedEndTranslation.width
        let swipedLeft = translation < -width * 0.25 || predicted < -width * 0.5
        let swipedRight = translation > width * 0.25 || predicted > width * 0.5
        if swipedLeft {
            if authorIndex + 1 < stories.count {
                moveToAuthor(authorIndex + 1)
            } else {
                close()
            }
        } else if swipedRight && authorIndex > 0 {
            moveToAuthor(authorIndex - 1)
        } else {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                pageDrag = 0
            }
        }
    }

    private func finishVerticalDrag(_ value: DragGesture.Value) {
        let translation = value.translation.height
        let predicted = value.predictedEndTranslation.height
        if translation > 140 || predicted > 420 {
            close()
            return
        }
        if translation < -70, let story = currentStory, !story.author.isMe {
            isReplying = true
        }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            dismissDrag = 0
        }
    }

    /// Resists swiping past the first author (and softens swiping past the last one).
    private func rubberBanded(_ translation: CGFloat) -> CGFloat {
        if authorIndex == 0 && translation > 0 {
            return translation * 0.3
        }
        if authorIndex == stories.count - 1 && translation < 0 {
            return translation * 0.5
        }
        return translation
    }

    // MARK: Actions

    private func react(_ emoji: String) {
        guard let story = currentStory else { return }
        Haptics.light()
        store.reactToStory(story, emoji: emoji)
        let reaction = HomeFloatingReaction(emoji: emoji, drift: CGFloat.random(in: -50...50))
        floatingReactions.append(reaction)
        let id = reaction.id
        Task {
            try? await Task.sleep(nanoseconds: 1_900_000_000)
            floatingReactions.removeAll { $0.id == id }
        }
    }

    private func sendReply(_ text: String, to story: Story) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        isReplying = false
        guard !trimmed.isEmpty else { return }
        store.replyToStory(story, text: trimmed)
        Haptics.success()
    }

    private func deleteCurrentItem() {
        guard let story = currentStory, let item = currentItem else { return }
        store.deleteStoryItem(item)
        if story.items.isEmpty {
            if authorIndex + 1 < stories.count {
                moveToAuthor(authorIndex + 1)
            } else {
                close()
            }
        } else {
            itemIndex = min(itemIndex, story.items.count - 1)
            progress = 0
        }
    }

    private func openAuthorProfile() {
        guard let author = currentStory?.author else { return }
        let router = router
        close()
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            router.push(.profile(author))
        }
    }

    private func addToStory() {
        let router = router
        close()
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            router.openCreateStory()
        }
    }
}
