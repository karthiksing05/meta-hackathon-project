import Foundation
import WebKit

// Muse Studio's microgame path (docs/BUBBLES.md 7.12): the authoring layer (expander, engine
// validation, bot gate, Bubble wrapper) running in one hidden WKWebView. The page is
// `microgame-studio.html`, which loads the engine (`bubble-kit-microgame-engine.js`, WebAssembly)
// and the generated `microgame-studio.js` (authoring/tools/make-studio-bundle.mjs). A bare
// JSContext on iOS has no WebAssembly, so this can't run in `BubbleJSRuntime`.
//
// Foundation and WebKit only: the macOS CLI (tools/bubble-studio) compiles this file too.

// MARK: - Results

/// One diagnostic from the expander or the engine, mapped back to the authoring manifest.
struct MicrogameDiagnostic: Hashable, Sendable {
    enum Severity: String, Sendable { case error, warning, info }
    /// Who has to fix it (authoring/SPEC.md 3): the model (its own manifest) or us (a fragment or
    /// look in the library).
    enum Audience: String, Sendable { case model, library }

    var severity: Severity
    var code: String
    /// JSON Pointer into the authoring manifest, when there is one.
    var at: String?
    var message: String
    var hint: String?
    var audience: Audience
    /// "game", "use:<id>", "look:<id>" or "library".
    var origin: String?
    var fragment: String?
    /// For library diagnostics: the only thing the model is told (that the fragment can't take
    /// those params, or that the look doesn't work).
    var modelNote: String?

    init(severity: Severity, code: String, at: String? = nil, message: String, hint: String? = nil, audience: Audience,
         origin: String? = nil, fragment: String? = nil, modelNote: String? = nil) {
        self.severity = severity
        self.code = code
        self.at = at
        self.message = message
        self.hint = hint
        self.audience = audience
        self.origin = origin
        self.fragment = fragment
        self.modelNote = modelNote
    }

    init(json: JSONValue) {
        severity = Severity(rawValue: json["severity"]?.string ?? "error") ?? .error
        code = json["code"]?.string ?? "E_UNKNOWN"
        at = json["at"]?.string
        message = json["message"]?.string ?? ""
        hint = json["hint"]?.string
        audience = Audience(rawValue: json["audience"]?.string ?? "model") ?? .model
        origin = json["origin"]?.string
        fragment = json["fragment"]?.string
        modelNote = json["model_note"]?.string
    }

    /// "E_UNKNOWN_NAME at /rules/1/do/0/to: no state named 'x' (did you mean 'y'?)"
    var line: String {
        var text = code
        if let at, !at.isEmpty { text += " at \(at)" }
        text += ": \(message)"
        if let hint, !hint.isEmpty { text += " (\(hint))" }
        return text
    }
}

/// An authoring manifest expanded into a `game.json` and validated by the engine.
struct MicrogameExpansion: Sendable {
    /// The authoring manifest, made sort-safe (function params and state inits that key sorting
    /// would break are renamed or inlined); `.string` with the raw text when it wasn't JSON.
    var authoring: JSONValue
    /// The expanded `game.json` (`.null` when the expander stopped on errors). Sort-safe, and checked
    /// with sorted keys, which is how the player gets it.
    var game: JSONValue
    /// The copy the bots play (with the hidden `__progress` value when the manifest has a
    /// `playtest.progress` hint); the same as `game` otherwise.
    var playtestGame: JSONValue
    /// The same three as exact JSON text from the page. `JSONValue` re-encodes objects with sorted
    /// keys, and key order is part of a game's meaning (positional function params, state init
    /// order), so gate and wrap use these, and the Bubble stores the game as text.
    var authoringJSON: String = ""
    var gameJSON: String = ""
    var playtestGameJSON: String = ""
    var diagnostics: [MicrogameDiagnostic]
    /// No errors from the expander or the engine, for the model or the library.
    var ok: Bool
    var expandMilliseconds: Double = 0
    var validateMilliseconds: Double = 0

