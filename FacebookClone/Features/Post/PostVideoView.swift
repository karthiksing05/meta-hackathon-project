import SwiftUI
import UIKit

/// A feed video. The poster shows first (and stays if the sample URL can't load), then a
/// muted looping player takes over while at least half of the video is on screen.
///
/// Pauses when the card scrolls away, when another tab is selected, under the app-wide
/// covers, while the card's own sheet or photo viewer is up (`isSuspended`), and in the
/// background. With "Autoplay videos" off it shows a play button instead.
struct PostVideoView: View {
    let media: Media
    var post: Post?
    var isSuspended: Bool = false

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.postOwningTab) private var owningTab
    @AppStorage(SettingsKey.autoplayVideos) private var autoplay = true

    @State private var isAppeared = false
    @State private var isOnScreen = false
    @State private var appearedTab: AppTab?
    @State private var userStarted = false
    @State private var isReady = false
    @State private var secondsLeft: Int?

    var body: some View {
        Color.black
            .aspectRatio(PostMediaGrid.clampedRatio(media.aspectRatio), contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay { player }
            .overlay { poster }
            .overlay { playButton }
            .overlay(alignment: .bottomLeading) { timePill }
            .overlay(alignment: .bottomTrailing) { soundButton }
            .clipped()
            .contentShape(Rectangle())
            .onTapGesture(perform: handleTap)
            .background { visibilityReader }
            .onAppear {
                isAppeared = true
                appearedTab = router.selectedTab
            }
            .onDisappear {
                isAppeared = false
                isOnScreen = false
                isReady = false
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Video")
    }

    // MARK: Layers

    @ViewBuilder
    private var player: some View {
        if let url = media.videoURL, shouldMountPlayer {
            LoopingVideoPlayer(url: url, isPlaying: shouldPlay, isMuted: store.videosMuted) { elapsed, total in
                updateProgress(elapsed: elapsed, total: total)
            }
            .allowsHitTesting(false)
        }
    }

    /// Covers the player (which is black until it has frames) until playback really starts.
    private var poster: some View {
        RemoteImage(url: media.url, data: media.data)
            .opacity(isReady && shouldMountPlayer ? 0 : 1)
            .animation(.easeOut(duration: 0.25), value: isReady)
            .allowsHitTesting(false)
    }

    @ViewBuilder
    private var playButton: some View {
        if !autoplay && !userStarted {
            PostPlayGlyph(size: 60)
        }
    }

    @ViewBuilder
    private var timePill: some View {
        if let text = remainingText {
            Text(text)
                .font(.fbCaptionEmphasized.monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.55), in: Capsule())
                .padding(10)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private var soundButton: some View {
        if shouldMountPlayer {
            Button {
                store.videosMuted.toggle()
                Haptics.light()
            } label: {
                Image(systemName: store.videosMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color.black.opacity(0.55), in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(10)
            .accessibilityLabel(soundLabel)
        }
    }

    private var soundLabel: String {
        store.videosMuted ? "Turn sound on" : "Turn sound off"
    }

    private var remainingText: String? {
        if isReady, let secondsLeft {
            return Double(secondsLeft).clockString
        }
        if let duration = media.duration, duration > 0 {
            return duration.clockString
        }
        return nil
    }

    // MARK: Playback rules

    private var shouldMountPlayer: Bool {
        isAppeared && (autoplay || userStarted)
    }

    private var shouldPlay: Bool {
        shouldMountPlayer && isOnScreen && !isSuspended && !isCovered && isOnOwningTab && scenePhase == .active
    }

    private var isCovered: Bool {
        router.isMessengerPresented
            || router.reelsRequest != nil
            || router.createPostRequest != nil
            || router.isCreateStoryPresented
    }

    /// All tabs stay alive, so a video plays only on the tab that shows it.
    private var isOnOwningTab: Bool {
        guard let tab = owningTab ?? appearedTab else { return true }
        return router.selectedTab == tab
    }

    // MARK: Actions

    private func handleTap() {
        if !autoplay && !userStarted {
            userStarted = true
            Haptics.light()
        } else if let post, post.isReel {
            router.openReels(startingAt: post)
        } else {
            store.videosMuted.toggle()
            Haptics.light()
        }
    }

    private func updateProgress(elapsed: Double, total: Double) {
        guard total.isFinite, total > 0, elapsed.isFinite else { return }
        if !isReady && elapsed > 0.05 {
            isReady = true
        }
        let left = max(0, Int((total - elapsed).rounded(.up)))
        if left != secondsLeft {
            secondsLeft = left
        }
    }

    // MARK: Visibility

    private var visibilityReader: some View {
        GeometryReader { proxy in
            let frame = proxy.frame(in: .global)
            Color.clear
                .onAppear {
                    updateVisibility(frame)
                }
                .onChange(of: frame) { _, newFrame in
                    updateVisibility(newFrame)
                }
        }
    }

    /// "On screen" means at least half of the video is inside the screen.
    private func updateVisibility(_ frame: CGRect) {
        let screenHeight = Self.screenHeight
        let top = max(frame.minY, 0)
        let bottom = min(frame.maxY, screenHeight)
        let visible = frame.height > 0 && (bottom - top) >= frame.height * 0.5
        if visible != isOnScreen {
            isOnScreen = visible
        }
    }

    private static var screenHeight: CGFloat {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first?.screen.bounds.height ?? 844
    }
}
