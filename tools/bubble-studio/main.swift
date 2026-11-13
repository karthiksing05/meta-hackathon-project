import Foundation

// bubble-studio: Muse Studio on macOS. Runs the same harness as the app (FacebookClone/Bubbles/
// Studio) against the runtime scripts in a folder, to make and check Bubbles from the terminal.
// Build with tools/bubble-studio/build.sh. Never prints the Muse key.

let usage = """
bubble-studio: Muse Studio on the command line.

Commands
  catalog [--json]                       Formulas and concepts in the runtime
  validate <file>...                     Validate manifests (seed files are fine)
  simulate <file> [--seed N] [--skill S] [--bot-seed N] [--max-ticks N] [--playtest]
  brief --prompt TEXT [--mode M] [--group ID | --event ID]
  compose --mode create|edit|remix|next_level|daily --prompt TEXT [--base FILE]
          [--group ID | --event ID] [--date yyyy-MM-dd] [--sources N] [--formula F] [--palette P]
          [--recent-looks a,b]   looks of earlier Bubbles, so this one varies (the app remembers these itself)
          --out FILE.json [--cover FILE.webp] [--timeline FILE.txt] [--offline]
  models                                 Muse models this key can use
  --microgame TEXT [--fake-muse] [--out FILE.json] [--repairs N] [--revise FILE.json] [--fake-good FILE]
                                         Make a microgame (MicrogameComposer, docs/BUBBLES.md 7.12) in a hidden
                                         WKWebView. --fake-muse: a scripted Muse (a broken manifest, then a good one)

Options
  --runtime-dir DIR   Runtime scripts (default FacebookClone/Bubbles/Runtime/web)
  --world FILE        Demo world (default FacebookClone/Bubbles/Seeds/bubble-demo-world.json)
  --config FILE       Muse config (default FacebookClone/Bubbles/Studio/MuseConfig.json, then MUSE_API_KEY)
"""

// MARK: - Arguments

struct Arguments {
    var positional: [String] = []
    var options: [String: String] = [:]
    var flags: Set<String> = []

    static let valueOptions: Set<String> = [
        "runtime-dir", "world", "config", "seed", "skill", "bot-seed", "max-ticks", "prompt", "mode", "group", "event",
        "base", "out", "cover", "date", "sources", "formula", "palette", "timeline", "recent-looks",
        "microgame", "repairs", "revise", "fake-good",
    ]

    init(_ raw: [String]) {
        var index = 0
        while index < raw.count {
            let item = raw[index]
            if item.hasPrefix("--") {
                let name = String(item.dropFirst(2))
                if let equals = name.firstIndex(of: "=") {
                    options[String(name[..<equals])] = String(name[name.index(after: equals)...])
                } else if Self.valueOptions.contains(name), index + 1 < raw.count {
                    options[name] = raw[index + 1]
                    index += 1
                } else {
                    flags.insert(name)
                }
            } else {
                positional.append(item)
            }
            index += 1
        }
    }

    func value(_ name: String) -> String? { options[name] }
    func int(_ name: String) -> Int? { options[name].flatMap { Int($0) } }
    func double(_ name: String) -> Double? { options[name].flatMap { Double($0) } }
    func has(_ name: String) -> Bool { flags.contains(name) }
}

// MARK: - Output

