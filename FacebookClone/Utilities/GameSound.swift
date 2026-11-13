import AVFoundation
import Observation
import UIKit

/// App sounds for social moments in the games feature. Each one is synthesized (no audio files).
enum GameSoundCue: String, CaseIterable, Sendable {
    /// Muse finished making a game.
    case ready
    /// You shared a game.
    case publish
    /// You sent a challenge (or shared a game to people).
    case challengeSent
    /// A friend's run, challenge or play came in.
    case challengeIn
    /// Someone beat your score.
    case beaten
    /// You won a challenge or set a new best.
    case newBest
    /// Today's Daily game is ready.
    case daily
    /// A tiny, soft tick for saves and small confirmations.
    case tap
}

/// The app's sound: the audio session, one persisted mute, app cues and sound previews.
///
/// - **Session.** `.ambient` with `.mixWithOthers` by default, so the silent switch mutes app cues
///   and people's music keeps playing. A running game with sound on holds `.playback` with
///   `.mixWithOthers` through `beginGamePlayback(_:)`, so it is heard with the silent switch on
///   (like Reels) and music still keeps playing. Video with sound borrows `.playback` through
///   `beginPlayback(_:)` / `endPlayback(_:)` (or `withPlayback { }`) and gives it back.
/// - **Mute.** `GameSound.isMuted` is persisted and observable. The games tab, the player and Studio
///   all read it, and running games get `mute`/`unmute` through their host.
/// - **Cues.** `GameSound.play(.challengeIn)` plays a short synthesized cue. Cues respect the mute,
///   Settings' "Sound effects" switch and the silent switch; the optional haptic respects Settings'
///   "Haptics" switch (`Haptics`). Social cues also play by themselves, from the app's notifications
///   (`install(appStore:)`).
/// - **Previews.** `preview(set:moment:)` and `preview(_:)` play a microgame's sounds with a Swift copy
///   of the engine's synth, so Studio can preview without the engine.
@MainActor
@Observable
final class GameSound {
    static let shared = GameSound()

    // MARK: Mute

    /// Persisted in `SettingsKey.gameSoundMuted`.
    private(set) var muted: Bool {
        didSet { UserDefaults.standard.set(muted, forKey: SettingsKey.gameSoundMuted) }
    }

    /// One mute for every game surface and app cue. Persisted; observable from SwiftUI.
    static var isMuted: Bool {
        get { shared.muted }
        set { shared.setMuted(newValue) }
    }

    static func toggleMute() { isMuted.toggle() }

    private func setMuted(_ value: Bool) {
        guard value != muted else { return }
        muted = value
        GameSound.debugLog("mute -> \(value ? "muted" : "sound on")")
        if value { stopMusic() }
        NotificationCenter.default.post(name: .gameSoundMuteChanged, object: nil)
    }

    // MARK: Music preview state

    /// The loop playing from `playMusic`, by name, for UI state ("drift").
    private(set) var playingMusic: String?

    // MARK: Engine

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var voices: [AVAudioPlayerNode] = []
    @ObservationIgnored private var musicNode: AVAudioPlayerNode?
    @ObservationIgnored private var nextVoice = 0
    @ObservationIgnored private var idleStop: DispatchWorkItem?
    @ObservationIgnored private var cueBuffers: [GameSoundCue: AVAudioPCMBuffer] = [:]
    @ObservationIgnored private var toneBuffers: [SoundTone: AVAudioPCMBuffer] = [:]
    @ObservationIgnored private var lastAutomaticCue: Date = .distantPast
    @ObservationIgnored private var lastWinAt: Date = .distantPast
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private weak var appStore: AppStore?
    @ObservationIgnored private var seenNotificationIDs: Set<String> = []

    nonisolated static let sampleRate: Double = 44_100
    private let format = AVAudioFormat(standardFormatWithSampleRate: GameSound.sampleRate, channels: 1)!
    private let musicFormat = AVAudioFormat(standardFormatWithSampleRate: SoundSynth.musicRate, channels: 1)!

    private init() {
        muted = UserDefaults.standard.bool(forKey: SettingsKey.gameSoundMuted)
        listen()
        SessionBroker.shared.useAmbient()
    }

    // MARK: Public API

