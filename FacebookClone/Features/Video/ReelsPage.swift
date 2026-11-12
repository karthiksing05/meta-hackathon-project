import SwiftUI

/// One full-screen reel: the video, tap / double-tap / hold gestures, the caption overlay,
/// the action column and a thin progress line at the bottom.
struct ReelsPage: View {
    let reel: Post
    let isCurrent: Bool
    /// Keeps a paused player warm for the reels right before and after the current one.
    let shouldLoad: Bool
    /// A sheet is open over Reels.
    let isSuspended: Bool
    let isMuted: Bool
    let insets: EdgeInsets
    let onComments: () -> Void
    let onShare: () -> Void
    let onMore: () -> Void
    let onOpenProfile: (User) -> Void

    @Environment(AppStore.self) private var store

    @State private var progress = VideoProgressModel()
    @State private var isPausedByUser = false
    /// True while a finger rests on the reel after a long press. Resets itself on release.
    @GestureState private var isHolding = false
    @State private var holdEndedAt = Date.distantPast
    @State private var hearts: [ReelsHeart] = []
    @State private var likeBounce = 0

    private var isPlaying: Bool {
        isCurrent && !isSuspended && !isPausedByUser && !isHolding
    }

    var body: some View {
        ZStack {
            Color.black
            RemoteImage(url: reel.media.first?.url)
            playerLayer
            bottomScrim
            pauseGlyph
            heartsLayer
            chrome
                .opacity(isHolding ? 0 : 1)
                .animation(.easeInOut(duration: 0.2), value: isHolding)
        }
        .contentShape(Rectangle())
        // Double tap is declared first so a single tap waits for it to fail.
        .onTapGesture(count: 2) { location in
            doubleTap(at: location)
        }
        .onTapGesture {
            togglePause()
        }
        .simultaneousGesture(holdGesture)
        .onChange(of: isHolding) { wasHolding, holding in
            if wasHolding && !holding {
                holdEndedAt = Date()
            }
        }
        .onChange(of: isCurrent) { _, current in
            if current {
                isPausedByUser = false
            }
        }
        .onChange(of: shouldLoad) { _, load in
            if !load {
                progress.reset()
            }
        }
    }

    // MARK: Layers

    @ViewBuilder
    private var playerLayer: some View {
        if shouldLoad, let url = reel.media.first?.videoURL {
            LoopingVideoPlayer(
                url: url,
                isPlaying: isPlaying,
                isMuted: isMuted,
                onProgress: { elapsed, total in
                    progress.update(elapsed: elapsed, duration: total)
                }
            )
            .opacity(progress.hasStarted ? 1 : 0)
            .animation(.easeIn(duration: 0.25), value: progress.hasStarted)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private var bottomScrim: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            LinearGradient(
                colors: [Color.clear, Color.black.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 340)
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var pauseGlyph: some View {
        if isPausedByUser && isCurrent {
            Image(systemName: "play.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color.white.opacity(0.9))
                .shadow(color: Color.black.opacity(0.4), radius: 8)
                .transition(.scale(scale: 1.6).combined(with: .opacity))
                .allowsHitTesting(false)
                .accessibilityLabel("Paused")
        }
    }

    private var heartsLayer: some View {
        ZStack {
            ForEach(hearts) { heart in
                ReelsHeartBurstView(tilt: heart.tilt)
                    .position(heart.location)
                    .transition(.asymmetric(insertion: .identity, removal: .opacity.combined(with: .scale(scale: 1.3))))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }

    private var chrome: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 12) {
                ReelsInfoOverlay(reel: reel, isPlaying: isPlaying, onOpenProfile: onOpenProfile)
                ReelsActionColumn(
                    reel: reel,
                    isPlaying: isPlaying,
                    likeBounce: likeBounce,
                    onLike: like,
                    onComments: onComments,
                    onShare: onShare,
                    onMore: onMore
                )
            }
            .padding(.leading, 14)
            .padding(.trailing, 8)
            .padding(.bottom, 14)
            VideoProgressBar(progress: progress, tint: Color.white, track: Color.white.opacity(0.25), height: 2)
                .opacity(isCurrent ? 1 : 0)
        }
        .padding(.bottom, insets.bottom)
    }

    // MARK: Gestures

    /// Press and hold pauses; lifting the finger resumes.
    private var holdGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.3, maximumDistance: 24)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .updating($isHolding) { value, state, _ in
                switch value {
                case .second(true, _):
                    state = true
                default:
                    state = false
                }
            }
    }

    private func togglePause() {
        // A tap can land right after a hold ends; that release shouldn't also pause.
        guard isCurrent, Date().timeIntervalSince(holdEndedAt) > 0.45 else { return }
        Haptics.soft()
        withAnimation(.easeOut(duration: 0.2)) {
            isPausedByUser.toggle()
        }
    }

    private func doubleTap(at location: CGPoint) {
        if reel.myReaction == nil {
            store.setReaction(.like, on: reel)
        }
        likeBounce += 1
        Haptics.medium()
        let heart = ReelsHeart(location: location, tilt: Double.random(in: -16...16))
        hearts.append(heart)
        Task {
            try? await Task.sleep(nanoseconds: 850_000_000)
            withAnimation(.easeOut(duration: 0.25)) {
                hearts.removeAll { $0.id == heart.id }
            }
        }
    }

    private func like() {
        Haptics.light()
        store.toggleLike(reel)
        likeBounce += 1
    }
}

// MARK: - Heart burst

private struct ReelsHeart: Identifiable {
    let id = UUID()
    let location: CGPoint
    let tilt: Double
}

private struct ReelsHeartBurstView: View {
    let tilt: Double
    @State private var popped = false

