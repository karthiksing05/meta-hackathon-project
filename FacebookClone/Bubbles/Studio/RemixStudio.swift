import Foundation

/// Muse Studio support for remixes (docs/BUBBLES.md 7.5): the "Remix of <title> by <name>" credit
/// in `lineage` (`remix_of_title`, `remix_of_creator_id`, `remix_of_creator_name`), built on the
/// existing lineage and Chains rather than beside them.
/// Owner: the "remix" feature. Foundation only (the CLI compiles this file).
///
/// The rest of the remix pipeline is unchanged: `StudioManifestBuilder.identity` sets `parent`,
/// `remix_of` and the "remix" operator, the offline composer adapts the base, and the bot playtest
/// runs as usual. `finalize` only adds the credit, so it is metadata only.
enum RemixStudio {
    /// Composer prompt lines for a remix (whose game it was, what to keep).
    static func promptLines(_ request: StudioRequest) -> [String] {
        guard request.mode == .remix, let base = request.base else { return [] }
        let title = base.title
        let line: String
        if let name = creatorName(request), !name.isEmpty {
            line = "This is a remix of “\(title)” by \(name). Keep its core and feel, change what the request asks, and give it a new title that nods to the original."
        } else {
            line = "This is a remix of “\(title)”. Keep its core and feel, change what the request asks, and give it a new title that nods to the original."
        }
        return [line]
    }

    /// Fills the remix credit from `request.base` and `request.social`.
    ///
    /// - Remix: `remix_of` is the base (identity already set it), `remix_of_title` the base's title,
    ///   and the creator fields come from `request.social` (StudioModel fills them from the base
    ///   Bubble's creator). `parent` and `operators` stay as identity set them.
    /// - Edit of a remix: the new version keeps the credit it had.
    static func finalize(_ manifest: BubbleManifest, request: StudioRequest) -> BubbleManifest {
        guard let base = request.base else { return manifest }
        var out = manifest
        switch request.mode {
        case .remix:
            if out.lineage.remixOf == nil || out.lineage.remixOf == out.id {
                out.lineage.remixOf = base.id
            }
            if out.lineage.parent == nil { out.lineage.parent = base.id }
            if !out.lineage.operators.contains("remix") {
                out.lineage.operators.insert("remix", at: 0)
            }
            out.lineage.remixOfTitle = base.title
            if let id = request.social?.baseCreatorID, !id.isEmpty {
                out.lineage.remixOfCreatorID = id
            }
            if let name = creatorName(request), !name.isEmpty {
                out.lineage.remixOfCreatorName = name
            }
        case .edit:
            guard out.id == base.id, base.lineage.remixOf != nil else { return out }
            if out.lineage.remixOf == nil { out.lineage.remixOf = base.lineage.remixOf }
            if out.lineage.remixOfTitle == nil { out.lineage.remixOfTitle = base.lineage.remixOfTitle }
            if out.lineage.remixOfCreatorID == nil { out.lineage.remixOfCreatorID = base.lineage.remixOfCreatorID }
            if out.lineage.remixOfCreatorName == nil { out.lineage.remixOfCreatorName = base.lineage.remixOfCreatorName }
        default:
            break
        }
        return out
    }

    /// The original's creator as the credit names them (nil when the base is your own game, or
    /// when there is no social context, as in the CLI).
    private static func creatorName(_ request: StudioRequest) -> String? {
        let name = request.social?.baseCreatorName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (name?.isEmpty ?? true) ? nil : name
    }
}
