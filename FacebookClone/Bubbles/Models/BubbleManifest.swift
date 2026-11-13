import Foundation

/// The seven core formulas from the taxonomy canvas (section 9), plus the collaboration batch's
/// story, nextline and learn (docs/BUBBLES.md, 7). The runtime supports all but `make`, which is
/// reserved.
enum BubbleFormula: String, Codable, CaseIterable, Sendable {
    case dodge
    case time
    case merge
    case guess
    case group
    case answer
    case make
    /// Branching stories you play (docs/BUBBLES.md 7.6). Labeled "Adventure", never "Story", so it
    /// isn't confused with Facebook Stories.
    case story
    /// Guess what they say next: a quiz-night party game (docs/BUBBLES.md 7.7).
    case nextline
    /// A short lesson, practice and a recap (docs/BUBBLES.md 7.8).
    case learn
    /// Any game the Rust/WASM microgame engine runs: the whole game is in `content.game`
    /// (engine/SPEC-v0.2.md), played by bubble-kit-microgame.js (docs/BUBBLES.md, "microgame").
    case microgame

    var title: String {
        switch self {
        case .dodge: return "Dodge"
        case .time: return "Timing"
        case .merge: return "Merge"
        case .guess: return "Guess"
        case .group: return "Sort"
        case .answer: return "Answer"
        case .make: return "Make"
        case .story: return "Adventure"
        case .nextline: return "Next line"
        case .learn: return "Learn"
        case .microgame: return "Microgame"
        }
    }

    /// SF Symbol for chips and badges.
    var symbol: String {
        switch self {
        case .dodge: return "wind"
        case .time: return "timer"
        case .merge: return "circle.circle"
        case .guess: return "questionmark.bubble"
        case .group: return "square.grid.2x2"
        case .answer: return "text.bubble"
        case .make: return "paintbrush.pointed"
        case .story: return "signpost.right.and.left"
        case .nextline: return "quote.bubble"
        case .learn: return "graduationcap"
        case .microgame: return "gamecontroller"
        }
    }

    /// The category chip this formula shows (docs/BUBBLES.md 7). `.play` shows no chip.
    var category: BubbleCategory {
        switch self {
        case .story: return .adventure
        case .nextline: return .party
        case .learn: return .learn
        default: return .play
        }
    }
}

/// What the person wants and how it should feel (concept library canvas, section 7).
/// Muse writes it from the request; the creator can read and edit it before composing.
struct BubbleBrief: Codable, Hashable, Sendable {
    var intent: String
    var audience: String
    var mood: [String]
    var energy: String
    var competition: String
    var occasion: String?
    var contentSources: [String]?
    var notes: String?

    init(
        intent: String,
        audience: String = "everyone",
        mood: [String] = ["playful"],
        energy: String = "medium",
        competition: String = "light",
        occasion: String? = nil,
        contentSources: [String]? = nil,
        notes: String? = nil
    ) {
        self.intent = intent
        self.audience = audience
        self.mood = mood
        self.energy = energy
        self.competition = competition
        self.occasion = occasion
        self.contentSources = contentSources
        self.notes = notes
    }

    enum CodingKeys: String, CodingKey {
        case intent, audience, mood, energy, competition, occasion, notes
        case contentSources = "content_sources"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        intent = try c.decodeIfPresent(String.self, forKey: .intent) ?? ""
        audience = try c.decodeIfPresent(String.self, forKey: .audience) ?? "everyone"
        if let moods = try? c.decodeIfPresent([String].self, forKey: .mood) {
            mood = moods
        } else if let single = try? c.decodeIfPresent(String.self, forKey: .mood) {
            mood = [single]
        } else {
            mood = []
        }
        energy = try c.decodeIfPresent(String.self, forKey: .energy) ?? "medium"
        competition = try c.decodeIfPresent(String.self, forKey: .competition) ?? "light"
        occasion = try c.decodeIfPresent(String.self, forKey: .occasion)
        contentSources = try? c.decodeIfPresent([String].self, forKey: .contentSources)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
    }
}

/// How often you play, who shares the same content, and who made the content.
struct BubbleStructure: Codable, Hashable, Sendable {
    /// "endless", "daily" or "weekly".
    var cadence: String
    /// "everyone", "friends", "group:<id>" or "event:<id>".
    var scope: String
    /// "ai", "player" or "designer".
    var setter: String

