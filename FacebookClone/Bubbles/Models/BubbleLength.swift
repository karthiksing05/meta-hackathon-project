import Foundation

// Length is a first-class primitive (docs/BUBBLES.md 7.9): every formula honors one shared
// contract, so a challenge, a group-chat session or a Group game night can lock everyone to the
// same mode and numbers. Foundation only: the CLI compiles this file too.
//
// Owner: the "length" feature. The scaffolding defines the shape; the length feature fills in
// labels, defaults per formula and the Customize panel.

/// How a run ends.
enum BubbleLengthMode: String, Codable, CaseIterable, Sendable {
    /// Play until you fail.
    case endless
    /// N rounds (questions, scenes, stacks…), then the run ends.
    case rounds
    /// N seconds, then the run ends.
    case timed
    /// N lives; each miss costs one.
    case lives
}

/// Manifest `length` (snake_case JSON: `{"mode": "rounds", "rounds": 10}`). Only the number that
/// belongs to the mode is read; the others are ignored. Nil fields use the formula's default.
struct BubbleLength: Codable, Hashable, Sendable {
    var mode: BubbleLengthMode
    var rounds: Int?
    var seconds: Int?
    var lives: Int?

    init(mode: BubbleLengthMode, rounds: Int? = nil, seconds: Int? = nil, lives: Int? = nil) {
        self.mode = mode
        self.rounds = rounds
        self.seconds = seconds
        self.lives = lives
    }

    static let endless = BubbleLength(mode: .endless)
    static func rounds(_ n: Int) -> BubbleLength { BubbleLength(mode: .rounds, rounds: n) }
    static func timed(_ seconds: Int) -> BubbleLength { BubbleLength(mode: .timed, seconds: seconds) }
    static func lives(_ n: Int) -> BubbleLength { BubbleLength(mode: .lives, lives: n) }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = (try? c.decodeIfPresent(BubbleLengthMode.self, forKey: .mode)) ?? .endless
        rounds = try? c.decodeIfPresent(Int.self, forKey: .rounds)
        seconds = try? c.decodeIfPresent(Int.self, forKey: .seconds)
        lives = try? c.decodeIfPresent(Int.self, forKey: .lives)
    }

    enum CodingKeys: String, CodingKey {
        case mode, rounds, seconds, lives
    }

    /// Player-facing label for intro cards, results and boards ("Endless", "10 rounds",
    /// "60 seconds", "3 lives"). `label(best:)` adds the score to beat ("Endless: beat 42").
    var label: String {
        switch mode {
        case .endless: return "Endless"
        case .rounds: return rounds.map { $0 == 1 ? "1 round" : "\($0) rounds" } ?? "Rounds"
        case .timed: return seconds.map { "\($0) seconds" } ?? "Timed"
        case .lives: return lives.map { $0 == 1 ? "1 life" : "\($0) lives" } ?? "Lives"
        }
    }

    /// "Endless: beat 42" when there's a best to beat; otherwise `label`. Same text as the
    /// runtime's intro card (`Bubble.lengthLabel`).
    func label(best: Int?) -> String {
        if mode == .endless, let best, best > 0 { return "Endless: beat \(best)" }
        return label
    }

    /// A short label for chips ("10 rounds", "60 s", "3 lives", "Endless").
    var shortLabel: String {
        switch mode {
        case .timed: return seconds.map { $0 >= 60 && $0 % 60 == 0 ? "\($0 / 60) min" : "\($0) s" } ?? "Timed"
        default: return label
        }
    }

    /// SF Symbol for the mode.
    var symbol: String { mode.symbol }

    // MARK: Numbers

    /// The allowed range for each mode's number (the runtime's `length_limits`).
    static let roundsRange = 1...50
    static let secondsRange = 10...300
    static let livesRange = 1...9

    /// The number the mode reads (rounds, seconds or lives); nil for endless.
    var number: Int? {
        get {
            switch mode {
            case .endless: return nil
            case .rounds: return rounds
            case .timed: return seconds
            case .lives: return lives
            }
        }
        set {
            switch mode {
            case .endless: break
            case .rounds: rounds = newValue
            case .timed: seconds = newValue
            case .lives: lives = newValue
            }
        }
    }

    /// Only the mode's own number, clamped to its range (what a manifest should carry).
    var normalized: BubbleLength {
        var out = BubbleLength(mode: mode)
        if let n = number { out.number = Self.clamp(n, mode: mode) }
        return out
    }

    /// True when the mode's number is set and in range (endless always is).
    var isComplete: Bool {
        guard mode != .endless else { return true }
        guard let n = number else { return false }
        return Self.range(for: mode)?.contains(n) ?? false
    }

    static func range(for mode: BubbleLengthMode) -> ClosedRange<Int>? {
        switch mode {
        case .endless: return nil
        case .rounds: return roundsRange
        case .timed: return secondsRange
        case .lives: return livesRange
        }
    }

    static func clamp(_ value: Int, mode: BubbleLengthMode) -> Int {
        guard let range = range(for: mode) else { return value }
        return min(max(value, range.lowerBound), range.upperBound)
    }

    /// Steps for a stepper: rounds and lives by 1, seconds by 15 (5 under 30).
    static func step(for mode: BubbleLengthMode, at value: Int) -> Int {
        mode == .timed ? (value < 30 ? 5 : 15) : 1
    }

    /// This length as a manifest JSON object.
    var json: JSONValue {
        var object: [String: JSONValue] = ["mode": .string(mode.rawValue)]
        if let rounds, mode == .rounds { object["rounds"] = .number(Double(rounds)) }
        if let seconds, mode == .timed { object["seconds"] = .number(Double(seconds)) }
        if let lives, mode == .lives { object["lives"] = .number(Double(lives)) }
        return .object(object)
    }

    /// A length from a manifest or draft JSON object; nil when it isn't one (unknown mode, or a
    /// number out of range).
    init?(json: JSONValue?) {
        guard let object = json?.object, let raw = object["mode"]?.string?.lowercased(),
              let mode = BubbleLengthMode(rawValue: raw) else { return nil }
        self.init(mode: mode)
        let key: String? = mode == .rounds ? "rounds" : mode == .timed ? "seconds" : mode == .lives ? "lives" : nil
        if let key, let value = object[key] {
            guard let n = value.double, n.rounded() == n, let range = Self.range(for: mode), range.contains(Int(n)) else { return nil }
            number = Int(n)
        }
    }
}

