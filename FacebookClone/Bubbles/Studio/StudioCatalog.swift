import Foundation

/// The runtime's concept library as Muse Studio sees it: `Bubble.catalogJSON()` parsed into
/// formulas (each with a complete example manifest) and concept contracts (docs/BUBBLES.md 4.6).
///
/// Every prompt and tool reply is built from this, so new kits and concepts show up in Studio
/// without code changes.
struct StudioCatalog: Sendable {
    struct Formula: Sendable {
        var id: String
        var title: String
        var describe: String
        var core: [String]
        var optional: [String]
        var contentDescribe: String
        var contentSchema: JSONValue
        /// A complete, valid manifest: the few-shot for Muse and the start for the offline composer.
        var example: JSONValue?
        /// More complete manifests, when the kit ships several (`examples`).
        var examples: [JSONValue]
        /// Tuning advice from the kit ("Chill: speed 2.2, gap 190+ ...").
        var tips: [String]
        var raw: JSONValue

        /// Core entries can offer alternatives ("rule.answer_key|rule.consensus"): every concept id named.
        var coreIDs: [String] { core.flatMap { $0.split(separator: "|").map(String.init) } }
        var optionalIDs: [String] { optional.flatMap { $0.split(separator: "|").map(String.init) } }

        /// Core entries that a concept list is missing (an alternative counts when any one is used).
        func missingCore(in concepts: [String]) -> [String] {
            core.filter { entry in !entry.split(separator: "|").contains { concepts.contains(String($0)) } }
        }
    }

    struct Concept: Sendable {
        var id: String
        var kind: String
        var describe: String
        var formulas: [String]
        /// Param name to its spec: `{type, default, min, max, values, max_length, max_items, describe}`.
        var params: [String: JSONValue]
        var consumes: [String]
        var emits: [String]
        var requires: [String]
        var conflicts: [String]
        var glue: [String]
        var tags: JSONValue
        /// True when the concept can end a run.
        var ends: Bool
        var raw: JSONValue

        func supports(_ formula: String) -> Bool {
            formulas.isEmpty || formulas.contains("*") || formulas.contains(formula)
        }

        var isShared: Bool { formulas.isEmpty || formulas.contains("*") }
    }

    /// `Bubble.version`, e.g. "1.0.0". "0.0-stub" for the placeholder runtime.
    var version: String
    /// The runtime contract manifests are pinned to (`engine_version`).
    var engineVersion: Int
    var formulas: [Formula]
    var concepts: [String: Concept]
    /// Identifiers glue may not use (from the catalog when it lists them).
    var glueForbidden: [String]
    /// The runtime's own glue rules and per-slot signatures (`glue_rules`, `glue_slots`).
    var glueRules: String?
    var glueSlots: [String: String]
    /// The looks Bubbles can wear (LOOKS.md), from the catalog's `looks`, or LOOKS.md's must-haves
    /// while the runtime doesn't list them (`looksFromRuntime` false).
    var looks: [BubbleLookSpec]
    var looksFromRuntime: Bool
    /// Preset palette ids (`palettes`), without "custom".
    var paletteIDs: [String]
    var fontIDs: [String]
    var motifIDs: [String]
    var raw: JSONValue

