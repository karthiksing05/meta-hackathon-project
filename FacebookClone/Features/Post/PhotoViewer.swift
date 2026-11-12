import SwiftUI

/// Sheets the photo viewer can show for its post.
enum PostViewerSheet: String, Identifiable {
    case comments
    case share

    var id: String { rawValue }
}

/// Full-screen photos: swipe between them, pinch or double-tap to zoom, drag down (or up)
/// to close, tap to show or hide the controls. Full-screen cover content; dismisses itself.
struct PhotoViewer: View {
    let media: [Media]
    /// The post the photos belong to. When set, the bottom bar has Like / Comment / Share.
    var post: Post?

    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store

    @State private var index: Int
    @State private var showsChrome = true
    @State private var dragOffset: CGFloat = 0
    @State private var dragStart: CGPoint?
    @State private var isVerticalDrag = false
    @State private var zoomedPages: Set<Int> = []
    @State private var activeSheet: PostViewerSheet?

    init(media: [Media], startIndex: Int = 0, post: Post? = nil) {
        self.media = media
        self.post = post
        let lastIndex = max(media.count - 1, 0)
        _index = State(initialValue: min(max(startIndex, 0), lastIndex))
    }

    var body: some View {
        ZStack {
            Color.black
                .opacity(backgroundOpacity)
                .ignoresSafeArea()

            pager
                .offset(y: dragOffset)
                .scaleEffect(contentScale)

            if showsChrome {
                chrome
                    .opacity(chromeOpacity)
                    .transition(.opacity)
            }
        }
        .environment(\.colorScheme, .dark)
        .statusBarHidden(!showsChrome)
        .presentationBackground(.clear)
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 120)
        }
        .onChange(of: index) {
            dragOffset = 0
        }
        .sheet(item: $activeSheet) { sheet in
            sheetContent(sheet)
        }
    }

    // MARK: Pages

    private var pager: some View {
        TabView(selection: $index) {
            ForEach(Array(media.enumerated()), id: \.offset) { offset, item in
                PostZoomablePhoto(media: item, isZoomed: zoomBinding(for: offset)) {
                    toggleChrome()
                }
                .tag(offset)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea()
        .simultaneousGesture(dismissGesture, including: isCurrentZoomed ? .subviews : .all)
    }

    private var isCurrentZoomed: Bool {
        zoomedPages.contains(index)
    }

    private func zoomBinding(for page: Int) -> Binding<Bool> {
        Binding(
            get: { zoomedPages.contains(page) },
            set: { isZoomed in
                if isZoomed {
                    _ = zoomedPages.insert(page)
                } else {
                    _ = zoomedPages.remove(page)
                }
            }
        )
    }

    /// Vertical drags move the photo and fade the background; far or fast enough closes.
    private var dismissGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                if dragStart != value.startLocation {
                    dragStart = value.startLocation
                    isVerticalDrag = abs(value.translation.height) > abs(value.translation.width)
                }
                guard isVerticalDrag else { return }
                dragOffset = value.translation.height
            }
            .onEnded { value in
                let wasVertical = isVerticalDrag && dragStart == value.startLocation
                dragStart = nil
                isVerticalDrag = false
                guard wasVertical else { return }
                let distance = abs(value.translation.height)
                let projected = abs(value.predictedEndTranslation.height)
                if distance > 120 || projected > 320 {
                    Haptics.light()
                    dismiss()
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.82)) {
                        dragOffset = 0
                    }
                }
            }
    }

    private var dragProgress: CGFloat {
        min(abs(dragOffset) / 300, 1)
    }

    private var backgroundOpacity: Double {
        Double(1 - dragProgress * 0.85)
    }

    private var contentScale: CGFloat {
        1 - dragProgress * 0.15
    }

    private var chromeOpacity: Double {
        Double(1 - dragProgress)
    }

    // MARK: Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            topBar
            Spacer(minLength: 0)
            if let post {
                PostViewerActionsBar(
                    post: post,
                    onComment: { activeSheet = .comments },
                    onShare: { activeSheet = .share }
                )
            }
        }
    }

    private var topBar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                chromeIcon("xmark")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")

            Spacer()
            if media.count > 1 {
                Text("\(index + 1) of \(media.count)")
                    .monospacedDigit()
                    .font(.fbName)
                    .foregroundStyle(.white)
            }
            Spacer()

            Menu {
                Button {
                    savePhoto()
                } label: {
                    Label("Save photo", systemImage: "square.and.arrow.down")
                }
                if let post {
                    Button {
                        store.postCopyLink(post)
                    } label: {
                        Label("Copy link", systemImage: "link")
                    }
                }
            } label: {
                chromeIcon("ellipsis")
            }
            .accessibilityLabel("More options")
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
    }

    private func chromeIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 40, height: 40)
            .background(Color.white.opacity(0.14), in: Circle())
            .contentShape(Circle())
    }

    @ViewBuilder
    private func sheetContent(_ sheet: PostViewerSheet) -> some View {
        if let post {
            switch sheet {
            case .comments:
                CommentsView(post: post, autoFocus: false)
            case .share:
                ShareSheetView(post: post)
            }
        }
    }

    // MARK: Actions

    private func toggleChrome() {
        withAnimation(.easeInOut(duration: 0.2)) {
            showsChrome.toggle()
        }
    }

    private func savePhoto() {
        Haptics.success()
        store.showToast("Photo saved", symbol: "checkmark.circle.fill")
    }
}

