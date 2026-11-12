import Foundation

/// Muse Studio support for the `learn` formula: Lessons you learn together (docs/BUBBLES.md 7.8).
/// Owner: the "learn" feature. Stub from feat/base: fill in the hint (keywords, nouns, looks,
/// composer guide, offline content, playtest policy) and the prompt lines.
/// Foundation only (the CLI compiles this file).
enum LearnStudio {
    static let hint = StudioFormulaHint(formula: "learn")

    /// Extra composer prompt lines for this request (empty when it doesn't apply).
    static func promptLines(_ request: StudioRequest) -> [String] {
        []
    }
}
