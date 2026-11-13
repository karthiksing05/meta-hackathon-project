import SwiftUI
import UIKit

/// Speak instead of type, for Studio's free-text boxes that go to Muse.
///
/// Tap the mic to start: the transcript streams into the field (after anything already typed).
/// Tap again, or pause for `pauseToStop`, to stop. It never sends: the person reads, edits and
/// sends as usual. It also stops when its button leaves the screen or the app goes to the
/// background, and only one field listens at a time.
///
/// Use: keep a `@State private var voice = VoiceInput()` next to the field, put
/// `VoiceInputButton(voice:text:)` beside it and `VoiceInputNote(voice:)` under it.
///
/// DEBUG launch variables (the simulator has no speech recognizer, so the mic hides there):
/// - `FB_VOICE=preview`: a scripted transcriber (`ScriptedSpeechTranscriber`), no microphone.
/// - `FB_VOICE=listen`: the same, and the first mic on screen starts listening by itself.
@MainActor
@Observable
final class VoiceInput {
    enum State: Equatable {
        case idle
        /// Asking for permission or starting the microphone.
        case starting
        case listening
        /// Microphone or Speech Recognition is off for the app.
        case denied
        case failed(String)
    }

    /// Silence that ends listening once the person has said something.
    static let pauseToStop: Duration = .milliseconds(1500)
    /// How long to wait for the first words.
    static let waitForSpeech: Duration = .seconds(6)

    private(set) var state: State = .idle
    /// Input level, 0...1, for the waveform.
    private(set) var level: Float = 0

    var isListening: Bool { state == .starting || state == .listening }
    var isAvailable: Bool { transcriber.isAvailable }

    @ObservationIgnored private let transcriber: any SpeechTranscribing
    @ObservationIgnored private var text: Binding<String>?
    @ObservationIgnored private var silence: Task<Void, Never>?
    /// The one field listening right now.
    private static weak var active: VoiceInput?

    /// `transcriber` defaults to `OnDeviceSpeechTranscriber`.
    init(transcriber: (any SpeechTranscribing)? = nil) {
        #if DEBUG
        if transcriber == nil, DebugLaunch.value("FB_VOICE") != nil {
            self.transcriber = ScriptedSpeechTranscriber()
            return
        }
        #endif
        self.transcriber = transcriber ?? OnDeviceSpeechTranscriber()
    }

    func toggle(_ text: Binding<String>) {
        if isListening {
            stop()
        } else {
            Task { await start(text) }
        }
    }

    func start(_ text: Binding<String>) async {
        guard !isListening else { return }
        if let other = Self.active, other !== self { other.stop() }
        Self.active = self
        state = .starting
        let permission = await transcriber.requestPermission()
        guard state == .starting else { return } // Stopped while the prompt was up.
        switch permission {
        case .granted: break
        case .denied:
            state = .denied
            return
        case .restricted:
            state = .failed("Speech input isn't allowed on this device.")
            return
        }
        // Put the keyboard away so the words land in the field without a cursor fight.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        let typed = text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        self.text = text
        do {
            try transcriber.start(
                onText: { [weak self] heard in self?.heard(heard, after: typed) },
                onLevel: { [weak self] level in
                    guard let self, self.state == .listening else { return }
                    self.level = level
                },
                onEnd: { [weak self] _ in self?.finish() }
            )
            state = .listening
            Haptics.light()
            stopAfter(Self.waitForSpeech)
        } catch {
            self.text = nil
            state = .failed("Couldn't start the microphone. Try again.")
        }
    }

    /// Stops listening. What was heard stays in the field.
    func stop() {
        guard isListening else { return }
        transcriber.stop()
        finish()
    }

    /// Hides the denied or failed note.
    func dismissNote() {
        if !isListening { state = .idle }
    }

    private func heard(_ heard: String, after typed: String) {
        guard state == .listening, let text else { return }
        text.wrappedValue = typed.isEmpty ? heard : typed + " " + heard
        stopAfter(Self.pauseToStop)
    }

    private func finish() {
        silence?.cancel()
        silence = nil
        text = nil
        level = 0
        if isListening { state = .idle }
        if Self.active === self { Self.active = nil }
    }

    private func stopAfter(_ delay: Duration) {
        silence?.cancel()
        silence = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.stop()
        }
    }
}

// MARK: - Mic button