/// Caption, counts and Like / Comment / Share along the bottom of the photo viewer.
private struct PostViewerActionsBar: View {
    let post: Post
    var onComment: () -> Void
    var onShare: () -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !post.text.isEmpty {
                Text(post.text)
                    .font(.fbBody)
                    .foregroundStyle(.white)
                    .lineLimit(3)
            }
            HStack(spacing: 6) {
                if post.totalReactions > 0 {
                    ReactionBadgeStack(types: post.topReactions, size: 16)
                    Text(post.totalReactions.fbCompact)
                }
                Spacer(minLength: 8)
                if post.totalComments > 0 {
                    Text("\(post.totalComments.fbCompact) comments")
                }
            }
            .font(.fbMeta)
            .foregroundStyle(.white.opacity(0.85))
            Rectangle()
                .fill(Color.white.opacity(0.2))
                .frame(height: 0.5)
            HStack(spacing: 0) {
                actionButton(symbol: likeSymbol, title: likeTitle, color: likeColor, action: like)
                actionButton(symbol: "bubble.right", title: "Comment", color: .white, action: onComment)
                actionButton(symbol: "arrowshape.turn.up.right", title: "Share", color: .white, action: onShare)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 32)
        .padding(.bottom, 8)
        .background {
            LinearGradient(colors: [.clear, Color.black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        }
    }

    private var likeSymbol: String {
        post.myReaction == nil ? "hand.thumbsup" : "hand.thumbsup.fill"
    }

    private var likeTitle: String {
        post.myReaction?.title ?? "Like"
    }

    private var likeColor: Color {
        post.myReaction?.color ?? .white
    }

    private func like() {
        let isLiking = post.myReaction == nil
        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
            store.toggleLike(post)
        }
        if isLiking {
            Haptics.light()
        } else {
            Haptics.soft()
        }
    }

    private func actionButton(symbol: String, title: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 17))
                Text(title)
                    .font(.fbButton)
            }
            .foregroundStyle(color)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// One page of the viewer: an aspect-fit photo with pinch and double-tap zoom, and
/// panning while zoomed (which also stops the pager from swiping).
struct PostZoomablePhoto: View {
    let media: Media
    @Binding var isZoomed: Bool
    var onTap: () -> Void = {}

    @State private var scale: CGFloat = 1
    @State private var baseScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var baseOffset: CGSize = .zero

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            RemoteImage(url: media.url, data: media.data, contentMode: .fit, placeholder: .clear)
                .frame(width: size.width, height: size.height)
                .background {
                    ProgressView()
                        .tint(.white)
                }
                .overlay {
                    if media.kind == .video {
                        PostPlayGlyph(size: 64)
                    }
                }
                .scaleEffect(scale)
                .offset(offset)
                .contentShape(Rectangle())
                .simultaneousGesture(magnifyGesture(in: size))
                .gesture(panGesture(in: size), including: isZoomed ? .all : .subviews)
                .onTapGesture(count: 2) {
                    toggleZoom()
                }
                .onTapGesture {
                    onTap()
                }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityName)
        .accessibilityAddTraits(.isImage)
    }

    private var accessibilityName: String {
        media.kind == .video ? "Video" : "Photo"
    }

    private func magnifyGesture(in size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(max(baseScale * value.magnification, 1), 5)
                let zoomed = scale > 1.01
                if zoomed != isZoomed {
                    isZoomed = zoomed
                }
            }
            .onEnded { _ in
                if scale <= 1.05 {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        reset()
                    }
                } else {
                    baseScale = scale
                    let clamped = clampedOffset(offset, in: size)
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        offset = clamped
                    }
                    baseOffset = clamped
                }
            }
    }

    private func panGesture(in size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: baseOffset.width + value.translation.width,
                    height: baseOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                let clamped = clampedOffset(offset, in: size)
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                    offset = clamped
                }
                baseOffset = clamped
            }
    }

    private func clampedOffset(_ proposed: CGSize, in size: CGSize) -> CGSize {
        let maxX = max((size.width * scale - size.width) / 2, 0)
        let maxY = max((size.height * scale - size.height) / 2, 0)
        return CGSize(
            width: min(max(proposed.width, -maxX), maxX),
            height: min(max(proposed.height, -maxY), maxY)
        )
    }

    private func toggleZoom() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            if scale > 1.01 {
                reset()
            } else {
                scale = 2.5
                baseScale = 2.5
                isZoomed = true
            }
        }
    }

    private func reset() {
        scale = 1
        baseScale = 1
        offset = .zero
        baseOffset = .zero
        isZoomed = false
    }
}