    var errors: [MicrogameDiagnostic] { diagnostics.filter { $0.severity == .error } }
    var modelErrors: [MicrogameDiagnostic] { errors.filter { $0.audience == .model } }
    var libraryErrors: [MicrogameDiagnostic] { errors.filter { $0.audience == .library } }
}

/// The quality check's verdict (authoring/expander/quality.mjs): 0–100, the number of major issues,
/// and one line per issue, ready for Muse's polish turn.
struct MicrogameQuality: Sendable, Hashable {
    var score: Int
    var major: Int
    var lines: [String]

    /// Worth a polish round: any major issue, or a score under 85 (prompts.mjs `needsPolish`).
    var needsPolish: Bool { major > 0 || score < 85 }
}

/// What Muse can build microgames from, read from the bundle so the prompt can't drift.
struct MicrogameCatalog: Sendable {
    struct Fragment: Sendable, Hashable {
        var id: String
        var version: Int
        var describe: String
        /// `{name: {type, default, min, max, values, max_len}}` as in the fragment file.
        var params: JSONValue
        /// `{section: ["name: type", ...]}`.
        var requires: [String: [String]]
        var provides: [String: [String]]
        var slots: [String]
        var conflicts: [String]
    }

    struct Look: Sendable, Hashable {
        var id: String
        var describe: String
        var font: String?
        var tokens: [String: String]
    }

    struct Example: Sendable, Hashable {
        var name: String
        var manifest: JSONValue
    }

    /// Ready-made prompt sections, rendered by the bundle from the data above.
    struct PromptText: Sendable, Hashable {
        var fragments: String
        var looks: String
        var engine: String
        var format: String
        var examples: String
    }

    var fragments: [Fragment]
    var looks: [Look]
    /// The engine's `microgame catalog --json`.
    var engine: JSONValue
    /// SPEC.md sections 1.1–1.4 and 2, the model-facing format rules.
    var formatRules: String
    var examples: [Example]
    var prompt: PromptText
    /// "microgame/0.1": what the expander writes.
    var gameFormat: String
    var build: JSONValue

    init(json: JSONValue) {
        func strings(_ value: JSONValue?) -> [String: [String]] {
            (value?.object ?? [:]).mapValues { $0.strings }
        }
        fragments = (json["fragments"]?.array ?? []).map { f in
            Fragment(id: f["id"]?.string ?? "", version: f["version"]?.int ?? 1, describe: f["describe"]?.string ?? "",
                     params: f["params"] ?? .object([:]), requires: strings(f["requires"]), provides: strings(f["provides"]),
                     slots: f["slots"]?.strings ?? [], conflicts: f["conflicts"]?.strings ?? [])
        }
        looks = (json["looks"]?.array ?? []).map { l in
            Look(id: l["id"]?.string ?? "", describe: l["describe"]?.string ?? "", font: l["font"]?.string,
                 tokens: (l["tokens"]?.object ?? [:]).compactMapValues { $0.string })
        }
        engine = json["engine"] ?? .object([:])
        formatRules = json["format_rules"]?.string ?? ""
        examples = (json["examples"]?.array ?? []).map { Example(name: $0["name"]?.string ?? "", manifest: $0["manifest"] ?? .null) }
        let p = json["prompt"]
        prompt = PromptText(fragments: p?["fragments"]?.string ?? "", looks: p?["looks"]?.string ?? "", engine: p?["engine"]?.string ?? "",
                            format: p?["format"]?.string ?? "", examples: p?["examples"]?.string ?? "")
        gameFormat = json["game_format"]?.string ?? "microgame/0.1"
        build = json["build"] ?? .null
    }
}

enum MicrogameStudioError: Error, LocalizedError {
    /// `microgame-studio.html` (or its scripts) isn't where the source says.
    case pageMissing(String)
    case loadFailed(String)
    /// The page loaded but the engine or `MicrogameStudio` didn't start.
    case engineUnavailable(String)
    /// The page threw.
    case javaScript(String)
    case badReply(String)
    case timedOut(operation: String, seconds: TimeInterval)
    /// `gate` or `wrap` was given an expansion with errors.
    case notValid([MicrogameDiagnostic])

