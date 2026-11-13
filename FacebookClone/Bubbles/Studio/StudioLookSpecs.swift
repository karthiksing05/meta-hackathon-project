import Foundation

/// A Bubble's look (LOOKS.md): the render family that gives each game its own identity inside the
/// same Bubble frame. Studio reads the list from the runtime catalog (`looks`); `fallback` is used
/// only while a runtime doesn't list them yet.
struct BubbleLookSpec: Sendable, Hashable {
    var id: String
    var title: String
    var describe: String
    /// Moods and themes the look fits ("crafty", "cozy").
    var moods: [String]
    var energy: [String]
    /// Fonts that suit the look, best first.
    var fonts: [String]
    /// Background motifs that suit the look.
    var motifs: [String]
    /// Ready color sets for `palette: "custom"`, each legible (ink 4.5:1 on both backgrounds).
    var exampleColors: [BubbleColors]
    /// The runtime's default motif for the look ("none" means a plain background).
    var defaultMotif: String? = nil

    /// How the timeline names it: "a paper-cutout look".
    var phrase: String { Self.phrases[id] ?? title.lowercased() }

    /// How a timeline row names it: "Paper cutout".
    var displayName: String { Self.displayNames[id] ?? title }

    var withArticle: String {
        let first = phrase.first.map { String($0).lowercased() } ?? ""
        return ("aeiou".contains(first) ? "an " : "a ") + phrase
    }