func say(_ text: String = "") {
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

func fail(_ text: String) -> Never {
    FileHandle.standardError.write(Data(("error: " + text + "\n").utf8))
    exit(1)
}

func pad(_ text: String, _ width: Int) -> String {
    text.count >= width ? text : text + String(repeating: " ", count: width - text.count)
}

func secondsText(_ value: Double) -> String { String(format: "%.1f s", value) }

// MARK: - Paths

/// The repo root: the nearest folder up from the working directory that has FacebookClone/Bubbles.
func repoRoot() -> URL {
    var url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    for _ in 0..<8 {
        if FileManager.default.fileExists(atPath: url.appendingPathComponent("FacebookClone/Bubbles").path) { return url }
        url.deleteLastPathComponent()
    }
    return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
}

func resolve(_ path: String) -> URL {
    path.hasPrefix("/") ? URL(fileURLWithPath: path) : URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(path)
}

let args = Arguments(Array(CommandLine.arguments.dropFirst()))
let root = repoRoot()
let runtimeDir = args.value("runtime-dir").map(resolve) ?? root.appendingPathComponent("FacebookClone/Bubbles/Runtime/web")
let worldURL = args.value("world").map(resolve) ?? root.appendingPathComponent("FacebookClone/Bubbles/Seeds/bubble-demo-world.json")
let configURL = args.value("config").map(resolve) ?? root.appendingPathComponent("FacebookClone/Bubbles/Studio/MuseConfig.json")

func loadRuntime() -> BubbleJSRuntime {
    do {
        return try BubbleJSRuntime(directory: runtimeDir)
    } catch {
        fail("couldn't load the runtime from \(runtimeDir.path): \(error.localizedDescription)")
    }
}

func readJSON(_ path: String) -> (text: String, value: JSONValue) {
    let url = resolve(path)
    guard let data = try? Data(contentsOf: url) else { fail("can't read \(path)") }
    guard let value = try? JSONValue.parse(data) else { fail("\(path) isn't valid JSON") }
    return (String(decoding: data, as: UTF8.self), value)
}

func loadManifest(_ path: String) -> BubbleManifest {
    let file = readJSON(path)
    do {
        return try BubbleManifest.decode(file.text)
    } catch {
        fail("\(path) isn't a Bubble manifest: \(error)")
    }
}

// MARK: - Commands

func runCatalog() {
    let runtime = loadRuntime()
    guard let json = runtime.catalog() else { fail("Bubble.catalogJSON() returned nothing") }
    if args.has("json") {
        say(json.jsonString(pretty: true))
        return
    }
    let catalog = StudioCatalog(json: json, runtimeVersion: runtime.runtimeVersion)
    say("Runtime \(runtime.runtimeVersion ?? "?") · engine v\(catalog.engineVersion) · \(runtimeDir.path)")
    if catalog.isStub { say("(placeholder runtime: no formulas)") }
    for formula in catalog.formulas {
        var status = "no example"
        if let example = formula.example {
            let check = runtime.validate(json: example.jsonString())
            status = check.ok ? "example valid" : "example INVALID: \(check.errors.first?.message ?? "")"
        }
        say("")
        say("\(formula.id) (\(formula.title)): \(status)")
        say("  core: \(formula.core.joined(separator: ", "))")
        if !formula.optional.isEmpty { say("  optional: \(formula.optional.joined(separator: ", "))") }
        let own = catalog.concepts.values.filter { $0.formulas.contains(formula.id) }.map(\.id).sorted()
        say("  concepts (\(own.count)): \(own.joined(separator: ", "))")
    }
    let shared = catalog.concepts.values.filter(\.isShared).map(\.id).sorted()
    say("")
    say("shared concepts (\(shared.count)): \(shared.joined(separator: ", "))")
    say("looks (\(catalog.looksFromRuntime ? "from the runtime" : "LOOKS.md fallback: the runtime doesn't list them")): " +
        catalog.looks.map { "\($0.id) [\($0.fonts.joined(separator: "/"))]" }.joined(separator: ", "))
    say("palettes: \(catalog.paletteIDs.joined(separator: ", "))\(catalog.supportsCustomColors ? ", custom" : "")")
    var kinds: [String: Int] = [:]
    for concept in catalog.concepts.values { kinds[concept.kind, default: 0] += 1 }
    say("by kind: " + kinds.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))
}

func runValidate() {
    guard !args.positional.dropFirst().isEmpty else { fail("validate needs at least one file") }
    let runtime = loadRuntime()
    var failed = 0
    for path in args.positional.dropFirst() {
        let file = readJSON(path)
        let name = URL(fileURLWithPath: path).lastPathComponent
        var problems: [String] = []
        let decoded = try? BubbleManifest.decode(file.text)
        if decoded == nil { problems.append("Swift can't decode it as BubbleManifest") }
        let check = runtime.validate(json: file.text)
        problems += check.errors.map { "\($0.code): \($0.message)\($0.path.map { " (\($0))" } ?? "")" }
        if problems.isEmpty && check.ok {
            let formula = decoded?.formula.rawValue ?? "?"
            let warnings = check.warnings.isEmpty ? "" : " · \(check.warnings.count) warnings"
            say("ok    \(name) (\(formula), \(decoded?.concepts.count ?? 0) concepts\(warnings))")
            for warning in check.warnings { say("        warning \(warning.code): \(warning.message)") }
        } else {
            failed += 1
            say("FAIL  \(name)")
            for problem in problems { say("        \(problem)") }
        }
    }
    if failed > 0 { exit(1) }
}

