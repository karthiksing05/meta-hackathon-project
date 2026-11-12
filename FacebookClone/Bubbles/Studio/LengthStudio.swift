import Foundation

/// Muse Studio support for length and customizing (docs/BUBBLES.md 7.9): Muse picks the length
/// from the brief, the creator's Customize choices (`StudioRequest.length`, `.tuning`) are applied
/// and re-validated, and the manifest's `length` survives from draft to publish.
/// Owner: the "length" feature. Foundation only (the CLI compiles this file).
///
/// `StudioRequest.tuning` maps a knob id (speed, difficulty, timer, rounds, lives) to the concept
/// param value the creator picked; the formula's knob (`length.knobs`) says which param, and the
/// value is clamped to the knob's range.
enum LengthStudio {
    /// Composer prompt lines: the locked length, or how to pick one from the brief, plus tuning.
    static func promptLines(_ request: StudioRequest) -> [String] {
        var lines: [String] = []
        if let length = request.length?.normalized {
            lines.append("Length is locked: \(length.label). Set \"length\" in the draft to exactly this: \(length.json.jsonString()).")
        } else {
            let kept = request.base?.length.map { " The base Bubble's length is \($0.label) (\($0.json.jsonString())); keep it unless the request changes how long a run is." } ?? ""
            lines.append("""
            Length: pick "length" from the formula's length.modes to fit the brief, as {"mode": "endless"}, \
            {"mode": "rounds", "rounds": 8}, {"mode": "timed", "seconds": 60} or {"mode": "lives", "lives": 3} \
            (rounds 1–50, seconds 10–300, lives 1–9). "A quick game for the bus" is timed 45; a quiz night is \
            rounds 10; "until you drop" is endless; a forgiving game for kids is lives 5. Leave "length" out to \
            keep the formula's default.\(kept)
            """)
        }
        if let tuning = request.tuning, !tuning.isEmpty {
            let parts = tuning.keys.sorted().compactMap { key -> String? in
                guard let v = tuning[key]?.double else { return nil }
                return "\(key) \(format(v))"
            }
            if !parts.isEmpty {
                lines.append("The creator tuned \(parts.joined(separator: ", ")) in Customize (the formula's length.knobs say which params). Keep those param values.")
            }
        }
        return lines
    }

    /// Online path: copy `length` from Muse's draft (or the request, which wins) into the manifest
    /// object, and apply the creator's tuning to the concepts.
    static func applyDraft(_ object: inout [String: JSONValue], draft: [String: JSONValue], request: StudioRequest) {
        let formula = object["formula"]?.string ?? ""
        let spec = BubbleLengthCatalog.shared.spec(for: formula)
        var length: BubbleLength?
        if let locked = request.length?.normalized {
            length = locked
        } else if let picked = BubbleLength(json: draft["length"]), spec?.supports(picked.mode) ?? true {
            length = picked.normalized
        } else if let base = request.base?.length, request.base?.formula.rawValue == formula, spec?.supports(base.mode) ?? true {
            length = base.normalized
        }
        if let length, spec?.supports(length.mode) ?? true {
            let episodes = object["content"]?.object?["episodes"]?.array?.count
            object["length"] = capped(completed(length, spec: spec), formula: formula, episodes: episodes).json
        } else {
            object["length"] = nil
        }
        guard let spec, let tuning = request.tuning, !tuning.isEmpty, var concepts = object["concepts"]?.array else { return }
        for knob in spec.knobs {
            guard let value = tuning[knob.id]?.double else { continue }
            guard let index = concepts.firstIndex(where: { knob.conceptIDs.contains($0["use"]?.string ?? "") }) else { continue }
            var item = concepts[index].object ?? [:]
            var params = item["params"]?.object ?? [:]
            params[knob.param] = .number(knob.clamped(value))
            item["params"] = .object(params)
            concepts[index] = .object(item)
        }
        object["concepts"] = .array(concepts)
    }

    /// Offline path: apply the request's length and tuning (or a length the brief asks for) before
    /// validation and playtest.
    static func applyOffline(_ manifest: inout BubbleManifest, request: StudioRequest, brief: BubbleBrief) {
        let spec = BubbleLengthCatalog.shared.spec(for: manifest.formula.rawValue)
        let episodes = manifest.content["episodes"]?.array?.count
        if let locked = request.length?.normalized, spec?.supports(locked.mode) ?? true {
            manifest.length = capped(completed(locked, spec: spec), formula: manifest.formula.rawValue, episodes: episodes)
        } else if request.length == nil, manifest.length == nil, let picked = fromBrief(request: request, brief: brief, spec: spec) {
            manifest.length = capped(picked, formula: manifest.formula.rawValue, episodes: episodes)
        }
        if let tuning = request.tuning { apply(tuning: tuning, to: &manifest) }
    }