    init(cadence: String = "endless", scope: String = "everyone", setter: String = "ai") {
        self.cadence = cadence
        self.scope = scope
        self.setter = setter
    }

    var isDaily: Bool { cadence == "daily" }

    var groupID: String? {
        scope.hasPrefix("group:") ? String(scope.dropFirst("group:".count)) : nil
    }

    var eventID: String? {
        scope.hasPrefix("event:") ? String(scope.dropFirst("event:".count)) : nil
    }
}

/// Where a Bubble came from: its parent and the operators applied (taxonomy canvas, part 4).
///
/// Remix credit and co-makers (docs/BUBBLES.md 7.4 and 7.5): `remixOfTitle` and
/// `remixOfCreatorName` carry the "Remix of Hill Drift by Leo" credit so it survives even when the
/// original isn't on this device; `makers` lists everyone who made a co-made Bubble ("Made by Maya,
/// Leo and you"). All optional, so older manifests decode unchanged.
struct BubbleLineage: Codable, Hashable, Sendable {
    var parent: String?
    var operators: [String]
    var remixOf: String?
    var remixOfTitle: String?
    var remixOfCreatorID: String?
    var remixOfCreatorName: String?
    var makers: [BubbleMaker]?

    init(
        parent: String? = nil,
        operators: [String] = [],
        remixOf: String? = nil,
        remixOfTitle: String? = nil,
        remixOfCreatorID: String? = nil,
        remixOfCreatorName: String? = nil,
        makers: [BubbleMaker]? = nil
    ) {
        self.parent = parent
        self.operators = operators
        self.remixOf = remixOf
        self.remixOfTitle = remixOfTitle
        self.remixOfCreatorID = remixOfCreatorID
        self.remixOfCreatorName = remixOfCreatorName
        self.makers = makers
    }

    enum CodingKeys: String, CodingKey {
        case parent, operators, makers
        case remixOf = "remix_of"
        case remixOfTitle = "remix_of_title"
        case remixOfCreatorID = "remix_of_creator_id"
        case remixOfCreatorName = "remix_of_creator_name"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        parent = try c.decodeIfPresent(String.self, forKey: .parent)
        operators = (try? c.decodeIfPresent([String].self, forKey: .operators)) ?? []
        remixOf = try c.decodeIfPresent(String.self, forKey: .remixOf)
        remixOfTitle = try? c.decodeIfPresent(String.self, forKey: .remixOfTitle)
        remixOfCreatorID = try? c.decodeIfPresent(String.self, forKey: .remixOfCreatorID)
        remixOfCreatorName = try? c.decodeIfPresent(String.self, forKey: .remixOfCreatorName)
        makers = try? c.decodeIfPresent([BubbleMaker].self, forKey: .makers)
    }
}

/// A level's place in a Bubble Chain. Each level is its own Bubble.
struct BubbleChainLink: Codable, Hashable, Sendable {
    var id: String
    var index: Int
    var title: String?
    var prev: String?
    var next: String?

    init(id: String, index: Int = 1, title: String? = nil, prev: String? = nil, next: String? = nil) {
        self.id = id
        self.index = index
        self.title = title
        self.prev = prev
        self.next = next
    }
}

/// The Glow look for this Bubble. `palette` is an id from docs/BUBBLES.md (for example "lilac-haze").
/// A Bubble's own colors, used when `BubbleStyle.palette` is "custom" (docs/BUBBLES.md, Looks).
/// Hex strings like "#FFC2B0". Every field is optional so imperfect Muse output still decodes.
struct BubbleColors: Codable, Hashable, Sendable {
    var bgTop: String?
    var bgBottom: String?
    var ink: String?
    var primary: String?
    var secondary: String?
    var accent: String?
    var danger: String?

    init(bgTop: String? = nil, bgBottom: String? = nil, ink: String? = nil, primary: String? = nil, secondary: String? = nil, accent: String? = nil, danger: String? = nil) {
        self.bgTop = bgTop
        self.bgBottom = bgBottom
        self.ink = ink
        self.primary = primary
        self.secondary = secondary
        self.accent = accent
        self.danger = danger
    }

    enum CodingKeys: String, CodingKey {
        case ink, primary, secondary, accent, danger
        case bgTop = "bg_top"
        case bgBottom = "bg_bottom"
    }
}