func runSimulate() async {
    guard let path = args.positional.dropFirst().first else { fail("simulate needs a file") }
    let manifest = loadManifest(path)
    if args.has("playtest") {
        let runtime = StudioRuntime.directory(runtimeDir)
        let report = await runtime.playtest(manifest)
        say("Playtest: \(report.headline)")
        say(report.spread)
        for run in report.runs {
            say("  \(pad(run.bot.label, 24)) skill \(String(format: "%.2f", run.bot.skill))  \(pad(run.outcome, 8)) score \(pad(String(run.score), 6)) \(secondsText(run.seconds))\(run.error.map { "  error: \($0)" } ?? "")")
        }
        for flag in report.flags { say("  \(flag.blocking ? "BLOCKING" : "note") \(flag.code): \(flag.message)") }
        if !report.passed { exit(1) }
        return
    }
    let runtime = loadRuntime()
    let started = Date()
    let run = runtime.simulate(manifest, seed: args.int("seed") ?? manifest.seed, maxTicks: args.int("max-ticks") ?? 9000,
                               bot: true, botSeed: args.int("bot-seed"), botSkill: args.double("skill"))
    let took = Date().timeIntervalSince(started)
    say("ok: \(run.ok)\(run.error.map { " · error: \($0)" } ?? "")")
    say("outcome: \(run.outcome ?? "?") · score \(run.score) · \(run.ticks) ticks (\(secondsText(run.durationSec))) · simulated in \(String(format: "%.0f ms", took * 1000))")
    let events = run.events.sorted { $0.value > $1.value }.prefix(14).map { "\($0.key) \($0.value)" }
    say("events: \(events.joined(separator: ", "))")
    say("inputs: \(run.replay?.inputs.count ?? 0)")
    if !run.ok { exit(1) }
}

func makeRequest(mode: StudioMode, world: StudioDemoWorld?) -> StudioRequest {
    let prompt = args.value("prompt") ?? ""
    var request = StudioRequest(mode: mode, prompt: prompt)
    if let group = args.value("group") {
        let id = group.hasPrefix("group:") ? String(group.dropFirst(6)) : group
        request.scope = "group:\(id)"
        if let world, let scope = world.scope(for: id) {
            request.scopeName = scope.name
            request.audienceNames = scope.audience
            if mode == .daily {
                request.sources = world.groupSources(limit: args.int("sources") ?? 5)
            }
        }
    }
    if let event = args.value("event") {
        let id = event.hasPrefix("event:") ? String(event.dropFirst(6)) : event
        request.scope = "event:\(id)"
        if let world, let scope = world.scope(for: id) {
            request.scopeName = scope.name
            request.audienceNames = scope.audience
            if let count = args.int("sources") { request.sources = world.eventSources(limit: count) }
        }
    }
    if let base = args.value("base") { request.base = loadManifest(base) }
    if let formula = args.value("formula") { request.formulaHint = BubbleFormula(rawValue: formula) }
    if let palette = args.value("palette") { request.paletteHint = palette }
    if mode == .daily { request.date = args.value("date") ?? StudioManifestBuilder.dayKey(Date()) }
    return request
}

func studioMode(_ text: String?) -> StudioMode {
    guard let text else { return .create }
    guard let mode = StudioMode(rawValue: text.replacingOccurrences(of: "-", with: "_")) else {
        fail("unknown mode \(text); use create, edit, remix, next_level or daily")
    }
    return mode
}

func runModels() async {
    guard let config = MuseConfig.load(file: configURL) else { fail("no Muse key (MuseConfig.json or MUSE_API_KEY)") }
    say("Muse: \(config.redactedDescription)")
    let client = MuseClient(config: config)
    do {
        let started = Date()
        let ids = try await client.models()
        say("\(ids.count) models in \(secondsText(Date().timeIntervalSince(started))): \(ids.joined(separator: ", "))")
    } catch {
        fail(error.localizedDescription)
    }
}