extension BubbleLengthMode {
    var title: String {
        switch self {
        case .endless: return "Endless"
        case .rounds: return "Rounds"
        case .timed: return "Timed"
        case .lives: return "Lives"
        }
    }

    var symbol: String {
        switch self {
        case .endless: return "infinity"
        case .rounds: return "flag.checkered"
        case .timed: return "timer"
        case .lives: return "heart.fill"
        }
    }

    /// What the number counts ("Rounds", "Seconds", "Lives").
    var numberTitle: String {
        switch self {
        case .endless: return ""
        case .rounds: return "Rounds"
        case .timed: return "Seconds"
        case .lives: return "Lives"
        }
    }
}

// MARK: - Formula length declarations

/// A tuning knob a formula exposes in Customize (`length.knobs` in `defineFormula`): one concept
/// param with a creator-friendly range. `concept` may list alternatives ("rule.a|rule.b"); the
/// first one the manifest uses is tuned. `invert` means a higher param is easier, so the slider's
/// right end (harder, faster) maps to `min`.
struct BubbleLengthKnob: Hashable, Sendable, Identifiable {
    /// speed, difficulty, lives, rounds or timer.
    var id: String
    var concept: String
    var param: String
    var label: String
    var min: Double
    var max: Double
    var step: Double?
    var invert: Bool

    var conceptIDs: [String] { concept.split(separator: "|").map(String.init) }

    /// The first concept of the knob a manifest uses.
    func concept(in manifest: BubbleManifest) -> String? {
        conceptIDs.first { id in manifest.concepts.contains { $0.use == id } }
    }

    /// The param value for a slider position (0 = easy or slow, 1 = hard or fast).
    func value(at position: Double) -> Double {
        let t = Swift.min(Swift.max(position, 0), 1)
        var v = invert ? max - (max - min) * t : min + (max - min) * t
        if let step, step > 0 { v = (v / step).rounded() * step }
        return (v * 100).rounded() / 100
    }

    /// The slider position for a param value.
    func position(of value: Double) -> Double {
        guard max > min else { return 0.5 }
        let t = (value - min) / (max - min)
        return Swift.min(Swift.max(invert ? 1 - t : t, 0), 1)
    }

    func clamped(_ value: Double) -> Double { Swift.min(Swift.max(value, min), max) }
}