    /// Sets up the session and starts listening for social moments. Call once at launch with the
    /// app's store (more calls are ignored). Without it, the save and social-signal cues still play;
    /// incoming notifications (beaten, daily, friend activity) need the store.
    static func install(appStore: AppStore) {
        let sound = shared
        guard sound.appStore == nil else { return }
        sound.appStore = appStore
        sound.seenNotificationIDs = Set(appStore.notifications.map(\.id))
        sound.watchNotifications()
    }

    /// Plays an app cue unless muted, Settings' "Sound effects" is off, or the app isn't active.
    /// `haptic` adds the cue's haptic (which follows Settings' "Haptics" switch on its own).
    static func play(_ cue: GameSoundCue, haptic: Bool = false) {
        if haptic { cue.playHaptic() }
        guard soundEffectsOn, !isMuted else { return }
        shared.playCue(cue)
    }

    /// Plays one moment of a microgame sound set (authoring/SPEC.md 2.9), as the engine would.
    /// Plays unless muted (previews are explicit taps, so "Sound effects" doesn't apply).
    static func preview(set: String, moment: SoundMoment) {
        let section = GameSoundSection(setName: set)
        guard let tone = section.tone(for: moment) else { return }
        preview(tone)
    }

    /// Plays one microgame sound (already scaled by the game's volume).
    static func preview(_ tone: SoundTone) {
        guard !isMuted else { return }
        shared.playTone(tone)
    }

    /// Loops a microgame music track until `stopMusic()`. `volume` is the game's volume (0...1).
    static func playMusic(_ loop: SoundLoop, named name: String, volume: Double = 1) {
        guard !isMuted else { return }
        shared.startMusic(loop, name: name, volume: volume)
    }

    static func stopMusic() { shared.stopMusic() }

    static var playingMusic: String? { shared.playingMusic }

    /// Video with sound: hold `.playback` (plays with the silent switch on, like the real app) while
    /// `owner` is unmuted. Pair with `endPlayback(_:)`; a released or freed owner gives it back.
    nonisolated static func beginPlayback(_ owner: AnyObject) {
        SessionBroker.shared.hold(owner)
    }

    nonisolated static func endPlayback(_ owner: AnyObject) {
        SessionBroker.shared.release(owner)
    }

    /// A running game with sound on: hold `.playback` mixed with other apps, so the game is heard
    /// with the silent switch on and people's music keeps playing. Pair with `endPlayback(_:)`.
    /// Web Audio in a `WKWebView` plays under the app's session, so `.ambient` would silence it.
    nonisolated static func beginGamePlayback(_ owner: AnyObject) {
        SessionBroker.shared.hold(owner, mixes: true)
    }

    /// DEBUG builds: one line in the device console (Console.app, filter "GameSound").
    nonisolated static func debugLog(_ message: @autoclosure () -> String) {
        #if DEBUG
        NSLog("[GameSound] %@", message())
        #endif
    }

    /// Runs `body` with the session in `.playback`, then gives it back to `.ambient`. For one-off
    /// work; long-lived video uses `beginPlayback(_:)` / `endPlayback(_:)`.
    @discardableResult
    nonisolated static func withPlayback<T>(_ body: () throws -> T) rethrows -> T {
        let token = PlaybackToken()
        SessionBroker.shared.hold(token)
        defer { SessionBroker.shared.release(token) }
        return try body()
    }

    // MARK: Settings

    private static var soundEffectsOn: Bool {
        UserDefaults.standard.object(forKey: SettingsKey.soundEffects) as? Bool ?? true
    }

    // MARK: Playing

    private func playCue(_ cue: GameSoundCue) {
        let buffer: AVAudioPCMBuffer
        if let cached = cueBuffers[cue] {
            buffer = cached
        } else {
            guard let made = makeBuffer(SoundSynth.render(cue: cue)) else { return }
            cueBuffers[cue] = made
            buffer = made
        }
        schedule(buffer)
    }

    private func playTone(_ tone: SoundTone) {
        let buffer: AVAudioPCMBuffer
        if let cached = toneBuffers[tone] {
            buffer = cached
        } else {
            guard let made = makeBuffer(SoundSynth.render(tone: tone)) else { return }
            if toneBuffers.count > 64 { toneBuffers.removeAll() }
            toneBuffers[tone] = made
            buffer = made
        }
        schedule(buffer)
    }

