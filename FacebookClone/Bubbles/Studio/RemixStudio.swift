import Foundation

/// Muse Studio support for remixes (docs/BUBBLES.md 7.5): the "Remix of <title> by <name>" credit
/// in `lineage` (`remix_of_title`, `remix_of_creator_id`, `remix_of_creator_name`), built on the
/// existing lineage and Chains rather than beside them.
/// Owner: the "remix" feature. Stub from feat/base. Foundation only (the CLI compiles this file).
enum RemixStudio {
    /// Composer prompt lines for a remix (whose game it was, what to keep).
    static func promptLines(_ request: StudioRequest) -> [String] {
        []
    }

    /// Fills the remix credit from `request.base` and `request.social`.
    static func finalize(_ manifest: BubbleManifest, request: StudioRequest) -> BubbleManifest {
        manifest
    }
}