/// A formula's `length` declaration: the modes its kit honors, the default, what each mode
/// suggests when picked, how labels infer the length from concepts, and the Customize knobs.
struct BubbleLengthSpec: Hashable, Sendable {
    var modes: [BubbleLengthMode]
    var defaultLength: BubbleLength
    /// Suggested numbers when a creator picks a mode (`length.numbers`).
    var numbers: [BubbleLengthMode: Int]
    /// Concept params ("rule.timing_window.targets") or content arrays ("content:rounds") that say
    /// how long an unlocked run is, by mode (`length.infer`). Labels only.
    var infer: [BubbleLengthMode: [String]]
    var knobs: [BubbleLengthKnob]

    /// The length a mode starts at in Customize.
    func suggested(_ mode: BubbleLengthMode) -> BubbleLength {
        var out = BubbleLength(mode: mode)
        if mode != .endless {
            out.number = numbers[mode] ?? (mode == defaultLength.mode ? defaultLength.number : nil) ?? BubbleLengthCatalog.fallback(mode)
        }
        return out.normalized
    }

    func supports(_ mode: BubbleLengthMode) -> Bool { modes.contains(mode) }

    init(modes: [BubbleLengthMode], defaultLength: BubbleLength, numbers: [BubbleLengthMode: Int] = [:],
         infer: [BubbleLengthMode: [String]] = [:], knobs: [BubbleLengthKnob] = []) {
        self.modes = modes
        self.defaultLength = defaultLength
        self.numbers = numbers
        self.infer = infer
        self.knobs = knobs
    }

    /// Parses a catalog formula's `length` object; nil when it has no modes.
    init?(json: JSONValue?) {
        guard let object = json?.object else { return nil }
        let modes = (object["modes"]?.strings ?? []).compactMap(BubbleLengthMode.init(rawValue:))
        guard !modes.isEmpty else { return nil }
        self.modes = modes
        var def = BubbleLength(mode: modes[0])
        if let d = object["default"]?.object, let raw = d["mode"]?.string, let mode = BubbleLengthMode(rawValue: raw) {
            def = BubbleLength(mode: mode)
            def.number = (d["rounds"] ?? d["seconds"] ?? d["lives"])?.int
        }
        defaultLength = def
        var numbers: [BubbleLengthMode: Int] = [:]
        if let n = object["numbers"]?.object {
            if let v = n["rounds"]?.int { numbers[.rounds] = v }
            if let v = n["seconds"]?.int { numbers[.timed] = v }
            if let v = n["lives"]?.int { numbers[.lives] = v }
        }
        self.numbers = numbers
        var infer: [BubbleLengthMode: [String]] = [:]
        if let i = object["infer"]?.object {
            if let v = i["rounds"]?.strings, !v.isEmpty { infer[.rounds] = v }
            if let v = i["timed"]?.strings, !v.isEmpty { infer[.timed] = v }
            if let v = i["lives"]?.strings, !v.isEmpty { infer[.lives] = v }
        }
        self.infer = infer
        var knobs: [BubbleLengthKnob] = []
        for (id, value) in object["knobs"]?.object ?? [:] {
            guard let k = value.object, let concept = k["concept"]?.string, let param = k["param"]?.string,
                  let lo = k["min"]?.double, let hi = k["max"]?.double, hi > lo else { continue }
            knobs.append(BubbleLengthKnob(id: id, concept: concept, param: param, label: k["label"]?.string ?? id.capitalized,
                                          min: lo, max: hi, step: k["step"]?.double, invert: k["invert"]?.bool ?? false))
        }
        self.knobs = knobs.sorted { BubbleLengthCatalog.knobOrder($0.id) < BubbleLengthCatalog.knobOrder($1.id) }
    }
}

/// Every formula's length declaration. Built in (mirroring the kits, so labels work before the
/// runtime loads and in the CLI), and replaced by the runtime catalog's when Studio registers it.
/// Thread-safe; Foundation only.
final class BubbleLengthCatalog: @unchecked Sendable {
    static let shared = BubbleLengthCatalog()

    private let lock = NSLock()
    private var specs: [String: BubbleLengthSpec]
    private var conceptDefaults: [String: Double] = [:]

    private init() {
        specs = Self.builtIn
    }

    func spec(for formula: String) -> BubbleLengthSpec? {
        lock.lock(); defer { lock.unlock() }
        return specs[formula]
    }

    /// Takes every formula's `length` from `Bubble.catalogJSON()` (and concept param defaults, for
    /// label inference). Formulas the catalog doesn't declare keep the built-in spec.
    func register(catalog: JSONValue) {
        var found: [String: BubbleLengthSpec] = [:]
        for formula in catalog["formulas"]?.array ?? [] {
            if let id = formula["id"]?.string, let spec = BubbleLengthSpec(json: formula["length"]) { found[id] = spec }
        }
        var defaults: [String: Double] = [:]
        for concept in catalog["concepts"]?.array ?? [] {
            guard let id = concept["id"]?.string else { continue }
            for (name, param) in concept["params"]?.object ?? [:] {
                if let v = param["default"]?.double { defaults["\(id).\(name)"] = v }
            }
        }
        lock.lock(); defer { lock.unlock() }
        specs.merge(found) { _, new in new }
        conceptDefaults.merge(defaults) { _, new in new }
    }