    var body: some View {
        Image(systemName: "heart.fill")
            .font(.system(size: 96))
            .foregroundStyle(
                LinearGradient(colors: [Color(hex: 0xFF6680), Color(hex: 0xE61739)], startPoint: .top, endPoint: .bottom)
            )
            .shadow(color: Color.black.opacity(0.3), radius: 10, y: 4)
            .rotationEffect(.degrees(tilt))
            .scaleEffect(popped ? 1 : 0.2)
            .opacity(popped ? 1 : 0)
            .onAppear {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.5)) {
                    popped = true
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Bottom-left info

private struct ReelsInfoOverlay: View {
    let reel: Post
    let isPlaying: Bool
    let onOpenProfile: (User) -> Void

    @Environment(AppStore.self) private var store
    @State private var isCaptionExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            authorRow
            if !reel.text.isEmpty {
                caption
            }
            audioRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadow(color: Color.black.opacity(0.4), radius: 3, y: 1)
    }

    private var authorRow: some View {
        HStack(spacing: 8) {
            Button {
                onOpenProfile(reel.author)
            } label: {
                HStack(spacing: 8) {
                    AvatarView(user: reel.author, size: FBAvatarSize.story)
                    Text(reel.author.name)
                        .font(.fbName)
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                    if reel.author.isVerified {
                        VerifiedBadge(size: 13)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(reel.author.name), view profile")

            if showsFollow {
                Button {
                    follow()
                } label: {
                    Text("Follow")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .overlay {
                            Capsule().stroke(Color.white.opacity(0.9), lineWidth: 1)
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .scale(scale: 0.8)))
                .accessibilityLabel("Follow \(reel.author.name)")
            }
        }
    }

    /// Hidden for friends, yourself, and once you follow the author.
    private var showsFollow: Bool {
        let author = reel.author
        return !author.isMe && !author.isFriend && !author.isFollowing
    }

    private func follow() {
        Haptics.light()
        withAnimation(.easeInOut(duration: 0.2)) {
            store.follow(reel.author)
        }
    }

    private var caption: some View {
        Text(reel.text)
            .font(.fbBody)
            .foregroundStyle(Color.white)
            .lineLimit(isCaptionExpanded ? 12 : 2)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isCaptionExpanded.toggle()
                }
            }
            .accessibilityAddTraits(.isButton)
    }

    private var audioRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "music.note")
                .font(.system(size: FBIconSize.small, weight: .semibold))
            ReelsMarqueeText(text: audioTitle, width: 190, isAnimating: isPlaying)
        }
        .foregroundStyle(Color.white)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Audio: \(audioTitle)")
    }

    private var audioTitle: String {
        if let title = reel.audioTitle, !title.isEmpty {
            return title
        }
        return "\(reel.author.name) · Original audio"
    }
}

/// Scrolls text that is wider than `width` in a slow, seamless loop.
private struct ReelsMarqueeText: View {
    let text: String
    let width: CGFloat
    let isAnimating: Bool

    @State private var textWidth: CGFloat = 0

