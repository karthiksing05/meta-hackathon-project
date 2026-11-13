import AVFoundation
import Observation

/// Speaks short, plain lines about what Muse is doing in Studio ("Muse is picking the rules…").
///
/// One shared object. Lines come from Studio's own progress (`StudioNarration`), never from Muse.
/// - **On or off.** `isEnabled` is persisted and on by default, and it only speaks while the app-wide
///   game sound is on (`GameSound.isMuted`); muting stops a line mid-word.
/// - **One voice at a time.** It never talks over itself: a new line waits for the current one and
///   replaces any line already waiting; a waiting line older than `staleAfter` is dropped. `urgent`
///   lines (done, failed) cut in at the next word.
/// - **Quiet next to games.** It uses the app's audio session (ambient, mixes with others), speaks a
///   little under full volume, and `holdForGame` keeps it silent while a game is playing in Try.
@MainActor
@Observable
final class MuseNarrator: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = MuseNarrator()

    private static let enabledKey = "studio.narration.enabled"
    /// A waiting line older than this is no longer news.
    static let staleAfter: TimeInterval = 4

    /// The Studio toggle. Persisted; defaults to on.
    var isEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey)
            if !isEnabled { stop() }
        }
    }

    /// True while a line is being spoken (for the toggle's state).
    private(set) var isSpeaking = false

    /// Speaks only when enabled and the game sound is on.
    var isActive: Bool { isEnabled && !GameSound.isMuted }

    /// Set while a game runs in Studio's Try step, so narration never competes with game audio.
    @ObservationIgnored var holdForGame = false

    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private var pending: (text: String, at: Date)?
    @ObservationIgnored private var lastSpoken: String?

    private override init() {
        isEnabled = UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true
        super.init()
        synthesizer.delegate = self
        synthesizer.usesApplicationAudioSession = true
    }

    /// Says `text` when it's its turn. Repeats of the last line are ignored.
    func say(_ text: String, urgent: Bool = false) {
        guard isActive, !holdForGame, text != lastSpoken else { return }
        if synthesizer.isSpeaking {
            pending = (text, Date())
            if urgent { synthesizer.stopSpeaking(at: .word) }
            return
        }
        speak(text)
    }

    /// Stops right away and forgets what was waiting.
    func stop() {
        pending = nil
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        isSpeaking = false
    }

    /// A new Studio session: forget the last line so the same step can be said again.
    func reset() {
        stop()
        lastSpoken = nil
    }

    private func speak(_ text: String) {
        lastSpoken = text
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.02
        utterance.volume = 0.85
        utterance.preUtteranceDelay = 0.05
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        isSpeaking = true
        synthesizer.speak(utterance)
    }

    private func next() {
        isSpeaking = false
        guard let line = pending else { return }
        pending = nil
        guard isActive, !holdForGame, Date().timeIntervalSince(line.at) < Self.staleAfter else { return }
        speak(line.text)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.next() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.next() }
    }
}