    init(json: JSONValue, runtimeVersion: String? = nil) {
        raw = json
        let object = json.object ?? [:]
        version = object["version"]?.string ?? runtimeVersion ?? "unknown"
        if let pinned = object["engine_version"]?.int {
            engineVersion = pinned
        } else if let major = version.split(separator: ".").first.flatMap({ Int($0) }), major > 0 {
            engineVersion = major
        } else {
            engineVersion = 1
        }
        formulas = (object["formulas"]?.array ?? []).compactMap(Self.formula(from:))
        var concepts: [String: Concept] = [:]
        for item in object["concepts"]?.array ?? [] {
            if let concept = Self.concept(from: item) {
                concepts[concept.id] = concept
            }
        }
        self.concepts = concepts
        let forbidden = (object["glue"]?["forbidden"]?.strings ?? []) + (object["glue_forbidden"]?.strings ?? [])
        glueForbidden = forbidden.isEmpty ? Self.defaultGlueForbidden : forbidden
        glueRules = object["glue_rules"]?.string
        glueSlots = (object["glue_slots"]?.object ?? [:]).compactMapValues { $0.string }
        let listed = BubbleLookSpec.parse(object["looks"])
        looks = listed.isEmpty ? BubbleLookSpec.fallback : listed
        looksFromRuntime = !listed.isEmpty
        let palettes = (object["palettes"]?.array ?? []).compactMap { $0.string ?? $0["id"]?.string }.filter { $0 != "custom" }
        paletteIDs = palettes.isEmpty ? StudioPalette.ids : palettes
        let fonts = object["fonts"]?.array?.compactMap { $0.string ?? $0["id"]?.string } ?? []
        fontIDs = StudioManifestBuilder.unique(fonts.isEmpty ? BubbleLookSpec.allFonts + looks.flatMap(\.fonts) : fonts)
        let motifs = object["motifs"]?.array?.compactMap { $0.string ?? $0["id"]?.string } ?? []
        motifIDs = StudioManifestBuilder.unique(motifs.isEmpty ? BubbleLookSpec.allMotifs + looks.flatMap(\.motifs) : motifs)
    }

    static let empty = StudioCatalog(json: .object([:]))

    /// True for the placeholder runtime or a catalog with no formulas.
    var isEmpty: Bool { formulas.isEmpty }
    var isStub: Bool { version.contains("stub") || formulas.isEmpty }

    var formulaIDs: [String] { formulas.map(\.id) }

    func formula(_ id: String) -> Formula? {
        formulas.first { $0.id == id }
    }

    func concept(_ id: String) -> Concept? {
        concepts[id]
    }

    var lookIDs: [String] { looks.map(\.id) }

    func look(_ id: String?) -> BubbleLookSpec? {
        guard let id = id?.trimmingCharacters(in: .whitespaces).lowercased(), !id.isEmpty else { return nil }
        return looks.first { $0.id == id || $0.title.lowercased() == id }
    }

    /// `palette: "custom"` with `colors` needs a runtime that knows looks; older ones only know presets.
    var supportsCustomColors: Bool { looksFromRuntime }

    func isPreset(_ palette: String?) -> Bool {
        guard let palette else { return false }
        return paletteIDs.contains(palette)
    }

    /// Concepts a formula can use, shared ones last.
    func concepts(for formula: String) -> [Concept] {
        concepts.values
            .filter { $0.supports(formula) }
            .sorted { ($0.isShared ? 1 : 0, $0.id) < ($1.isShared ? 1 : 0, $1.id) }
    }