    /// Metadata at stamp time (nothing: the length and tuning ran through the playtest already).
    static func finalize(_ manifest: BubbleManifest, request: StudioRequest) -> BubbleManifest {
        manifest
    }

    // MARK: - Helpers (also used by the Customize panel)

    /// Sets each tuned knob's param on the concept that uses it, clamped to the knob's range.
    static func apply(tuning: [String: JSONValue], to manifest: inout BubbleManifest) {
        guard let spec = BubbleLengthCatalog.shared.spec(for: manifest.formula.rawValue) else { return }
        for knob in spec.knobs {
            guard let value = tuning[knob.id]?.double, let concept = knob.concept(in: manifest),
                  let index = manifest.concepts.firstIndex(where: { $0.use == concept }) else { continue }
            var params = manifest.concepts[index].params ?? [:]
            params[knob.param] = .number(knob.clamped(value))
            manifest.concepts[index].params = params
        }
    }

    /// The current value of a knob's param in a manifest (nil when the manifest doesn't use it, or
    /// leaves the param at the concept's default and `fallback` is nil).
    static func value(of knob: BubbleLengthKnob, in manifest: BubbleManifest, fallback: Double? = nil) -> Double? {
        guard let concept = knob.concept(in: manifest) else { return nil }
        return manifest.concepts.first { $0.use == concept }?.params?[knob.param]?.double ?? fallback
    }

    /// Nextline plays each episode once (it doesn't cycle its content like answer and learn), so a
    /// rounds length is capped at the episode count and the label never promises more rounds than
    /// the game has.
    static func capped(_ length: BubbleLength, formula: String, episodes: Int?) -> BubbleLength {
        guard formula == BubbleFormula.nextline.rawValue, length.mode == .rounds,
              let n = length.number, let episodes, episodes > 0, n > episodes else { return length }
        return .rounds(episodes)
    }

    /// A length with its number filled from the formula's suggestion when it has none.
    static func completed(_ length: BubbleLength, spec: BubbleLengthSpec?) -> BubbleLength {
        guard length.mode != .endless, length.number == nil else { return length.normalized }
        return spec?.suggested(length.mode) ?? BubbleLength(mode: length.mode, rounds: 10, seconds: 60, lives: 3).normalized
    }

    /// A length the brief clearly asks for ("a quick game for the bus", "quiz night", "until you
    /// drop"), when the formula supports it. Nil keeps the formula's default.
    static func fromBrief(request: StudioRequest, brief: BubbleBrief, spec: BubbleLengthSpec?) -> BubbleLength? {
        guard let spec else { return nil }
        let text = ([request.prompt, brief.intent, brief.occasion ?? "", brief.notes ?? ""] + brief.mood)
            .joined(separator: " ").lowercased()
        // Whole words only, so "bus" doesn't match "busy" and "kids" doesn't match "skids".
        let padded = " " + text.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).joined(separator: " ") + " "
        func has(_ words: [String]) -> Bool { words.contains { padded.contains(" \($0) ") } }
        var picks: [BubbleLength] = []
        if let seconds = secondsMentioned(in: text) { picks.append(.timed(seconds)) }
        if has(["quick", "bus", "commute", "coffee break", "in line", "one minute", "a minute", "lunch break", "short break"]) {
            picks.append(.timed(45))
        }
        if has(["quiz night", "game night", "trivia night", "tournament", "best of"]) { picks.append(.rounds(10)) }
        if has(["until you drop", "endless", "forever", "high score", "beat my score", "how long can you"]) { picks.append(.endless) }
        if has(["kids", "forgiving", "gentle", "beginner", "grandma", "grandpa"]) { picks.append(.lives(5)) }
        guard let pick = picks.first(where: { spec.supports($0.mode) }) else { return nil }
        return pick.normalized
    }

    /// "60 seconds", "90-second", "2 minutes" in a brief.
    private static func secondsMentioned(in text: String) -> Int? {
        let words = text.replacingOccurrences(of: "-", with: " ").split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
        for (i, word) in words.enumerated() where i + 1 < words.count {
            guard let n = Int(word), n > 0 else { continue }
            let unit = words[i + 1]
            if unit.hasPrefix("sec") { return BubbleLength.clamp(n, mode: .timed) }
            if unit.hasPrefix("min") { return BubbleLength.clamp(n * 60, mode: .timed) }
        }
        return nil
    }

    private static func format(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(format: "%.2f", v)
    }
}