func runBrief() async {
    let world = StudioDemoWorld.load(url: worldURL)
    let request = makeRequest(mode: studioMode(args.value("mode")), world: world)
    let runtime = StudioRuntime.directory(runtimeDir)
    guard let config = MuseConfig.load(file: configURL), !args.has("offline") else {
        let brief = OfflineComposer(world: world).brief(for: request)
        say("(offline) \((try? JSONValue.encode(brief))?.jsonString(pretty: true) ?? "{}")")
        return
    }
    let service = MuseStudioService(config: config, runtime: runtime, world: world)
    let started = Date()
    do {
        let brief = try await service.draftBrief(request)
        say((try? JSONValue.encode(brief))?.jsonString(pretty: true) ?? "{}")
        let calls = service.callLog.records
        let source = calls.contains(where: { $0.ok }) ? "muse-ember-1.0" : "offline fallback"
        say("brief in \(secondsText(Date().timeIntervalSince(started))) (\(source))")
    } catch {
        fail(error.localizedDescription)
    }
}

func eventLine(_ event: StudioEvent) -> String {
    let time = String(format: "[%5.1fs]", event.elapsed)
    var line = "\(time) \(pad(event.step.rawValue, 10)) \(event.title)"
    if let detail = event.detail, !detail.isEmpty { line += " — \(detail)" }
    var tags: [String] = []
    if let model = event.model { tags.append(model) }
    if event.isOffline { tags.append("offline") }
    if !tags.isEmpty { line += "  (\(tags.joined(separator: ", ")))" }
    for issue in event.issues ?? [] where event.step != .done {
        line += "\n           · \(issue)"
    }
    return line
}

