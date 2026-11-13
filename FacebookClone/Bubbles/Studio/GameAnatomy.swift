import Foundation

// The game anatomy (`game-anatomy/0.1`, docs/BUBBLES.md 7.13): Muse's read of how a game works, part
// by part, agreed with the person before Muse builds it. Studio shows it as cards, the person
// corrects it, and the agreed version goes into the build as text (`agreedText`).
//
// Everything about the format lives in this file, so it can be swapped for another plan format
// later. Decoding is lenient: missing fields get defaults, unknown familiarity reads as
// "approximate", and either `{"anatomy": "game-anatomy/0.1", "parts": …}` or a wrapper
// `{"anatomy": {…}}` is accepted.

/// Who decided a part: the person's own words, or Muse's guess.
enum AnatomySource: String, Hashable, Sendable {
    case you
    case guess

    init(lenient raw: String?) {
        switch raw?.lowercased().trimmingCharacters(in: .whitespaces) {
        case "you", "user", "person", "said", "creator", "request": self = .you
        default: self = .guess
        }
    }

    var label: String { self == .you ? "You said" : "Muse guessed" }
}

/// How well Muse knows how to build a part.
enum AnatomyFamiliarity: String, Hashable, Sendable {
    /// A tested fragment does it as is.
    case known
    /// A fragment gets close; Muse tunes it or adds a small custom rule.
    case approximate
    /// Nothing in the library does it; Muse writes it from scratch.
    case unfamiliar

    init(lenient raw: String?) {
        switch raw?.lowercased().trimmingCharacters(in: .whitespaces) {
        case "known", "familiar", "fragment": self = .known
        case "unfamiliar", "new", "new_to_muse", "new to muse", "unknown", "novel": self = .unfamiliar
        default: self = .approximate
        }
    }

    var label: String {
        switch self {
        case .known: return "Known"
        case .approximate: return "Approximate"
        case .unfamiliar: return "New to Muse"
        }
    }
}

/// What every part carries besides its content.
struct AnatomyMeta: Hashable, Sendable {
    var source: AnatomySource = .guess
    var familiarity: AnatomyFamiliarity = .approximate
    /// How Muse plans to build it: "fragment:<id>", "custom:<what>", "gate:<profile>" or "engine-gap:<name>".
    var plan: String?
    /// A question for the person; only for guessed parts Muse doesn't know.
    var question: String?
    /// Quick answers for the question.
    var options: [String] = []
    /// The person's answer (set in Studio, sent back to Muse).
    var answer: String?

    static let keys: Set<String> = ["source", "familiarity", "plan", "question", "options", "answer"]

    init(source: AnatomySource = .guess, familiarity: AnatomyFamiliarity = .approximate, plan: String? = nil,
         question: String? = nil, options: [String] = [], answer: String? = nil) {
        self.source = source
        self.familiarity = familiarity
        self.plan = plan
        self.question = question
        self.options = options
        self.answer = answer
    }

    init(json: JSONValue?) {
        source = AnatomySource(lenient: json?["source"]?.string)
        familiarity = AnatomyFamiliarity(lenient: json?["familiarity"]?.string)
        plan = GameAnatomy.clean(json?["plan"]?.string)
        question = GameAnatomy.clean(json?["question"]?.string)
        options = (json?["options"]?.strings ?? []).compactMap(GameAnatomy.clean).prefix(4).map { $0 }
        answer = GameAnatomy.clean(json?["answer"]?.string)
        // Questions only for guessed parts Muse doesn't know (the format's rule).
        if source == .you || familiarity == .known { question = nil; options = [] }
    }

    var jsonFields: [String: JSONValue] {
        var out: [String: JSONValue] = [
            "source": .string(source.rawValue),
            "familiarity": .string(familiarity.rawValue),
        ]
        out["plan"] = plan.map(JSONValue.string) ?? .null
        out["question"] = question.map(JSONValue.string) ?? .null
        if !options.isEmpty { out["options"] = .array(options.map(JSONValue.string)) }
        if let answer { out["answer"] = .string(answer) }
        return out
    }