    var errorDescription: String? {
        switch self {
        case .pageMissing(let what): return "The microgame Studio page is missing: \(what)."
        case .loadFailed(let message): return "The microgame Studio page didn't load: \(message)"
        case .engineUnavailable(let message): return "The microgame engine isn't available: \(message)"
        case .javaScript(let message): return "Microgame Studio failed: \(message)"
        case .badReply(let message): return "Microgame Studio returned something unexpected: \(message)"
        case .timedOut(let operation, let seconds): return "Microgame Studio took longer than \(Int(seconds)) s to \(operation)."
        case .notValid(let issues): return "The microgame doesn't validate: \(issues.first?.line ?? "unknown error")"
        }
    }
}

// MARK: - Studio

/// The authoring layer for microgames on one hidden, lazily created `WKWebView` (never on screen).
/// Every call waits for the page; `warmUp()` loads it early. Calls time out, and a timed-out or
/// crashed page is thrown away and reloaded on the next call.
@MainActor final class MicrogameStudio {
    enum Source {
        /// `microgame-studio.html` and its scripts, flat in an app bundle.
        case bundle(Bundle)
        /// A page and the folder it may read (the scripts must sit next to it), e.g. for the CLI.
        case files(page: URL, readAccess: URL)
    }

    struct Timeouts: Sendable {
        var load: TimeInterval = 20
        var catalog: TimeInterval = 20
        var expand: TimeInterval = 20
        /// Five bots, one after another; most games take well under 10 s.
        var gate: TimeInterval = 150
        var wrap: TimeInterval = 10

        init() {}
    }

    /// One page for the whole app. Nothing loads until the first call (or `warmUp()`).
    nonisolated static let shared = MicrogameStudio()

    let source: Source
    var timeouts: Timeouts

    private var webView: WKWebView?
    private var loader: MicrogamePageLoader?
    private var loading: Task<WKWebView, Error>?
    private var cachedCatalog: MicrogameCatalog?

    nonisolated init(source: Source = .bundle(.main), timeouts: Timeouts = Timeouts()) {
        self.source = source
        self.timeouts = timeouts
    }

    /// Loads the page and the catalog ahead of the first real call. Never throws.
    func warmUp() async {
        _ = try? await catalog()
    }

    /// Fragments, looks, the engine catalog and ready-made prompt text. Cached after the first call.
    func catalog() async throws -> MicrogameCatalog {
        if let cachedCatalog { return cachedCatalog }
        let text = try await call("return MicrogameStudio.catalog()", operation: "read the catalog", timeout: timeouts.catalog)
        guard let json = try? JSONValue.parse(text), json["fragments"]?.array != nil else {
            throw MicrogameStudioError.badReply("catalog isn't JSON")
        }
        let catalog = MicrogameCatalog(json: json)
        cachedCatalog = catalog
        return catalog
    }

    /// The gold examples closest to `request` (authoring/gold/, picked by expander/gold.mjs), as prompt
    /// text with each one's request, why it works, the mistakes it avoids and its manifest.
    func examples(for request: String, count: Int = 2) async throws -> (ids: [String], text: String) {
        let text = try await call("return MicrogameStudio.examples(request, count)",
                                  arguments: ["request": request, "count": count],
                                  operation: "pick examples", timeout: timeouts.catalog)
        guard let json = try? JSONValue.parse(text), let prompt = json["text"]?.string else {
            throw MicrogameStudioError.badReply("examples didn't return text")
        }
        return ((json["ids"]?.array ?? []).compactMap(\.string), prompt)
    }

    /// One of Muse's prompts from the bundle (authoring/expander/prompts.mjs), the same text the
    /// server's generator sends: "system", "compose", "revise", "repair", "playtest_repair", "polish".
    func prompt(_ name: String, _ args: [String: JSONValue]) async throws -> String {
        try await call("return MicrogameStudio.prompt(name, args)",
                       arguments: ["name": name, "args": JSONValue.object(args).jsonString()],
                       operation: "write the prompt", timeout: timeouts.catalog)
    }