    /// LOOKS.md, "Looks (render families)". Riso and chalk are only offered when the runtime lists them.
    static let known: [String: BubbleLookSpec] = {
        let all = [
            BubbleLookSpec(id: "glow", title: "Glow", describe: "Dreamy, soft, pastel: gradient sky, iridescent soap bubbles with halos, rounded glowing text",
                       moods: ["dreamy", "calm"], energy: ["low"], fonts: ["rounded"], motifs: ["clouds", "stars", "waves", "dots"],
                       exampleColors: [BubbleColors(bgTop: "#C9B8FF", bgBottom: "#FFC8E8", ink: "#2E1F5E", primary: "#9EF0DA", secondary: "#FFE59A", accent: "#9AD4FF", danger: "#FF6B8B")]),
            BubbleLookSpec(id: "paper", title: "Paper", describe: "Crafty, warm, tactile: paper grain, layered cutouts, flat fills with offset shadows, confetti scraps",
                       moods: ["crafty", "cozy"], energy: ["low", "medium"], fonts: ["rounded", "serif"], motifs: ["hills", "leaves", "clouds", "city", "waves"],
                       exampleColors: [
                           BubbleColors(bgTop: "#F6EBDD", bgBottom: "#EAD7BF", ink: "#3A2A1E", primary: "#E4572E", secondary: "#2E86AB", accent: "#F2C14E", danger: "#C0392B"),
                           BubbleColors(bgTop: "#FBEFD9", bgBottom: "#F3D9B1", ink: "#40261A", primary: "#4F9D69", secondary: "#E86A92", accent: "#F4A259", danger: "#C8553D"),
                       ]),
            BubbleLookSpec(id: "pixel", title: "Pixel", describe: "Retro arcade: low-res pixels, dithered sky, blocks with a 1 px outline, hard-shadow text",
                       moods: ["retro", "arcade"], energy: ["high", "medium"], fonts: ["pixel", "mono"], motifs: ["city", "stars", "grid", "hills"],
                       exampleColors: [
                           BubbleColors(bgTop: "#22264B", bgBottom: "#3B3F78", ink: "#FFF6E0", primary: "#FFD23F", secondary: "#3EC1D3", accent: "#7BD389", danger: "#FF5964"),
                           BubbleColors(bgTop: "#9BD3F0", bgBottom: "#F4E3B5", ink: "#1B1F3B", primary: "#E84855", secondary: "#2B7A78", accent: "#F9DC5C", danger: "#C81D25"),
                       ]),
            BubbleLookSpec(id: "neon", title: "Neon", describe: "Night, electric: near-black with a grid, horizon or stars, glowing outline strokes, sparks",
                       moods: ["night", "energetic"], energy: ["high"], fonts: ["condensed", "mono"], motifs: ["grid", "stars", "city", "waves"],
                       exampleColors: [BubbleColors(bgTop: "#0B0820", bgBottom: "#1A0B33", ink: "#F5F3FF", primary: "#FF3EA5", secondary: "#22D3EE", accent: "#FDE047", danger: "#FF5A5F")]),
            BubbleLookSpec(id: "ink", title: "Ink", describe: "Hand-drawn, whimsical: off-white paper, wobbly outlines, hatch shading, scribbles",
                       moods: ["whimsical", "handmade"], energy: ["medium", "low"], fonts: ["hand"], motifs: ["leaves", "clouds", "hills", "dots"],
                       exampleColors: [BubbleColors(bgTop: "#FBF8F1", bgBottom: "#F1EADB", ink: "#1E1E24", primary: "#3D5A80", secondary: "#E07A5F", accent: "#81B29A", danger: "#D62828")]),
            BubbleLookSpec(id: "clay", title: "Clay", describe: "Toy-like, chunky, cute: soft studio backdrop, soft 3D shapes with a specular dot and contact shadow",
                       moods: ["cute", "toy"], energy: ["medium"], fonts: ["rounded"], motifs: ["hills", "clouds", "dots", "leaves"],
                       exampleColors: [
                           BubbleColors(bgTop: "#FFE8D6", bgBottom: "#F9D5C2", ink: "#3D2C2E", primary: "#FF8A5B", secondary: "#6CC5B0", accent: "#FFD166", danger: "#EF476F"),
                           BubbleColors(bgTop: "#DDF3EA", bgBottom: "#C9E7F2", ink: "#21384A", primary: "#FF9F68", secondary: "#7A9CFF", accent: "#FFD84D", danger: "#F25F5C"),
                       ]),
            BubbleLookSpec(id: "riso", title: "Riso", describe: "Zine, print, graphic: cream paper with grain, 2–3 spot colors, halftone fills, slight misregistration",
                       moods: ["zine", "graphic"], energy: ["medium"], fonts: ["condensed", "serif"], motifs: ["dots", "city", "waves", "grid"],
                       exampleColors: [BubbleColors(bgTop: "#F5EFE0", bgBottom: "#EFE6D2", ink: "#1F2041", primary: "#FF48B0", secondary: "#0078BF", accent: "#FFE800", danger: "#E4002B")]),
            BubbleLookSpec(id: "chalk", title: "Chalk", describe: "Brainy, calm, school: dark slate with smudges, chalky strokes, rough fills, chalk dust",
                       moods: ["brainy", "puzzle"], energy: ["low"], fonts: ["hand", "rounded"], motifs: ["grid", "dots", "stars", "none"],
                       exampleColors: [BubbleColors(bgTop: "#2F3B35", bgBottom: "#24302B", ink: "#F4F1E8", primary: "#F7D774", secondary: "#8EC5E8", accent: "#F2A3B3", danger: "#FF7B6B")]),
        ]
        return Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    }()

    /// LOOKS.md's must-haves, for runtimes that don't list looks yet.
    static let fallback: [BubbleLookSpec] = ["glow", "paper", "pixel", "neon", "ink", "clay"].compactMap { known[$0] }

    static let allFonts = ["rounded", "serif", "mono", "hand", "condensed", "pixel"]
    static let allMotifs = ["hills", "waves", "city", "stars", "clouds", "grid", "dots", "leaves", "none"]

    static let phrases: [String: String] = [
        "glow": "dreamy glow", "paper": "paper-cutout", "pixel": "pixel-art", "neon": "neon",
        "ink": "hand-inked", "clay": "soft clay", "riso": "risograph", "chalk": "chalkboard",
    ]

    static let displayNames: [String: String] = [
        "glow": "Dreamy glow", "paper": "Paper cutout", "pixel": "Pixel art", "neon": "Neon",
        "ink": "Hand-inked", "clay": "Soft clay", "riso": "Risograph", "chalk": "Chalkboard",
    ]

    /// The look's timeline row: "Paper cutout · warm cream, tomato red and deep teal".
    static func row(_ look: BubbleLookSpec, colors: String) -> String {
        let short = shortColors(colors)
        return short.isEmpty ? look.displayName : "\(look.displayName) · \(short)"
    }