    /// "custom: region map" → "Muse writes custom rules: region map". Nil for plain fragments.
    var planLine: String? {
        guard let plan else { return nil }
        let parts = plan.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
        let kind = parts[0].lowercased()
        let rest = parts.count > 1 ? parts[1] : ""
        switch kind {
        case "fragment": return rest.isEmpty ? nil : "Built from the \(rest.replacingOccurrences(of: "_", with: " ")) block, tuned for this game"
        case "custom":
            // "grid, neighbors8 - two crowns may not touch": people read the part after the builtins.
            let what = rest.range(of: " - ").map { String(rest[$0.upperBound...]) } ?? rest
            return what.isEmpty ? "Muse writes custom rules for this" : "Muse writes custom rules: \(what)"
        case "gate": return rest.isEmpty ? "Muse checks this in playtests" : "Muse checks this in playtests: \(rest)"
        case "engine-gap", "engine_gap", "gap": return "The game engine can't do this yet\(rest.isEmpty ? "" : " (\(rest.replacingOccurrences(of: "_", with: " ")))"), so Muse will get as close as it can"
        default: return plan
        }
    }
}

/// The parts of a game, in the order Studio shows them. Rules are listed separately.
enum AnatomyPartKey: String, CaseIterable, Hashable, Sendable {
    case coreLoop = "core_loop"
    case verbs
    case pieces
    case state
    case end
    case structure
    case randomness
    case share
    case theme

    var title: String {
        switch self {
        case .coreLoop: return "Core loop"
        case .verbs: return "What you do"
        case .pieces: return "Pieces"
        case .state: return "What it tracks"
        case .end: return "How it ends"
        case .structure: return "Turns and timing"
        case .randomness: return "Chance"
        case .share: return "What you share"
        case .theme: return "Theme"
        }
    }

    /// For Muse's "This changes …" lines.
    var phrase: String {
        switch self {
        case .coreLoop: return "the core loop"
        case .verbs: return "what you do"
        case .pieces: return "the pieces"
        case .state: return "what the game tracks"
        case .end: return "how it ends"
        case .structure: return "the turns and timing"
        case .randomness: return "the chance"
        case .share: return "what you share"
        case .theme: return "the theme"
        }
    }

    /// SF Symbol for the card.
    var symbol: String {
        switch self {
        case .coreLoop: return "arrow.triangle.2.circlepath"
        case .verbs: return "hand.tap"
        case .pieces: return "square.grid.2x2"
        case .state: return "list.bullet.rectangle"
        case .end: return "flag.checkered"
        case .structure: return "timer"
        case .randomness: return "dice"
        case .share: return "square.and.arrow.up"
        case .theme: return "paintpalette"
        }
    }
}

/// One part of the anatomy (everything but rules).
struct AnatomyPart: Identifiable, Hashable, Sendable {
    var key: AnatomyPartKey
    /// One plain line: what the person reads and can edit.
    var text: String
    /// Extra lines read from the structured fields ("Win: …", "Crown: row, column").
    var details: [String]
    /// The part's own fields as Muse sent them (items, win, lose, …), kept for the round trip.
    var fields: [String: JSONValue]
    var meta: AnatomyMeta

    var id: String { key.rawValue }
}

/// One numbered rule.
struct AnatomyRule: Identifiable, Hashable, Sendable {
    var n: Int
    var text: String
    /// How a scripted playtest would confirm it.
    var check: String?
    var meta: AnatomyMeta

    var id: String { GameAnatomy.ruleSlot(n) }
}

struct GameAnatomy: Hashable, Sendable {
    static let format = "game-anatomy/0.1"

    var title: String
    /// word, puzzle, action, story or party.
    var genre: String
    var parts: [AnatomyPart]
    var rules: [AnatomyRule]
    /// Muse's one-line answer to a change ("This changes rule 2 and how it ends.").
    var reply: String?
    /// What Muse says a change touched, as slots ("end", "rules.2").
    var changed: [String] = []

    // MARK: Reading

    /// Decodes Muse's reply leniently. Nil only when there's nothing that looks like an anatomy.
    static func decode(_ value: JSONValue) -> GameAnatomy? {
        var root = value
        if root["parts"] == nil, let inner = root["anatomy"], inner.object != nil { root = inner }
        if root["parts"] == nil, let inner = root["game"], inner.object != nil { root = inner }
        guard let partsJSON = root["parts"]?.object else { return nil }

        var parts: [AnatomyPart] = []
        for key in AnatomyPartKey.allCases {
            guard let raw = partsJSON[key.rawValue] else { continue }
            parts.append(part(key, from: raw))
        }
        let rulesJSON = partsJSON["rules"] ?? root["rules"]
        var rules: [AnatomyRule] = []
        for (index, item) in (rulesJSON?.array ?? []).enumerated() {
            if let text = clean(item.string) {
                rules.append(AnatomyRule(n: index + 1, text: text, check: nil, meta: AnatomyMeta()))
                continue
            }
            guard let text = clean(item["text"]?.string ?? item["rule"]?.string) else { continue }
            rules.append(AnatomyRule(n: item["n"]?.int ?? index + 1, text: text, check: clean(item["check"]?.string), meta: AnatomyMeta(json: item)))
        }
        guard !parts.isEmpty || !rules.isEmpty else { return nil }

        var changed: [String] = []
        if let list = root["changed"]?.strings, !list.isEmpty { changed = list } else { changed = value["changed"]?.strings ?? [] }
        return GameAnatomy(
            title: clean(root["title"]?.string) ?? "Your game",
            genre: clean(root["genre"]?.string)?.lowercased() ?? "puzzle",
            parts: parts,
            rules: rules,
            reply: clean(root["reply"]?.string ?? value["reply"]?.string),
            changed: changed
        )
    }

