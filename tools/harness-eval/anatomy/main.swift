import Foundation

// anatomy-helper: drafts a game anatomy for a request the way Studio does (GameAnatomyMuse.draft
// with MuseAnatomyPrompts, the fast model, calibrated), answers each open question with its first
// option, and writes the result plus the "Agreed game anatomy…" text the build reads.
//
//   anatomy-helper --request TEXT --out FILE.json [--config MuseConfig.json] [--audience TEXT]
//
// Built by tools/harness-eval/build-anatomy.sh. Never prints the Muse key.

func value(_ name: String) -> String? {
    let all = CommandLine.arguments
    guard let index = all.firstIndex(of: "--\(name)"), index + 1 < all.count else { return nil }
    return all[index + 1]
}

func fail(_ text: String) -> Never {
    FileHandle.standardError.write(Data(("error: " + text + "\n").utf8))
    exit(1)
}

/// The repo root: the nearest folder up from the working directory that has FacebookClone/Bubbles.
func repoRoot() -> URL {
    var url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    for _ in 0..<8 {
        if FileManager.default.fileExists(atPath: url.appendingPathComponent("FacebookClone/Bubbles").path) { return url }
        url.deleteLastPathComponent()
    }
    return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
}

/// The engine's fragment list for the prompt, from the same Studio page the CLI stages, written
/// the way GameAnatomyMuse.fragmentLines writes the live catalog (fallback list if it won't load).
@MainActor func fragmentLines(root: URL) async -> (lines: String, source: String) {
    let files = [
        "FacebookClone/Bubbles/Studio/web/microgame-studio.html",
        "FacebookClone/Bubbles/Studio/web/microgame-studio.js",
        "FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js",
    ]
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("harness-eval-anatomy-\(ProcessInfo.processInfo.processIdentifier)")
    defer { try? FileManager.default.removeItem(at: dir) }
    do {
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for file in files {
            let source = root.appendingPathComponent(file)
            try FileManager.default.copyItem(at: source, to: dir.appendingPathComponent(source.lastPathComponent))
        }
        let studio = MicrogameStudio(source: .files(page: dir.appendingPathComponent("microgame-studio.html"), readAccess: dir))
        await studio.warmUp()
        let catalog = try await studio.catalog()
        guard !catalog.fragments.isEmpty else { return (MusePrompts.anatomyFallbackFragmentLines, "fallback") }
        let lines = catalog.fragments.map { fragment in
            let first = fragment.describe.split(separator: ".", maxSplits: 1).first.map(String.init) ?? fragment.describe
            return "- \(fragment.id): \(first.trimmingCharacters(in: .whitespaces))"
        }.joined(separator: "\n")
        return (lines, "catalog")
    } catch {
        return (MusePrompts.anatomyFallbackFragmentLines, "fallback")
    }
}

@MainActor func main() async {
    guard let request = value("request"), let out = value("out") else { fail("usage: anatomy-helper --request TEXT --out FILE.json [--config FILE]") }
    let root = repoRoot()
    let configURL = value("config").map { URL(fileURLWithPath: $0) } ?? root.appendingPathComponent("FacebookClone/Bubbles/Studio/MuseConfig.json")
    guard let config = MuseConfig.load(file: configURL) else { fail("no Muse key (MuseConfig.json or MUSE_API_KEY)") }

    let (fragments, fragmentSource) = await fragmentLines(root: root)
    let muse = GameAnatomyMuse(client: MuseClient(config: config))
    let started = Date()
    var anatomy: GameAnatomy
    do {
        anatomy = try await muse.draft(request: request, audience: value("audience"), fragments: fragments)
    } catch {
        fail("anatomy failed: \(error.localizedDescription)")
    }
    let seconds = Date().timeIntervalSince(started)

    // Auto-answer: each open question gets its first option (Muse's own pick).
    var answered: [JSONValue] = []
    for slot in anatomy.openQuestions {
        guard let meta = anatomy.meta(slot: slot), let first = meta.options.first else { continue }
        anatomy.setAnswer(first, slot: slot)
        answered.append(["slot": .string(slot), "question": .string(meta.question ?? ""), "answer": .string(first)])
    }
    let agreed = anatomy.agreedText(request: request)
    let theme = anatomy.part(.theme)
    let result: JSONValue = [
        "model": .string(muse.model),
        "seconds": .number(seconds),
        "fragments": .string(fragmentSource),
        "anatomy": anatomy.json,
        "answered": .array(answered),
        "counts": [
            "parts": .number(Double(anatomy.partCount)),
            "rules": .number(Double(anatomy.rules.count)),
            "new": .number(Double(anatomy.newCount)),
            "approximate": .number(Double(anatomy.approximateCount)),
            "guesses": .number(Double(anatomy.guessCount)),
        ],
        "theme": ["text": .string(theme?.text ?? ""), "source": .string(theme?.meta.source.rawValue ?? "")],
        "agreedText": .string(agreed),
        "requestText": .string(request + "\n\n" + agreed),
    ]
    do {
        try Data(result.jsonString(pretty: true).utf8).write(to: URL(fileURLWithPath: out))
    } catch {
        fail("couldn't write \(out): \(error.localizedDescription)")
    }
    print("anatomy: \(anatomy.title) · \(anatomy.partCount) parts, \(anatomy.newCount) new · \(answered.count) answered · theme \(theme?.text ?? "-") (\(theme?.meta.source.rawValue ?? "-")) · \(String(format: "%.1f s", seconds))")
}

await main()
