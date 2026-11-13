import Foundation

/// Microgame helpers for Studio (docs/BUBBLES.md 7.12). Microgames are made on the server
/// (`StudioGenerateBridge`, `POST /v1/generate`); the app no longer runs the composer or calls Muse.
/// What's left here reads requests and finished games: `fits(_:)`, `fragments(of:)` and
/// `readableIssue(_:)`.
@MainActor
enum StudioMicrogameBridge {
    /// Words that suggest play the formulas can't do well but the engine can: physics, arcade
    /// action, aiming, bouncing. Matched as whole words in the request.
    static let arcadeWords: Set<String> = [
        "arcade", "physics", "bounce", "bouncing", "bouncy", "gravity", "pinball", "breakout", "brick", "bricks",
        "paddle", "juggle", "juggling", "launch", "launcher", "slingshot", "aim", "aiming", "shoot", "shooter",
        "asteroid", "asteroids", "orbit", "orbiting", "platformer", "platform", "jump", "jumping", "swing",
        "rhythm", "beat", "beats", "drum", "drums", "flick", "swipe", "catapult", "ricochet", "billiards",
    ]

    /// True when the request reads like arcade or physics play.
    static func fits(_ request: String) -> Bool {
        let words = request.lowercased().split { !$0.isLetter }.map(String.init)
        return words.contains { arcadeWords.contains($0) }
    }

    /// The fragments a microgame uses, from its stored authoring manifest (`uses[].fragment`), as
    /// concept-style ids ("fragment.timer_bar") so the concept chips can draw them.
    nonisolated static func fragments(of game: BubbleManifest) -> [String] {
        let json: Any?
        if let text = game.content["authoring_json"]?.string, let data = text.data(using: .utf8) {
            json = try? JSONSerialization.jsonObject(with: data)
        } else if let object = game.content["authoring"], let data = object.jsonString().data(using: .utf8) {
            json = try? JSONSerialization.jsonObject(with: data)
        } else {
            json = nil
        }
        guard let root = json as? [String: Any], let uses = root["uses"] as? [[String: Any]] else { return [] }
        var seen: [String] = []
        for use in uses {
            guard let name = use["fragment"] as? String, !name.isEmpty else { continue }
            let id = "fragment.\(name)"
            if !seen.contains(id) { seen.append(id) }
        }
        return seen
    }

    // MARK: - Running

    /// Repair issues arrive as "CODE at /pointer: message (hint)" or "code: message"; people only
    /// need the message. Anything else is shown as is.
    nonisolated static func readableIssue(_ issue: String) -> String {
        let text = issue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let colon = text.range(of: ": ") else { return text }
        let head = String(text[..<colon.lowerBound])
        let code = head.components(separatedBy: " at ").first ?? head
        let isCode = !code.isEmpty && !code.contains(" ") && code.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" }
            && (code.contains("_") || code == code.uppercased())
        guard isCode, head == code || head.hasPrefix(code + " at ") else { return text }
        let rest = text[colon.upperBound...]
        guard let first = rest.first else { return text }
        return first.uppercased() + rest.dropFirst()
    }
}
