import Foundation

/// The tools Muse Wonder calls while composing (OpenAI function-calling format). Enums come from
/// the runtime catalog.
enum StudioTools {
    static let listFormulas = "list_formulas"
    static let getFormula = "get_formula"
    static let getConcepts = "get_concepts"
    static let writeContent = "write_content"
    static let paintCover = "paint_cover"
    static let validateManifest = "validate_manifest"
    static let playtest = "playtest"
    static let finalize = "finalize"

    static func definitions(_ catalog: StudioCatalog) -> [JSONValue] {
        let formulaIDs: JSONValue = .array(catalog.formulaIDs.map { .string($0) })
        let lookIDs: JSONValue = .array(catalog.lookIDs.map { .string($0) })
        let draft = draftSchema(catalog)
        return [
            tool(listFormulas,
                 "List every formula in the library with its core and optional concepts and what content it needs.",
                 properties: [:], required: []),
            tool(getFormula,
                 "Pick a formula. Returns its content schema, the contracts of its core and optional concepts (params with defaults and ranges, events, glue slots) and a complete example manifest that passes validation. Start your draft from the example.",
                 properties: [
                    "id": ["type": "string", "enum": formulaIDs, "description": "Formula id"],
                    "reason": ["type": "string", "description": "Why it fits this request, under 12 words, shown to the creator. E.g. \"one-touch play fits 'chill' and 'running club'\""],
                 ],
                 required: ["id", "reason"]),
            tool(getConcepts,
                 "Get full contracts for concepts by id: params (type, default, min/max, values), consumes/emits, requires/conflicts, glue slots, tags and examples.",
                 properties: [
                    "ids": ["type": "array", "items": ["type": "string"], "description": "Concept ids, e.g. [\"behavior.speed_ramp\"]"],
                 ],
                 required: ["ids"]),
            tool(writeContent,
                 "Ask the fast content model to write one bulk content list (words, labels, clues, rounds, categories). The items are returned to you and stored under content.<key>; in your draft you may leave that key out and Studio fills it in.",
                 properties: [
                    "key": ["type": "string", "description": "Content key, as in the formula's content schema, e.g. \"obstacle_labels\" or \"rounds\""],
                    "label": ["type": "string", "description": "Plural noun phrase for the creator's timeline, e.g. \"hill names\" or \"trivia rounds\""],
                    "count": ["type": "integer", "minimum": 1, "maximum": 40],
                    "instructions": ["type": "string", "description": "What to write: theme, tone, constraints (length, uppercase, which names or facts to use)"],
                    "item_schema": ["type": "object", "description": "JSON-schema-lite for one item, copied from the formula's content schema (e.g. {\"type\": \"string\", \"max_length\": 14})"],
                 ],
                 required: ["key", "label", "count", "instructions"]),
            tool(paintCover,
                 "Start painting the cover art in the background (about 15–30 s), in the game's look. Call it once, in your first turn, as soon as you know the title and look.",
                 properties: [
                    "title": ["type": "string"],
                    "look": ["type": "string", "enum": lookIDs, "description": "The look you'll use in style.look"],
                    "colors": ["type": "string", "description": "The game's colors in words, e.g. \"cream paper, tomato red and deep teal\""],
                    "emoji": ["type": "string", "description": "One emoji for the theme (as in style.emoji)"],
                    "scene": ["type": "string", "description": "What the cover shows: concrete and visual (subject, setting, light), no text. E.g. \"a tiny runner bounding over rolling San Francisco hills at golden hour\""],
                 ],
                 required: ["title", "look", "colors", "scene"]),
            tool(validateManifest,
                 "Check a draft with the runtime validator: schema, concepts, params, structure, event wiring, glue and content.",
                 properties: ["manifest": draft], required: ["manifest"]),
            tool(playtest,
                 "Validate a draft, then play it headless with a weak, a typical and a strong bot. Reports duration, outcome and score spread, and flags games that are too easy, too hard or too short.",
                 properties: ["manifest": draft], required: ["manifest"]),
            tool(finalize,
                 "Submit the finished draft. Studio validates and playtests it; if it passes, it ships. If not, you get the problems to fix.",
                 properties: ["manifest": draft], required: ["manifest"]),
        ]
    }

    static func draftSchema(_ catalog: StudioCatalog) -> JSONValue {
        var palettes = catalog.paletteIDs
        if catalog.supportsCustomColors { palettes.append("custom") }
        let hex: JSONValue = ["type": "string", "description": "#RRGGBB"]
        return [
            "type": "object",
            "description": "The draft: formula, title, one_line_rule, style, concepts, glue, content, operators, sources_used. Studio fills id, version, brief, structure, lineage, chain, seed and engine_version.",
            "properties": [
                "formula": ["type": "string"],
                "title": ["type": "string"],
                "one_line_rule": ["type": "string"],
                "style": [
                    "type": "object",
                    "properties": [
                        "look": ["type": "string", "enum": .array(catalog.lookIDs.map { .string($0) })],
                        "palette": ["type": "string", "enum": .array(palettes.map { .string($0) })],
                        "colors": [
                            "type": "object",
                            "description": "Required when palette is custom. ink needs 4.5:1 contrast with bg_top and bg_bottom.",
                            "properties": .object(Dictionary(uniqueKeysWithValues: StudioColors.roles.map { ($0, hex) })),
                        ],
                        "font": ["type": "string", "enum": .array(catalog.fontIDs.map { .string($0) })],
                        "motif": ["type": "string", "enum": .array(catalog.motifIDs.map { .string($0) })],
                        "emoji": ["type": "string"],
                        "mood_preset": ["type": "string"],
                    ],
                ],
                "concepts": [
                    "type": "array",
                    "items": [
                        "type": "object",
                        "properties": ["use": ["type": "string"], "params": ["type": "object"]],
                        "required": ["use"],
                    ],
                ],
                "glue": ["type": "object", "description": "{\"glue.<name>\": {\"slot\", \"source\", \"describe\"}}; usually empty"],
                "content": ["type": "object", "description": "Follows the formula's content schema"],
                "length": ["type": "object", "description": "How a run ends (docs 7.9), one of the formula's length.modes: {\"mode\": \"endless\"}, {\"mode\": \"rounds\", \"rounds\": n}, {\"mode\": \"timed\", \"seconds\": n} or {\"mode\": \"lives\", \"lives\": n}. Optional."],
                "operators": ["type": "array", "items": ["type": "string"]],
                "sources_used": ["type": "array", "items": ["type": "integer"], "description": "Numbers of the opted-in posts you used (Daily Curios and Icebreakers)"],
            ],
            "required": ["formula", "title", "one_line_rule", "style", "concepts", "content"],
        ]
    }

    private static func tool(_ name: String, _ description: String, properties: [String: JSONValue], required: [String]) -> JSONValue {
        [
            "type": "function",
            "function": [
                "name": .string(name),
                "description": .string(description),
                "parameters": [
                    "type": "object",
                    "properties": .object(properties),
                    "required": .array(required.map { .string($0) }),
                ],
            ],
        ]
    }
}
