import Foundation

/// Paints a Bubble's cover with muse-image-1.0 in the game's own look (LOOKS.md), in parallel with
/// composing: it starts as soon as the title and look are known and Studio collects it at the end.
/// If the draft later lands on a different look, Studio repaints once so cover and game match.
final class StudioCoverPainter: @unchecked Sendable {
    private let lock = NSLock()
    private var task: Task<Data?, Never>?
    private var _prompt: String?
    private var _scene: String?
    private var _look: String?
    private var _startedAt: Date?
    private var _finishedAt: Date?
    private var _failure: String?
    private var _repaints = 0
    private var _announced = -1
    private var onPainted: (@Sendable (Painted) -> Void)?

    init() {}

    /// A finished painting, handed over the moment it's done.
    struct Painted: Sendable {
        var image: Data
        var seconds: TimeInterval
        var look: String?
        var scene: String?
    }

    /// Called once per painting, as soon as it's done (Studio shows the cover right away).
    func whenPainted(_ handler: @escaping @Sendable (Painted) -> Void) {
        locked { onPainted = handler }
    }

    /// True when the current painting was already handed to `whenPainted`.
    var announced: Bool { locked { _announced == _repaints } }

    var isStarted: Bool { locked { task != nil } }
    var prompt: String? { locked { _prompt } }
    var scene: String? { locked { _scene } }
    /// The look the cover is painted in.
    var look: String? { locked { _look } }
    var failure: String? { locked { _failure } }
    var repaints: Int { locked { _repaints } }

    /// Seconds the painting took, once it finished.
    var paintSeconds: Double? {
        locked {
            guard let start = _startedAt, let end = _finishedAt else { return nil }
            return end.timeIntervalSince(start)
        }
    }

    /// Starts painting `prompt`. Returns false when a cover is already being painted.
    @discardableResult
    func start(client: MuseClient, prompt: String, scene: String, look: String, timeout: TimeInterval = 90) -> Bool {
        locked { () -> Bool in
            guard task == nil else { return false }
            begin(client: client, prompt: prompt, scene: scene, look: look, timeout: timeout)
            return true
        }
    }

    /// Paints again in a new look, once: the draft moved away from the look the cover started in.
    @discardableResult
    func repaint(client: MuseClient, prompt: String, scene: String, look: String, timeout: TimeInterval = 90) -> Bool {
        locked { () -> Bool in
            guard task != nil, _look != look, _repaints == 0 else { return false }
            task?.cancel()
            task = nil
            _repaints += 1
            begin(client: client, prompt: prompt, scene: scene, look: look, timeout: timeout)
            return true
        }
    }

    /// Call with the lock held.
    private func begin(client: MuseClient, prompt: String, scene: String, look: String, timeout: TimeInterval) {
        _prompt = prompt
        _scene = scene
        _look = look
        _startedAt = Date()
        _finishedAt = nil
        _failure = nil
        let generation = _repaints
        task = Task { [weak self] in
            do {
                let data = try await client.image(prompt: prompt, timeout: timeout, purpose: "cover")
                self?.finish(failure: nil, generation: generation)
                self?.announce(data, generation: generation)
                return data
            } catch {
                let reason = (error as? MuseError)?.shortReason ?? (error is CancellationError ? "cancelled" : error.localizedDescription)
                self?.finish(failure: reason, generation: generation)
                return nil
            }
        }
    }

    /// The painted image, waiting at most `seconds` for it.
    func image(waitingAtMost seconds: TimeInterval) async -> Data? {
        guard let task = locked({ task }) else { return nil }
        let data = await StudioAsync.value(of: task, waitingAtMost: seconds)
        if data == nil, locked({ _finishedAt == nil }) {
            locked { _failure = _failure ?? "still painting after \(Int(seconds.rounded())) s" }
        }
        return data
    }

    func cancel() {
        locked { task }?.cancel()
    }

    private func announce(_ data: Data, generation: Int) {
        var handler: (@Sendable (Painted) -> Void)?
        var painted: Painted?
        lock.lock()
        if generation == _repaints, _announced != generation, let start = _startedAt {
            _announced = generation
            painted = Painted(image: data, seconds: (_finishedAt ?? Date()).timeIntervalSince(start), look: _look, scene: _scene)
            handler = onPainted
        }
        lock.unlock()
        if let handler, let painted { handler(painted) }
    }

    private func finish(failure: String?, generation: Int) {
        locked {
            // A cancelled first painting must not overwrite the repaint's state.
            guard generation == _repaints else { return }
            _finishedAt = Date()
            _failure = failure
        }
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}
