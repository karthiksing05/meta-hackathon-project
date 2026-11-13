import Foundation

// bubble-studio --microgame "a cozy game about lanterns" [--fake-muse] [--out FILE.json] [--repairs N]
//               [--revise FILE.json] [--fake-good FILE.authoring.json]
//
// Runs MicrogameComposer (FacebookClone/Bubbles/Studio/MicrogameComposer.swift) headless: the same
// hidden WKWebView page as the app (macOS WebKit runs the WebAssembly engine), with real Muse when a
// key is configured, or a scripted Muse with --fake-muse: first a manifest with a misspelled param
// (exercises the repair loop), then authoring/games/tide_taps.authoring.json (or --fake-good).

/// The Studio page as the app bundle has it: the page and both scripts copied flat into one folder.
@MainActor func cliMicrogameStudio() -> MicrogameStudio {
    let files = [
        "FacebookClone/Bubbles/Studio/web/microgame-studio.html",
        "FacebookClone/Bubbles/Studio/web/microgame-studio.js",
        "FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js",
    ]
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("bubble-studio-microgame-\(ProcessInfo.processInfo.processIdentifier)")
    try? FileManager.default.removeItem(at: dir)
    do {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for file in files {
            let source = root.appendingPathComponent(file)
            try FileManager.default.copyItem(at: source, to: dir.appendingPathComponent(source.lastPathComponent))
        }
    } catch {
        fail("couldn't stage the Studio page: \(error.localizedDescription)")
    }
    atexit { try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("bubble-studio-microgame-\(ProcessInfo.processInfo.processIdentifier)")) }
    return MicrogameStudio(source: .files(page: dir.appendingPathComponent("microgame-studio.html"), readAccess: dir))
}

/// First a broken manifest (a misspelled param), then a good one.
func fakeMicrogameMuse() -> ScriptedMicrogameMuse {
    let path = args.value("fake-good") ?? root.appendingPathComponent("authoring/games/tide_taps.authoring.json").path
    let good = readJSON(path).value
    var broken = good
    if case .object(var top) = good, case .array(var uses)? = top["uses"], let index = uses.firstIndex(where: { $0["params"]?.object?.isEmpty == false }),
       case .object(var use) = uses[index], case .object(var params)? = use["params"], let key = params.keys.sorted().first {
        params["\(key)z"] = params.removeValue(forKey: key)
        use["params"] = .object(params)
        uses[index] = .object(use)
        top["uses"] = .array(uses)
        broken = .object(top)
    }
    return ScriptedMicrogameMuse(replies: [broken, good], model: "fake-muse")
}

@MainActor func microgameEventLine(_ event: MicrogameComposer.Event, since started: Date) -> String {
    let time = String(format: "[%5.1fs]", Date().timeIntervalSince(started))
    switch event {
    case .drafting(let attempt): return "\(time) drafting    attempt \(attempt)"
    case .expanding: return "\(time) expanding"
    case .repairing(let round, let issues):
        return "\(time) repairing   round \(round)" + issues.map { "\n           · \($0)" }.joined()
    case .playtesting(let bots): return "\(time) playtesting \(bots) bots"
    case .playtested(let report):
        return "\(time) playtested  \(report.passed ? "passed" : "FLAGGED"): \(report.headline) · \(report.spread)"
    case .drawingArt: return "\(time) drawing art"
    case .done(let manifest): return "\(time) done        \(manifest.title) (\(manifest.id))"
    case .failed(let message): return "\(time) failed      \(message)"
    }
}