    /// The quality check (authoring/expander/quality.mjs) on an expansion's authoring manifest:
    /// what still reads as unfinished next to the gold games. `request` enables the theme check.
    func quality(_ e: MicrogameExpansion, request: String) async throws -> MicrogameQuality {
        let text = try await call("return MicrogameStudio.quality(json, request)",
                                  arguments: ["json": e.authoringJSON.isEmpty ? e.authoring.jsonString() : e.authoringJSON, "request": request],
                                  operation: "check the game's quality", timeout: timeouts.expand)
        guard let json = try? JSONValue.parse(text), let score = json["score"]?.int else {
            throw MicrogameStudioError.badReply("quality didn't return a score")
        }
        return MicrogameQuality(score: score, major: json["major"]?.int ?? 0, lines: (json["lines"]?.array ?? []).compactMap(\.string))
    }

    /// Expands an authoring manifest (or a microgame Bubble wrapper) and validates it in the engine.
    /// Problems come back as diagnostics, not errors; this throws only when the page fails.
    func expand(_ authoring: JSONValue) async throws -> MicrogameExpansion {
        try await expand(text: authoring.jsonString(), fallback: authoring)
    }

    /// The same from JSON text, e.g. Muse's reply as it came (code fences and prose around the object
    /// are fine). Prefer this for model output: `JSONValue` sorts object keys, and the engine reads
    /// key order in function params and state inits. The returned `authoring` is the manifest made
    /// sort-safe (authoring/expander/stable.mjs), so it can be stored and re-encoded freely.
    func expand(text: String) async throws -> MicrogameExpansion {
        try await expand(text: text, fallback: nil)
    }

    private func expand(text: String, fallback: JSONValue?) async throws -> MicrogameExpansion {
        let reply = try await call("return MicrogameStudio.expand(json)", arguments: ["json": text],
                                   operation: "expand the game", timeout: timeouts.expand)
        guard let json = try? JSONValue.parse(reply), json["ok"]?.bool != nil else {
            throw MicrogameStudioError.badReply("expand didn't return a result")
        }
        let game = json["game"] ?? .null
        let playtest = json["playtest_game"].flatMap { $0.isNull ? nil : $0 } ?? game
        let authoring = json["authoring"].flatMap { $0.isNull ? nil : $0 } ?? fallback ?? (try? JSONValue.parse(text)) ?? .string(text)
        return MicrogameExpansion(
            authoring: authoring,
            game: game,
            playtestGame: playtest,
            authoringJSON: json["authoring_json"]?.string ?? authoring.jsonString(),
            gameJSON: json["game_json"]?.string ?? game.jsonString(),
            playtestGameJSON: json["playtest_game_json"]?.string ?? playtest.jsonString(),
            diagnostics: (json["diagnostics"]?.array ?? []).map(MicrogameDiagnostic.init(json:)),
            ok: json["ok"]?.bool ?? false,
            expandMilliseconds: json["ms"]?["expand"]?.double ?? 0,
            validateMilliseconds: json["ms"]?["validate"]?.double ?? 0
        )
    }

