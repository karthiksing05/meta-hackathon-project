import AVFoundation
import Observation

/// Plays library sounds (`/v1/sounds`, TikTok-style) behind games: one looping track at a time,
/// crossfading (~250 ms) when the sound changes. The feed, the full-screen player and a sound's
/// page each ask for their sound as an `owner`; an owner can only pause or stop what it started,
/// so the player opening over the feed doesn't get cut off by the feed going away.
///
/// The audio is native (AVPlayer, streamed from `audioUrl`), not in the pooled web views, so it
/// never touches the runtime's preloading or a run's replay. It follows the app-wide mute
/// (`GameSound.isMuted`) and plays with the silent switch on, like the games do.
@MainActor
@Observable
final class LibrarySoundPlayer {
    static let shared = LibrarySoundPlayer()

    enum Owner: String { case feed, player, page, picker }

    /// The sound playing (or paused), for the disc, the ticker and the page's play button.
    private(set) var current: RemoteGameSound?
    private(set) var owner: Owner?
    /// Paused by a person (the page's play button) rather than by the app.
    private(set) var isPaused = false

    var isPlaying: Bool { current != nil && !isPaused && !GameSound.isMuted }

    @ObservationIgnored private var active: Deck?
    @ObservationIgnored private var fading: [Deck] = []
    @ObservationIgnored private var fadeTask: Task<Void, Never>?
    @ObservationIgnored private var muteObserver: NSObjectProtocol?

    static let crossfade: Duration = .milliseconds(250)

    private final class Deck {
        let sound: RemoteGameSound
        let player: AVQueuePlayer
        let looper: AVPlayerLooper
        var gain: Float = 0

        init(_ sound: RemoteGameSound) {
            self.sound = sound
            let item = AVPlayerItem(url: sound.audioURL)
            player = AVQueuePlayer()
            player.volume = 0
            looper = AVPlayerLooper(player: player, templateItem: item)
            if sound.offsetMs > 0 {
                player.seek(to: CMTime(value: CMTimeValue(sound.offsetMs), timescale: 1000), toleranceBefore: .zero, toleranceAfter: .positiveInfinity)
            }
        }
    }

    private init() {
        muteObserver = NotificationCenter.default.addObserver(forName: .gameSoundMuteChanged, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { LibrarySoundPlayer.shared.muteChanged() }
        }
    }

    // MARK: Playing

    /// Plays `sound` for `owner`, crossfading from whatever played before. The same sound keeps
    /// playing where it is (the feed handing it to the full-screen player). Nil means this owner
    /// shows a game without a sound: whatever played fades out.
    func play(_ sound: RemoteGameSound?, for owner: Owner) {
        guard let sound else {
            self.owner = owner
            stop(owner)
            return
        }
        self.owner = owner
        isPaused = false
        if let active, active.sound.id == sound.id, active.sound.audioURL == sound.audioURL {
            current = sound
            resumeAudio()
            return
        }
        current = sound
        if let active { fading.append(active) }
        let deck = Deck(sound)
        active = deck
        startAudio()
        fade()
    }

    /// Fades out and forgets the sound, if `owner` started it.
    func stop(_ owner: Owner) {
        guard self.owner == owner else { return }
        self.owner = nil
        current = nil
        isPaused = false
        if let active { fading.append(active) }
        active = nil
        fade()
    }

    /// The app paused (the tab went away, a sheet covered it): holds the sound where it is.
    func hold(_ owner: Owner) {
        guard self.owner == owner, let active else { return }
        active.player.pause()
        GameSound.endPlayback(self)
    }

    /// Picks up after `hold`, unless a person paused it.
    func resume(_ owner: Owner) {
        guard self.owner == owner, !isPaused else { return }
        resumeAudio()
    }

    /// The page's play button.
    func togglePause() {
        guard current != nil else { return }
        isPaused.toggle()
        if isPaused {
            active?.player.pause()
            GameSound.endPlayback(self)
        } else {
            resumeAudio()
        }
    }

    // MARK: Audio

    /// How loud the sound plays: `mix` 0 is only the game, 1 only the sound.
    private static func level(for sound: RemoteGameSound) -> Float {
        Float(0.3 + 0.7 * min(1, max(0, sound.mix)))
    }

    private func startAudio() {
        guard let active, !GameSound.isMuted else { return }
        GameSound.beginGamePlayback(self)
        active.player.play()
    }

    private func resumeAudio() {
        guard let active, !GameSound.isMuted else { return }
        GameSound.beginGamePlayback(self)
        if active.player.timeControlStatus != .playing { active.player.play() }
        fade()
    }

    private func muteChanged() {
        if GameSound.isMuted {
            fadeTask?.cancel()
            for deck in fading { deck.player.pause() }
            fading = []
            active?.player.pause()
            active?.gain = 0
            active?.player.volume = 0
            GameSound.endPlayback(self)
        } else if !isPaused {
            startAudio()
            fade()
        }
    }

    /// Ramps the active deck up to its level and every fading deck down to silence, then drops them.
    private func fade() {
        fadeTask?.cancel()
        let steps = 10
        let step = Self.crossfade / steps
        fadeTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let target = self.active.map { Self.level(for: $0.sound) } ?? 0
            let startActive = self.active?.gain ?? 0
            let startFading = self.fading.map(\.gain)
            for i in 1...steps {
                try? await Task.sleep(for: step)
                if Task.isCancelled { return }
                let t = Float(i) / Float(steps)
                if let active = self.active {
                    active.gain = startActive + (target - startActive) * t
                    active.player.volume = active.gain
                }
                for (deck, from) in zip(self.fading, startFading) {
                    deck.gain = from * (1 - t)
                    deck.player.volume = deck.gain
                }
            }
            for deck in self.fading { deck.player.pause(); deck.player.removeAllItems() }
            self.fading = []
            if self.active == nil { GameSound.endPlayback(self) }
        }
    }
}

extension Notification.Name {
    /// Posted by `GameSound` when the app-wide mute changes.
    static let gameSoundMuteChanged = Notification.Name("gameSoundMuteChanged")
}

extension BubbleStore {
    /// The library sound a game plays behind it, as the server sent it.
    func librarySound(for bubble: Bubble) -> RemoteGameSound? {
        remoteGames[bubble.id]?.sound
    }
}
