import Foundation

/// Emits Studio's live timeline. Every event is stamped with the seconds since the run started,
/// and the stream finishes exactly once.
final class StudioTimeline: @unchecked Sendable {
    private let continuation: AsyncThrowingStream<StudioEvent, Error>.Continuation
    private let started: Date
    private let lock = NSLock()
    private var isFinished = false
    private var history: [StudioEvent] = []

    init(continuation: AsyncThrowingStream<StudioEvent, Error>.Continuation, started: Date = Date()) {
        self.continuation = continuation
        self.started = started
    }

    var elapsed: TimeInterval { Date().timeIntervalSince(started) }
    var startDate: Date { started }

    var events: [StudioEvent] {
        lock.lock()
        defer { lock.unlock() }
        return history
    }

    @discardableResult
    func emit(
        _ step: StudioStep,
        _ title: String,
        detail: String? = nil,
        model: String? = nil,
        brief: BubbleBrief? = nil,
        concepts: [String]? = nil,
        manifest: BubbleManifest? = nil,
        cover: Data? = nil,
        issues: [String]? = nil,
        offline: Bool = false,
        baseUpdate: BubbleManifest? = nil,
        sources: [String]? = nil
    ) -> StudioEvent {
        var event = StudioEvent(
            step: step,
            title: title,
            detail: detail,
            model: model,
            elapsed: (elapsed * 10).rounded() / 10,
            brief: brief,
            concepts: concepts,
            manifest: manifest,
            coverImage: cover,
            issues: issues,
            isOffline: offline
        )
        event.baseUpdate = baseUpdate
        event.sourcesUsed = sources
        lock.lock()
        defer { lock.unlock() }
        guard !isFinished else { return event }
        history.append(event)
        continuation.yield(event)
        return event
    }

    func finish() {
        lock.lock()
        defer { lock.unlock() }
        guard !isFinished else { return }
        isFinished = true
        continuation.finish()
    }

    func finish(throwing error: Error) {
        lock.lock()
        defer { lock.unlock() }
        guard !isFinished else { return }
        isFinished = true
        continuation.finish(throwing: error)
    }
}

enum StudioAsync {
    /// Runs `operation`, throwing `URLError(.timedOut)` if it takes longer than `seconds`.
    static func withTimeout<T: Sendable>(_ seconds: TimeInterval, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else { throw CancellationError() }
            return first
        }
    }

    /// Waits for a task's value for at most `seconds`; nil when it isn't ready by then.
    static func value<T: Sendable>(of task: Task<T?, Never>, waitingAtMost seconds: TimeInterval) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await task.value }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    static func pause(_ seconds: TimeInterval) async {
        guard seconds > 0 else { return }
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }
}

/// Human copy for the timeline: sentence case, short, honest.
enum StudioCopy {
    static func list(_ items: [String], limit: Int = 3) -> String {
        let shown = Array(items.prefix(limit))
        var text: String
        switch shown.count {
        case 0: return ""
        case 1: text = shown[0]
        case 2: text = "\(shown[0]) and \(shown[1])"
        default: text = shown.dropLast().joined(separator: ", ") + " and " + shown.last!
        }
        if items.count > limit {
            text = shown.joined(separator: ", ") + " and \(items.count - limit) more"
        }
        return text
    }

    static func quote(_ text: String, max: Int = 70) -> String {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
        if clean.count <= max { return "“\(clean)”" }
        return "“\(clean.prefix(max - 1).trimmingCharacters(in: .whitespaces))…”"
    }

    static func seconds(_ value: Double) -> String {
        value < 10 ? String(format: "%.1f s", value) : "\(Int(value.rounded())) s"
    }

    /// "obstacle_labels" → "obstacle labels"
    static func humanKey(_ key: String) -> String {
        key.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
    }

    static func conceptName(_ id: String) -> String {
        let name = id.split(separator: ".").dropFirst().joined(separator: " ")
        return humanKey(name.isEmpty ? id : name)
    }

    static func audience(_ request: StudioRequest) -> String {
        if let name = request.scopeName, !name.isEmpty { return name }
        switch request.scope {
        case "everyone": return "everyone"
        case "friends": return "your friends"
        default: return request.scope
        }
    }

    static func understandTitle(_ request: StudioRequest) -> String {
        switch request.mode {
        case .create: return "Reading your request"
        case .edit: return "Reading your edit"
        case .remix: return "Reading your remix"
        case .nextLevel: return "Planning the next level"
        case .daily: return "Reading today's posts"
        }
    }

    static func understandDetail(_ request: StudioRequest) -> String {
        let prompt = request.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let quoted = prompt.isEmpty ? nil : quote(prompt, max: 90)
        switch request.mode {
        case .create:
            return [quoted, "for \(audience(request))"].compactMap { $0 }.joined(separator: " · ")
        case .edit:
            let base = request.base.map { "Editing \($0.title) v\($0.version)" } ?? "Editing \(ProductName.withArticle)"
            return [base, quoted].compactMap { $0 }.joined(separator: " · ")
        case .remix:
            let base = request.base.map { "Remixing \($0.title)" } ?? "Remixing \(ProductName.withArticle)"
            return [base, quoted].compactMap { $0 }.joined(separator: " · ")
        case .nextLevel:
            let level = (request.base?.chain?.index ?? 1) + 1
            let base = request.base.map { "Level \(level) after \($0.title)" } ?? "Next level"
            return [base, quoted].compactMap { $0 }.joined(separator: " · ")
        case .daily:
            let count = request.sources.count
            let posts = count == 1 ? "1 opted-in post" : "\(count) opted-in posts"
            return "Daily \(ProductName.singular) for \(audience(request)) from \(posts)"
        }
    }
}