    /// The five-bot playtest (authoring/playtest, the same bots and flags as `StudioPlaytest`),
    /// on the playtest copy of the game. Runs are capped at 180 s, as in the authoring gate.
    func gate(_ e: MicrogameExpansion, seed: Int) async throws -> StudioPlaytest.Report {
        guard e.ok else { throw MicrogameStudioError.notValid(e.errors) }
        let text = try await call("return await MicrogameStudio.gate(json, seed)",
                                  arguments: ["json": e.playtestGameJSON.isEmpty ? e.playtestGame.jsonString() : e.playtestGameJSON, "seed": seed],
                                  operation: "playtest the game", timeout: timeouts.gate)
        guard let json = try? JSONValue.parse(text), let runs = json["runs"]?.array else {
            throw MicrogameStudioError.badReply("gate didn't return runs")
        }
        return StudioPlaytest.Report(
            runs: runs.map { run in
                let bot = run["bot"]
                return StudioPlaytest.Run(
                    bot: StudioPlaytest.Bot(label: bot?["label"]?.string ?? "bot", skill: bot?["skill"]?.double ?? 0,
                                            botSeed: bot?["bot_seed"]?.int ?? 0, seedOffset: bot?["seed_offset"]?.int ?? 0),
                    ok: run["ok"]?.bool ?? false,
                    error: run["error"]?.string,
                    outcome: run["outcome"]?.string ?? "error",
                    score: run["score"]?.int ?? 0,
                    seconds: run["seconds"]?.double ?? 0,
                    events: [:]
                )
            },
            flags: (json["flags"]?.array ?? []).map {
                StudioPlaytest.Flag(code: $0["code"]?.string ?? "flag", message: $0["message"]?.string ?? "", blocking: $0["blocking"]?.bool ?? false)
            }
        )
    }

    /// Wraps the expanded game as a `formula: "microgame"` Bubble (authoring/expander/wrap.mjs):
    /// the game as text in `content.game_json`, the authoring manifest (fragment versions pinned)
    /// as text in `content.authoring_json`, and frame colors picked from the game.
    func wrap(_ e: MicrogameExpansion, id: String, brief: BubbleBrief?, emoji: String?) async throws -> BubbleManifest {
        try await wrap(e, id: id, brief: brief, emoji: emoji, seed: nil)
    }

    func wrap(_ e: MicrogameExpansion, id: String, brief: BubbleBrief?, emoji: String?, seed: Int?) async throws -> BubbleManifest {
        guard e.ok else { throw MicrogameStudioError.notValid(e.errors) }
        // Exact text from expand, so the stored game is byte-for-byte what was validated and gated.
        var options: [String: JSONValue] = ["id": .string(id), "game_json": .string(e.gameJSON.isEmpty ? e.game.jsonString() : e.gameJSON)]
        if !e.authoringJSON.isEmpty { options["authoring_json"] = .string(e.authoringJSON) }
        if let brief, let value = try? JSONValue.encode(brief) { options["brief"] = value }
        if let emoji, !emoji.isEmpty { options["emoji"] = .string(emoji) }
        if let seed { options["seed"] = .number(Double(seed)) }
        let text = try await call("return MicrogameStudio.wrap(json)", arguments: ["json": JSONValue.object(options).jsonString()],
                                  operation: "wrap the game", timeout: timeouts.wrap)
        do {
            return try BubbleManifest.decode(text)
        } catch {
            throw MicrogameStudioError.badReply("wrap: \(error)")
        }
    }

    /// Throws the page away; the next call loads a fresh one.
    func reset() {
        loading?.cancel()
        loading = nil
        webView?.navigationDelegate = nil
        webView?.stopLoading()
        webView = nil
        loader = nil
    }

    // MARK: - Page

    private func page() throws -> (page: URL, readAccess: URL) {
        switch source {
        case .bundle(let bundle):
            guard let url = bundle.url(forResource: "microgame-studio", withExtension: "html") else {
                throw MicrogameStudioError.pageMissing("microgame-studio.html isn't in the app bundle")
            }
            // Resources are flat in the bundle: the scripts sit next to the page.
            return (url, url.deletingLastPathComponent())
        case .files(let page, let readAccess):
            guard FileManager.default.fileExists(atPath: page.path) else {
                throw MicrogameStudioError.pageMissing(page.path)
            }
            return (page, readAccess)
        }
    }