    /// Every mood word the library tags concepts with, for the brief's vocabulary.
    var moods: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for concept in concepts.values.sorted(by: { $0.id < $1.id }) {
            for mood in concept.tags["mood"]?.strings ?? [] where seen.insert(mood).inserted {
                out.append(mood)
            }
        }
        return out.isEmpty ? Self.defaultMoods : out
    }

    /// Closest known concept ids for an unknown one (same kind first, then shared words).
    func suggestions(for unknown: String, formula: String? = nil, limit: Int = 4) -> [String] {
        let kind = unknown.split(separator: ".").first.map(String.init) ?? ""
        let words = Set(unknown.split(whereSeparator: { $0 == "." || $0 == "_" }).map(String.init))
        let scored = concepts.values.compactMap { concept -> (Int, String)? in
            if let formula, !concept.supports(formula) { return nil }
            var score = 0
            if concept.kind == kind { score += 2 }
            let other = Set(concept.id.split(whereSeparator: { $0 == "." || $0 == "_" }).map(String.init))
            score += words.intersection(other).count * 3
            return score > 0 ? (score, concept.id) : nil
        }
        return scored.sorted { ($0.0, $1.1) > ($1.0, $0.1) }.prefix(limit).map(\.1)
    }

    // MARK: - Prompt views

    /// One line per formula, for the composer's system prompt.
    var formulaLines: String {
        formulas.map { formula in
            var line = "- `\(formula.id)` (\(formula.title)): \(formula.describe) Core: \(formula.core.joined(separator: ", "))."
            if !formula.contentDescribe.isEmpty {
                line += " Content: \(formula.contentDescribe)"
            }
            return line
        }.joined(separator: "\n")
    }

    /// One line per look, for the composer's system prompt.
    var lookLines: String {
        looks.map { look in
            let describe = (look.describe.isEmpty ? look.title : look.describe).trimmingCharacters(in: CharacterSet(charactersIn: ". "))
            var line = "- `\(look.id)`: \(describe)."
            if !look.moods.isEmpty { line += " Fits \(look.moods.joined(separator: ", "))." }
            line += " Fonts: \(look.fonts.joined(separator: ", "))."
            if !look.motifs.isEmpty { line += " Motifs: \(look.motifs.joined(separator: ", "))." }
            if supportsCustomColors, let colors = look.exampleColors.first {
                line += " Example colors: \(StudioColors.json(colors).jsonString())"
            }
            return line
        }.joined(separator: "\n")
    }

    /// What `list_formulas` returns.
    func formulaSummaries() -> JSONValue {
        .array(formulas.map { formula in
            [
                "id": .string(formula.id),
                "title": .string(formula.title),
                "describe": .string(formula.describe),
                "core": .array(formula.core.map { .string($0) }),
                "optional": .array(formula.optional.map { .string($0) }),
                "content": .string(formula.contentDescribe),
            ]
        })
    }

    /// A concept's contract for Muse. `full` adds examples, tags and events.
    func contract(_ id: String, full: Bool) -> JSONValue? {
        guard let concept = concepts[id] else { return nil }
        var out: [String: JSONValue] = [
            "id": .string(concept.id),
            "kind": .string(concept.kind),
            "describe": .string(concept.describe),
        ]
        if !concept.params.isEmpty {
            out["params"] = .object(concept.params.mapValues(Self.compactParam))
        }
        if !concept.requires.isEmpty { out["requires"] = .array(concept.requires.map { .string($0) }) }
        if !concept.conflicts.isEmpty { out["conflicts"] = .array(concept.conflicts.map { .string($0) }) }
        if !concept.glue.isEmpty { out["glue_slots"] = .array(concept.glue.map { .string($0) }) }
        if !concept.consumes.isEmpty { out["consumes"] = .array(concept.consumes.map { .string($0) }) }
        if !concept.emits.isEmpty { out["emits"] = .array(concept.emits.map { .string($0) }) }
        if concept.ends { out["can_end_run"] = true }
        if full {
            out["formulas"] = .array(concept.formulas.map { .string($0) })
            if let examples = concept.raw["examples"], !examples.isNull { out["examples"] = examples }
            if !concept.tags.isNull { out["tags"] = concept.tags }
            if let glueDocs = concept.raw["glue_docs"] ?? concept.raw["glue_signature"] ?? concept.raw["glue_args"] {
                out["glue_docs"] = glueDocs
            }
        }
        return .object(out)
    }

    private static func compactParam(_ spec: JSONValue) -> JSONValue {
        guard var object = spec.object else { return spec }
        for key in object.keys where object[key]?.isNull == true {
            object.removeValue(forKey: key)
        }
        return .object(object)
    }

    // MARK: - Parsing

    private static func formula(from value: JSONValue) -> Formula? {
        guard let id = value["id"]?.string, !id.isEmpty else { return nil }
        let content = value["content"]
        return Formula(
            id: id,
            title: value["title"]?.string ?? id.capitalized,
            describe: value["describe"]?.string ?? "",
            core: value["core"]?.strings ?? [],
            optional: value["optional"]?.strings ?? [],
            contentDescribe: content?["describe"]?.string ?? content?.string ?? "",
            contentSchema: content?["schema"] ?? .null,
            example: value["example"].flatMap { $0.object == nil ? nil : $0 },
            examples: (value["examples"]?.array ?? []).filter { $0.object != nil },
            tips: value["tips"]?.strings ?? [],
            raw: value
        )
    }

    private static func concept(from value: JSONValue) -> Concept? {
        guard let id = value["id"]?.string, !id.isEmpty else { return nil }
        let kind = value["kind"]?.string ?? id.split(separator: ".").first.map(String.init) ?? ""
        let formulas: [String]
        if let list = value["formulas"]?.array {
            formulas = list.compactMap(\.string)
        } else if let single = value["formulas"]?.string {
            formulas = [single]
        } else {
            formulas = []
        }
        return Concept(
            id: id,
            kind: kind,
            describe: value["describe"]?.string ?? "",
            formulas: formulas,
            params: value["params"]?.object ?? [:],
            consumes: value["consumes"]?.strings ?? [],
            emits: value["emits"]?.strings ?? [],
            requires: value["requires"]?.strings ?? [],
            conflicts: value["conflicts"]?.strings ?? [],
            glue: value["glue"]?.strings ?? [],
            tags: value["tags"] ?? .null,
            ends: value["ends"]?.bool ?? false,
            raw: value
        )
    }

    static let defaultMoods = ["chill", "cozy", "playful", "calm", "silly", "dreamy", "nostalgic", "competitive", "hype", "spooky"]

    /// docs/BUBBLES.md 4.6, `glue_forbidden`.
    static let defaultGlueForbidden = [
        "window", "document", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "import", "require",
        "eval", "Function", "setTimeout", "setInterval", "Date", "Math.random", "webkit", "localStorage",
    ]
}