    /// The first few colors of a description: "warm cream paper, tomato red and deep teal".
    static func shortColors(_ words: String, limit: Int = 3) -> String {
        var text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        if let colon = text.firstIndex(of: ":") { text = String(text[text.index(after: colon)...]) }
        let parts = text.replacingOccurrences(of: " and ", with: ",").replacingOccurrences(of: " with ", with: ",")
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return StudioCopy.list(Array(parts.prefix(limit)), limit: limit)
    }

    /// How a motif reads in a sentence ("with rolling hills behind").
    static let motifPhrases: [String: String] = [
        "hills": "rolling hills", "waves": "waves", "city": "a city skyline", "stars": "stars", "clouds": "clouds",
        "grid": "a grid", "dots": "dots", "leaves": "leaves",
    ]

    // MARK: - Catalog

    /// `looks` from `Bubble.catalogJSON()`: objects `{id, title, describe, moods, energy, fonts,
    /// motifs, example_colors}` or plain ids. Fields a runtime leaves out come from `known`.
    static func parse(_ value: JSONValue?) -> [BubbleLookSpec] {
        var seen = Set<String>()
        return (value?.array ?? []).compactMap { item -> BubbleLookSpec? in
            let id = (item.string ?? item["id"]?.string ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            guard !id.isEmpty, seen.insert(id).inserted else { return nil }
            let base = known[id]
            if item.string != nil {
                return base ?? BubbleLookSpec(id: id, title: id.capitalized, describe: "", moods: [], energy: [], fonts: ["rounded"], motifs: [], exampleColors: [])
            }
            let colors = StudioColors.sets(from: item["example_colors"] ?? item["colors"])
            var fonts = nonEmpty(item["fonts"]?.strings) ?? base?.fonts ?? ["rounded"]
            if let preferred = item["default_font"]?.string ?? item["font"]?.string {
                fonts = [preferred] + fonts.filter { $0 != preferred }
            }
            return BubbleLookSpec(
                id: id,
                title: item["title"]?.string ?? base?.title ?? id.capitalized,
                describe: item["describe"]?.string ?? base?.describe ?? "",
                moods: nonEmpty(item["moods"]?.strings) ?? base?.moods ?? [],
                energy: nonEmpty(item["energy"].map(words)) ?? base?.energy ?? [],
                fonts: fonts,
                motifs: nonEmpty(item["motifs"]?.strings) ?? base?.motifs ?? [],
                exampleColors: colors.isEmpty ? (base?.exampleColors ?? []) : colors,
                defaultMotif: item["default_motif"]?.string ?? item["motif"]?.string
            )
        }
    }

    private static func nonEmpty(_ list: [String]?) -> [String]? {
        guard let list, !list.isEmpty else { return nil }
        return list
    }

    private static func words(_ value: JSONValue) -> [String] {
        if let text = value.string { return text.split(whereSeparator: { $0 == "," || $0 == "|" || $0 == " " }).map(String.init) }
        return value.strings
    }

    // MARK: - Picking

    /// Words that call for each look: LOOKS.md "How Muse picks", plus close synonyms and SF themes.
    static let cues: [String: [String]] = [
        "glow": ["dreamy", "calm", "chill", "float", "floating", "soft", "relax", "relaxing", "gentle", "pastel", "glow", "zen", "bubbles", "ocean", "bay"],
        "paper": ["crafty", "craft", "cozy", "picnic", "paper", "papercut", "scrapbook", "garden", "bake", "baking", "hill", "hills", "park", "autumn", "warm", "icebreaker", "newcomers"],
        "pixel": ["retro", "arcade", "pixel", "8-bit", "pixelated", "classic", "cable car", "bike", "cycling", "platformer", "nostalgic", "streetcar"],
        "neon": ["night", "neon", "energetic", "electric", "party", "music", "dance", "late", "synth", "hype", "intense", "dark", "midnight", "concert"],
        "ink": ["whimsical", "handmade", "doodle", "sketch", "drawn", "hand-drawn", "storybook", "poem", "poetry", "quirky", "words", "word", "fog", "foggy"],
        "clay": ["cute", "toy", "toys", "squishy", "chunky", "claymation", "clay", "pets", "pet", "cat", "dog", "moving", "snack", "snacks", "dumpling", "kids", "silly", "swim"],
        "riso": ["zine", "graphic", "print", "poster", "riso", "bold", "indie", "coffee", "sourdough", "bread", "record", "vinyl", "sun"],
        "chalk": ["brainy", "puzzle", "quiz", "trivia", "school", "smart", "logic", "math", "chalk", "classroom", "sort", "study", "clever", "nerdy"],
    ]

    /// Looks each formula leans toward when the words don't decide.
    static let formulaLeans: [String: [String]] = baseFormulaLeans.merging(StudioFormulaHints.looks) { builtIn, _ in builtIn }

    static let baseFormulaLeans: [String: [String]] = [
        "guess": ["ink", "chalk", "riso"], "answer": ["riso", "paper", "chalk"], "group": ["chalk", "paper"],
        "time": ["riso", "clay", "pixel"], "merge": ["clay", "glow"], "dodge": ["paper", "pixel", "neon", "glow"],
    ]

    /// A deterministic pick: the look whose cues, moods and energy fit best. `avoid` (recent looks)
    /// loses ties so new Bubbles vary; `salt` breaks the rest.
    static func pick(text: String, brief: BubbleBrief?, formula: String?, available: [BubbleLookSpec], salt: String, avoid: [String] = []) -> BubbleLookSpec {
        let looks = available.isEmpty ? fallback : available
        let tokens = Self.tokens(text)
        let lowered = " " + text.lowercased() + " "
        let moods = Set((brief?.mood ?? []).map { $0.lowercased() })
        func score(_ look: BubbleLookSpec) -> Int {
            var total = 0
            let cueList = (cues[look.id] ?? []) + look.moods.map { $0.lowercased() }
            for cue in Set(cueList) {
                if cue.contains(" ") || cue.contains("-") ? lowered.contains(cue) : tokens.contains(cue) { total += 3 }
                if moods.contains(cue) { total += 2 }
            }
            if let energy = brief?.energy, look.energy.contains(energy) { total += 1 }
            if let formula, let leans = formulaLeans[formula], let rank = leans.firstIndex(of: look.id) { total += max(2 - rank, 1) }
            if avoid.contains(look.id) { total -= 2 }
            return total
        }
        let scored = looks.map { ($0, score($0), stableHash(salt + $0.id)) }
        return scored.max { a, b in a.1 != b.1 ? a.1 < b.1 : a.2 < b.2 }!.0
    }

    /// Style words that name a look's feel outright (LOOKS.md moods), as opposed to theme nouns.
    static let styleWords: Set<String> = [
        "retro", "arcade", "pixel", "8-bit", "neon", "night", "energetic", "electric", "cute", "toy", "chunky", "brainy", "puzzle",
        "zine", "graphic", "crafty", "cozy", "whimsical", "handmade", "doodle", "dreamy", "calm", "chill", "pastel", "glow",
        "paper", "clay", "ink", "riso", "chalk", "spooky", "synth", "hand-drawn", "sketch", "trivia", "quiz",
    ]

    static func hasStyleWords(_ text: String) -> Bool {
        !tokens(text).isDisjoint(with: styleWords)
    }

    /// Words in an edit, remix or next-level request that ask for a new look or theme.
    static let changeWords: Set<String> = [
        "look", "looks", "style", "styled", "theme", "themed", "color", "colors", "colour", "colours", "colored", "palette",
        "aesthetic", "vibe", "vibes", "skin", "reskin", "re-skin", "font", "art", "artwork", "visuals", "visual", "night",
        "dark", "darker", "neon", "retro", "arcade", "pixel", "pixelated", "8-bit", "paper", "papercut", "crafty", "clay",
        "claymation", "toy", "ink", "inked", "doodle", "sketch", "sketchy", "hand-drawn", "chalk", "chalkboard", "riso", "zine",
        "glow", "glowing", "pastel", "spooky", "halloween", "winter", "snowy", "sunset", "cute", "brighter", "moody", "noir",
    ]

    static func changeRequested(_ prompt: String, looks: [BubbleLookSpec]) -> Bool {
        let tokens = Self.tokens(prompt)
        if !tokens.isDisjoint(with: changeWords) { return true }
        return looks.contains { tokens.contains($0.id) || tokens.contains($0.title.lowercased()) }
    }

    static func tokens(_ text: String) -> Set<String> {
        Set(text.lowercased().split(whereSeparator: { !($0.isLetter || $0.isNumber || $0 == "-") }).map(String.init))
    }

    /// FNV-1a, stable across launches.
    static func stableHash(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return hash
    }
}

/// Looks of the Bubbles Studio made recently in this process, so new ones vary.
final class StudioLookMemory: @unchecked Sendable {
    static let shared = StudioLookMemory()

