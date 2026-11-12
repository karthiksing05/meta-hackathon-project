import Foundation

// The Muse API client: OpenAI-compatible chat completions (with tools and JSON mode), image
// generation and the model list. Foundation only: the macOS CLI compiles this file too.
//
// Never log or print the key or the request headers. Errors carry the server's message only.

// MARK: - Errors

/// What went wrong talking to Muse. Messages never include the key or request headers.
enum MuseError: Error, LocalizedError, Sendable {
    case notConfigured
    case offline(String)
    case http(status: Int, message: String)
    case network(String)
    case timedOut(seconds: TimeInterval)
    case emptyReply(model: String, finishReason: String?)
    case invalidReply(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "No Muse key is configured."
        case .offline(let message):
            return "You're offline (\(message))."
        case .http(let status, let message):
            return message.isEmpty ? "Muse returned HTTP \(status)." : "Muse returned HTTP \(status): \(message)"
        case .network(let message):
            return "Couldn't reach Muse: \(message)"
        case .timedOut(let seconds):
            return "Muse took longer than \(Int(seconds.rounded())) s."
        case .emptyReply(let model, let reason):
            return "\(model) sent an empty reply (\(reason ?? "no reason given"))."
        case .invalidReply(let message):
            return "Muse sent a reply Studio couldn't read: \(message)"
        }
    }

    /// 429, 5xx, dropped connections and timeouts are worth another try. Bad requests and being
    /// offline are not.
    var isRetryable: Bool {
        switch self {
        case .http(let status, _):
            return status == 408 || status == 409 || status == 425 || status == 429 || status >= 500
        case .network, .timedOut, .emptyReply:
            return true
        case .notConfigured, .offline, .invalidReply:
            return false
        }
    }

    /// A short, human reason for the Studio timeline.
    var shortReason: String {
        switch self {
        case .notConfigured: return "no Muse key"
        case .offline: return "offline"
        case .http(let status, _): return status == 429 ? "Muse is busy (HTTP 429)" : "HTTP \(status)"
        case .network: return "network error"
        case .timedOut(let seconds): return "no answer in \(Int(seconds.rounded())) s"
        case .emptyReply: return "empty reply"
        case .invalidReply: return "unreadable reply"
        }
    }
}

// MARK: - Call log

/// One Muse call, for the timeline and the CLI's timing report. Holds no key and no prompt text.
struct MuseCallRecord: Sendable {
    var model: String
    var endpoint: String
    var purpose: String
    var seconds: Double
    var attempts: Int
    var ok: Bool
    var promptTokens: Int?
    var completionTokens: Int?
    var reasoningTokens: Int?
    var error: String?
}

/// Thread-safe list of calls made through a `MuseClient`.
final class MuseCallLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [MuseCallRecord] = []

    init() {}

    func add(_ record: MuseCallRecord) {
        lock.lock()
        storage.append(record)
        lock.unlock()
    }

    var records: [MuseCallRecord] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

// MARK: - Client

/// Minimal OpenAI-compatible client for Muse at `https://api.meta.ai/v1`.
///
/// - Bearer auth from `MuseConfig`.
/// - Timeouts per call, retries with backoff on 429/5xx and dropped connections, and Swift task
///   cancellation (cancelling the calling task cancels the request).
/// - The text models reason before answering, so every chat call sends `max_tokens` >= 4000.
final class MuseClient: @unchecked Sendable {
    struct ToolCall: Sendable, Hashable {
        var id: String
        var name: String
        var arguments: String
    }

    struct Usage: Sendable, Hashable {
        var promptTokens: Int?
        var completionTokens: Int?
        var reasoningTokens: Int?
    }

    struct ChatOptions: Sendable {
        var maxTokens: Int = MuseClient.minimumMaxTokens
        /// `response_format: {"type": "json_object"}`.
        var json: Bool = false
        /// OpenAI-style tool definitions (`{"type": "function", "function": {...}}`).
        var tools: [JSONValue]? = nil
        var toolChoice: String? = nil
        /// "low", "medium" or "high". Nil uses the model's default.
        var reasoningEffort: String? = nil
        /// Seconds per attempt.
        var timeout: TimeInterval = 60
        var maxAttempts: Int = 3
        /// What the call is for, e.g. "brief" or "compose turn 2". Shows up in the call log.
        var purpose: String = "chat"

        init(
            maxTokens: Int = MuseClient.minimumMaxTokens,
            json: Bool = false,
            tools: [JSONValue]? = nil,
            toolChoice: String? = nil,
            reasoningEffort: String? = nil,
            timeout: TimeInterval = 60,
            maxAttempts: Int = 3,
            purpose: String = "chat"
        ) {
            self.maxTokens = maxTokens
            self.json = json
            self.tools = tools
            self.toolChoice = toolChoice
            self.reasoningEffort = reasoningEffort
            self.timeout = timeout
            self.maxAttempts = maxAttempts
            self.purpose = purpose
        }
    }