    private let gap: CGFloat = 36
    /// Points per second.
    private let speed: Double = 26

    private var overflows: Bool { textWidth > width }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !(overflows && isAnimating))) { context in
            HStack(spacing: gap) {
                label
                if overflows {
                    label
                }
            }
            .offset(x: marqueeOffset(at: context.date))
        }
        .frame(width: width, alignment: .leading)
        .clipped()
        .mask {
            if overflows {
                LinearGradient(
                    stops: [
                        Gradient.Stop(color: Color.clear, location: 0),
                        Gradient.Stop(color: Color.black, location: 0.04),
                        Gradient.Stop(color: Color.black, location: 0.9),
                        Gradient.Stop(color: Color.clear, location: 1),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            } else {
                Color.black
            }
        }
    }

    private var label: some View {
        Text(text)
            .font(.fbMetaEmphasized)
            .lineLimit(1)
            .fixedSize()
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { textWidth = proxy.size.width }
                        .onChange(of: proxy.size.width) { _, newWidth in
                            textWidth = newWidth
                        }
                }
            }
    }

    /// How far the text has scrolled left. Zero when it fits.
    private func marqueeOffset(at date: Date) -> CGFloat {
        guard overflows else { return 0 }
        let distance = Double(textWidth + gap)
        guard distance > 0 else { return 0 }
        let elapsed = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: distance / speed)
        return -CGFloat(elapsed * speed)
    }
}

// MARK: - Right action column

private struct ReelsActionColumn: View {
    let reel: Post
    let isPlaying: Bool
    let likeBounce: Int
    let onLike: () -> Void
    let onComments: () -> Void
    let onShare: () -> Void
    let onMore: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            likeButton
            ReelsActionButton(symbol: "bubble.right.fill", count: reel.totalComments, label: "Comment", action: onComments)
            ReelsActionButton(symbol: "arrowshape.turn.up.right.fill", count: reel.shareCount, label: "Share", action: onShare)
            ReelsActionButton(symbol: "ellipsis", count: nil, label: "More options", action: onMore)
            ReelsAudioThumbnail(user: reel.author, isSpinning: isPlaying)
                .padding(.top, 4)
        }
    }

    private var likeButton: some View {
        Button(action: onLike) {
            VStack(spacing: 4) {
                likeIcon
                    .frame(width: 44, height: 40)
                Text(reel.totalReactions.fbCompact)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(Color.white)
            }
            .shadow(color: Color.black.opacity(0.35), radius: 3, y: 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(reel.myReaction == nil ? "Like" : "Remove reaction")
        .accessibilityValue("\(reel.totalReactions) reactions")
    }

    @ViewBuilder
    private var likeIcon: some View {
        if let reaction = reel.myReaction, reaction != .like {
            Text(reaction.emoji)
                .font(.system(size: FBIconSize.xxl))
        } else {
            Image(systemName: "hand.thumbsup.fill")
                .font(.system(size: FBIconSize.xxl, weight: .semibold))
                .foregroundStyle(reel.myReaction == nil ? Color.white : FBColor.brandBlue)
                .symbolEffect(.bounce, value: likeBounce)
        }
    }
}

private struct ReelsActionButton: View {
    let symbol: String
    let count: Int?
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.xxl, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 44, height: 40)
                if let count {
                    Text(count.fbCompact)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(Color.white)
                }
            }
            .shadow(color: Color.black.opacity(0.35), radius: 3, y: 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The author's picture as a slowly turning rounded square, standing in for the audio's cover art.
private struct ReelsAudioThumbnail: View {
    let user: User
    let isSpinning: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !isSpinning)) { context in
            thumbnail
                .rotationEffect(.degrees(angle(at: context.date)))
        }
        .frame(width: 44, height: 44)
        .accessibilityHidden(true)
    }

    private var thumbnail: some View {
        ZStack {
            RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                .fill(AvatarView.color(for: user.id))
            Text(user.initials)
                .font(.fbCaptionEmphasized)
                .foregroundStyle(Color.white)
            RemoteImage(url: user.avatarURL, data: user.avatarData, placeholder: .clear)
        }
        .frame(width: 32, height: 32)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                .stroke(Color.white, lineWidth: 2)
        }
    }

    /// One turn every nine seconds.
    private func angle(at date: Date) -> Double {
        (date.timeIntervalSinceReferenceDate * 40).truncatingRemainder(dividingBy: 360)
    }
}