    private func startMusic(_ loop: SoundLoop, name: String, volume: Double) {
        guard UIApplication.shared.applicationState != .background, let engine = runningEngine(), let node = musicNode else { return }
        let samples = SoundSynth.render(loop: loop, volume: volume)
        guard let buffer = makeBuffer(samples, format: musicFormat) else { return }
        node.stop()
        node.scheduleBuffer(buffer, at: nil, options: [.loops], completionHandler: nil)
        node.play()
        _ = engine
        playingMusic = name
        idleStop?.cancel()
    }

    private func stopMusic() {
        musicNode?.stop()
        if playingMusic != nil { playingMusic = nil }
        scheduleIdleStop(after: 1)
    }

    private func schedule(_ buffer: AVAudioPCMBuffer) {
        guard UIApplication.shared.applicationState != .background, runningEngine() != nil, !voices.isEmpty else { return }
        let node = voices[nextVoice]
        nextVoice = (nextVoice + 1) % voices.count
        node.stop()
        node.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        node.play()
        scheduleIdleStop(after: Double(buffer.frameLength) / buffer.format.sampleRate + 3)
    }

    private func makeBuffer(_ samples: [Float], format: AVAudioFormat? = nil) -> AVAudioPCMBuffer? {
        let format = format ?? self.format
        guard !samples.isEmpty,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            channel.update(from: source.baseAddress!, count: samples.count)
        }
        return buffer
    }

    /// The engine, started (and the session active) if it can be.
    private func runningEngine() -> AVAudioEngine? {
        if engine == nil { buildEngine() }
        guard let engine else { return nil }
        if !engine.isRunning {
            SessionBroker.shared.activate()
            do {
                try engine.start()
            } catch {
                return nil
            }
        }
        return engine
    }

    private func buildEngine() {
        let engine = AVAudioEngine()
        for _ in 0..<4 {
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            voices.append(node)
        }
        let music = AVAudioPlayerNode()
        engine.attach(music)
        engine.connect(music, to: engine.mainMixerNode, format: musicFormat)
        musicNode = music
        engine.prepare()
        self.engine = engine
        observers.append(NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { _ in
            // The output changed (headphones, a call). The engine stopped; the next sound restarts it.
            MainActor.assumeIsolated {
                GameSound.shared.playingMusic = nil
            }
        })
    }

    /// Stops the engine a few seconds after the last sound, so it doesn't hold the audio hardware.
    private func scheduleIdleStop(after seconds: Double) {
        idleStop?.cancel()
        guard playingMusic == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.playingMusic == nil else { return }
                self.engine?.stop()
                SessionBroker.shared.deactivateIfIdle()
            }
        }
        idleStop = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    // MARK: Social moments

    private func listen() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .bubbleSocialSignal, object: nil, queue: .main) { note in
            let kind = note.userInfo?[BubbleSocialSignals.kindKey] as? String
            MainActor.assumeIsolated {
                GameSound.shared.socialSignal(kind.flatMap(BubbleSocialSignalKind.init(rawValue:)))
            }
        })
        observers.append(center.addObserver(forName: .bubbleSaveChanged, object: nil, queue: .main) { note in
            let saved = note.userInfo?[BubbleSaveSignals.isSavedKey] as? Bool ?? false
            MainActor.assumeIsolated {
                if saved { GameSound.shared.automatic(.tap) }
            }
        })
    }

    /// docs/BUBBLES.md 7.1 signal kinds to cues. Moments that come back as notifications (a friend's
    /// score) are left to `notificationsChanged()` so they don't play twice.
    private func socialSignal(_ kind: BubbleSocialSignalKind?) {
        guard let kind else { return }
        switch kind {
        case .challengeSent, .challengeRematch, .groupChallenge, .share, .remix, .storyPathShared, .lessonShared:
            automatic(.challengeSent)
        case .challengeWon:
            lastWinAt = Date()
            automatic(.newBest, haptic: true)
        case .challengeAccepted:
            // A friend's reply landed. ChallengeCenter adds a notification right after, which picks
            // beaten or challengeIn; without the store, play the friendly one here.
            if appStore == nil { automatic(.challengeIn) }
        case .coMakeContribution:
            if appStore == nil { automatic(.challengeIn) }
        case .addFriendFromGame:
            automatic(.tap)
        case .groupChatPlay, .gameNightPlay, .aboutMePlay:
            break
        }
    }

    /// Cues triggered by the app (not a tap) are spaced out: one moment often fires two signals.
    private func automatic(_ cue: GameSoundCue, haptic: Bool = false) {
        let now = Date()
        guard now.timeIntervalSince(lastAutomaticCue) > 0.4 else { return }
        lastAutomaticCue = now
        GameSound.play(cue, haptic: haptic)
    }

    private func watchNotifications() {
        guard let appStore else { return }
        withObservationTracking {
            _ = appStore.notifications.count
            _ = appStore.notifications.first?.id
        } onChange: {
            Task { @MainActor in
                GameSound.shared.notificationsChanged()
            }
        }
    }

    /// New game notifications: someone beat you, a friend played or remixed, today's Daily.
    private func notificationsChanged() {
        defer { watchNotifications() }
        guard let appStore else { return }
        let fresh = appStore.notifications.filter { !seenNotificationIDs.contains($0.id) }
        seenNotificationIDs.formUnion(fresh.map(\.id))
        guard let note = fresh.first(where: { $0.kind.isGame && Date().timeIntervalSince($0.createdAt) < 15 }) else { return }
        switch note.kind {
        case .bubbleScore:
            // Your own win already played its cue a moment ago.
            guard Date().timeIntervalSince(lastWinAt) > 1 else { return }
            // ChallengeCopy.opponentNote: "beat your 34 with 41 in …".
            if note.message.hasPrefix("beat your") {
                automatic(.beaten, haptic: true)
            } else {
                automatic(.challengeIn)
            }
        case .bubbleDaily:
            automatic(.daily)
        case .bubblePlayed, .bubbleRemix:
            automatic(.challengeIn)
        default:
            break
        }
    }
}

