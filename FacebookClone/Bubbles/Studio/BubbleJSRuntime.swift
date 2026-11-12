import Foundation
import JavaScriptCore

/// The Bubble runtime running headless in JavaScriptCore: the concept catalog, validation and
/// bot simulation. It is the same JavaScript the player runs (docs/BUBBLES.md, 4.3 and 4.6).
///
/// Used by Muse Studio (validate and playtest every manifest before it ships), by `BubbleStore`
/// (bot runs that become Bursts) and by the CLI.
///
/// Not thread-safe: create one per queue or actor and only use it there. Loading takes a few
/// milliseconds; reuse an instance rather than creating one per call.
final class BubbleJSRuntime {
    struct Issue: Codable, Hashable, Sendable {
        var code: String
        var message: String
        var path: String?
    }

    struct Validation: Hashable, Sendable {
        var ok: Bool
        var errors: [Issue]
        var warnings: [Issue]

        static func failure(_ code: String, _ message: String) -> Validation {
            Validation(ok: false, errors: [Issue(code: code, message: message, path: nil)], warnings: [])
        }
    }

    struct Simulation: Hashable, Sendable {
        var ok: Bool
        var error: String?
        /// "fail", "success" or "timeout".
        var outcome: String?
        var score: Int
        var ticks: Int
        var durationSec: Double
        /// How many times each bus event fired, e.g. `["entity.passed": 14]`.
        var events: [String: Int]
        var replay: BubbleInputLog?
        /// The whole JSON reply, including any extra fields a kit reports.
        var raw: JSONValue

        static func failure(_ message: String) -> Simulation {
            Simulation(ok: false, error: message, outcome: nil, score: 0, ticks: 0, durationSec: 0, events: [:], replay: nil, raw: .null)
        }
    }

    enum LoadError: Error, LocalizedError {
        case missingScript(String)
        case scriptFailed(String, String)

        var errorDescription: String? {
            switch self {
            case .missingScript(let name): return "Game runtime script \(name) is missing."
            case .scriptFailed(let name, let message): return "Game runtime script \(name) failed to load: \(message)"
            }
        }
    }

    /// The order the runtime's scripts load in, everywhere (host page, JavaScriptCore, tests):
    /// `bubble-runtime.js`, then `bubble-kit-common.js`, then every other `bubble-kit-*.js` by name.
    static func orderedScriptNames(_ names: [String]) -> [String] {
        let kits = names
            .filter { $0.hasPrefix("bubble-kit-") && $0.hasSuffix(".js") && $0 != "bubble-kit-common.js" }
            .sorted()
        var ordered = ["bubble-runtime.js"]
        if names.contains("bubble-kit-common.js") {
            ordered.append("bubble-kit-common.js")
        }
        return ordered + kits
    }

    private let context: JSContext
    private var exception: String?

    init(scripts: [(name: String, source: String)]) throws {
        guard let context = JSContext() else {
            throw LoadError.scriptFailed("JSContext", "could not create a JavaScript context")
        }
        self.context = context
        context.name = "Bubble runtime"
        context.exceptionHandler = { [weak self] _, value in
            self?.exception = value?.toString() ?? "unknown JavaScript exception"
        }
        let log: @convention(block) (String) -> Void = { message in
            if ProcessInfo.processInfo.environment["BUBBLE_JS_LOG"] != nil {
                print("[bubble.js] \(message)")
            }
        }
        context.setObject(log, forKeyedSubscript: "__bubbleLog" as NSString)
        context.evaluateScript("""
        var console = (function () {
          function out() { __bubbleLog(Array.prototype.map.call(arguments, String).join(' ')); }
          return { log: out, info: out, warn: out, error: out, debug: function () {} };
        })();
        """)
        for script in scripts {
            exception = nil
            context.evaluateScript(script.source, withSourceURL: URL(string: "bubble:///\(script.name)"))
            if let exception {
                throw LoadError.scriptFailed(script.name, exception)
            }
        }
    }

    /// Loads the runtime scripts from an app bundle (they are copied flat into its root).
    convenience init(bundle: Bundle = .main) throws {
        try self.init(urls: bundle.urls(forResourcesWithExtension: "js", subdirectory: nil) ?? [])
    }

    /// Loads the runtime scripts from a folder, e.g. `FacebookClone/Bubbles/Runtime/web` for the CLI.
    convenience init(directory: URL) throws {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        try self.init(urls: urls.filter { $0.pathExtension == "js" })
    }

    convenience init(urls: [URL]) throws {
        let byName = Dictionary(urls.map { ($0.lastPathComponent, $0) }, uniquingKeysWith: { first, _ in first })
        var scripts: [(name: String, source: String)] = []
        for name in Self.orderedScriptNames(Array(byName.keys)) {
            guard let url = byName[name] else { throw LoadError.missingScript(name) }
            scripts.append((name, try String(contentsOf: url, encoding: .utf8)))
        }
        try self.init(scripts: scripts)
    }

    // MARK: - Calls