/// The five preset palettes (docs/BUBBLES.md, section 2; LOOKS.md). Hex values match `BubbleGlow`
/// and the runtime's `palettes`.
struct StudioPalette: Sendable, Hashable {
    var id: String
    var top: String
    var bottom: String
    var mood: String
    /// The palette in plain words, for cover prompts and the timeline (any look).
    var words: String
    var colors: BubbleColors

    static let all: [StudioPalette] = [
        StudioPalette(id: "lilac-haze", top: "#C9B8FF", bottom: "#FFC8E8", mood: "cozy, soft, daily rituals",
                      words: "lilac, rose pink, mint and butter yellow",
                      colors: BubbleColors(bgTop: "#C9B8FF", bgBottom: "#FFC8E8", ink: "#2E1F5E", primary: "#9EF0DA", secondary: "#FFE59A", accent: "#9AD4FF", danger: "#FF9EC9")),
        StudioPalette(id: "peach-fizz", top: "#FFC2B0", bottom: "#FFE7A8", mood: "warm, sunny, food and picnics",
                      words: "peach, butter yellow, pink and sky blue",
                      colors: BubbleColors(bgTop: "#FFC2B0", bgBottom: "#FFE7A8", ink: "#4D2238", primary: "#FF8FB8", secondary: "#8FD6FF", accent: "#B8F2A6", danger: "#C9A8FF")),
        StudioPalette(id: "mint-pop", top: "#A6F2DC", bottom: "#B3CCFF", mood: "fresh, outdoorsy, parks and runs",
                      words: "mint, periwinkle, pink and lemon",
                      colors: BubbleColors(bgTop: "#A6F2DC", bgBottom: "#B3CCFF", ink: "#123B4D", primary: "#FF9ECB", secondary: "#FFE48F", accent: "#C9A8FF", danger: "#8FE3FF")),
        StudioPalette(id: "sky-glow", top: "#ADD8FF", bottom: "#DCC8FF", mood: "airy, calm, hills and ocean",
                      words: "sky blue, lavender, pink and mint",
                      colors: BubbleColors(bgTop: "#ADD8FF", bgBottom: "#DCC8FF", ink: "#1F2B66", primary: "#FFB0D9", secondary: "#A6F2DC", accent: "#FFE59A", danger: "#9AB8FF")),
        StudioPalette(id: "night-bloom", top: "#2B2150", bottom: "#5A3577", mood: "night, glowing, music and late hangs",
                      words: "deep violet night with neon pink, cyan and gold",
                      colors: BubbleColors(bgTop: "#2B2150", bgBottom: "#5A3577", ink: "#FFF3FF", primary: "#FF9DE2", secondary: "#9DF2FF", accent: "#FFE59D", danger: "#B9A2FF")),
    ]

    static var ids: [String] { all.map(\.id) }

    static func named(_ id: String?) -> StudioPalette? {
        guard let id else { return nil }
        return all.first { $0.id == id }
    }
}