    private static func part(_ key: AnatomyPartKey, from raw: JSONValue) -> AnatomyPart {
        if let text = clean(raw.string) {
            return AnatomyPart(key: key, text: text, details: [], fields: [:], meta: AnatomyMeta())
        }
        var fields = raw.object ?? [:]
        for metaKey in AnatomyMeta.keys { fields.removeValue(forKey: metaKey) }
        let explicit = clean(fields.removeValue(forKey: "text")?.string)
        let details = detailLines(key, fields)
        let text = explicit ?? summary(key, fields, details: details)
        return AnatomyPart(key: key, text: text, details: explicit == nil ? details.filter { $0 != text } : details, fields: fields, meta: AnatomyMeta(json: raw))
    }

    /// Readable lines from a part's structured fields.
    private static func detailLines(_ key: AnatomyPartKey, _ fields: [String: JSONValue]) -> [String] {
        var lines: [String] = []
        switch key {
        case .end:
            if let win = clean(fields["win"]?.string) { lines.append("Win: \(win)") }
            if let lose = clean(fields["lose"]?.string) { lines.append("Lose: \(lose)") }
            if let score = clean(fields["score"]?.string) { lines.append("Score: \(score)") }
        case .structure:
            if let turns = clean(fields["turns"]?.string) { lines.append("Turns: \(turns)") }
            if let timing = clean(fields["timing"]?.string) { lines.append("Timing: \(timing)") }
            if let range = fields["length_s"]?.array, let low = range.first?.int, let high = range.last?.int {
                lines.append(low == high ? "About \(low) s a run" : "\(low)–\(high) s a run")
            } else if let seconds = fields["length_s"]?.int {
                lines.append("About \(seconds) s a run")
            }
        case .randomness:
            if let seed = clean(fields["seed"]?.string) { lines.append(seed) }
        case .share:
            if let grid = clean(fields["grid"]?.string) { lines.append(grid) }
        default:
            break
        }
        // Verbs are already the summary line; pieces and state add what each one has.
        for item in key == .verbs ? [] : fields["items"]?.array ?? [] {
            if let text = clean(item.string) {
                lines.append(text)
            } else if let name = clean(item["name"]?.string) {
                if let has = item["has"]?.strings, !has.isEmpty {
                    lines.append("\(name): \(has.joined(separator: ", "))")
                } else if let type = clean(item["type"]?.string) {
                    lines.append("\(name) (\(type))")
                } else {
                    lines.append(name)
                }
            }
        }
        return lines
    }

    private static func summary(_ key: AnatomyPartKey, _ fields: [String: JSONValue], details: [String]) -> String {
        switch key {
        case .verbs:
            let items = (fields["items"]?.array ?? []).compactMap { clean($0.string) ?? clean($0["name"]?.string) }
            if !items.isEmpty {
                let rest = items.dropFirst().map { $0.prefix(1).lowercased() + $0.dropFirst() }
                return sentence(([items[0]] + rest).joined(separator: ", "))
            }
        case .pieces, .state:
            let names = (fields["items"]?.array ?? []).compactMap { clean($0["name"]?.string) ?? clean($0.string) }
            if !names.isEmpty { return sentence(names.joined(separator: ", ")) }
        case .end:
            if let win = clean(fields["win"]?.string) { return "Win: \(win)" }
            if let lose = clean(fields["lose"]?.string) { return "Lose: \(lose)" }
        default:
            break
        }
        if let first = details.first { return first }
        let strings = fields.sorted { $0.key < $1.key }.compactMap { clean($0.value.string) }
        return strings.first ?? "Muse will pick"
    }

    // MARK: Writing