private extension NotificationKind {
    var isGame: Bool {
        switch self {
        case .bubbleScore, .bubbleDaily, .bubblePlayed, .bubbleRemix: return true
        default: return false
        }
    }
}

extension GameSoundCue {
    /// The haptic that goes with the cue. `Haptics` checks Settings' "Haptics" switch.
    @MainActor
    func playHaptic() {
        switch self {
        case .ready, .publish, .newBest: Haptics.success()
        case .challengeSent: Haptics.light()
        case .challengeIn, .daily: Haptics.soft()
        case .beaten: Haptics.rigid()
        case .tap: Haptics.selection()
        }
    }
}

// MARK: - Audio session

/// Who holds `.playback`. Thread-safe; video code may call it from anywhere.
private final class SessionBroker: @unchecked Sendable {
    static let shared = SessionBroker()

    private let lock = NSLock()
    private var holders: [ObjectIdentifier: WeakOwner] = [:]
    private var inPlayback = false
    /// The `.playback` options in effect: mixable while every holder is a game.
    private var playbackMixes = false

    private struct WeakOwner {
        weak var object: AnyObject?
        var mixes: Bool
    }

    /// `mixes`: a game (`.mixWithOthers`, `.default` mode) rather than video (`.moviePlayback`).
    func hold(_ owner: AnyObject, mixes: Bool = false) {
        lock.lock()
        prune()
        let id = ObjectIdentifier(owner)
        if holders[id]?.object === owner, holders[id]?.mixes == mixes, inPlayback {
            lock.unlock()
            return
        }
        holders[id] = WeakOwner(object: owner, mixes: mixes)
        let wantMix = holders.values.allSatisfy(\.mixes)
        let switchNow = !inPlayback || wantMix != playbackMixes
        inPlayback = true
        playbackMixes = wantMix
        lock.unlock()
        guard switchNow else { return }
        setPlayback(mixes: wantMix)
    }

    func release(_ owner: AnyObject) {
        lock.lock()
        holders[ObjectIdentifier(owner)] = nil
        prune()
        let backToAmbient = inPlayback && holders.isEmpty
        if backToAmbient { inPlayback = false }
        // The last video went and only games remain: back to mixing with other apps.
        let wantMix = !holders.isEmpty && holders.values.allSatisfy(\.mixes)
        let remix = inPlayback && wantMix && !playbackMixes
        if remix { playbackMixes = true }
        lock.unlock()
        if backToAmbient { setAmbient() }
        if remix { setPlayback(mixes: true) }
    }