    private let lock = NSLock()
    private var looks: [String] = []

    init(_ looks: [String] = []) {
        self.looks = looks
    }

    var recent: [String] {
        lock.lock()
        defer { lock.unlock() }
        return looks
    }

    func record(_ look: String) {
        lock.lock()
        defer { lock.unlock() }
        looks.append(look)
        if looks.count > 4 { looks.removeFirst(looks.count - 4) }
    }
}

/// Custom colors (`style.colors`): parsing, legibility and plain-word names for prompts.
enum StudioColors {
    static let roles = ["bg_top", "bg_bottom", "ink", "primary", "secondary", "accent", "danger"]
    static let minimumContrast = 4.5

    /// "#abc", "abc", "#AABBCC" or "aabbcc" → "#AABBCC".
    static func normalize(_ raw: String?) -> String? {
        guard var hex = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !hex.isEmpty else { return nil }
        if hex.hasPrefix("#") { hex.removeFirst() }
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6, hex.allSatisfy(\.isHexDigit) else { return nil }
        return "#" + hex.uppercased()
    }

    static func rgb(_ hex: String) -> (r: Double, g: Double, b: Double)? {
        guard let clean = normalize(hex), let value = UInt32(clean.dropFirst(), radix: 16) else { return nil }
        return (Double((value >> 16) & 0xFF) / 255, Double((value >> 8) & 0xFF) / 255, Double(value & 0xFF) / 255)
    }