/// The mic: tap to speak, tap again to stop. A live waveform while listening. Hidden when the
/// device can't transcribe.
struct VoiceInputButton: View {
    let voice: VoiceInput
    @Binding var text: String
    /// The visible circle; the tap target is always 44 pt.
    var diameter: CGFloat = 34

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        if voice.isAvailable {
            Button {
                Haptics.selection()
                voice.toggle($text)
            } label: {
                ZStack {
                    if voice.isListening {
                        Circle().fill(BubbleGlow.brandGradient)
                        VoiceLevelBars(level: voice.level, isWaiting: voice.state == .starting)
                            .foregroundStyle(BubbleGlow.ink)
                    } else {
                        Circle().fill(StudioGlow.fieldFill)
                        Circle().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75)
                        Image(systemName: "mic.fill")
                            .font(.system(size: FBIconSize.regular, weight: .semibold))
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                .frame(width: diameter, height: diameter)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.pressable)
            .animation(.easeInOut(duration: 0.2), value: voice.isListening)
            .accessibilityLabel(voice.isListening ? "Stop listening" : "Speak instead of typing")
            .onDisappear { voice.stop() }
            #if DEBUG
            .task {
                if DebugLaunch.value("FB_VOICE") == "listen", !voice.isListening {
                    await voice.start($text)
                }
            }
            #endif
            .onChange(of: scenePhase) { _, phase in
                // Not on .inactive: the permission prompt makes the scene inactive.
                if phase == .background { voice.stop() }
            }
        }
    }
}

/// Four bars that follow the input level.
private struct VoiceLevelBars: View {
    let level: Float
    let isWaiting: Bool

    private static let weights: [CGFloat] = [0.55, 1, 0.75, 0.45]

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(Self.weights.indices, id: \.self) { index in
                Capsule()
                    .frame(width: 3, height: height(Self.weights[index]))
            }
        }
        .frame(height: 18)
        .animation(.easeOut(duration: 0.12), value: level)
        .opacity(isWaiting ? 0.5 : 1)
    }

    private func height(_ weight: CGFloat) -> CGFloat {
        4 + 14 * weight * CGFloat(level)
    }
}

// MARK: - Note

/// One line under the field: listening, or why the mic can't be used (with a Settings link).
struct VoiceInputNote: View {
    let voice: VoiceInput

    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            switch voice.state {
            case .listening:
                line(symbol: "waveform", text: "Listening. Pause or tap the mic when you're done.")
            case .denied:
                HStack(alignment: .firstTextBaseline, spacing: FBSpacing.s) {
                    line(symbol: "mic.slash", text: "To speak instead of typing, allow the microphone and Speech Recognition.")
                    Button("Settings") {
                        voice.dismissNote()
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.accent)
                }
            case .failed(let message):
                line(symbol: "exclamationmark.circle", text: message)
            case .idle, .starting:
                EmptyView()
            }
        }
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.2), value: voice.state)
    }

    private func line(symbol: String, text: String) -> some View {
        Label {
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol)
        }
        .font(.fbMeta)
        .foregroundStyle(FBColor.secondaryText)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
// MARK: - Scripted transcriber (DEBUG)

/// Says a fixed sentence a word at a time, with a moving level, then pauses. For the simulator and
/// screenshots (`FB_VOICE`).
@MainActor
final class ScriptedSpeechTranscriber: SpeechTranscribing {
    private static let words = "A game where my friends and I race to stack pancakes before the timer runs out".split(separator: " ").map(String.init)
    private var job: Task<Void, Never>?

    var isAvailable: Bool { true }

    func requestPermission() async -> SpeechPermission { .granted }

    func start(onText: @escaping @MainActor (String) -> Void,
               onLevel: @escaping @MainActor (Float) -> Void,
               onEnd: @escaping @MainActor (Error?) -> Void) throws {
        stop()
        job = Task {
            var heard: [String] = []
            for word in Self.words {
                for _ in 0..<5 {
                    try? await Task.sleep(for: .milliseconds(70))
                    if Task.isCancelled { return }
                    onLevel(Float.random(in: 0.35...0.95))
                }
                heard.append(word)
                onText(heard.joined(separator: " "))
            }
            onLevel(0.05)
        }
    }

    func stop() {
        job?.cancel()
        job = nil
    }
}
#endif