    /// The default: `.ambient`, mixing with other apps, muted by the silent switch.
    func useAmbient() {
        lock.lock()
        let playback = inPlayback
        lock.unlock()
        if !playback { setAmbient() }
    }

    /// Before the engine starts.
    func activate() {
        lock.lock()
        prune()
        if inPlayback && holders.isEmpty { inPlayback = false }
        let playback = inPlayback
        lock.unlock()
        let session = AVAudioSession.sharedInstance()
        if !playback && session.category != .ambient { setAmbient() }
        do {
            try session.setActive(true)
        } catch {
            GameSound.debugLog("setActive(true) failed: \(error.localizedDescription)")
        }
    }

    /// After the engine stops: lets other apps' audio know they can resume, unless video holds it.
    func deactivateIfIdle() {
        lock.lock()
        let playback = inPlayback
        lock.unlock()
        guard !playback else { return }
        // Fails harmlessly while a web view is still playing; the session then stays active.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func setAmbient() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            GameSound.debugLog("session -> ambient (silent switch mutes)")
        } catch {
            GameSound.debugLog("session -> ambient failed: \(error.localizedDescription)")
        }
    }

    private func setPlayback(mixes: Bool) {
        let session = AVAudioSession.sharedInstance()
        do {
            if mixes {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            } else {
                try session.setCategory(.playback, mode: .moviePlayback)
            }
            try session.setActive(true)
            GameSound.debugLog("session -> playback\(mixes ? " (mixes with others)" : "") active, silent switch ignored; output volume \(session.outputVolume)")
        } catch {
            GameSound.debugLog("session -> playback failed: \(error.localizedDescription)")
        }
    }

    /// Owners that were freed without `release` give the session back too.
    private func prune() {
        holders = holders.filter { $0.value.object != nil }
    }
}

private final class PlaybackToken {}

// MARK: - Synth

/// Renders sounds to mono float samples. A Swift copy of the engine's Web Audio synth
/// (`engine/web/render.js`: exponential attack and decay, exponential slides) plus the runtime's
/// master (gain 0.32, 6 kHz low-pass), so previews sound like the game. App cues use the same
/// oscillators with softer bell envelopes.
enum SoundSynth {
    static let rate = GameSound.sampleRate
    /// Music renders at the expander's rate (`renderMusic`: 8 kHz), so it sounds the same.
    static let musicRate: Double = 8_000
    /// The runtime's master gain (`bubble-runtime.js` `Sound.master`).
    static let runtimeMaster: Float = 0.32

    struct Note {
        enum Envelope {
            /// The engine's: 5 ms exponential attack, hold, exponential decay to the end.
            case engine
            /// A bell: 4 ms attack, exponential decay with this time constant (s).
            case bell(Double)
        }

        var wave: SoundTone.Wave = .sine
        var frequency: Double
        var slide: Double?
        var start: Double
        var duration: Double
        var peak: Double
        var envelope: Envelope = .engine
    }

    // MARK: Microgame sounds

    static func notes(for tone: SoundTone) -> [Note] {
        let step = max(0.02, min(5, tone.step))
        let volume = max(0, min(1, tone.volume))
        let peak = volume * (tone.wave == .square || tone.wave == .sawtooth ? 0.13 : 0.3)
        return tone.frequencies.enumerated().map { index, frequency in
            let last = index == tone.frequencies.count - 1
            return Note(wave: tone.wave, frequency: frequency, slide: last ? tone.slide : nil,
                        start: Double(index) * step, duration: step, peak: peak)
        }
    }

    static func render(tone: SoundTone) -> [Float] {
        var samples = render(notes(for: tone))
        lowPass(&samples, cutoff: 6_000, rate: rate)
        scale(&samples, by: runtimeMaster)
        return samples
    }