    static func hex(_ r: Double, _ g: Double, _ b: Double) -> String {
        func byte(_ v: Double) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(r), byte(g), byte(b))
    }

    /// WCAG relative luminance.
    static func luminance(_ hex: String) -> Double {
        guard let c = rgb(hex) else { return 0 }
        func channel(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    static func contrast(_ a: String, _ b: String) -> Double {
        let (la, lb) = (luminance(a), luminance(b))
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    static func mix(_ a: String, _ b: String, _ t: Double) -> String {
        guard let x = rgb(a), let y = rgb(b) else { return normalize(a) ?? a }
        return hex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t)
    }

    /// One color set from JSON: an object with role keys (snake or camel case), or a list of hex
    /// strings in role order.
    static func colors(from value: JSONValue?) -> BubbleColors? {
        guard let value else { return nil }
        if let list = value.array, list.allSatisfy({ $0.string != nil }), list.count >= 3 {
            let hexes = list.compactMap { normalize($0.string) }
            func at(_ i: Int) -> String? { hexes.indices.contains(i) ? hexes[i] : nil }
            return BubbleColors(bgTop: at(0), bgBottom: at(1), ink: at(2), primary: at(3), secondary: at(4), accent: at(5), danger: at(6))
        }
        guard let object = value.object else { return nil }
        func get(_ keys: String...) -> String? {
            for key in keys { if let hex = normalize(object[key]?.string) { return hex } }
            return nil
        }
        let colors = BubbleColors(
            bgTop: get("bg_top", "bgTop", "top", "background_top"),
            bgBottom: get("bg_bottom", "bgBottom", "bottom", "background_bottom"),
            ink: get("ink", "text"),
            primary: get("primary"),
            secondary: get("secondary"),
            accent: get("accent"),
            danger: get("danger")
        )
        return colors == BubbleColors() ? nil : colors
    }

    /// Every color set in a catalog field: one object, a list of objects, or a list of hex lists.
    static func sets(from value: JSONValue?) -> [BubbleColors] {
        guard let value else { return [] }
        if let list = value.array, list.contains(where: { $0.object != nil || $0.array != nil }) {
            return list.compactMap { colors(from: $0) }
        }
        return colors(from: value).map { [$0] } ?? []
    }

    static func json(_ colors: BubbleColors) -> JSONValue {
        var out: [String: JSONValue] = [:]
        for (key, value) in [("bg_top", colors.bgTop), ("bg_bottom", colors.bgBottom), ("ink", colors.ink), ("primary", colors.primary),
                             ("secondary", colors.secondary), ("accent", colors.accent), ("danger", colors.danger)] {
            if let value { out[key] = .string(value) }
        }
        return .object(out)
    }

    /// Fills missing roles from a template set.
    static func complete(_ colors: BubbleColors?, template: BubbleColors?) -> BubbleColors {
        let given = colors ?? BubbleColors()
        let fill = template ?? BubbleLookSpec.known["glow"]!.exampleColors[0]
        return BubbleColors(
            bgTop: normalize(given.bgTop) ?? normalize(given.bgBottom) ?? fill.bgTop,
            bgBottom: normalize(given.bgBottom) ?? normalize(given.bgTop) ?? fill.bgBottom,
            ink: normalize(given.ink) ?? fill.ink,
            primary: normalize(given.primary) ?? fill.primary,
            secondary: normalize(given.secondary) ?? fill.secondary,
            accent: normalize(given.accent) ?? fill.accent,
            danger: normalize(given.danger) ?? fill.danger
        )
    }

    static func isComplete(_ colors: BubbleColors) -> Bool {
        [colors.bgTop, colors.bgBottom, colors.ink, colors.primary, colors.secondary, colors.accent, colors.danger].allSatisfy { normalize($0) != nil }
    }

    /// The lower of ink's contrast with the two backgrounds.
    static func inkContrast(_ colors: BubbleColors) -> Double {
        guard let ink = colors.ink, let top = colors.bgTop, let bottom = colors.bgBottom else { return 0 }
        return min(contrast(ink, top), contrast(ink, bottom))
    }

    /// Makes ink readable on both backgrounds (4.5:1): first moves ink toward black or white, then,
    /// if the backgrounds are too far apart for any ink, moves them toward each other's side.
    static func legible(_ colors: BubbleColors) -> (colors: BubbleColors, fixed: Bool) {
        let inkFixed = legibleInk(colors)
        let accents = distinctAccents(inkFixed.colors)
        return (accents.colors, inkFixed.fixed || accents.fixed)
    }

    /// The runtime asks primary, secondary and accent to stand out from the background (1.25:1).
    static func distinctAccents(_ colors: BubbleColors) -> (colors: BubbleColors, fixed: Bool) {
        var out = colors
        guard let top = out.bgTop, let bottom = out.bgBottom else { return (out, false) }
        let middle = mix(top, bottom, 0.5)
        let away = luminance(middle) > 0.18 ? "#000000" : "#FFFFFF"
        var fixed = false
        for path in [\BubbleColors.primary, \BubbleColors.secondary, \BubbleColors.accent] {
            guard let color = out[keyPath: path], contrast(color, middle) < 1.3 else { continue }
            for step in stride(from: 0.15, through: 1.0001, by: 0.15) {
                let candidate = mix(color, away, step)
                if contrast(candidate, middle) >= 1.3 || step > 0.99 {
                    out[keyPath: path] = candidate
                    fixed = true
                    break
                }
            }
        }
        return (out, fixed)
    }

    static func legibleInk(_ colors: BubbleColors) -> (colors: BubbleColors, fixed: Bool) {
        var out = complete(colors, template: nil)
        guard inkContrast(out) < minimumContrast, let ink = out.ink, let top = out.bgTop, let bottom = out.bgBottom else { return (out, false) }
        let backgroundLight = (luminance(top) + luminance(bottom)) / 2 > 0.18
        let target = backgroundLight ? "#000000" : "#FFFFFF"
        for step in stride(from: 0.1, through: 1.0001, by: 0.1) {
            var candidate = out
            candidate.ink = mix(ink, target, step)
            if inkContrast(candidate) >= minimumContrast { return (candidate, true) }
        }
        out.ink = backgroundLight ? "#1A1A1A" : "#FFFFFF"
        let away = backgroundLight ? "#FFFFFF" : "#000000"
        for step in stride(from: 0.1, through: 1.0001, by: 0.1) {
            var candidate = out
            if contrast(out.ink!, top) < minimumContrast { candidate.bgTop = mix(top, away, step) }
            if contrast(out.ink!, bottom) < minimumContrast { candidate.bgBottom = mix(bottom, away, step) }
            if inkContrast(candidate) >= minimumContrast { return (candidate, true) }
        }
        return (out, true)
    }

    // MARK: - Words

    /// "cream, tomato red and deep teal": the set's main colors in words, for prompts and the timeline.
    static func words(_ colors: BubbleColors, limit: Int = 4) -> String {
        let names = StudioManifestBuilder.unique([colors.bgTop, colors.bgBottom, colors.primary, colors.secondary, colors.accent]
            .compactMap { $0 }.map(name).filter { !$0.isEmpty })
        return StudioCopy.list(Array(names.prefix(limit)), limit: limit)
    }

    /// A plain name for a color: "cream", "deep teal", "coral".
    static func name(_ hex: String) -> String {
        guard let c = rgb(hex) else { return "" }
        let high = max(c.r, c.g, c.b), low = min(c.r, c.g, c.b)
        let lightness = (high + low) / 2
        let chroma = high - low
        var hue = 0.0
        if chroma > 0 {
            if high == c.r { hue = 60 * ((c.g - c.b) / chroma).truncatingRemainder(dividingBy: 6) }
            else if high == c.g { hue = 60 * ((c.b - c.r) / chroma + 2) }
            else { hue = 60 * ((c.r - c.g) / chroma + 4) }
            if hue < 0 { hue += 360 }
        }
        let warm = hue >= 15 && hue < 75
        // Near-neutrals, judged by chroma (how far from gray), not HSL saturation.
        if chroma < 0.08 || (lightness > 0.88 && chroma < 0.16) {
            switch lightness {
            case 0.97...: return "white"
            case 0.9...: return warm && chroma > 0.03 ? "cream" : "off-white"
            case 0.78...: return warm && chroma > 0.04 ? "cream" : "light gray"
            case 0.5...: return "gray"
            case 0.14...: return hue >= 90 && hue < 220 && chroma > 0.03 ? "slate" : "charcoal"
            default: return "near-black"
            }
        }
        if lightness > 0.75 && chroma < 0.3 && warm {
            return hue < 28 ? "peach" : (hue < 50 ? "sand" : "cream")
        }
        var base: String
        switch hue {
        case ..<10, 345...: base = lightness > 0.75 ? "pink" : "red"
        case ..<22: base = lightness > 0.72 ? "peach" : (lightness > 0.55 ? "coral" : "tomato red")
        case ..<38: base = lightness < 0.35 ? "brown" : (lightness > 0.72 ? "peach" : "orange")
        case ..<47: base = lightness < 0.35 ? "brown" : "amber"
        case ..<65: base = lightness < 0.35 ? "olive" : (lightness > 0.75 ? "butter yellow" : "yellow")
        case ..<90: base = lightness < 0.35 ? "olive" : "lime"
        case ..<150: base = lightness > 0.72 ? "mint" : "green"
        case ..<180: base = lightness > 0.72 ? "mint" : "teal"
        case ..<200: base = lightness > 0.7 ? "aqua" : "cyan"
        case ..<220: base = lightness > 0.65 ? "sky blue" : "blue"
        case ..<245: base = lightness < 0.3 ? "navy" : (lightness > 0.7 ? "periwinkle" : "blue")
        case ..<265: base = lightness > 0.7 ? "lavender" : "indigo"
        case ..<290: base = lightness > 0.7 ? "lilac" : "violet"
        case ..<320: base = lightness > 0.7 ? "orchid" : "magenta"
        default: base = lightness > 0.72 ? "pink" : "hot pink"
        }
        if ["navy", "brown", "olive"].contains(base) { return base }
        if lightness < 0.2 { return "deep " + base }
        if lightness < 0.3 { return "dark " + base }
        return base
    }
}