@MainActor func runMicrogame(_ prompt: String) async {
    let studio = cliMicrogameStudio()
    let muse: any MicrogameMuse
    if args.has("fake-muse") {
        muse = fakeMicrogameMuse()
        say("Muse: scripted (--fake-muse): a misspelled param first, then a good manifest")
    } else if let config = MuseConfig.load(file: configURL) {
        muse = MuseClient(config: config)
        say("Muse: \(config.redactedDescription)")
    } else {
        fail("no Muse key (MuseConfig.json or MUSE_API_KEY); pass --fake-muse to use a scripted Muse")
    }

    let started = Date()
    await studio.warmUp()
    let catalog: MicrogameCatalog
    do { catalog = try await studio.catalog() } catch { fail(error.localizedDescription) }
    say("Studio page ready in \(String(format: "%.2f s", Date().timeIntervalSince(started))): \(catalog.fragments.count) fragments, \(catalog.looks.count) looks, " +
        "\(catalog.examples.count) examples, writes \(catalog.gameFormat); system prompt \(MicrogamePrompts.system(catalog).count) chars")
    say("")

    let composer = MicrogameComposer(muse: muse, studio: studio, maxRepairRounds: args.int("repairs") ?? 3)
    var lastReport: StudioPlaytest.Report?
    let composeStarted = Date()
    let onEvent: @MainActor (MicrogameComposer.Event) -> Void = { event in
        if case .playtested(let report) = event { lastReport = report }
        say(microgameEventLine(event, since: composeStarted))
    }
    let manifest: BubbleManifest
    do {
        if let base = args.value("revise") {
            manifest = try await composer.revise(loadManifest(base), request: prompt, onEvent: onEvent)
        } else {
            manifest = try await composer.compose(request: prompt, brief: BubbleBrief(intent: prompt), onEvent: onEvent)
        }
    } catch {
        fail("microgame failed: \(error.localizedDescription)")
    }

    // Check the result as the app would get it: decode, re-expand content.authoring_json, compare.
    say("")
    say("Title: \(manifest.title) · \(manifest.oneLineRule)")
    say("Bubble: \(manifest.id) v\(manifest.version), formula \(manifest.formula.rawValue), seed \(manifest.seed), style \(manifest.style.look)/\(manifest.style.palette) \(manifest.style.emoji ?? "")")
    // The game and authoring manifest are stored as JSON text (content.game_json and
    // content.authoring_json), so key order survives; re-expand the text and compare texts.
    let storedGame = manifest.content["game_json"]?.string ?? ""
    let storedAuthoring = manifest.content["authoring_json"]?.string ?? ""
    if let check = try? await studio.expand(text: storedAuthoring) {
        let same = !storedGame.isEmpty && check.gameJSON == storedGame
        let warnings = check.diagnostics.filter { $0.severity != .error }.count
        say("Validation: \(check.ok ? "valid" : "INVALID") (\(check.errors.count) errors, \(warnings) warnings; expand \(String(format: "%.1f", check.expandMilliseconds)) ms, " +
            "engine \(String(format: "%.1f", check.validateMilliseconds)) ms) · content.authoring_json re-expands to content.game_json: \(same ? "yes" : "NO")")
        for d in check.errors { say("  \(d.audience.rawValue) \(d.line)") }
    }
    if let report = lastReport {
        say("Gate: \(report.passed ? "passed" : "FLAGGED") · \(report.headline) · \(report.spread)")
        for run in report.runs {
            say("  \(pad(run.bot.label, 18)) skill \(String(format: "%.2f", run.bot.skill))  \(pad(run.outcome, 8)) score \(pad(String(run.score), 7)) \(secondsText(run.seconds))\(run.error.map { "  error: \($0)" } ?? "")")
        }
        for flag in report.flags { say("  \(flag.blocking ? "BLOCKING" : "note") \(flag.code): \(flag.message)") }
    }
    let stats = composer.lastStats
    say("Examples in the prompt: \(stats.examples.isEmpty ? "the fixed set" : stats.examples.joined(separator: ", "))")
    say("Muse: \(stats.museCalls) calls (\(stats.models.joined(separator: ", "))) · first draft \(stats.firstDraftValid == true ? "valid" : "invalid") · " +
        "\(stats.repairRounds) repair rounds\(stats.playtestRepair ? " + 1 playtest repair" : "") · \(secondsText(stats.seconds))")
    if !composer.libraryIssues.isEmpty {
        say("Library issues (logged, not shown to Muse):")
        for d in composer.libraryIssues { say("  \(d.origin ?? "?") \(d.line)") }
    }
    if let out = args.value("out") {
        let url = resolve(out)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        do {
            try manifest.jsonData(pretty: true).write(to: url)
            say("Saved \(out)")
        } catch {
            fail("couldn't write \(out): \(error.localizedDescription)")
        }
    }
    if lastReport?.passed != true { exit(2) }
}
