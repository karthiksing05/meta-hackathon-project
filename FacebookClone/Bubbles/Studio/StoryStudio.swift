import Foundation

/// Muse Studio support for the `story` formula: Branching adventures (docs/BUBBLES.md 7.6).
/// Owner: the "story" feature. Stub from feat/base: fill in the hint (keywords, nouns, looks,
/// composer guide, offline content, playtest policy) and the prompt lines.
/// Foundation only (the CLI compiles this file).
enum StoryStudio {
    static let hint = StudioFormulaHint(formula: "story")

    /// Extra composer prompt lines for this request (empty when it doesn't apply).
    static func promptLines(_ request: StudioRequest) -> [String] {
        []
    }
}
