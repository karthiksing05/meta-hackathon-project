import AVFoundation
import SwiftUI
import UIKit

/// A looping video surface with no system controls. Feed videos and Reels use it.
///
/// Drive it from SwiftUI state: flip `isPlaying` when the video scrolls on or off screen,
/// and `isMuted` when the user taps the speaker button.
struct LoopingVideoPlayer: UIViewRepresentable {
    let url: URL
    var isPlaying: Bool = true
    var isMuted: Bool = true
    var gravity: AVLayerVideoGravity = .resizeAspectFill
    /// Called about 10 times a second with (elapsed seconds, total seconds).
    var onProgress: ((Double, Double) -> Void)? = nil

    func makeUIView(context: Context) -> LoopingPlayerUIView {
        let view = LoopingPlayerUIView()
        view.load(url)
        return view
    }

    func updateUIView(_ view: LoopingPlayerUIView, context: Context) {
        if view.currentURL != url {
            view.load(url)
        }
        view.playerLayer.videoGravity = gravity
        view.onProgress = onProgress
        view.setMuted(isMuted)
        view.setPlaying(isPlaying)
    }

    static func dismantleUIView(_ view: LoopingPlayerUIView, coordinator: ()) {
        view.unload()
    }
}

final class LoopingPlayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    // swiftlint:disable:next force_cast
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

    private(set) var currentURL: URL?
    var onProgress: ((Double, Double) -> Void)?

    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var timeObserver: Any?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        playerLayer.videoGravity = .resizeAspectFill
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func load(_ url: URL) {
        unload()
        currentURL = url
        let item = AVPlayerItem(url: url)
        let queuePlayer = AVQueuePlayer()
        queuePlayer.isMuted = true
        looper = AVPlayerLooper(player: queuePlayer, templateItem: item)
        playerLayer.player = queuePlayer
        player = queuePlayer
        let interval = CMTime(seconds: 0.1, preferredTimescale: 600)
        timeObserver = queuePlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, let current = self.player?.currentItem else { return }
                let duration = current.duration.seconds
                guard duration.isFinite, duration > 0 else { return }
                self.onProgress?(time.seconds, duration)
            }
        }
    }

    func setPlaying(_ playing: Bool) {
        guard let player else { return }
        if playing {
            if player.timeControlStatus != .playing {
                player.play()
            }
        } else {
            player.pause()
        }
    }

    func setMuted(_ muted: Bool) {
        guard let player, player.isMuted != muted else { return }
        player.isMuted = muted
        // With sound, play even when the ring/silent switch is on, like the real app. GameSound
        // owns the session and puts it back to `.ambient` once no video has sound.
        if muted {
            GameSound.endPlayback(self)
        } else {
            GameSound.beginPlayback(self)
        }
    }

    func unload() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        player?.pause()
        GameSound.endPlayback(self)
        looper?.disableLooping()
        looper = nil
        player = nil
        playerLayer.player = nil
        currentURL = nil
    }
}