    /// `Bubble.version`, e.g. "1.0.0" ("0.0-stub" for the placeholder runtime).
    var runtimeVersion: String? {
        guard let bubble = context.objectForKeyedSubscript("Bubble"), bubble.isObject,
              let version = bubble.objectForKeyedSubscript("version"), version.isString else {
            return nil
        }
        return version.toString()
    }

    /// `Bubble.catalogJSON()`: every formula and concept with its contract.
    func catalogJSON() -> String? {
        call("catalogJSON", [])
    }

    func catalog() -> JSONValue? {
        catalogJSON().flatMap { try? JSONValue.parse($0) }
    }

    func validate(_ manifest: BubbleManifest) -> Validation {
        validate(json: manifest.jsonString())
    }

    /// `Bubble.validateJSON(manifestJSON)`.
    func validate(json: String) -> Validation {
        guard let out = call("validateJSON", [json]) else {
            return .failure("runtime", exception ?? "validateJSON returned nothing")
        }
        guard let value = try? JSONValue.parse(out) else {
            return .failure("runtime", "validateJSON returned invalid JSON")
        }
        return Validation(
            ok: value["ok"]?.bool ?? false,
            errors: Self.issues(value["errors"]),
            warnings: Self.issues(value["warnings"])
        )
    }

    func simulate(
        _ manifest: BubbleManifest,
        seed: Int? = nil,
        maxTicks: Int = 5400,
        bot: Bool = true,
        botSeed: Int? = nil,
        botSkill: Double? = nil,
        replay: BubbleInputLog? = nil
    ) -> Simulation {
        simulate(json: manifest.jsonString(), seed: seed, maxTicks: maxTicks, bot: bot, botSeed: botSeed, botSkill: botSkill, replay: replay)
    }

    /// Re-plays a recorded run headless and checks it reaches the claimed score. Deterministic
    /// replays make every score verifiable (docs/BUBBLES.md, 4.8).
    func verify(_ manifest: BubbleManifest, replay: BubbleInputLog, claimedScore: Int) -> Bool {
        let run = simulate(manifest, seed: replay.seed, maxTicks: max(replay.totalTicks + 120, 600), bot: false, replay: replay)
        return run.ok && run.score == claimedScore
    }

    /// `Bubble.simulateJSON(manifestJSON, optionsJSON)`: plays the game headless with the formula's
    /// bot (or replays `replay`) and reports the outcome. `botSeed` varies the bot's choices and
    /// `botSkill` (0...1) how well it plays, so bot runs can stand in for different players.
    func simulate(
        json: String,
        seed: Int? = nil,
        maxTicks: Int = 5400,
        bot: Bool = true,
        botSeed: Int? = nil,
        botSkill: Double? = nil,
        replay: BubbleInputLog? = nil
    ) -> Simulation {
        var options: [String: JSONValue] = ["max_ticks": .number(Double(maxTicks)), "bot": .bool(bot)]
        if let seed {
            options["seed"] = .number(Double(seed))
        }
        if let botSeed {
            options["bot_seed"] = .number(Double(botSeed))
        }
        if let botSkill {
            options["bot_skill"] = .number(botSkill)
        }
        if let replay, let value = try? JSONValue.encode(replay) {
            options["replay"] = value
        }
        guard let out = call("simulateJSON", [json, JSONValue.object(options).jsonString()]) else {
            return .failure(exception ?? "simulateJSON returned nothing")
        }
        guard let value = try? JSONValue.parse(out) else {
            return .failure("simulateJSON returned invalid JSON")
        }
        var log: BubbleInputLog?
        if let replayValue = value["replay"], !replayValue.isNull {
            log = try? replayValue.decode(BubbleInputLog.self)
        }
        return Simulation(
            ok: value["ok"]?.bool ?? false,
            error: value["error"]?.string,
            outcome: value["outcome"]?.string,
            score: value["score"]?.int ?? 0,
            ticks: value["ticks"]?.int ?? 0,
            durationSec: value["duration_sec"]?.double ?? 0,
            events: (value["events"]?.object ?? [:]).compactMapValues { $0.int },
            replay: log,
            raw: value
        )
    }

    // MARK: - Private

    private func call(_ function: String, _ arguments: [String]) -> String? {
        exception = nil
        guard let bubble = context.objectForKeyedSubscript("Bubble"), bubble.isObject else {
            exception = "Bubble is not defined"
            return nil
        }
        let result = bubble.invokeMethod(function, withArguments: arguments)
        if exception != nil {
            return nil
        }
        guard let result, result.isString else {
            return nil
        }
        return result.toString()
    }

    private static func issues(_ value: JSONValue?) -> [Issue] {
        (value?.array ?? []).map { item in
            if let text = item.string {
                return Issue(code: "note", message: text, path: nil)
            }
            return Issue(
                code: item["code"]?.string ?? "issue",
                message: item["message"]?.string ?? item.jsonString(),
                path: item["path"]?.string
            )
        }
    }
}