    func conceptDefault(_ ref: String) -> Double? {
        lock.lock(); defer { lock.unlock() }
        return conceptDefaults[ref] ?? Self.builtInDefaults[ref]
    }

    static func fallback(_ mode: BubbleLengthMode) -> Int? {
        switch mode {
        case .endless: return nil
        case .rounds: return 10
        case .timed: return 60
        case .lives: return 3
        }
    }

    static func knobOrder(_ id: String) -> Int {
        ["speed", "difficulty", "timer", "rounds", "lives"].firstIndex(of: id) ?? 9
    }

    /// The kits' declarations (bubble-kit-*.js `length`), for before the catalog loads.
    static let builtIn: [String: BubbleLengthSpec] = [
        "dodge": BubbleLengthSpec(
            modes: [.endless, .timed, .rounds, .lives], defaultLength: .endless,
            numbers: [.rounds: 20, .timed: 60, .lives: 3],
            knobs: [
                BubbleLengthKnob(id: "speed", concept: "space.side_scroll", param: "speed", label: "Speed", min: 1.6, max: 3.6, invert: false),
                BubbleLengthKnob(id: "difficulty", concept: "behavior.spawn_stream", param: "gap", label: "Gap size", min: 140, max: 240, invert: true),
            ]),
        "time": BubbleLengthSpec(
            modes: [.rounds, .timed, .lives, .endless], defaultLength: BubbleLength(mode: .rounds),
            numbers: [.rounds: 12, .timed: 45, .lives: 3],
            infer: [.rounds: ["rule.timing_window.targets", "rule.timing_stack.goal"]],
            knobs: [
                BubbleLengthKnob(id: "speed", concept: "entity.timing_mover", param: "speed", label: "Speed", min: 0.28, max: 0.8, invert: false),
                BubbleLengthKnob(id: "difficulty", concept: "rule.timing_window|rule.timing_stack", param: "perfect", label: "Perfect zone", min: 2, max: 10, invert: true),
            ]),
        "merge": BubbleLengthSpec(
            modes: [.endless, .timed, .rounds], defaultLength: .endless,
            numbers: [.rounds: 40, .timed: 75],
            knobs: [
                BubbleLengthKnob(id: "speed", concept: "entity.merge_orb", param: "cooldown", label: "Drop pace", min: 0.3, max: 1, invert: true),
                BubbleLengthKnob(id: "difficulty", concept: "rule.overflow_fail", param: "grace", label: "Overflow grace", min: 0.6, max: 2.6, invert: true),
            ]),
        "group": BubbleLengthSpec(
            modes: [.rounds, .timed, .lives, .endless], defaultLength: BubbleLength(mode: .rounds),
            numbers: [.rounds: 15, .timed: 45, .lives: 3],
            infer: [.rounds: ["entity.sort_bubble.deal"]],
            knobs: [
                BubbleLengthKnob(id: "speed", concept: "entity.sort_bubble", param: "rise_speed", label: "Rise speed", min: 20, max: 60, invert: false),
                BubbleLengthKnob(id: "difficulty", concept: "entity.sort_bubble", param: "spawn_every", label: "Bubble pace", min: 1, max: 3, invert: true),
            ]),
        "answer": BubbleLengthSpec(
            modes: [.rounds, .timed, .lives, .endless], defaultLength: BubbleLength(mode: .rounds),
            numbers: [.rounds: 8, .timed: 60, .lives: 3],
            infer: [.rounds: ["content:rounds"]],
            knobs: [
                BubbleLengthKnob(id: "speed", concept: "flow.rounds", param: "pause", label: "Pace", min: 70, max: 150, invert: true),
                BubbleLengthKnob(id: "timer", concept: "rule.answer_key|rule.consensus", param: "round_seconds", label: "Seconds per question", min: 4, max: 15, invert: false),
            ]),
        "guess": BubbleLengthSpec(
            modes: [.rounds, .timed, .lives], defaultLength: BubbleLength(mode: .rounds),
            numbers: [.rounds: 6, .timed: 90, .lives: 5],
            infer: [.rounds: ["rule.attempt_budget.attempts"]],
            knobs: [
                BubbleLengthKnob(id: "speed", concept: "flow.rounds", param: "pause", label: "Pace", min: 50, max: 130, invert: true),
                BubbleLengthKnob(id: "difficulty", concept: "space.portrait_choices", param: "choices", label: "Faces to pick from", min: 2, max: 4, step: 1, invert: false),
            ]),
        "story": BubbleLengthSpec(
            modes: [.rounds, .endless], defaultLength: BubbleLength(mode: .rounds),
            numbers: [.rounds: 12]),
        "nextline": BubbleLengthSpec(
            modes: [.rounds, .timed, .lives], defaultLength: .rounds(5),
            knobs: [
                BubbleLengthKnob(id: "timer", concept: "rule.next_line", param: "round_seconds", label: "Seconds to answer", min: 4, max: 15, invert: false),
            ]),
        "learn": BubbleLengthSpec(
            modes: [.rounds, .lives, .endless], defaultLength: BubbleLength(mode: .rounds),
            numbers: [.rounds: 8, .lives: 3],
            infer: [.rounds: ["content:questions"]]),
    ]

