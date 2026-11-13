import Foundation

/// Prompts for Muse's microgame path (docs/BUBBLES.md 7.12): Muse writes an authoring manifest
/// (authoring/SPEC.md 2) from the fragment library. Everything about the library, the engine and
/// the format comes from `MicrogameCatalog` (generated from authoring/ and the engine), so the
/// prompt can't drift from what the expander accepts.
enum MicrogamePrompts {
    // MARK: System

    static func system(_ catalog: MicrogameCatalog) -> String {
        """
        You design microgames for Bubbles: tiny, original games people make and play inside Facebook on a phone.
        A microgame is written as an authoring manifest (JSON). An expander combines it with a library of tested \
        fragments into a \(catalog.gameFormat) game for a deterministic engine, the engine validates it, and five bots \
        playtest it before it ships.

        Reply with exactly one JSON object: the complete authoring manifest, with "authoring": "microgame-authoring/0.1". \
        No markdown, no comments, no text around it.

        How to write a good one
        - Build from fragments first (uses + params + bind). Add your own types, state, events, inputs and rules only for \
        what's new in this game; the game's rules run after the fragments' rules.
        - It's played by touch on a phone: taps, drags and swipes. Never rely on a physical keyboard.
        - A run lasts 10–120 seconds, can be lost, and can be won or scored. Make it ramp up so good play shows: \
        a typical player shouldn't still be going after 2 minutes, and nobody should lose in the first 10 seconds.
        - The canvas is 360 × 640 (portrait); the HUD sits at the top (hud_top holds 3 nodes, hud_bottom 2).
        - meta.title is short (at most 40 characters) and original; meta.instructions is one or two plain sentences \
        that say how to play and how to win or lose. meta.duration_s is the expected run length.
        - Put the game's words and lists in content (read them as content_<key>), not inside expressions.
        - Use the standard color tokens ($primary $secondary $accent $ink $bg $danger $surface); define extra tokens \
        in look.tokens if you need them. Pick a look.id from the list below.
        - When score alone doesn't show progress (lights switched off, distance to a goal, lives kept), add \
        "playtest": {"progress": "<expr>"} so the bots know what doing better means.
        - Expressions use single-quoted strings, and floats are written with a decimal point (1.0, not 1) where \
        a float is expected.
        - Everything is synthetic and original: no real people, brands, businesses or copies of existing games.

        ## The authoring format

        \(catalog.prompt.format)

        ## Fragments (the library)

        \(catalog.prompt.fragments)

        ## Looks

        \(catalog.prompt.looks)

        ## Engine reference (for your own sections)

        \(catalog.prompt.engine)

        ## Complete examples that validate and pass the bots

        \(catalog.prompt.examples)
        """
    }

    // MARK: User turns

    static func compose(request: String, brief: BubbleBrief) -> String {
        var lines = ["Make a microgame for this request:", request.trimmingCharacters(in: .whitespacesAndNewlines)]
        lines.append("")
        lines.append(briefText(brief))
        lines.append("")
        lines.append("Reply with the complete authoring manifest.")
        return lines.joined(separator: "\n")
    }

    /// `authoring` is the manifest's JSON text, exactly as stored (`content.authoring_json`): key
    /// order matters (positional function params), so it must not round-trip through JSONValue.
    static func revise(authoring: String, request: String, brief: BubbleBrief?) -> String {
        var lines = ["Here is a microgame's authoring manifest:", authoring, "", "Change it as asked:", request.trimmingCharacters(in: .whitespacesAndNewlines)]
        if let brief {
            lines.append("")
            lines.append(briefText(brief))
        }
        lines.append("")
        lines.append("Keep everything the request doesn't touch. Reply with the complete authoring manifest.")
        return lines.joined(separator: "\n")
    }

    /// Errors for Muse: its own (with pointers into its manifest), plus a plain note for each
    /// fragment or look the library couldn't build with its params.
    static func repair(request: String, manifest: String, issues: [String], round: Int) -> String {
        """
        Request: \(request)

        Your authoring manifest:
        \(manifest)

        It doesn't validate yet (repair round \(round)). The pointers (`at`) are JSON Pointers into your manifest:
        \(issues.map { "- \($0)" }.joined(separator: "\n"))

        Fix every problem and reply with the complete corrected authoring manifest.
        """
    }

    /// Blocking playtest flags for Muse.
    static func playtestRepair(request: String, manifest: String, report: StudioPlaytest.Report) -> String {
        let runs = report.runs.map { run in
            "- \(run.bot.label) (skill \(String(format: "%.2f", run.bot.skill))): \(run.outcome), score \(run.score), \(Int(run.seconds.rounded())) s\(run.error.map { " · \($0)" } ?? "")"
        }
        return """
        Request: \(request)

        Your authoring manifest:
        \(manifest)

        It validates, but the playtest bots found problems that block it from shipping:
        \(report.blocking.map { "- \($0.code): \($0.message)" }.joined(separator: "\n"))

        The bot runs:
        \(runs.joined(separator: "\n"))

        Change the params, fragments or rules so a run lasts 10–120 s, can be lost, and can be won or scored. \
        Reply with the complete corrected authoring manifest.
        """
    }

    // MARK: Pieces

    static func briefText(_ brief: BubbleBrief) -> String {
        var parts = ["Brief: \(brief.intent)"]
        parts.append("Audience: \(brief.audience). Mood: \(brief.mood.joined(separator: ", ")). Energy: \(brief.energy). Competition: \(brief.competition).")
        if let occasion = brief.occasion, !occasion.isEmpty { parts.append("Occasion: \(occasion).") }
        if let notes = brief.notes, !notes.isEmpty { parts.append("Notes: \(notes)") }
        return parts.joined(separator: "\n")
    }

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