    /// The expander's `renderMusic`: melody voice with a 3/s decay, triangle bass with 1.6/s,
    /// 8 ms attack and 20 ms release per note; then the music volume and the runtime master.
    static func render(loop: SoundLoop, volume: Double) -> [Float] {
        let eighth = 30 / loop.bpm
        let steps = max(loop.melody.count, loop.bass.count * 2, 1)
        let count = Int((Double(steps) * eighth * musicRate).rounded())
        var out = [Double](repeating: 0, count: count)
        func voice(_ notes: [Double?], step: Double, wave: SoundTone.Wave, gain: Double, decay: Double) {
            for (index, hz) in notes.enumerated() {
                guard let hz else { continue }
                let start = Int((Double(index) * step * musicRate).rounded())
                let length = Int((step * musicRate * 0.92).rounded())
                var k = 0
                while k < length && start + k < count {
                    let t = Double(k) / musicRate
                    let attack = min(1, Double(k) / (musicRate * 0.008))
                    let release = min(1, Double(length - k) / (musicRate * 0.02))
                    let env = attack * release * exp(-t * decay)
                    out[start + k] += musicOscillator(wave, phase: hz * t) * env * gain
                    k += 1
                }
            }
        }
        voice(loop.melody, step: eighth, wave: loop.wave, gain: 0.38, decay: 3.0)
        voice(loop.bass, step: eighth * 2, wave: .triangle, gain: 0.32, decay: 1.6)
        let gain = loop.volume * max(0, min(1, volume)) * Double(runtimeMaster)
        return out.map { Float(max(-1, min(1, $0)) * gain) }
    }

    /// `sound.mjs` `osc`: naive shapes, as the 8 kHz loop has them.
    private static func musicOscillator(_ wave: SoundTone.Wave, phase: Double) -> Double {
        let p = phase - floor(phase)
        switch wave {
        case .square: return p < 0.5 ? 0.6 : -0.6
        case .triangle: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
        case .sawtooth: return (2 * p - 1) * 0.7
        case .sine: return sin(2 * .pi * p)
        }
    }

    // MARK: App cues

    /// Short, soft and bright: sines and triangles with bell tails, high in the register.
    static func notes(for cue: GameSoundCue) -> [Note] {
        func bell(_ hz: Double, at start: Double, _ peak: Double, decay: Double, wave: SoundTone.Wave = .sine) -> [Note] {
            // A quiet octave partial makes it shimmer.
            [Note(wave: wave, frequency: hz, start: start, duration: decay * 5, peak: peak, envelope: .bell(decay)),
             Note(wave: .sine, frequency: hz * 2, start: start, duration: decay * 3, peak: peak * 0.22, envelope: .bell(decay * 0.6))]
        }
        switch cue {
        case .tap:
            return [Note(frequency: 1318.5, start: 0, duration: 0.12, peak: 0.12, envelope: .bell(0.025)),
                    Note(frequency: 2637, start: 0, duration: 0.08, peak: 0.03, envelope: .bell(0.015))]
        case .ready:
            // A rising sparkle: C6 E6 G6 C7 over a soft C5.
            return [1046.5, 1318.5, 1568.0, 2093.0].enumerated().flatMap { index, hz in
                bell(hz, at: Double(index) * 0.075, 0.15 - Double(index) * 0.015, decay: 0.28)
            } + [Note(wave: .triangle, frequency: 523.25, start: 0, duration: 0.9, peak: 0.05, envelope: .bell(0.35))]
        case .publish:
            // A whoosh up, then a two-bell chime.
            return [Note(frequency: 392, slide: 1568, start: 0, duration: 0.2, peak: 0.1)]
                + bell(1568, at: 0.18, 0.14, decay: 0.4)
                + bell(2349.3, at: 0.27, 0.08, decay: 0.45)
        case .challengeSent:
            return [Note(wave: .triangle, frequency: 659.25, slide: 1318.5, start: 0, duration: 0.12, peak: 0.14)]
                + bell(1760, at: 0.11, 0.1, decay: 0.16)
        case .challengeIn:
            // A friendly two-note doorbell.
            return bell(1318.5, at: 0, 0.15, decay: 0.32) + bell(1046.5, at: 0.17, 0.15, decay: 0.42)
        case .beaten:
            // Cheeky, not sad: down two steps, then a curious lift ("your move").
            return [Note(wave: .triangle, frequency: 784, start: 0, duration: 0.09, peak: 0.14),
                    Note(wave: .triangle, frequency: 659.25, start: 0.1, duration: 0.09, peak: 0.13),
                    Note(frequency: 880, slide: 1174.7, start: 0.22, duration: 0.16, peak: 0.13)]
        case .newBest:
            // A quick triangle run up, then a sparkle on top.
            return [523.25, 659.25, 784.0, 1046.5].enumerated().map { index, hz in
                Note(wave: .triangle, frequency: hz, start: Double(index) * 0.075, duration: 0.075, peak: 0.16)
            } + bell(1318.5, at: 0.3, 0.1, decay: 0.5) + bell(2093, at: 0.34, 0.05, decay: 0.5)
        case .daily:
            // A sunrise of soft bells.
            return bell(784, at: 0, 0.13, decay: 0.6) + bell(1174.7, at: 0.13, 0.11, decay: 0.65) + bell(1975.5, at: 0.26, 0.06, decay: 0.5)
        }
    }