    /// The anatomy as Muse reads it back (with the person's edits and answers).
    var json: JSONValue {
        var partsJSON: [String: JSONValue] = [:]
        for part in parts {
            var object = part.fields
            object["text"] = .string(part.text)
            for (key, value) in part.meta.jsonFields { object[key] = value }
            partsJSON[part.key.rawValue] = .object(object)
        }
        partsJSON["rules"] = .array(rules.map { rule in
            var object: [String: JSONValue] = ["n": .number(Double(rule.n)), "text": .string(rule.text)]
            object["check"] = rule.check.map(JSONValue.string) ?? .null
            for (key, value) in rule.meta.jsonFields { object[key] = value }
            return .object(object)
        })
        return .object([
            "anatomy": .string(Self.format),
            "title": .string(title),
            "genre": .string(genre),
            "parts": .object(partsJSON),
        ])
    }

    // MARK: Slots (one id per card: a part key or "rules.<n>")

    static func ruleSlot(_ n: Int) -> String { "rules.\(n)" }

    func part(_ key: AnatomyPartKey) -> AnatomyPart? { parts.first { $0.key == key } }

    func meta(slot: String) -> AnatomyMeta? {
        if let rule = rules.first(where: { $0.id == slot }) { return rule.meta }
        return parts.first { $0.id == slot }?.meta
    }

    func text(slot: String) -> String? {
        if let rule = rules.first(where: { $0.id == slot }) { return rule.text }
        return parts.first { $0.id == slot }?.text
    }

    /// "rule 2", "how it ends".
    func label(slot: String) -> String {
        if slot.hasPrefix("rules.") || slot.hasPrefix("rule.") {
            let number = slot.split(separator: ".").last.map(String.init) ?? ""
            return number.isEmpty ? "the rules" : "rule \(number)"
        }
        if slot == "rules" { return "the rules" }
        return AnatomyPartKey(rawValue: slot)?.phrase ?? slot.replacingOccurrences(of: "_", with: " ")
    }