    /// Param defaults the inference reads when a manifest leaves them out.
    static let builtInDefaults: [String: Double] = [
        "rule.timer.seconds": 30, "flow.rounds.count": 5, "rule.lives.lives": 3,
        "rule.timing_window.targets": 12, "rule.timing_stack.goal": 16, "rule.attempt_budget.attempts": 6,
        "entity.sort_bubble.deal": 0,
    ]
}

extension BubbleLength {
    /// The formula's default length (from its `length.default`); endless when it declares none.
    static func defaultLength(for manifest: BubbleManifest) -> BubbleLength {
        BubbleLengthCatalog.shared.spec(for: manifest.formula.rawValue)?.defaultLength ?? .endless
    }

    /// The length a player sees: the manifest's own (locked) length, else what its concepts say
    /// (rule.timer, flow.rounds, the formula's `length.infer`, rule.lives), else the formula's
    /// default mode. Mirrors the runtime's `Bubble.displayLength`. Nil when nothing says.
    static func effective(for manifest: BubbleManifest) -> BubbleLength? {
        let spec = BubbleLengthCatalog.shared.spec(for: manifest.formula.rawValue)
        if let own = manifest.length {
            var out = own
            if out.mode != .endless, out.number == nil {
                out.number = spec?.numbers[out.mode] ?? (spec?.defaultLength.mode == out.mode ? spec?.defaultLength.number : nil) ?? BubbleLengthCatalog.fallback(out.mode)
            }
            return out.normalized
        }
        let generic: [BubbleLengthMode: [String]] = [.timed: ["rule.timer.seconds"], .rounds: ["flow.rounds.count"], .lives: ["rule.lives.lives"]]
        for mode in [BubbleLengthMode.timed, .rounds, .lives] {
            for ref in (generic[mode] ?? []) + (spec?.infer[mode] ?? []) {
                if let n = infer(ref, in: manifest) {
                    var out = BubbleLength(mode: mode)
                    out.number = n
                    return out
                }
            }
        }
        guard let def = spec?.defaultLength else { return .endless }
        return def.mode == .endless || def.number != nil ? def : nil
    }

    private static func infer(_ ref: String, in manifest: BubbleManifest) -> Int? {
        if ref.hasPrefix("content:") {
            let n = manifest.content[String(ref.dropFirst(8))]?.array?.count ?? 0
            return n > 0 ? n : nil
        }
        guard let dot = ref.lastIndex(of: ".") else { return nil }
        let concept = String(ref[..<dot]), param = String(ref[ref.index(after: dot)...])
        guard let use = manifest.concepts.first(where: { $0.use == concept }) else { return nil }
        let value = use.params?[param]?.double ?? BubbleLengthCatalog.shared.conceptDefault(ref)
        guard let value, value > 0 else { return nil }
        return Int(value)
    }
}

extension BubbleManifest {
    /// This manifest with `length` set (nil keeps it). Changes the session key, so a prepared
    /// session for the plain manifest is never reused for a locked length.
    func withLength(_ length: BubbleLength?) -> BubbleManifest {
        guard let length else { return self }
        var copy = self
        copy.length = length
        return copy
    }

    /// This manifest with another seed (nil keeps it). Same-seed challenges and group-chat
    /// sessions play this way; the replay log records the seed, so the score stays verifiable.
    func withSeed(_ seed: Int?) -> BubbleManifest {
        guard let seed else { return self }
        var copy = self
        copy.seed = seed
        return copy
    }
}
