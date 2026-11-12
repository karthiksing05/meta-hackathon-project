import SwiftUI

/// The video area of a feed card: the poster, the looping player while this card is the
/// current one, and the overlays (live badge, time left, mute, progress, play button).
struct VideoInlinePlayer: View {
    let post: Post
    let media: Media
    /// This card owns playback right now. Its player stays loaded while it is current.
    let isCurrent: Bool
    let isPlaying: Bool
    let isLive: Bool
    /// Shown when autoplay is off and the video isn't playing.
    let showsPlayButton: Bool
    let onPlay: () -> Void
    /// Opens the full-screen player, passing the current position.
    let onOpenFullScreen: (Double) -> Void

    @Environment(AppStore.self) private var store
    @State private var progress = VideoProgressModel()

    /// Width / height. Very tall videos are cropped to 4:5 in the feed, like the real app.
    private var displayRatio: CGFloat {
        let ratio = media.aspectRatio > 0 ? media.aspectRatio : 16.0 / 9.0
        return CGFloat(max(ratio, 0.8))
    }

    var body: some View {
        Color.black
            .aspectRatio(displayRatio, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay { RemoteImage(url: media.url) }
            .overlay { playerLayer }
            .overlay { playButton }
            .overlay(alignment: .topLeading) { liveOverlay }
            .overlay(alignment: .bottomLeading) { timeOverlay }
            .overlay(alignment: .bottomTrailing) { muteButton }
            .overlay(alignment: .bottom) { progressOverlay }
            .clipped()
            .contentShape(Rectangle())
            .onTapGesture {
                onOpenFullScreen(progress.elapsed)
            }
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens the video full screen")
            .onChange(of: isCurrent) { _, current in
                if !current {
                    progress.reset()
                }
            }
    }

    // MARK: Layers

    @ViewBuilder
    private var playerLayer: some View {
        if isCurrent, let url = media.videoURL {
            LoopingVideoPlayer(
                url: url,
                isPlaying: isPlaying,
                isMuted: store.videosMuted,
                onProgress: { elapsed, total in
                    progress.update(elapsed: elapsed, duration: total)
                }
            )
            // The poster stays visible until real frames arrive (or forever when offline).
            .opacity(progress.hasStarted ? 1 : 0)
            .animation(.easeIn(duration: 0.25), value: progress.hasStarted)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var playButton: some View {
        if showsPlayButton {
            Button(action: onPlay) {
                Image(systemName: "play.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(Color.white)
                    .frame(width: 64, height: 64)
                    .background(Color.black.opacity(0.55), in: Circle())
                    .overlay {
                        Circle().stroke(Color.white.opacity(0.9), lineWidth: 2)
                    }
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Play video")
        }
    }

    @ViewBuilder
    private var liveOverlay: some View {
        if isLive {
            HStack(spacing: 6) {
                VideoLiveBadge()
                VideoWatchingPill(post: post)
            }
            .padding(10)
        }
    }

    @ViewBuilder
    private var timeOverlay: some View {
        if !isLive {
            VideoTimePill(progress: progress, fallbackDuration: media.duration ?? 0)
                .padding(10)
        }
    }

    @ViewBuilder
    private var muteButton: some View {
        if isCurrent && !showsPlayButton {
            Button {
                Haptics.light()
                store.videosMuted.toggle()
            } label: {
                Image(systemName: store.videosMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 30, height: 30)
                    .background(Color.black.opacity(0.55), in: Circle())
                    .padding(10)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.videosMuted ? "Unmute" : "Mute")
        }
    }

    @ViewBuilder
    private var progressOverlay: some View {
        if isCurrent && !isLive {
            VideoProgressBar(progress: progress, tint: FBColor.brandBlue, track: Color.white.opacity(0.25), height: 3)
        }
    }
}

// MARK: - Overlay pieces

/// Time left, e.g. "2:41". Falls back to the video's listed length before playback.
private struct VideoTimePill: View {
    let progress: VideoProgressModel
    let fallbackDuration: Double

    private var remaining: Double {
        let total = progress.duration > 0 ? progress.duration : fallbackDuration
        return max(total - progress.elapsed, 0)
    }

    var body: some View {
        if remaining > 0 {
            Text(remaining.clockString)
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color.white)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.6), in: Capsule())
                .accessibilityLabel("\(remaining.clockString) left")
        }
    }
}

private struct VideoLiveBadge: View {
    var body: some View {
        Text("LIVE")
            .font(.system(size: 12, weight: .heavy))
            .tracking(0.5)
            .foregroundStyle(Color.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(FBColor.liveRed, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .accessibilityLabel("Live")
    }
}

/// "1.2K watching", nudged every few seconds so the broadcast feels live.
private struct VideoWatchingPill: View {
    let post: Post

    var body: some View {
        TimelineView(.periodic(from: .now, by: 3)) { context in
            let watchers = VideoLiveStats.watchers(for: post, at: context.date)
            HStack(spacing: 4) {
                Image(systemName: "eye.fill")
                    .font(.system(size: 10, weight: .bold))
                Text("\(watchers.fbCompact) watching")
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .contentTransition(.numericText())
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .animation(.easeInOut(duration: 0.3), value: watchers)
            .accessibilityElement(children: .combine)
        }
    }
}
