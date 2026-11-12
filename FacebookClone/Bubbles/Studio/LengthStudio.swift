import Foundation

/// Muse Studio support for length and customizing (docs/BUBBLES.md 7.9): Muse picks the length
/// from the brief, the creator's Customize choices (`StudioRequest.length`, `.tuning`) are applied
/// and re-validated, and the manifest's `length` survives from draft to publish.
/// Owner: the "length" feature. Stub from feat/base. Foundation only (the CLI compiles this file).
enum LengthStudio {
    /// Composer prompt lines: the locked length, if the creator picked one.
    static func promptLines(_ request: StudioRequest) -> [String] {
        []
    }

    /// Online path: copy `length` from Muse's draft (or the request) into the manifest object.
    static func applyDraft(_ object: inout [String: JSONValue], draft: [String: JSONValue], request: StudioRequest) {
    }

    /// Offline path: apply the request's length and tuning before validation and playtest.
    static func applyOffline(_ manifest: inout BubbleManifest, request: StudioRequest, brief: BubbleBrief) {
    }

    /// Metadata at stamp time (nothing yet).
    static func finalize(_ manifest: BubbleManifest, request: StudioRequest) -> BubbleManifest {
        manifest
    }
}