/// How a Bubble looks. Every Bubble has its own look (render family, colors, font, motif) inside
/// the same Bubble frame (docs/BUBBLES.md, Looks).
struct BubbleStyle: Codable, Hashable, Sendable {
    /// Render family: glow, paper, pixel, neon, ink, clay, riso, chalk.
    var look: String
    /// A preset palette id, or "custom" to use `colors`.
    var palette: String
    var colors: BubbleColors?
    /// rounded, serif, mono, hand, condensed or pixel.
    var font: String?
    /// Background motif hint: hills, waves, city, stars, clouds, grid, dots, leaves, none.
    var motif: String?
    var moodPreset: String?
    var emoji: String?
    /// Prompt for the cover art, written in the same look as the game.
    var coverPrompt: String?

    init(
        look: String = "glow",
        palette: String = "lilac-haze",
        colors: BubbleColors? = nil,
        font: String? = nil,
        motif: String? = nil,
        moodPreset: String? = nil,
        emoji: String? = nil,
        coverPrompt: String? = nil
    ) {
        self.look = look
        self.palette = palette
        self.colors = colors
        self.font = font
        self.motif = motif
        self.moodPreset = moodPreset
        self.emoji = emoji
        self.coverPrompt = coverPrompt
    }

    enum CodingKeys: String, CodingKey {
        case look, palette, colors, font, motif, emoji
        case moodPreset = "mood_preset"
        case coverPrompt = "cover_prompt"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        look = (try? c.decodeIfPresent(String.self, forKey: .look)) ?? "glow"
        palette = (try? c.decodeIfPresent(String.self, forKey: .palette)) ?? "lilac-haze"
        colors = try? c.decodeIfPresent(BubbleColors.self, forKey: .colors)
        font = try? c.decodeIfPresent(String.self, forKey: .font)
        motif = try? c.decodeIfPresent(String.self, forKey: .motif)
        moodPreset = try? c.decodeIfPresent(String.self, forKey: .moodPreset)
        emoji = try? c.decodeIfPresent(String.self, forKey: .emoji)
        coverPrompt = try? c.decodeIfPresent(String.self, forKey: .coverPrompt)
    }
}

/// One concept in a manifest, with its settings.
struct ConceptUse: Codable, Hashable, Sendable {
    var use: String
    var params: [String: JSONValue]?

    init(_ use: String, params: [String: JSONValue]? = nil) {
        self.use = use
        self.params = params
    }
}

/// A small pure function Muse wrote for a gap in the library. The function's name is its slot.
struct GlueFunction: Codable, Hashable, Sendable {
    /// "feedback", "spawn", "score", "transform" or "constraint".
    var slot: String
    var source: String
    var describe: String?

    init(slot: String, source: String, describe: String? = nil) {
        self.slot = slot
        self.source = source
        self.describe = describe
    }
}

/// How Muse Studio made this Bubble.
struct StudioStamp: Codable, Hashable, Sendable {
    var models: [String]
    var createdAt: String
    var durationSec: Double?
    var offline: Bool?

    init(models: [String], createdAt: String, durationSec: Double? = nil, offline: Bool? = nil) {
        self.models = models
        self.createdAt = createdAt
        self.durationSec = durationSec
        self.offline = offline
    }

    enum CodingKeys: String, CodingKey {
        case models, offline
        case createdAt = "created_at"
        case durationSec = "duration_sec"
    }
}