    struct ChatReply: Sendable {
        var model: String
        var content: String
        var toolCalls: [ToolCall]
        var finishReason: String?
        /// The assistant message, ready to append to the conversation for the next turn.
        var message: JSONValue
        var seconds: Double
        var usage: Usage
    }

    /// Reasoning models spend tokens thinking first; small budgets come back empty.
    static let minimumMaxTokens = 4000

    let config: MuseConfig
    let callLog: MuseCallLog
    private let session: URLSession
    private let baseURL: URL

    init(config: MuseConfig, callLog: MuseCallLog = MuseCallLog(), session: URLSession? = nil) {
        self.config = config
        self.callLog = callLog
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 180
            configuration.timeoutIntervalForResource = 600
            configuration.waitsForConnectivity = false
            configuration.httpMaximumConnectionsPerHost = 6
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: configuration)
        }
        let trimmed = config.baseURL.hasSuffix("/") ? String(config.baseURL.dropLast()) : config.baseURL
        self.baseURL = URL(string: trimmed) ?? URL(string: MuseConfig.defaultBaseURL)!
    }

    var isConfigured: Bool { !config.apiKey.isEmpty }

    // MARK: Chat

    /// `POST /chat/completions`. Retries on 429/5xx; doubles the token budget once when a reply is
    /// cut off before any content.
    func chat(model: String, messages: [JSONValue], options: ChatOptions = ChatOptions()) async throws -> ChatReply {
        guard isConfigured else { throw MuseError.notConfigured }
        var body: [String: JSONValue] = [
            "model": .string(model),
            "messages": .array(messages),
        ]
        if options.json {
            body["response_format"] = ["type": "json_object"]
        }
        if let tools = options.tools, !tools.isEmpty {
            body["tools"] = .array(tools)
            body["tool_choice"] = .string(options.toolChoice ?? "auto")
        }
        if let effort = options.reasoningEffort {
            body["reasoning_effort"] = .string(effort)
        }

        var budget = max(options.maxTokens, Self.minimumMaxTokens)
        var attemptsSoFar = 0
        let started = Date()
        for pass in 0..<2 {
            body["max_tokens"] = .number(Double(budget))
            let data: Data
            do {
                data = try await send("chat/completions", body: .object(body), timeout: options.timeout, maxAttempts: options.maxAttempts, attempts: &attemptsSoFar)
            } catch {
                record(model: model, endpoint: "chat", purpose: options.purpose, started: started, attempts: attemptsSoFar, error: error)
                throw error
            }
            let reply: ChatReply
            do {
                reply = try Self.parseChat(data, model: model, seconds: Date().timeIntervalSince(started))
            } catch {
                record(model: model, endpoint: "chat", purpose: options.purpose, started: started, attempts: attemptsSoFar, error: error)
                throw error
            }
            if reply.content.isEmpty && reply.toolCalls.isEmpty {
                if reply.finishReason == "length" && pass == 0 {
                    budget = min(budget * 2, 32_000)
                    continue
                }
                let error = MuseError.emptyReply(model: model, finishReason: reply.finishReason)
                record(model: model, endpoint: "chat", purpose: options.purpose, started: started, attempts: attemptsSoFar, error: error)
                throw error
            }
            callLog.add(MuseCallRecord(
                model: model, endpoint: "chat", purpose: options.purpose,
                seconds: Date().timeIntervalSince(started), attempts: attemptsSoFar, ok: true,
                promptTokens: reply.usage.promptTokens, completionTokens: reply.usage.completionTokens,
                reasoningTokens: reply.usage.reasoningTokens, error: nil
            ))
            return reply
        }
        throw MuseError.emptyReply(model: model, finishReason: "length")
    }

    /// One system + user turn in JSON mode, parsed. Asks again once if the reply isn't JSON.
    func chatJSON(model: String, system: String, user: String, options: ChatOptions = ChatOptions()) async throws -> (value: JSONValue, reply: ChatReply) {
        var options = options
        options.json = true
        let messages: [JSONValue] = [
            ["role": "system", "content": .string(system)],
            ["role": "user", "content": .string(user)],
        ]
        var lastReply: ChatReply?
        for _ in 0..<2 {
            let reply = try await chat(model: model, messages: messages, options: options)
            if let value = MuseJSON.object(in: reply.content) {
                return (value, reply)
            }
            lastReply = reply
        }
        throw MuseError.invalidReply("\(lastReply?.model ?? model) didn't return a JSON object")
    }

    // MARK: Images

    /// `POST /images/generations`. Returns the image bytes (WebP from muse-image-1.0).
    func image(prompt: String, model: String? = nil, timeout: TimeInterval = 90, purpose: String = "cover") async throws -> Data {
        guard isConfigured else { throw MuseError.notConfigured }
        let model = model ?? config.imageModel
        let body: JSONValue = ["model": .string(model), "prompt": .string(prompt), "n": 1]
        let started = Date()
        var attempts = 0
        do {
            let data = try await send("images/generations", body: body, timeout: timeout, maxAttempts: 2, attempts: &attempts)
            let value: JSONValue
            do {
                value = try JSONValue.parse(data)
            } catch {
                throw MuseError.invalidReply("image reply wasn't JSON")
            }
            var bytes: Data?
            if let encoded = value["data"]?[0]?["b64_json"]?.string {
                bytes = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters)
            } else if let link = value["data"]?[0]?["url"]?.string, let url = URL(string: link) {
                let (downloaded, _) = try await session.data(from: url)
                bytes = downloaded
            }
            guard let bytes, !bytes.isEmpty else { throw MuseError.invalidReply("no image in the reply") }
            callLog.add(MuseCallRecord(
                model: model, endpoint: "image", purpose: purpose, seconds: Date().timeIntervalSince(started),
                attempts: attempts, ok: true, promptTokens: value["usage"]?["input_tokens"]?.int,
                completionTokens: value["usage"]?["output_tokens"]?.int, reasoningTokens: nil, error: nil
            ))
            return bytes
        } catch {
            record(model: model, endpoint: "image", purpose: purpose, started: started, attempts: attempts, error: error)
            throw error
        }
    }

    // MARK: Models

    /// `GET /models`: the model ids this key can use.
    func models() async throws -> [String] {
        guard isConfigured else { throw MuseError.notConfigured }
        let started = Date()
        var attempts = 0
        do {
            let data = try await send("models", body: nil, timeout: 15, maxAttempts: 2, attempts: &attempts)
            let ids = (try JSONValue.parse(data))["data"]?.array?.compactMap { $0["id"]?.string } ?? []
            callLog.add(MuseCallRecord(model: "-", endpoint: "models", purpose: "models", seconds: Date().timeIntervalSince(started),
                                       attempts: attempts, ok: true, promptTokens: nil, completionTokens: nil, reasoningTokens: nil, error: nil))
            return ids
        } catch {
            record(model: "-", endpoint: "models", purpose: "models", started: started, attempts: attempts, error: error)
            throw error
        }
    }

    // MARK: - Transport

    /// Sends one request, retrying retryable failures. `attempts` counts every try (it adds up
    /// across calls, so callers can report the total).
    private func send(_ path: String, body: JSONValue?, timeout: TimeInterval, maxAttempts: Int, attempts: inout Int) async throws -> Data {
        let url = baseURL.appendingPathComponent(path)
        let payload = try body?.jsonData()
        var attempt = 0
        while true {
            attempt += 1
            attempts += 1
            try Task.checkCancellation()
            var request = URLRequest(url: url)
            request.httpMethod = payload == nil ? "GET" : "POST"
            request.timeoutInterval = timeout
            request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if let payload {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = payload
            }
            let outcome: Result<(Data, Int), MuseError>
            var retryAfter: String?
            do {
                let (data, response) = try await session.data(for: request)
                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? 0
                if (200..<300).contains(status) {
                    return data
                }
                retryAfter = http?.value(forHTTPHeaderField: "Retry-After")
                outcome = .failure(.http(status: status, message: Self.serverMessage(from: data)))
            } catch let error as URLError {
                if error.code == .cancelled || Task.isCancelled {
                    throw CancellationError()
                }
                outcome = .failure(Self.map(error, timeout: timeout))
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                if Task.isCancelled { throw CancellationError() }
                outcome = .failure(.network(error.localizedDescription))
            }
            if case .failure(let error) = outcome {
                guard error.isRetryable, attempt < maxAttempts else { throw error }
                try await Task.sleep(nanoseconds: Self.backoffNanoseconds(attempt: attempt, retryAfter: retryAfter))
            }
        }
    }

    private func record(model: String, endpoint: String, purpose: String, started: Date, attempts: Int, error: Error) {
        let message: String
        if error is CancellationError {
            message = "cancelled"
        } else if let muse = error as? MuseError {
            message = muse.shortReason
        } else {
            message = error.localizedDescription
        }
        callLog.add(MuseCallRecord(model: model, endpoint: endpoint, purpose: purpose, seconds: Date().timeIntervalSince(started),
                                   attempts: attempts, ok: false, promptTokens: nil, completionTokens: nil, reasoningTokens: nil, error: message))
    }

    static func backoffNanoseconds(attempt: Int, retryAfter: String?) -> UInt64 {
        var seconds: Double
        if let retryAfter, let value = Double(retryAfter.trimmingCharacters(in: .whitespaces)) {
            seconds = min(max(value, 0.5), 10)
        } else {
            seconds = min(0.8 * pow(2, Double(attempt - 1)), 8) + Double.random(in: 0...0.4)
        }
        seconds = max(seconds, 0.2)
        return UInt64(seconds * 1_000_000_000)
    }

    private static func map(_ error: URLError, timeout: TimeInterval) -> MuseError {
        switch error.code {
        case .timedOut:
            return .timedOut(seconds: timeout)
        case .notConnectedToInternet, .internationalRoamingOff, .dataNotAllowed, .callIsActive:
            return .offline(error.localizedDescription)
        default:
            return .network(error.localizedDescription)
        }
    }

    /// `{"error": {"message": ...}}` or the start of the body. Never includes request headers.
    private static func serverMessage(from data: Data) -> String {
        if let value = try? JSONValue.parse(data) {
            if let message = value["error"]?["message"]?.string { return String(message.prefix(300)) }
            if let message = value["error"]?.string { return String(message.prefix(300)) }
            if let message = value["message"]?.string { return String(message.prefix(300)) }
        }
        return String(String(decoding: data.prefix(300), as: UTF8.self).filter { !$0.isNewline })
    }

    static func parseChat(_ data: Data, model: String, seconds: Double) throws -> ChatReply {
        let value: JSONValue
        do {
            value = try JSONValue.parse(data)
        } catch {
            throw MuseError.invalidReply("the reply wasn't JSON")
        }
        guard let choice = value["choices"]?[0] else {
            throw MuseError.invalidReply("no choices in the reply")
        }
        let message = choice["message"] ?? .object([:])
        let content = (message["content"]?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var calls: [ToolCall] = []
        for (index, call) in (message["tool_calls"]?.array ?? []).enumerated() {
            guard let function = call["function"], let name = function["name"]?.string else { continue }
            let arguments: String
            if let text = function["arguments"]?.string {
                arguments = text
            } else if let object = function["arguments"], !object.isNull {
                arguments = object.jsonString()
            } else {
                arguments = "{}"
            }
            let id = call["id"]?.string ?? "call_\(index)_\(UUID().uuidString.prefix(8).lowercased())"
            calls.append(ToolCall(id: id, name: name, arguments: arguments))
        }
        var echo: [String: JSONValue] = ["role": "assistant", "content": content.isEmpty ? .null : .string(content)]
        if !calls.isEmpty {
            echo["tool_calls"] = .array(calls.map { call in
                ["id": .string(call.id), "type": "function", "function": ["name": .string(call.name), "arguments": .string(call.arguments)]]
            })
        }
        let usage = value["usage"]
        return ChatReply(
            model: value["model"]?.string ?? model,
            content: content,
            toolCalls: calls,
            finishReason: choice["finish_reason"]?.string,
            message: .object(echo),
            seconds: seconds,
            usage: Usage(
                promptTokens: usage?["prompt_tokens"]?.int,
                completionTokens: usage?["completion_tokens"]?.int,
                reasoningTokens: usage?["completion_tokens_details"]?["reasoning_tokens"]?.int
            )
        )
    }
}

// MARK: - JSON in model replies

enum MuseJSON {
    /// The JSON object in a model reply, tolerating code fences and stray prose around it.
    static func object(in text: String) -> JSONValue? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let value = try? JSONValue.parse(trimmed), value.object != nil {
            return value
        }
        var body = trimmed
        if body.hasPrefix("```") {
            if let firstNewline = body.firstIndex(of: "\n") {
                body = String(body[body.index(after: firstNewline)...])
            }
            if let fence = body.range(of: "```", options: .backwards) {
                body = String(body[..<fence.lowerBound])
            }
            if let value = try? JSONValue.parse(body), value.object != nil {
                return value
            }
        }
        if let start = body.firstIndex(of: "{"), let end = body.lastIndex(of: "}"), start < end {
            if let value = try? JSONValue.parse(String(body[start...end])), value.object != nil {
                return value
            }
        }
        return nil
    }

    /// Tool-call arguments: a JSON object, or an empty object when the model sent nothing usable.
    static func arguments(_ text: String) -> JSONValue? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .object([:]) }
        return object(in: trimmed)
    }
}
