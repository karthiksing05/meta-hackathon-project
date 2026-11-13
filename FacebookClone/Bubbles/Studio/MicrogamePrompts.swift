import Foundation

/// Prompts for Muse's microgame path (docs/BUBBLES.md 7.12): Muse writes an authoring manifest
/// (authoring/SPEC.md 2) from the fragment library. The text comes from the Studio bundle
/// (authoring/expander/prompts.mjs), built from the same catalog the expander checks against.
enum MicrogamePrompts {
    // The text itself lives in authoring/expander/prompts.mjs (in the Studio bundle), shared with
    // the server's generator, so the two paths always send Muse the same prompts.

    /// `examples`: prompt text for the gold examples closest to the request
    /// (`MicrogameStudio.examples(for:)`); nil uses the catalog's fixed examples.
    @MainActor static func system(_ studio: MicrogameStudio, examples: String? = nil) async throws -> String {
        var args: [String: JSONValue] = [:]
        if let examples { args["examples"] = .string(examples) }
        return try await studio.prompt("system", args)
    }

    /// The first turn. A request carrying Studio's agreed anatomy gets it as its own section.
    @MainActor static func compose(_ studio: MicrogameStudio, request: String, brief: BubbleBrief) async throws -> String {
        try await studio.prompt("compose", ["request": .string(request), "brief": briefValue(brief)])
    }

    /// `authoring` is the manifest's JSON text, exactly as stored (`content.authoring_json`): key
    /// order matters (positional function params), so it must not round-trip through JSONValue.
    @MainActor static func revise(_ studio: MicrogameStudio, authoring: String, request: String, brief: BubbleBrief?) async throws -> String {
        var args: [String: JSONValue] = ["authoring": .string(authoring), "request": .string(request)]
        if let brief { args["brief"] = briefValue(brief) }
        return try await studio.prompt("revise", args)
    }

    /// Errors for Muse: its own (with pointers into its manifest), plus a plain note for each
    /// fragment or look the library couldn't build with its params.
    @MainActor static func repair(_ studio: MicrogameStudio, request: String, manifest: String, issues: [String], round: Int) async throws -> String {
        try await studio.prompt("repair", ["request": .string(request), "manifest": .string(manifest),
                                           "issues": .array(issues.map(JSONValue.string)), "round": .number(Double(round))])
    }

    /// Blocking playtest flags for Muse.
    @MainActor static func playtestRepair(_ studio: MicrogameStudio, request: String, manifest: String, report: StudioPlaytest.Report) async throws -> String {
        let runs: [JSONValue] = report.runs.map { run in
            var r: [String: JSONValue] = [
                "bot": .object(["label": .string(run.bot.label), "skill": .number(run.bot.skill)]),
                "outcome": .string(run.outcome), "score": .number(Double(run.score)), "seconds": .number(run.seconds),
            ]
            if let error = run.error { r["error"] = .string(error) }
            return .object(r)
        }
        let flags: [JSONValue] = report.flags.map { .object(["code": .string($0.code), "message": .string($0.message), "blocking": .bool($0.blocking)]) }
        return try await studio.prompt("playtest_repair", ["request": .string(request), "manifest": .string(manifest),
                                                            "report": .object(["runs": .array(runs), "flags": .array(flags)])])
    }

    /// After the game passes the bots: the quality check's lines (`MicrogameStudio.quality`).
    @MainActor static func polish(_ studio: MicrogameStudio, request: String, manifest: String, lines: [String]) async throws -> String {
        try await studio.prompt("polish", ["request": .string(request), "manifest": .string(manifest), "lines": .array(lines.map(JSONValue.string))])
    }

    private static func briefValue(_ brief: BubbleBrief) -> JSONValue {
        (try? JSONValue.encode(brief)) ?? .object(["intent": .string(brief.intent)])
    }

    // MARK: Pieces

    /// The lines Muse sees for an expansion with errors (authoring/SPEC.md 3): model errors in
    /// full, library errors only as "this fragment can't be used with these params", once each.
    static func issues(_ e: MicrogameExpansion) -> [String] {
        var lines = e.modelErrors.map(\.line)
        var notes: [String] = []
        for d in e.libraryErrors {
            let note = d.modelNote ?? "A fragment can't be used with these params. Change its params or drop it."
            if !notes.contains(note) { notes.append(note) }
        }
        lines += notes
        if lines.isEmpty, !e.ok { lines = ["The manifest doesn't expand. Check its shape against the format."] }
        return lines
    }
}
