import AVFoundation
import SwiftUI
import UIKit

/// What the Video tab shows full screen, and where playback should start.
struct VideoFullScreenItem: Identifiable {
    let id = UUID()
    let post: Post
    var startTime: Double = 0
}

/// Full-screen playback with its own controls: play/pause, skip 10 s, a scrubber,
/// elapsed and remaining time, mute and close. The poster stays underneath, so a
/// stream that can't load (offline) still shows a picture and a clear message.
struct VideoFullScreenPlayer: View {
    let post: Post
    var startTime: Double = 0

    @Environment(\.dismiss) private var dismiss
    @State private var controller = VideoPlaybackController()
    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?

    private var media: Media? { post.media.first }

    private var videoRatio: CGFloat {
        let ratio = media?.aspectRatio ?? 16.0 / 9.0
        return CGFloat(ratio > 0 ? ratio : 16.0 / 9.0)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            videoArea
            statusOverlay
            controls
                .opacity(controlsVisible ? 1 : 0)
                .allowsHitTesting(controlsVisible)
        }
        .contentShape(Rectangle())
        .onTapGesture { toggleControls() }
        .statusBarHidden(!controlsVisible)
        .preferredColorScheme(.dark)
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 90)
        }
        .onAppear { start() }
        .onDisappear { stop() }
        .task { await monitorPlayback() }
    }

    // MARK: Video

    private var videoArea: some View {
        Color.clear
            .aspectRatio(videoRatio, contentMode: .fit)
            .overlay {
                RemoteImage(url: media?.url)
            }
            .overlay {
                if let player = controller.player {
                    VideoPlayerSurface(player: player)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel("Video by \(post.author.name)")
    }

    @ViewBuilder
    private var statusOverlay: some View {
        if controller.didFail {
            VStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: FBIconSize.xxl, weight: .semibold))
                Text("This video can't play right now")
                    .font(.fbName)
                Text("Check your connection and try again.")
                    .font(.fbMeta)
                    .foregroundStyle(Color.white.opacity(0.7))
            }
            .foregroundStyle(Color.white)
            .multilineTextAlignment(.center)
            .padding(20)
            .background(Color.black.opacity(0.65), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .padding(.horizontal, 32)
            .allowsHitTesting(false)
        } else if controller.isBuffering {
            ProgressView()
                .controlSize(.large)
                .tint(Color.white)
                .allowsHitTesting(false)
        }
    }

    // MARK: Controls

    private var controls: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black.opacity(0.65), Color.clear, Color.clear, Color.black.opacity(0.75)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                bottomBar
            }

            if !controller.didFail && !controller.isBuffering {
                centerControls
            }
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(Color.white.opacity(0.16), in: Circle())
                    .contentShape(Circle())
            }
            .accessibilityLabel("Close")

            AvatarView(user: post.author, size: FBAvatarSize.comment)

            VStack(alignment: .leading, spacing: 1) {
                Text(post.author.name)
                    .font(.fbName)
                    .lineLimit(1)
                if !post.text.isEmpty {
                    Text(post.text)
                        .font(.fbMeta)
                        .foregroundStyle(Color.white.opacity(0.7))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            Button {
                controller.setMuted(!controller.isMuted)
                scheduleHide()
            } label: {
                Image(systemName: controller.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(Color.white.opacity(0.16), in: Circle())
                    .contentShape(Circle())
            }
            .accessibilityLabel(controller.isMuted ? "Unmute" : "Mute")
        }
        .foregroundStyle(Color.white)
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var centerControls: some View {
        HStack(spacing: 40) {
            controlButton(symbol: "gobackward.10", size: 24, label: "Back 10 seconds") {
                controller.skip(by: -10)
                scheduleHide()
            }
            controlButton(symbol: playSymbol, size: 34, label: playLabel) {
                Haptics.light()
                controller.togglePlay()
                scheduleHide()
            }
            controlButton(symbol: "goforward.10", size: 24, label: "Forward 10 seconds") {
                controller.skip(by: 10)
                scheduleHide()
            }
        }
    }

    private var playSymbol: String {
        if controller.isAtEnd { return "arrow.counterclockwise" }
        return controller.isPlaying ? "pause.fill" : "play.fill"
    }

    private var playLabel: String {
        if controller.isAtEnd { return "Replay" }
        return controller.isPlaying ? "Pause" : "Play"
    }

    private func controlButton(symbol: String, size: CGFloat, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: size * 2, height: size * 2)
                .background(Color.black.opacity(0.35), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var bottomBar: some View {
        VStack(spacing: 4) {
            Slider(
                value: scrubBinding,
                in: 0...sliderUpperBound,
                onEditingChanged: { editing in handleScrubbing(editing) }
            )
            .tint(Color.white)
            .accessibilityLabel("Playback position")

            HStack {
                Text(controller.displayTime.clockString)
                Spacer()
                Text("-" + remainingTime.clockString)
            }
            .font(.fbMetaEmphasized.monospacedDigit())
            .foregroundStyle(Color.white.opacity(0.85))
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }

    private var scrubBinding: Binding<Double> {
        Binding(
            get: { controller.displayTime },
            set: { controller.scrub(to: $0) }
        )
    }

    private var sliderUpperBound: Double { max(controller.duration, 1) }

    private var remainingTime: Double { max(controller.duration - controller.displayTime, 0) }

    // MARK: Behavior

    private func start() {
        controller.load(
            url: media?.videoURL,
            startTime: startTime,
            fallbackDuration: media?.duration ?? 0
        )
        scheduleHide()
    }

    private func stop() {
        cancelHide()
        controller.teardown()
    }

    private func monitorPlayback() async {
        while !Task.isCancelled {
            controller.refresh()
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private func handleScrubbing(_ editing: Bool) {
        if editing {
            cancelHide()
            controller.beginScrubbing()
        } else {
            controller.endScrubbing()
            scheduleHide()
        }
    }

    private func toggleControls() {
        let show = !controlsVisible
        withAnimation(.easeInOut(duration: 0.2)) {
            controlsVisible = show
        }
        if show {
            scheduleHide()
        } else {
            cancelHide()
        }
    }

    /// Hides the controls after a few seconds of uninterrupted playback.
    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            if controller.isPlaying && !controller.isScrubbing {
                withAnimation(.easeInOut(duration: 0.25)) {
                    controlsVisible = false
                }
            }
        }
    }

    private func cancelHide() {
        hideTask?.cancel()
        hideTask = nil
    }
}

// MARK: - Playback

/// Owns the full-screen `AVPlayer`. The view polls `refresh()` a few times a second,
/// which keeps this free of observers that would need cleaning up.
@Observable
final class VideoPlaybackController {
    private(set) var player: AVPlayer?
    private(set) var isPlaying = false
    private(set) var isBuffering = false
    private(set) var didFail = false
    private(set) var elapsed: Double = 0
    private(set) var duration: Double = 0
    private(set) var isMuted = false
    private(set) var isScrubbing = false
    private var scrubTime: Double = 0

    /// Skips time updates right after a seek so the scrubber doesn't jump back.
    @ObservationIgnored private var ignoreTimeUpdatesUntil = Date.distantPast

    var displayTime: Double { isScrubbing ? scrubTime : elapsed }

    var isAtEnd: Bool { duration > 0 && !isPlaying && elapsed >= duration - 0.3 }

    func load(url: URL?, startTime: Double, fallbackDuration: Double) {
        guard player == nil else { return }
        duration = fallbackDuration
        guard let url else {
            didFail = true
            return
        }
        // Play sound even with the silent switch on, like the real app.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)

        let newPlayer = AVPlayer(url: url)
        newPlayer.actionAtItemEnd = .pause
        newPlayer.isMuted = isMuted
        if startTime > 1 {
            newPlayer.seek(to: CMTime(seconds: startTime, preferredTimescale: 600))
            elapsed = startTime
            ignoreTimeUpdatesUntil = Date().addingTimeInterval(0.8)
        }
        newPlayer.play()
        player = newPlayer
        isPlaying = true
        isBuffering = true
    }

    func refresh() {
        guard let player else { return }
        if let item = player.currentItem {
            if item.status == .failed && !didFail {
                didFail = true
            }
            let total = item.duration.seconds
            if total.isFinite && total > 0 && abs(total - duration) > 0.01 {
                duration = total
            }
        }
        let playing = player.rate != 0
        if playing != isPlaying {
            isPlaying = playing
        }
        let buffering = !didFail && player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        if buffering != isBuffering {
            isBuffering = buffering
        }
        guard !isScrubbing, Date() >= ignoreTimeUpdatesUntil else { return }
        let current = player.currentTime().seconds
        if current.isFinite && abs(current - elapsed) > 0.05 {
            elapsed = max(current, 0)
        }
    }

    func togglePlay() {
        guard let player else { return }
        if player.rate != 0 {
            player.pause()
            isPlaying = false
        } else {
            if isAtEnd {
                player.seek(to: .zero)
                elapsed = 0
            }
            player.play()
            isPlaying = true
        }
    }

    func skip(by seconds: Double) {
        let upper = duration > 0 ? duration : elapsed + max(seconds, 0)
        seek(to: min(max(elapsed + seconds, 0), upper))
    }

    func seek(to seconds: Double) {
        guard let player else { return }
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        elapsed = seconds
        ignoreTimeUpdatesUntil = Date().addingTimeInterval(0.6)
    }

    func beginScrubbing() {
        scrubTime = elapsed
        isScrubbing = true
    }

    func scrub(to seconds: Double) {
        scrubTime = seconds
        if !isScrubbing {
            // VoiceOver adjustments arrive without an editing session.
            seek(to: seconds)
        }
    }

    func endScrubbing() {
        isScrubbing = false
        seek(to: scrubTime)
    }

    func setMuted(_ muted: Bool) {
        isMuted = muted
        player?.isMuted = muted
    }

    func teardown() {
        player?.pause()
        player = nil
        isPlaying = false
        isBuffering = false
    }
}

// MARK: - Player surface

/// Draws an `AVPlayer`'s frames. Transparent until the first frame, so the poster shows through.
private struct VideoPlayerSurface: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> VideoPlayerSurfaceView {
        let view = VideoPlayerSurfaceView()
        view.playerLayer?.videoGravity = .resizeAspect
        view.playerLayer?.player = player
        return view
    }

    func updateUIView(_ view: VideoPlayerSurfaceView, context: Context) {
        if view.playerLayer?.player !== player {
            view.playerLayer?.player = player
        }
    }

    static func dismantleUIView(_ view: VideoPlayerSurfaceView, coordinator: ()) {
        view.playerLayer?.player = nil
    }
}

private final class VideoPlayerSurfaceView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    var playerLayer: AVPlayerLayer? { layer as? AVPlayerLayer }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }
}