/// A whole game as data: which concepts it uses, their settings, the glue Muse wrote and the
/// content. The JavaScript runtime plays it; Muse Studio writes it. See docs/BUBBLES.md, 4.2.
struct BubbleManifest: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var version: Int
    var title: String
    var oneLineRule: String
    var formula: BubbleFormula
    var brief: BubbleBrief
    var structure: BubbleStructure
    var lineage: BubbleLineage
    var chain: BubbleChainLink?
    var style: BubbleStyle
    var concepts: [ConceptUse]
    var glue: [String: GlueFunction]
    var content: JSONValue
    var seed: Int
    var studio: StudioStamp?
    /// The runtime contract this manifest was compiled and playtested against (docs/BUBBLES.md, 4.8).
    var engineVersion: Int
    /// How long a run lasts: endless, rounds, timed or lives (docs/BUBBLES.md 7.9). Nil uses the
    /// formula's default.
    var length: BubbleLength?
    /// "Games about me": whose game this is and which template made it (docs/BUBBLES.md 7.4).
    var about: BubbleAboutMe?

    init(
        id: String,
        version: Int = 1,
        title: String,
        oneLineRule: String,
        formula: BubbleFormula,
        brief: BubbleBrief,
        structure: BubbleStructure = BubbleStructure(),
        lineage: BubbleLineage = BubbleLineage(),
        chain: BubbleChainLink? = nil,
        style: BubbleStyle = BubbleStyle(),
        concepts: [ConceptUse],
        glue: [String: GlueFunction] = [:],
        content: JSONValue = .object([:]),
        seed: Int = 1,
        studio: StudioStamp? = nil,
        engineVersion: Int = 1,
        length: BubbleLength? = nil,
        about: BubbleAboutMe? = nil
    ) {
        self.id = id
        self.version = version
        self.title = title
        self.oneLineRule = oneLineRule
        self.formula = formula
        self.brief = brief
        self.structure = structure
        self.lineage = lineage
        self.chain = chain
        self.style = style
        self.concepts = concepts
        self.glue = glue
        self.content = content
        self.seed = seed
        self.studio = studio
        self.engineVersion = engineVersion
        self.length = length
        self.about = about
    }

    enum CodingKeys: String, CodingKey {
        case id, version, title, formula, brief, structure, lineage, chain, style, concepts, glue, content, seed, studio, length, about
        case oneLineRule = "one_line_rule"
        case engineVersion = "engine_version"
    }

    /// Lenient: Muse output that leaves out optional parts still decodes with sensible defaults.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString.lowercased()
        version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? 1
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Untitled \(ProductName.singular)"
        oneLineRule = try c.decodeIfPresent(String.self, forKey: .oneLineRule) ?? ""
        formula = try c.decode(BubbleFormula.self, forKey: .formula)
        brief = (try? c.decodeIfPresent(BubbleBrief.self, forKey: .brief)) ?? BubbleBrief(intent: "")
        structure = (try? c.decodeIfPresent(BubbleStructure.self, forKey: .structure)) ?? BubbleStructure()
        lineage = (try? c.decodeIfPresent(BubbleLineage.self, forKey: .lineage)) ?? BubbleLineage()
        chain = try? c.decodeIfPresent(BubbleChainLink.self, forKey: .chain)
        style = (try? c.decodeIfPresent(BubbleStyle.self, forKey: .style)) ?? BubbleStyle()
        concepts = try c.decode([ConceptUse].self, forKey: .concepts)
        glue = (try? c.decodeIfPresent([String: GlueFunction].self, forKey: .glue)) ?? [:]
        content = (try? c.decodeIfPresent(JSONValue.self, forKey: .content)) ?? .object([:])
        if let wholeSeed = try? c.decodeIfPresent(Int.self, forKey: .seed) {
            seed = wholeSeed
        } else if let doubleSeed = try? c.decodeIfPresent(Double.self, forKey: .seed), doubleSeed.isFinite {
            seed = Int(doubleSeed.truncatingRemainder(dividingBy: 2_147_483_647))
        } else {
            seed = 1
        }
        studio = try? c.decodeIfPresent(StudioStamp.self, forKey: .studio)
        engineVersion = (try? c.decodeIfPresent(Int.self, forKey: .engineVersion)) ?? 1
        length = try? c.decodeIfPresent(BubbleLength.self, forKey: .length)
        about = try? c.decodeIfPresent(BubbleAboutMe.self, forKey: .about)
    }
}

extension BubbleManifest {
    static func decode(_ data: Data) throws -> BubbleManifest {
        try JSONDecoder().decode(BubbleManifest.self, from: data)
    }

    static func decode(_ string: String) throws -> BubbleManifest {
        try decode(Data(string.utf8))
    }

    func jsonData(pretty: Bool = false) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = pretty ? [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes] : [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    func jsonString(pretty: Bool = false) -> String {
        guard let data = try? jsonData(pretty: pretty) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    var conceptIDs: [String] { concepts.map(\.use) }

    func uses(_ conceptID: String) -> Bool {
        concepts.contains { $0.use == conceptID }
    }
}
