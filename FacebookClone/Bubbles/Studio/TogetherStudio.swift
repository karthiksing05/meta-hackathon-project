import Foundation

/// Muse Studio support for making together and "Games about me" (docs/BUBBLES.md 7.4): Muse
/// stitches every maker's contribution into one game, credits every maker in `lineage.makers`,
/// and builds about-me games from the subject's answers (manifest `about`). Every Muse step has
/// an offline fallback.
/// Owner: the "together" feature. Stub from feat/base. Foundation only (the CLI compiles this file).
enum TogetherStudio {
    /// Composer prompt lines: the contributions to stitch, or the about-me answers.
    static func promptLines(_ request: StudioRequest) -> [String] {
        []
    }

    /// Offline path: stitch contributions or answers into the content.
    static func applyOffline(_ manifest: inout BubbleManifest, request: StudioRequest, brief: BubbleBrief) {
    }

    /// Fills `lineage.makers` and `about` from `request.social`.
    static func finalize(_ manifest: BubbleManifest, request: StudioRequest) -> BubbleManifest {
        manifest
    }
}