    static func render(cue: GameSoundCue) -> [Float] {
        var samples = render(notes(for: cue))
        lowPass(&samples, cutoff: 7_000, rate: rate)
        return samples
    }

    // MARK: Rendering

    static func render(_ notes: [Note]) -> [Float] {
        let end = notes.map { $0.start + $0.duration }.max() ?? 0
        let count = Int((end + 0.03) * rate)
        guard count > 0 else { return [] }
        var out = [Float](repeating: 0, count: count)
        for note in notes { add(note, into: &out) }
        return out
    }

    private static func add(_ note: Note, into out: inout [Float]) {
        guard note.frequency > 0, note.duration > 0 else { return }
        let start = Int(note.start * rate)
        let length = Int(note.duration * rate)
        let floor = 0.0001
        let peak = max(floor * 2, note.peak)
        var phase = 0.0
        for k in 0..<length {
            let index = start + k
            guard index < out.count else { break }
            let t = Double(k) / rate
            let frequency: Double
            if let slide = note.slide, slide > 0 {
                frequency = note.frequency * pow(slide / note.frequency, t / note.duration)
            } else {
                frequency = note.frequency
            }
            let gain: Double
            switch note.envelope {
            case .engine:
                let attack = 0.005
                let hold = min(0.03, note.duration * 0.3)
                if t < attack {
                    gain = floor * pow(peak / floor, t / attack)
                } else if t < hold {
                    gain = peak
                } else {
                    gain = peak * pow(floor / peak, (t - hold) / max(0.001, note.duration - hold))
                }
            case .bell(let decay):
                let attack = min(1, t / 0.004)
                let release = min(1, (note.duration - t) / 0.01)
                gain = peak * attack * release * exp(-t / decay)
            }
            let increment = min(frequency, rate / 2) / rate
            out[index] += Float(oscillator(note.wave, phase: phase, increment: increment) * gain)
            phase += increment
            if phase >= 1 { phase -= 1 }
        }
    }

    /// Band-limited (PolyBLEP) square and sawtooth, like Web Audio's, so high notes don't alias.
    private static func oscillator(_ wave: SoundTone.Wave, phase p: Double, increment dt: Double) -> Double {
        func blep(_ t: Double) -> Double {
            if t < dt { let x = t / dt; return x + x - x * x - 1 }
            if t > 1 - dt { let x = (t - 1) / dt; return x * x + x + x + 1 }
            return 0
        }
        switch wave {
        case .sine:
            return sin(2 * .pi * p)
        case .triangle:
            return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
        case .sawtooth:
            return (2 * p - 1) - blep(p)
        case .square:
            var value = p < 0.5 ? 1.0 : -1.0
            value += blep(p)
            var shifted = p + 0.5
            if shifted >= 1 { shifted -= 1 }
            value -= blep(shifted)
            return value
        }
    }

    /// A biquad low-pass (Q 0.707), like the runtime's master filter.
    static func lowPass(_ samples: inout [Float], cutoff: Double, rate: Double) {
        guard cutoff < rate / 2 else { return }
        let w0 = 2 * Double.pi * cutoff / rate
        let alpha = sin(w0) / (2 * 0.7071)
        let cosw = cos(w0)
        let a0 = 1 + alpha
        let b0 = (1 - cosw) / 2 / a0, b1 = (1 - cosw) / a0, b2 = (1 - cosw) / 2 / a0
        let a1 = -2 * cosw / a0, a2 = (1 - alpha) / a0
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        for i in samples.indices {
            let x = Double(samples[i])
            let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            samples[i] = Float(y)
        }
    }

    static func scale(_ samples: inout [Float], by gain: Float) {
        for i in samples.indices { samples[i] *= gain }
    }
}