    private func loadedWebView() async throws -> WKWebView {
        if let webView { return webView }
        if let loading {
            return try await StudioAsyncMain.withTimeout(timeouts.load, operation: "load") { try await loading.value }
        }
        let (page, readAccess) = try self.page()
        let loader = MicrogamePageLoader()
        loader.onCrash = { [weak self] in self?.reset() }
        self.loader = loader
        let task = Task { @MainActor () throws -> WKWebView in
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 360, height: 640), configuration: configuration)
            #if DEBUG
            if #available(iOS 16.4, macOS 13.3, *) { view.isInspectable = true }
            #endif
            view.navigationDelegate = loader
            try await loader.load(view, page: page, readAccess: readAccess)
            // The scripts ran: check that the Studio API is there.
            let check = try await Self.evaluate(view, "if (typeof MicrogameStudio === 'undefined') { return 'missing' } return 'ok'", arguments: [:])
            guard check == "ok" else {
                throw MicrogameStudioError.engineUnavailable("microgame-studio.js didn't load")
            }
            return view
        }
        loading = task
        do {
            let view = try await StudioAsyncMain.withTimeout(timeouts.load, operation: "load") { try await task.value }
            webView = view
            loading = nil
            return view
        } catch {
            loading = nil
            reset()
            if let error = error as? MicrogameStudioError { throw error }
            throw MicrogameStudioError.loadFailed(error.localizedDescription)
        }
    }

    private func call(_ script: String, arguments: [String: Any] = [:], operation: String, timeout: TimeInterval) async throws -> String {
        let view = try await loadedWebView()
        do {
            return try await StudioAsyncMain.withTimeout(timeout, operation: operation) {
                try await Self.evaluate(view, script, arguments: arguments)
            }
        } catch let error as MicrogameStudioError {
            // A call that never came back may still be running in the page: start fresh next time.
            if case .timedOut = error { reset() }
            throw error
        }
    }

    /// `callAsyncJavaScript`, whose body returns a string (or a Promise of one).
    private static func evaluate(_ view: WKWebView, _ script: String, arguments: [String: Any]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            view.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    if let text = value as? String {
                        continuation.resume(returning: text)
                    } else {
                        continuation.resume(throwing: MicrogameStudioError.badReply("expected a string, got \(type(of: value))"))
                    }
                case .failure(let error):
                    let info = (error as NSError).userInfo
                    let message = info["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
                    if message.contains("engine unavailable") {
                        continuation.resume(throwing: MicrogameStudioError.engineUnavailable(message))
                    } else {
                        continuation.resume(throwing: MicrogameStudioError.javaScript(message))
                    }
                }
            }
        }
    }
}

/// Main-actor timeouts that stop waiting (the work itself can't be cancelled inside the page).
enum StudioAsyncMain {
    @MainActor
    static func withTimeout<T>(_ seconds: TimeInterval, operation: String, _ body: @escaping @MainActor () async throws -> T) async throws -> T {
        let gate = OnceGate<T>()
        return try await withCheckedThrowingContinuation { continuation in
            gate.continuation = continuation
            let work = Task { @MainActor in
                do { gate.finish(.success(try await body())) } catch { gate.finish(.failure(error)) }
            }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
                if gate.finish(.failure(MicrogameStudioError.timedOut(operation: operation, seconds: seconds))) { work.cancel() }
            }
        }
    }

    @MainActor
    private final class OnceGate<T> {
        var continuation: CheckedContinuation<T, Error>?

        @discardableResult
        func finish(_ result: Result<T, Error>) -> Bool {
            guard let continuation else { return false }
            self.continuation = nil
            continuation.resume(with: result)
            return true
        }
    }
}

/// Waits for the hidden page to finish loading, and notices when its web content process dies.
@MainActor private final class MicrogamePageLoader: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?
    var onCrash: (() -> Void)?

    func load(_ view: WKWebView, page: URL, readAccess: URL) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
            view.loadFileURL(page, allowingReadAccessTo: readAccess)
        }
    }

    private func finish(_ error: Error?) {
        guard let continuation else { return }
        self.continuation = nil
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finish(nil)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(MicrogameStudioError.loadFailed(error.localizedDescription))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(MicrogameStudioError.loadFailed(error.localizedDescription))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        finish(MicrogameStudioError.loadFailed("the web content process stopped"))
        onCrash?()
    }
}