func runCompose() async {
    let mode = studioMode(args.value("mode"))
    guard let out = args.value("out") else { fail("compose needs --out FILE.json") }
    if [.edit, .remix, .nextLevel].contains(mode) && args.value("base") == nil { fail("\(mode.rawValue) needs --base FILE") }
    let world = StudioDemoWorld.load(url: worldURL)
    let request = makeRequest(mode: mode, world: world)
    let runtime = StudioRuntime.directory(runtimeDir)
    let catalog: StudioCatalog
    do {
        catalog = try await runtime.catalog()
    } catch {
        fail(error.localizedDescription)
    }
    say("Runtime \(catalog.version) (\(catalog.formulas.count) formulas, \(catalog.concepts.count) concepts) · mode \(mode.rawValue)")

    let service: BubbleStudioService
    var callLog: MuseCallLog?
    if let config = MuseConfig.load(file: configURL), !args.has("offline") {
        var options = MuseStudioService.Options()
        options.coverWait = 90
        options.offlinePacing = 0
        let recent = (args.value("recent-looks") ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let muse = MuseStudioService(config: config, runtime: runtime, world: world, options: options, lookMemory: StudioLookMemory(recent))
        callLog = muse.callLog
        service = muse
        say("Muse: \(config.redactedDescription)")
    } else {
        service = OfflineStudioService(runtime: runtime, world: world, pacing: 0)
        say("Muse: offline composer\(args.has("offline") ? " (--offline)" : " (no key)")")
    }
    say("")

    var timelineText: [String] = []
    var done: StudioEvent?
    do {
        for try await event in service.compose(request) {
            let line = eventLine(event)
            say(line)
            timelineText.append(line)
            if event.step == .done { done = event }
        }
    } catch {
        fail("compose failed: \(error.localizedDescription)")
    }
    guard let done, let manifest = done.manifest else { fail("compose finished without a manifest") }

    // Save.
    let outURL = resolve(out)
    try? FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    do {
        try manifest.jsonData(pretty: true).write(to: outURL)
    } catch {
        fail("couldn't write \(out): \(error.localizedDescription)")
    }
    say("")
    say("Saved \(out) (\(manifest.id) v\(manifest.version), \(manifest.formula.rawValue), \(manifest.concepts.count) concepts)")
    let style = manifest.style
    var lookLine = "Look: \(style.look) · palette \(style.palette)"
    if let colors = style.colors {
        lookLine += " \(StudioColors.json(colors).jsonString()) · ink contrast \(String(format: "%.1f", StudioColors.inkContrast(colors))):1"
    }
    lookLine += " · font \(style.font ?? "-") · motif \(style.motif ?? "-") · \(style.emoji ?? "")"
    say(lookLine)
    timelineText.append("")
    timelineText.append(lookLine)
    if let cover = args.value("cover") {
        if let data = done.coverImage {
            do {
                try data.write(to: resolve(cover))
                say("Saved \(cover) (\(data.count / 1024) KB)")
            } catch {
                say("Couldn't write \(cover): \(error.localizedDescription)")
            }
        } else {
            say("No cover to save")
        }
    }
    if let base = done.baseUpdate {
        let baseURL = outURL.deletingPathExtension().appendingPathExtension("base.json")
        try? base.jsonData(pretty: true).write(to: baseURL)
        say("Saved the updated base (chain link) to \(baseURL.lastPathComponent)")
    }

    // Check the saved file with the runtime, as the app would get it.
    let saved = loadManifest(outURL.path)
    let check = await runtime.validate(saved)
    let report = await runtime.playtest(saved)
    say("Check: \(check.ok ? "valid" : "INVALID \(check.errors.map(\.message))") · playtest \(report.passed ? "passed" : "FLAGGED"): \(report.headline) · \(report.spread)")
    for flag in report.flags { say("  \(flag.blocking ? "BLOCKING" : "note") \(flag.code): \(flag.message)") }
    timelineText.append("")
    timelineText.append("Check: \(check.ok ? "valid" : "invalid") · playtest \(report.passed ? "passed" : "flagged"): \(report.headline) · \(report.spread)")

    // Timing.
    if let records = callLog?.records, !records.isEmpty {
        say("")
        say("Muse calls")
        timelineText.append("")
        timelineText.append("Muse calls")
        for record in records {
            var line = "  \(pad(record.model, 16)) \(pad(record.purpose, 26)) \(pad(secondsText(record.seconds), 8))"
            if let completion = record.completionTokens { line += " \(completion) tokens out" }
            if let reasoning = record.reasoningTokens { line += " (\(reasoning) reasoning)" }
            if record.attempts > 1 { line += " · \(record.attempts) attempts" }
            if !record.ok { line += " · FAILED: \(record.error ?? "?")" }
            say(line)
            timelineText.append(line)
        }
    }
    let total = "Total \(secondsText(done.elapsed)) · \(manifest.studio?.models.joined(separator: ", ") ?? "")\(done.isOffline ? " · offline" : "")"
    say(total)
    timelineText.append(total)
    if let timeline = args.value("timeline") {
        try? (timelineText.joined(separator: "\n") + "\n").write(to: resolve(timeline), atomically: true, encoding: .utf8)
    }
    if !check.ok || !report.passed { exit(2) }
}

/// Prints the composer's system prompt and user message for a request (no Muse call).
func runPrompts() async {
    let mode = studioMode(args.value("mode"))
    let world = StudioDemoWorld.load(url: worldURL)
    let request = MuseStudioService.enrich(makeRequest(mode: mode, world: world), world: world)
    let runtime = StudioRuntime.directory(runtimeDir)
    guard let catalog = try? await runtime.catalog() else { fail("no catalog") }
    let builder = StudioManifestBuilder(request: request, catalog: catalog)
    let brief = OfflineComposer(world: world).brief(for: request)
    say(MusePrompts.composerSystem(catalog))
    say("\n----- user -----\n")
    say(MusePrompts.composerUser(request, brief: brief, catalog: catalog, baseDraft: builder.base.map { StudioManifestBuilder.draftForm($0) },
                                 today: builder.today, keepsBaseLook: builder.keepsBaseLook,
                                 recentLooks: (args.value("recent-looks") ?? "").split(separator: ",").map(String.init)))
}

// MARK: - Main

if let prompt = args.value("microgame") {
    await runMicrogame(prompt)
    exit(0)
}

switch args.positional.first {
case "catalog": runCatalog()
case "microgame": await runMicrogame(args.value("prompt") ?? args.positional.dropFirst().joined(separator: " "))
case "validate": runValidate()
case "simulate": await runSimulate()
case "brief": await runBrief()
case "compose": await runCompose()
case "models": await runModels()
case "prompts": await runPrompts()
case nil, "help", "-h", "--help": say(usage)
default:
    FileHandle.standardError.write(Data(usage.utf8))
    exit(1)
}
