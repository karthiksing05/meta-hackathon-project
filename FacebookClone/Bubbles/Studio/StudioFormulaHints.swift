import Foundation

// Extension points that let each collaboration feature teach Muse Studio about its formula or its
// social context without editing the shared harness files (docs/BUBBLES.md 7.1). The harness
// (StudioLookSpecs, StudioRuntime, StudioManifestBuilder) calls
// these registries; each feature fills in only its own enum in its own file:
//
//   StoryStudio.swift     (story)      LearnStudio.swift   (learn)     NextlineStudio.swift (nextline)
//   LengthStudio.swift    (length)     RemixStudio.swift   (remix)     TogetherStudio.swift (together)
//
// Foundation only: the CLI compiles this folder too. Don't edit this file in a feature branch;
// if a feature needs a new hook, report it.

/// What Studio should know about one formula beyond the runtime catalog.
struct StudioFormulaHint: Sendable {
    /// The formula id ("story").
    var formula: String
    /// Words in a request that point at this formula (offline picker).
    var keywords: [String] = []
    /// Title nouns for offline titles ("Path", "Tale").
    var nouns: [String] = []
    /// Looks this formula leans toward when the words don't decide.
    var looks: [String] = []
    /// A paragraph appended to the composer system prompt: how to plan and write this kind of
    /// game (graph planning, lesson facts, punchline and decoys…).
    var composerGuide: String = ""
    /// Offline fallback: fills `manifest.content` (and may adjust concepts) from the request when
    /// Muse is unreachable. Returns a timeline line ("Wrote 6 scenes from your idea") or nil to
    /// leave the template's content.
    var offlineContent: (@Sendable (inout BubbleManifest, StudioRequest, BubbleBrief) -> String?)?
    /// Extra playtest flags for this formula (e.g. "ending_unreachable"). Blocking flags go back
    /// to Muse for a repair.
    var playtestFlags: (@Sendable (BubbleManifest, [StudioPlaytest.Run]) -> [StudioPlaytest.Flag])?
    /// Generic playtest codes that don't apply to this formula; they become non-blocking notes
    /// (e.g. "no_challenge" for a story with no fail state).
    var relaxedFlags: Set<String> = []
}

/// The registry. Formulas without a hint get none of this, and behave as before.
enum StudioFormulaHints {
    static var all: [StudioFormulaHint] {
        [StoryStudio.hint, NextlineStudio.hint, LearnStudio.hint]
    }

    static func hint(for formula: String) -> StudioFormulaHint? {
        all.first { $0.formula == formula }
    }

    /// Keyword lists, by formula id.
    static var keywords: [String: [String]] {
        var out: [String: [String]] = [:]
        for hint in all where !hint.keywords.isEmpty {
            out[hint.formula] = hint.keywords
        }
        return out
    }

    /// The feature formula ids.
    static var formulas: [String] { all.map(\.formula) }

    /// Look leanings merged into `BubbleLookSpec.formulaLeans`.
    static var looks: [String: [String]] {
        var out: [String: [String]] = [:]
        for hint in all where !hint.looks.isEmpty {
            out[hint.formula] = hint.looks
        }
        return out
    }

    /// Composer prompt paragraphs, one per formula that has one.
    static var composerGuides: String {
        all.filter { !$0.composerGuide.isEmpty }
            .map { "### \($0.formula)\n\($0.composerGuide)" }
            .joined(separator: "\n\n")
    }

    /// Applies a formula's playtest policy to a generic report.
    static func adjust(_ report: StudioPlaytest.Report, for manifest: BubbleManifest) -> StudioPlaytest.Report {
        guard let hint = hint(for: manifest.formula.rawValue) else { return report }
        var flags = report.flags.map { flag -> StudioPlaytest.Flag in
            guard hint.relaxedFlags.contains(flag.code) else { return flag }
            var relaxed = flag
            relaxed.blocking = false
            return relaxed
        }
        if let extra = hint.playtestFlags {
            flags.append(contentsOf: extra(manifest, report.runs))
        }
        return StudioPlaytest.Report(runs: report.runs, flags: flags)
    }
}

/// Social and length hooks around every Studio run.
enum StudioSocialHooks {
    /// Extra lines for the composer's user prompt (remix credit, co-makers' contributions, the
    /// "Games about me" answers, the locked length). Each feature returns its own lines.
    static func promptLines(_ request: StudioRequest) -> [String] {
        RemixStudio.promptLines(request)
            + TogetherStudio.promptLines(request)
            + LengthStudio.promptLines(request)
            + StoryStudio.promptLines(request)
            + LearnStudio.promptLines(request)
    }

    /// Called on Muse's draft before it becomes a manifest (online path), so a feature can carry
    /// draft fields such as `length` into the manifest object.
    static func applyDraft(_ object: inout [String: JSONValue], draft: [String: JSONValue], request: StudioRequest) {
        LengthStudio.applyDraft(&object, draft: draft, request: request)
    }

    /// Called on the offline composer's manifest after content, before validation and playtest.
    static func applyOffline(_ manifest: inout BubbleManifest, request: StudioRequest, brief: BubbleBrief) {
        LengthStudio.applyOffline(&manifest, request: request, brief: brief)
        TogetherStudio.applyOffline(&manifest, request: request, brief: brief)
    }

    /// Called on every finished manifest (online and offline) when Studio stamps it: lineage
    /// credits, makers, the about-me block. Metadata only: never change concepts or content here,
    /// because the playtest already ran.
    static func finalize(_ manifest: BubbleManifest, request: StudioRequest) -> BubbleManifest {
        var out = manifest
        out = RemixStudio.finalize(out, request: request)
        out = TogetherStudio.finalize(out, request: request)
        out = LengthStudio.finalize(out, request: request)
        return out
    }
}
