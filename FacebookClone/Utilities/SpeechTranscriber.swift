import AVFoundation
import Speech

/// What the person allowed for speaking instead of typing.
enum SpeechPermission: Equatable {
    case granted
    /// The microphone or Speech Recognition is off for this app; Settings can turn it on.
    case denied
    /// Not allowed on this device (Screen Time, a profile); Settings can't help.
    case restricted
}

enum SpeechTranscriptionError: Error {
    case unavailable
    case noMicrophone
}

/// Turns the person's voice into text, live. `VoiceInput` drives it; screens never call it.
///
/// Today it's `OnDeviceSpeechTranscriber` (Apple's Speech framework). A server transcriber can
/// replace it later by streaming audio to the backend; the app never calls Muse itself (CLAUDE.md).
@MainActor
protocol SpeechTranscribing: AnyObject {
    /// False when this device can't transcribe right now. The mic button hides then.
    var isAvailable: Bool { get }
    /// Asks for whatever the transcriber needs (the microphone, speech recognition). Prompts once.
    func requestPermission() async -> SpeechPermission
    /// Starts listening. `onText` gets the whole transcript so far, each time it changes;
    /// `onLevel` gets the input level, 0...1, about 20 times a second; `onEnd` comes once if
    /// listening ends by itself (an error, or the recognizer finished). Calls after `stop()` are
    /// dropped.
    func start(onText: @escaping @MainActor (String) -> Void,
               onLevel: @escaping @MainActor (Float) -> Void,
               onEnd: @escaping @MainActor (Error?) -> Void) throws
    /// Stops listening and gives the audio session back the way it was.
    func stop()
}

/// `SFSpeechRecognizer` + `AVAudioEngine`, on the device when the device supports it.
///
/// While it listens, the app's audio session is `.playAndRecord`; `stop()` restores the category it
/// found (normally `GameSound`'s `.ambient`) and deactivates, so game sound works again afterwards.
@MainActor
@Observable
final class OnDeviceSpeechTranscriber: NSObject, SpeechTranscribing, SFSpeechRecognizerDelegate {
    /// Follows the recognizer (it changes when the network comes and goes and on-device isn't
    /// supported), so the mic button appears and hides with it.
    private(set) var isAvailable = false

    @ObservationIgnored private let recognizer: SFSpeechRecognizer?
    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    /// Identifies the current listen, so late callbacks from a stopped one are dropped.
    @ObservationIgnored private var token: UUID?
    @ObservationIgnored private var savedSession: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?

    init(locale: Locale = .current) {
        recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        super.init()
        recognizer?.delegate = self
        isAvailable = recognizer?.isAvailable ?? false
    }

    nonisolated func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        Task { @MainActor [weak self] in self?.isAvailable = available }
    }

    func requestPermission() async -> SpeechPermission {
        let speech = await Self.speechAuthorization()
        switch speech {
        case .authorized: break
        case .restricted: return .restricted
        default: return .denied
        }
        let microphone = await AVAudioApplication.requestRecordPermission()
        return microphone ? .granted : .denied
    }

    func start(onText: @escaping @MainActor (String) -> Void,
               onLevel: @escaping @MainActor (Float) -> Void,
               onEnd: @escaping @MainActor (Error?) -> Void) throws {
        stop()
        guard let recognizer, recognizer.isAvailable else { throw SpeechTranscriptionError.unavailable }
        let token = UUID()
        self.token = token
        do {
            let session = AVAudioSession.sharedInstance()
            savedSession = (session.category, session.mode, session.categoryOptions)
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.taskHint = .dictation
            request.addsPunctuation = true
            if recognizer.supportsOnDeviceRecognition {
                request.requiresOnDeviceRecognition = true
            }

            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw SpeechTranscriptionError.noMicrophone }
            Self.installTap(on: input, format: format, request: request) { [weak self] level in
                guard self?.token == token else { return }
                onLevel(level)
            }
            engine.prepare()
            try engine.start()

            self.engine = engine
            self.request = request
            task = Self.recognize(with: recognizer, request: request) { [weak self] text, finished, error in
                guard let self, self.token == token else { return }
                if let text { onText(text) }
                if finished {
                    self.stop()
                    onEnd(error)
                }
            }
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        token = nil
        if let engine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        engine = nil
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil
        restoreSession()
    }

    private func restoreSession() {
        guard let saved = savedSession else { return }
        savedSession = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(saved.category, mode: saved.mode, options: saved.options)
    }

    // The callbacks below run on audio and Speech threads, so they're built outside the main actor
    // and hop back to it.

    nonisolated private static func speechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        let current = SFSpeechRecognizer.authorizationStatus()
        guard current == .notDetermined else { return current }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
    }

    nonisolated private static func installTap(on node: AVAudioInputNode, format: AVAudioFormat,
                                               request: SFSpeechAudioBufferRecognitionRequest,
                                               onLevel: @escaping @MainActor (Float) -> Void) {
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
            let level = Self.level(of: buffer)
            Task { @MainActor in onLevel(level) }
        }
    }

    nonisolated private static func recognize(with recognizer: SFSpeechRecognizer,
                                              request: SFSpeechAudioBufferRecognitionRequest,
                                              handler: @escaping @MainActor (String?, Bool, Error?) -> Void) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: request) { result, error in
            let text = result?.bestTranscription.formattedString
            let finished = error != nil || (result?.isFinal ?? false)
            Task { @MainActor in handler(text, finished, error) }
        }
    }

    /// RMS loudness mapped from -50...0 dB onto 0...1.
    nonisolated private static func level(of buffer: AVAudioPCMBuffer) -> Float {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        let count = Int(buffer.frameLength)
        var sum: Float = 0
        for index in 0..<count {
            sum += samples[index] * samples[index]
        }
        let rms = (sum / Float(count)).squareRoot()
        guard rms > 0 else { return 0 }
        let decibels = 20 * log10(rms)
        return min(max((decibels + 50) / 50, 0), 1)
    }
}
