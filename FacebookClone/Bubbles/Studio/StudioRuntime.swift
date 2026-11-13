import Foundation

/// The headless Bubble runtime for Muse Studio: catalog, validation and bot playtests on one
/// JavaScriptCore context. `BubbleJSRuntime` isn't thread-safe, so this actor owns it and runs
/// one call at a time. The runtime loads lazily on first use.
actor StudioRuntime {
    enum RuntimeError: Error, LocalizedError {
        case unavailable(String)

        var errorDescription: String? {
            switch self {
            case .unavailable(let message): return "The game engine didn't load: \(message)"
            }
        }
    }

    private let loader: @Sendable () throws -> BubbleJSRuntime
    private var runtime: BubbleJSRuntime?
    private var loadError: String?
    private var cachedCatalog: StudioCatalog?
    private var cachedValidations: [String: BubbleJSRuntime.Validation] = [:]

    init(loader: @escaping @Sendable () throws -> BubbleJSRuntime) {
        self.loader = loader
    }

    /// The runtime scripts copied flat into the app bundle.
    static func bundled(_ bundle: Bundle = .main) -> StudioRuntime {
        let path = bundle.bundlePath
        return StudioRuntime { try BubbleJSRuntime(bundle: Bundle(path: path) ?? .main) }
    }

    /// The runtime scripts in a folder, e.g. `FacebookClone/Bubbles/Runtime/web` (CLI).
    static func directory(_ url: URL) -> StudioRuntime {
        StudioRuntime { try BubbleJSRuntime(directory: url) }
    }

    private func loaded() throws -> BubbleJSRuntime {
        if let runtime { return runtime }
        if let loadError { throw RuntimeError.unavailable(loadError) }
        do {
            let created = try loader()
            runtime = created
            return created
        } catch {
            loadError = error.localizedDescription
            throw RuntimeError.unavailable(error.localizedDescription)
        }
    }

    // MARK: - Catalog

    func catalog() throws -> StudioCatalog {
        if let cachedCatalog { return cachedCatalog }
        let runtime = try loaded()
        let version = runtime.runtimeVersion
        let catalog = StudioCatalog(json: runtime.catalog() ?? .object([:]), runtimeVersion: version)
        cachedCatalog = catalog
        return catalog
    }

    /// `Bubble.version` ("0.0-stub" for the placeholder runtime).
    func version() -> String? {
        (try? loaded())?.runtimeVersion
    }

    // MARK: - Validation

    func validate(_ manifest: BubbleManifest) -> BubbleJSRuntime.Validation {
        validate(json: manifest.jsonString())
    }

    func validate(json: String) -> BubbleJSRuntime.Validation {
        if let cached = cachedValidations[json] { return cached }
        guard let runtime = try? loaded() else {
            return .failure("runtime", loadError ?? "The game engine didn't load")
        }
        let result = runtime.validate(json: json)
        if cachedValidations.count > 64 { cachedValidations.removeAll() }
        cachedValidations[json] = result
        return result
    }

    // MARK: - Simulation

    func simulate(_ manifest: BubbleManifest, seed: Int? = nil, maxTicks: Int = 5400, botSeed: Int? = nil, botSkill: Double? = nil) -> BubbleJSRuntime.Simulation {
        guard let runtime = try? loaded() else {
            return .failure(loadError ?? "The game engine didn't load")
        }
        return runtime.simulate(manifest, seed: seed, maxTicks: maxTicks, bot: true, botSeed: botSeed, botSkill: botSkill)
    }

    /// Plays the manifest with each bot and analyzes the runs.
    func playtest(_ manifest: BubbleManifest, bots: [StudioPlaytest.Bot] = StudioPlaytest.bots) -> StudioPlaytest.Report {
        let json = manifest.jsonString()
        let maxTicks = Int(StudioPlaytest.maxSeconds * 60)
        var runs: [StudioPlaytest.Run] = []
        guard let runtime = try? loaded() else {
            let run = StudioPlaytest.Run(bot: bots.first ?? StudioPlaytest.bots[0], ok: false, error: loadError ?? "runtime missing",
                                         outcome: "error", score: 0, seconds: 0, events: [:])
            return StudioPlaytest.analyze([run])
        }
        for bot in bots {
            let sim = runtime.simulate(json: json, seed: manifest.seed &+ bot.seedOffset, maxTicks: maxTicks, bot: true,
                                       botSeed: bot.botSeed, botSkill: bot.skill)
            let seconds = sim.durationSec > 0 ? sim.durationSec : Double(sim.ticks) / 60
            let ok = sim.ok && sim.error == nil
            runs.append(StudioPlaytest.Run(
                bot: bot,
                ok: ok,
                error: sim.error,
                outcome: ok ? (sim.outcome ?? "timeout") : "error",
                score: sim.score,
                seconds: seconds,
                events: sim.events
            ))
        }
        return StudioFormulaHints.adjust(StudioPlaytest.analyze(runs), for: manifest)
    }
}