    /// The person rewrote a part: it's theirs now.
    mutating func setText(_ text: String, slot: String) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        if let index = rules.firstIndex(where: { $0.id == slot }) {
            guard rules[index].text != value else { return }
            rules[index].text = value
            rules[index].meta.source = .you
            rules[index].meta.question = nil
        } else if let index = parts.firstIndex(where: { $0.id == slot }) {
            guard parts[index].text != value else { return }
            parts[index].text = value
            parts[index].details = []
            parts[index].fields = [:]
            parts[index].meta.source = .you
            parts[index].meta.question = nil
        }
    }

    /// The person answered a part's question (nil clears it).
    mutating func setAnswer(_ answer: String?, slot: String) {
        let value = answer?.trimmingCharacters(in: .whitespacesAndNewlines)
        let stored = (value?.isEmpty ?? true) ? nil : value
        if let index = rules.firstIndex(where: { $0.id == slot }) {
            rules[index].meta.answer = stored
        } else if let index = parts.firstIndex(where: { $0.id == slot }) {
            parts[index].meta.answer = stored
        }
    }

    /// Adds a rule in the person's words.
    mutating func addRule(_ text: String) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        rules.append(AnatomyRule(n: (rules.map(\.n).max() ?? 0) + 1, text: value, check: nil,
                                 meta: AnatomyMeta(source: .you, familiarity: .approximate, plan: "custom: a rule from your words")))
    }

    // MARK: Counts

    /// Every card: parts plus rules.
    var allMetas: [(slot: String, meta: AnatomyMeta)] {
        parts.map { ($0.id, $0.meta) } + rules.map { ($0.id, $0.meta) }
    }

    var partCount: Int { parts.count + rules.count }
    var newCount: Int { allMetas.filter { $0.meta.familiarity == .unfamiliar }.count }
    var approximateCount: Int { allMetas.filter { $0.meta.familiarity == .approximate }.count }
    var guessCount: Int { allMetas.filter { $0.meta.source == .guess }.count }
    /// Questions the person hasn't answered yet.
    var openQuestions: [String] { allMetas.filter { $0.meta.question != nil && $0.meta.answer == nil }.map(\.slot) }
    /// Answers given since Muse last read it.
    var answers: [(question: String, answer: String)] {
        allMetas.compactMap { item in
            guard let question = item.meta.question, let answer = item.meta.answer else { return nil }
            return (question, answer)
        }
    }

    /// "Muse understood 12 parts; 1 is new to it."
    var summaryLine: String {
        let parts = "\(partCount) \(partCount == 1 ? "part" : "parts")"
        switch newCount {
        case 0: return "Muse understood \(parts); none are new to it."
        case 1: return "Muse understood \(parts); 1 is new to it."
        default: return "Muse understood \(parts); \(newCount) are new to it."
        }
    }

    // MARK: Changes

    /// Slots that differ from `old` (text, rules added or removed, familiarity).
    func changedSlots(from old: GameAnatomy) -> [String] {
        var slots: [String] = []
        for part in parts {
            let before = old.part(part.key)
            if before?.text != part.text || before?.details != part.details { slots.append(part.id) }
        }
        for gone in old.parts where self.part(gone.key) == nil { slots.append(gone.id) }
        let oldRules = Dictionary(old.rules.map { ($0.n, $0) }, uniquingKeysWith: { first, _ in first })
        for rule in rules where oldRules[rule.n]?.text != rule.text { slots.append(rule.id) }
        let newNumbers = Set(rules.map(\.n))
        for rule in old.rules where !newNumbers.contains(rule.n) { slots.append(rule.id) }
        return slots
    }

    /// Slots this anatomy says changed, else the ones that differ from `old`.
    func changes(from old: GameAnatomy) -> [String] {
        let diff = changedSlots(from: old)
        guard !changed.isEmpty else { return diff }
        let normalized = changed.map { $0.replacingOccurrences(of: "rule.", with: "rules.").replacingOccurrences(of: "rules_", with: "rules.") }
        let named = normalized.filter { meta(slot: $0) != nil || $0.hasPrefix("rules.") }
        return named.isEmpty ? diff : named
    }

    /// "This changes rule 2 and how it ends."
    func changeSentence(_ slots: [String]) -> String {
        let labels = Self.unique(slots.map { label(slot: $0) })
        guard !labels.isEmpty else { return "This doesn't change how the game works, only how it looks or feels." }
        return "This changes \(Self.list(labels))."
    }

    /// Changed slots Muse hasn't built before.
    func unfamiliar(in slots: [String]) -> [String] {
        slots.filter { meta(slot: $0)?.familiarity == .unfamiliar }
    }

    // MARK: Text for the build

    /// The agreed anatomy as the build reads it. `request` is the person's own words, kept verbatim.
    func agreedText(request: String? = nil) -> String {
        var lines = ["Agreed game anatomy (follow the rules and mechanics exactly, not just the look):"]
        if let request = Self.clean(request) { lines.append("The person asked for: “\(request)”") }
        lines.append("Working title: \(title) · genre: \(genre)")
        if let theme = part(.theme), theme.meta.source == .you {
            lines.append("Theme the person asked for (keep it verbatim in names, art and words): \(theme.text)")
        }
        for part in parts {
            var line = "- \(part.key.title): \(part.text)"
            if !part.details.isEmpty { line += " (\(part.details.joined(separator: "; ")))" }
            line += Self.tag(part.meta)
            lines.append(line)
        }
        if !rules.isEmpty {
            lines.append("Rules (each one must hold in the game):")
            for rule in rules {
                var line = "\(rule.n). \(rule.text)"
                if let check = rule.check { line += " Check: \(check)" }
                line += Self.tag(rule.meta)
                lines.append(line)
            }
        }
        let answers = self.answers
        if !answers.isEmpty {
            lines.append("The person's answers:")
            lines += answers.map { "- \($0.question) \($0.answer)" }
        }
        return lines.joined(separator: "\n")
    }

    private static func tag(_ meta: AnatomyMeta) -> String {
        var bits: [String] = [meta.source == .you ? "the person said this" : "Muse's pick"]
        if meta.familiarity == .unfamiliar { bits.append("new: build it with custom rules") }
        if let plan = meta.plan { bits.append("plan \(plan)") }
        if let answer = meta.answer { bits.append("answer: \(answer)") }
        return " [\(bits.joined(separator: "; "))]"
    }

    // MARK: Calibration

    /// Engine builtins named in the prompt (`mg-core/src/builtins.rs`, the ones that build mechanics).
    static let promptBuiltins = [
        "cells", "coords", "neighbors4", "neighbors8", "in_grid", "in_bounds", "grid_map", "set_at", "count", "filter", "fold",
        "map_of", "set_of", "sum", "min_of", "max_of", "sort_by", "shuffle", "pick", "random_int", "random_float", "chance",
        "weighted", "hash", "in_dictionary", "chars", "split", "join", "contains", "index_of", "dist", "overlaps_circle",
        "overlaps_rect", "clamp", "lerp", "range", "zip",
    ]

    /// Words a `custom:` plan may use and still count as "built from builtins": the builtins, the
    /// state types, the input and timer names, and the joining words between them.
    static let builtinVocabulary: Set<String> = Set(promptBuiltins).union([
        "abs", "add", "all", "any", "concat", "drop", "first", "last", "find", "get_or", "has", "insert_at", "keys", "len",
        "length", "lower", "upper", "map", "max", "min", "push", "put", "remove", "remove_at", "repeat", "replace", "reverse",
        "rotate", "round", "slice", "take", "trim", "values", "vec", "grid", "list", "set", "int", "float", "string", "bool",
        "state", "event", "events", "timer", "timers", "every", "after", "input", "tap", "tap_cell", "drag", "swipe", "key",
        "keys", "press", "typed", "counter", "score",
    ])

    private static let planFillers: Set<String> = ["and", "or", "with", "plus", "then", "of", "a", "an", "the", "per", "on"]

    /// True when a `custom:` plan names only builtins before its description ("custom:grid, neighbors8 - …").
    static func planUsesOnlyBuiltins(_ plan: String?) -> Bool {
        guard let plan, let colon = plan.firstIndex(of: ":"),
              plan[..<colon].trimmingCharacters(in: .whitespaces).lowercased() == "custom" else { return false }
        var rest = String(plan[plan.index(after: colon)...])
        for separator in [" - ", " – ", " — ", ";", ":", "("] {
            if let range = rest.range(of: separator) { rest = String(rest[..<range.lowerBound]) }
        }
        let tokens = rest.lowercased().split { !($0.isLetter || $0.isNumber || $0 == "_") }.map(String.init)
            .filter { !planFillers.contains($0) }
        return !tokens.isEmpty && tokens.contains { promptBuiltins.contains($0) || builtinVocabulary.contains($0) }
            && tokens.allSatisfy { builtinVocabulary.contains($0) }
    }

    /// Applies the familiarity rule mechanically: "New to Muse" only for engine gaps or parts with no
    /// builtin plan. An unfamiliar part whose plan is a listed fragment, or a `custom:` plan made only
    /// of builtins, becomes approximate; a "known" part without a listed fragment becomes approximate.
    func calibrated(knownFragments: Set<String>) -> GameAnatomy {
        func fix(_ meta: AnatomyMeta) -> AnatomyMeta {
            var meta = meta
            let plan = meta.plan?.trimmingCharacters(in: .whitespaces) ?? ""
            let lower = plan.lowercased()
            let fragmentID = lower.hasPrefix("fragment:")
                ? String(lower.dropFirst("fragment:".count)).trimmingCharacters(in: .whitespaces) : nil
            // An engine gap is always new, whatever Muse called it.
            if lower.hasPrefix("engine-gap") || lower.hasPrefix("engine_gap") {
                meta.familiarity = .unfamiliar
                return meta
            }
            switch meta.familiarity {
            case .unfamiliar:
                if let fragmentID, knownFragments.contains(fragmentID) || knownFragments.isEmpty {
                    meta.familiarity = .approximate
                } else if Self.planUsesOnlyBuiltins(plan) {
                    meta.familiarity = .approximate
                }
            case .known:
                if fragmentID == nil, !lower.hasPrefix("gate") { meta.familiarity = .approximate }
            case .approximate:
                break
            }
            if meta.familiarity == .known { meta.question = nil; meta.options = [] }
            return meta
        }
        var out = self
        for index in out.parts.indices { out.parts[index].meta = fix(out.parts[index].meta) }
        for index in out.rules.indices { out.rules[index].meta = fix(out.rules[index].meta) }
        return out
    }

    /// Fragment ids from prompt lines ("- grid_board: …").
    static func fragmentIDs(in lines: String) -> Set<String> {
        Set(lines.split(separator: "\n").compactMap { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("- "), let colon = trimmed.firstIndex(of: ":") else { return nil }
            return String(trimmed[trimmed.index(trimmed.startIndex, offsetBy: 2)..<colon]).lowercased()
        })
    }

    // MARK: Helpers

    static func clean(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, text.lowercased() != "null" else { return nil }
        return text
    }

    static func sentence(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }

    static func unique(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.filter { seen.insert($0).inserted }
    }

    /// "a", "a and b", "a, b and c".
    static func list(_ items: [String]) -> String {
        switch items.count {
        case 0: return ""
        case 1: return items[0]
        default: return items.dropLast().joined(separator: ", ") + " and " + items[items.count - 1]
        }
    }
}
