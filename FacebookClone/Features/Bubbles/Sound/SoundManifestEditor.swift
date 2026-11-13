import Foundation

/// Reads and changes a game's `sound` section (authoring/SPEC.md 2.9).
///
/// Only microgames have one: it lives in the authoring manifest (`content.authoring_json`), and the
/// expander turns it into the game's synth notes. A structured change (set, music, volume) edits that
/// text, then expands and wraps it again through `MicrogameStudio` (no Muse call, no playtest: sound
/// doesn't change how the game plays). Free-text tweaks go through `MicrogameComposer.revise`.
enum SoundManifestEditor {
    enum EditError: LocalizedError {
        case notEditable
        case invalid([String])

        var errorDescription: String? {
            switch self {
            case .notEditable: return "This game's sounds can't be changed here."
            case .invalid(let issues): return issues.first ?? "That sound change didn't validate."
            }
        }
    }

    /// The authoring manifest as stored text (key order intact), or nil.
    static func authoringText(of manifest: BubbleManifest) -> String? {
        guard manifest.formula == .microgame else { return nil }
        if let text = manifest.content["authoring_json"]?.string, !text.isEmpty { return text }
        if let object = manifest.content["authoring"], object.object != nil { return object.jsonString() }
        return nil
    }

    /// True when the game has a sound section to edit (a microgame Muse built from an authoring manifest).
    static func canEdit(_ manifest: BubbleManifest) -> Bool { authoringText(of: manifest) != nil }

    /// The game's sound section. A microgame without one plays the `classic` set.
    static func section(of manifest: BubbleManifest) -> GameSoundSection? {
        guard let text = authoringText(of: manifest), let json = try? JSONValue.parse(text) else { return nil }
        return GameSoundSection(json: json["sound"])
    }

    /// The manifest with a new sound section: the authoring text with only `sound` replaced, expanded,
    /// validated and wrapped again. Keeps the id, brief, lineage and the rest, with `version + 1`.
    @MainActor
    static func applying(_ section: GameSoundSection, to manifest: BubbleManifest, studio: MicrogameStudio = .shared) async throws -> BubbleManifest {
        guard let text = authoringText(of: manifest),
              let edited = replacingTopLevelValue(forKey: "sound", with: section.json.jsonString(), in: text) else {
            throw EditError.notEditable
        }
        let expansion = try await studio.expand(text: edited)
        guard expansion.ok else { throw EditError.invalid(expansion.errors.map(\.message)) }
        var next = try await studio.wrap(expansion, id: manifest.id, brief: manifest.brief, emoji: manifest.style.emoji, seed: manifest.seed)
        next.version = manifest.version + 1
        next.lineage = manifest.lineage
        next.chain = manifest.chain
        next.structure = manifest.structure
        next.length = manifest.length
        next.about = manifest.about
        next.studio = manifest.studio
        if next.title.isEmpty { next.title = manifest.title }
        return next
    }

    // MARK: Text splice

    /// Replaces (or adds) one key of the top-level JSON object, leaving every other byte as it was,
    /// so the authoring manifest keeps its key order (docs/BUBBLES.md 7.12). Nil if `json` isn't an object.
    static func replacingTopLevelValue(forKey key: String, with value: String, in json: String) -> String? {
        let chars = Array(json.utf8)
        var i = 0
        func skipSpace() { while i < chars.count, [0x20, 0x09, 0x0A, 0x0D].contains(chars[i]) { i += 1 } }
        /// Skips a string starting at `i` (on its quote); returns its raw contents.
        func skipString() -> [UInt8]? {
            guard i < chars.count, chars[i] == 0x22 else { return nil }
            i += 1
            let start = i
            while i < chars.count {
                if chars[i] == 0x5C { i += 2; continue }
                if chars[i] == 0x22 { let body = Array(chars[start..<i]); i += 1; return body }
                i += 1
            }
            return nil
        }
        /// Skips any value starting at `i`.
        func skipValue() -> Bool {
            skipSpace()
            guard i < chars.count else { return false }
            switch chars[i] {
            case 0x22:
                return skipString() != nil
            case 0x7B, 0x5B:
                var depth = 0
                while i < chars.count {
                    switch chars[i] {
                    case 0x22: if skipString() == nil { return false }; continue
                    case 0x7B, 0x5B: depth += 1
                    case 0x7D, 0x5D:
                        depth -= 1
                        if depth == 0 { i += 1; return true }
                    default: break
                    }
                    i += 1
                }
                return false
            default:
                while i < chars.count, ![0x2C, 0x7D, 0x5D, 0x20, 0x09, 0x0A, 0x0D].contains(chars[i]) { i += 1 }
                return true
            }
        }

        skipSpace()
        guard i < chars.count, chars[i] == 0x7B else { return nil }
        i += 1
        let target = Array(key.utf8)
        var lastValueEnd: Int?
        while true {
            skipSpace()
            guard i < chars.count else { return nil }
            if chars[i] == 0x7D { break }
            if chars[i] == 0x2C { i += 1; continue }
            guard let name = skipString() else { return nil }
            skipSpace()
            guard i < chars.count, chars[i] == 0x3A else { return nil }
            i += 1
            skipSpace()
            let valueStart = i
            guard skipValue() else { return nil }
            if name == target {
                let before = String(decoding: chars[..<valueStart], as: UTF8.self)
                let after = String(decoding: chars[i...], as: UTF8.self)
                return before + value + after
            }
            lastValueEnd = i
        }
        // Not there: add it as the last key.
        let closing = i
        let keyText = "\"\(key)\": \(value)"
        let before = String(decoding: chars[..<closing], as: UTF8.self)
        let after = String(decoding: chars[closing...], as: UTF8.self)
        if lastValueEnd == nil {
            return before + keyText + after
        }
        return before.trimmingTrailingSpace() + ",\n  " + keyText + "\n" + after
    }
}

private extension String {
    func trimmingTrailingSpace() -> String {
        var s = self
        while let last = s.last, last.isWhitespace { s.removeLast() }
        return s
    }
}
