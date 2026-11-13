import Foundation

/// Every prompt Muse Studio sends. Formula and concept lists come from the runtime catalog, never
/// from code, so new kits show up here without changes.
enum MusePrompts {
    // MARK: - Shared blocks

    static let voice = """
    ## Voice
    - Copy is sentence case, warm, short and specific to the request. No hype, no exclamation marks in rules.
    - Titles are 1–3 words, original and catchy, with no emoji and without the word "Bubble".
    - The one-line rule is one short imperative sentence a first-timer understands (max 70 characters), \
    e.g. "Tap to float over the hills. Don't touch the fog."
    - Words we use: Bubble (a tiny game), pop in (play), blow (make), float (share), Daily Bubble, Icebreaker, Bubble Chain.
    """

    static let safety = """
    ## Rules
    - Synthetic people only: use only the first names given in the request. Never use real people, celebrities, brands, \
    products or logos. Public places (Dolores Park, Ocean Beach, Twin Peaks, the Mission) are fine.
    - Original games: genre mechanics are fine, but never reuse another game's name, characters, art, levels or look. \
    Nothing that resembles Wordle, Flappy Bird, 2048, Suika or Connections, in name or presentation.
    - Honest content: never invent vote counts, statistics, quotes or facts about the audience or any real group. A mode \
    that scores against the crowd's votes needs votes the request gives you; without them, use an answer key or a mode \
    with no crowd.
    - Kind and family-friendly. No jokes at anyone's expense.
    """

    static func paletteLines(_ catalog: StudioCatalog) -> String {
        StudioPalette.all.filter { catalog.paletteIDs.contains($0.id) }.map { "`\($0.id)` (\($0.mood))" }.joined(separator: ", ")
    }

    /// LOOKS.md "How Muse picks": the theme each look fits, for the looks this runtime has.
    static let lookFits: [(String, String)] = [
        ("paper", "crafty or cozy"), ("pixel", "retro or arcade"), ("neon", "night or energetic"), ("ink", "whimsical or handmade"),
        ("clay", "cute or toy"), ("riso", "zine or graphic"), ("chalk", "brainy or puzzle"), ("glow", "dreamy or calm"),
    ]

    static func lookSection(_ catalog: StudioCatalog) -> String {
        let fits = lookFits.filter { catalog.look($0.0) != nil }.map { "\($0.0) for \($0.1)" }
        let colorRule: String
        if catalog.supportsCustomColors {
            colorRule = """
            - Colors: `palette` is "custom" with `colors` {"bg_top", "bg_bottom", "ink", "primary", "secondary", "accent", "danger"} \
            as "#RRGGBB", chosen for the theme (start from the look's example colors and shift them toward the theme), or a \
            preset when one fits: \(paletteLines(catalog)). `ink` is the text color: it needs at least 4.5:1 contrast with both \
            backgrounds (dark ink on light backgrounds, light ink on dark ones). `danger` marks what hurts or fails.
            """
        } else {
            colorRule = "- Colors: `palette` is one of the presets: \(paletteLines(catalog)). (This runtime has no custom colors yet.)"
        }
        return """
        ## Look: every Bubble looks like itself
        The Bubble frame (intro card, score, transitions, share card) is the same in every game; the look is this game's own \
        identity, used in play, on its card and on its cover. Pick it for the theme. Looks from the runtime:
        \(catalog.lookLines)
        - Match the theme: \(fits.joined(separator: ", ")).
        - New Bubbles vary: glow is one look among several, not the default. Edits, remixes and next levels keep the base's \
        look unless the request asks to change it.
        \(colorRule)
        - `font`: one of the look's fonts. `motif`: an optional background hint that echoes the theme (\(catalog.motifIDs.joined(separator: ", "))).
        - `emoji`: one emoji for the theme. `mood_preset`: one mood word from the brief.
        - paint_cover paints the cover in the same look and colors, so name them there too.
        """
    }

    static func glueRules(_ catalog: StudioCatalog) -> String {
        """
        ## Glue: custom code, only for a twist the library can't express
        - `glue` maps an id like "glue.hill_bonus" to {"slot", "source", "describe"}. The source defines ONE pure function \
        named exactly after its slot, e.g. {"slot": "score", "source": "function score(run) { return run.base + run.streak * 2; }", \
        "describe": "+2 per hill in a streak"}.
        - Only use a slot that a concept in your draft lists in `glue_slots`; get_concepts shows what the function receives.
        - Pure functions only: compute from the arguments and return a value. The only helpers are sdk.rng(), sdk.int(a, b), \
        sdk.pick(list), sdk.clamp(v, a, b) and sdk.lerp(a, b, t). Never use \(catalog.glueForbidden.joined(separator: ", ")). \
        No unbounded loops, no recursion, no state kept between calls.
        - Glue gives a Bubble a signature twist the params can't express: a near-miss bonus, a streak that pays more on \
        the third hill, a gap pattern that echoes the theme. When the request suggests a twist like that, write one short \
        function (a few lines) and say what it does in `describe`. Otherwise skip it; never add glue just to have some.
        \(glueSlotLines(catalog))
        """
    }

    static func glueSlotLines(_ catalog: StudioCatalog) -> String {
        var lines: [String] = []
        if let rules = catalog.glueRules { lines.append("- Runtime rules: \(rules)") }
        if !catalog.glueSlots.isEmpty {
            lines.append("- Slots: " + catalog.glueSlots.sorted { $0.key < $1.key }.map { "`\($0.key)`: \($0.value)" }.joined(separator: " "))
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Brief (Ember)

    static func briefSystem(_ catalog: StudioCatalog) -> String {
        """
        You are Muse Studio's first read of a request for a Bubble: a tiny original game on Facebook that people make in one \
        sentence and play with their Groups and Events, to make friends in a new city. Read the request and reply with JSON only:
        {"intent": string, "audience": string, "mood": [string], "energy": "low"|"medium"|"high", \
        "competition": "none"|"light"|"friendly"|"fierce", "occasion": string|null, "content_sources": [string]|null, "notes": string}

        - intent: what they want, in their own words, max 12 words, lowercase start, no trailing period.
        - audience: the scope exactly as given (e.g. "everyone", "group:group-newinsf", "event:event-newcomers-picnic").
        - mood: 1–3 words, preferably from: \(catalog.moods.joined(separator: ", ")).
        - energy and competition: one value each, read from the words they used ("chill" is low energy, light competition).
        - occasion: "daily", "icebreaker", "club", "party", "event" or null.
        - content_sources: only for a Daily Bubble or Icebreaker that reads opted-in posts: the post authors you would draw on, \
        e.g. ["Maya's post", "Diego's post"]; otherwise null.
        - notes: one warm sentence that starts with "I read this as", max 18 words, naming the mood and who it's for, \
        e.g. "I read this as calm and nostalgic, for New in SF."
        For an edit, remix or next level, describe the new version, not the old one.
        """
    }

    static func briefUser(_ request: StudioRequest) -> String {
        var lines: [String] = []
        lines.append("Mode: \(request.mode.rawValue)")
        let prompt = request.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        lines.append("Request: \(prompt.isEmpty ? "(none: \(defaultIntent(request)))" : "“\(prompt)”")")
        lines.append("Scope: \(request.scope)\(request.scopeName.map { " (\($0))" } ?? "")")
        if let base = request.base {
            lines.append("Base Bubble: “\(base.title)” (\(base.formula.rawValue)): \(base.oneLineRule) Mood: \(base.brief.mood.joined(separator: ", ")).")
        }
        if !request.sources.isEmpty {
            lines.append("Opted-in posts: " + request.sources.prefix(8).map { "\($0.author): \(StudioCopy.quote($0.text, max: 80))" }.joined(separator: " | "))
        }
        if let hint = request.formulaHint { lines.append("Formula hint: \(hint.rawValue)") }
        return lines.joined(separator: "\n")
    }

    // MARK: - Composer (Wonder)

    static func composerSystem(_ catalog: StudioCatalog) -> String {
        """
        You are Muse Studio, the game composer inside Bubbles on Facebook. A Bubble is a tiny original game people make in one \
        sentence and play with their Groups and Events, to make friends in a new city. You turn a brief into one Bubble by \
        composing concepts from the runtime's library into a manifest. Studio validates and playtests everything you submit \
        with the real runtime before it ships.

        \(voice)

        \(safety)

        ## Formulas (runtime \(catalog.version))
        \(catalog.formulaLines)

        ## Picking the formula
        Match how the game plays to the request. A plain "game about X" wants play: pick from the formulas built around \
        action, timing or merging, and carry the theme through content and look. Quizzes, polls, word puzzles and sorting fit \
        when the request asks for them, and for Icebreakers and Daily Bubbles built from people's posts. A formula hint from \
        the creator always wins.

        ## How to work (aim for 3 turns; every turn costs the creator time)
        1. First turn, in parallel: get_formula(id, reason) for the formula that fits best, and paint_cover(title, look, colors, \
        emoji, scene) so the cover paints while you work. get_formula returns the content schema, the contracts of the core and optional \
        concepts, and a complete example manifest that passes validation.
        2. If you need contracts for other concepts, call get_concepts. For bulk content (more than about 8 words, clues, rounds \
        or categories), call write_content once per list and the fast model writes it; short content you write yourself.
        3. Call finalize(manifest) with the complete draft. It validates and playtests with bots of different skill. If it \
        returns problems, fix every one and call finalize again (2 repairs at most). validate_manifest and playtest exist for \
        checking a draft before you finalize, but finalize does both.

        ## The draft (the `manifest` argument)
        {"formula": string, "title": string, "one_line_rule": string, "style": {"look": string, "palette": string, \
        "colors": {...}, "font": string, "motif": string, "emoji": string, "mood_preset": string}, \
        "concepts": [{"use": string, "params": {...}}], "glue": {...}, "content": {...}, "operators": [string], \
        "sources_used": [number]}
        - Studio fills id, version, brief, structure, lineage, chain, seed, studio and engine_version, plus every param default \
        you leave out. Don't send them.
        - Start from the formula's example: keep its core concepts and its structure, then change params, content and look to \
        fit the brief.
        - Structure: exactly one `space.*` concept, at least one `input.*`, at least one concept that can end the run, exactly \
        one `score.*`, at most one `flow.*`. Every event a concept consumes must be emitted by another concept. Respect \
        `requires` and `conflicts`. Only use concepts made for the formula (or shared ones).
        - Params: only params the concept defines, inside min/max, enum values exactly as listed.
        - Content: follow the formula's content schema exactly (keys, types, counts, lengths). Labels must fit in a bubble.

        \(lookSection(catalog))

        \(glueRules(catalog))

        ## Difficulty
        A good Bubble lasts 10–120 s with the bot, can be failed and can score. Ease the first seconds and let it ramp up. \
        Playtests use a weak, a typical and a strong bot; when a playtest flags the game as too short, too hard or too easy, \
        change params (speed, gaps, gravity, rounds, tries, timers) rather than the formula.
        """ + formulaGuideSection
    }

    /// Per-formula guidance from the feature formulas (`StudioFormulaHints`), empty when none.
    static var formulaGuideSection: String {
        let guides = StudioFormulaHints.composerGuides
        return guides.isEmpty ? "" : "\n\n## Formula notes\n" + guides
    }

    static func composerUser(
        _ request: StudioRequest,
        brief: BubbleBrief,
        catalog: StudioCatalog,
        baseDraft: JSONValue?,
        today: String,
        keepsBaseLook: Bool = false,
        recentLooks: [String] = []
    ) -> String {
        var lines: [String] = []
        let prompt = request.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        lines.append("Mode: \(request.mode.rawValue)")
        lines.append("Request: \(prompt.isEmpty ? "(none: \(defaultIntent(request)))" : "“\(prompt)”")")
        lines.append("For: \(StudioCopy.audience(request)) (scope \"\(request.scope)\")")
        lines.append("Made by: \(request.creatorName)")
        lines.append("Date: \(request.date ?? today)")
        if let briefJSON = try? JSONValue.encode(brief) {
            lines.append("Brief (reviewed by the creator; follow it): \(briefJSON.jsonString())")
        }
        if let hint = request.formulaHint, catalog.formula(hint.rawValue) != nil {
            lines.append("The creator picked the formula: \(hint.rawValue). Use it.")
        }
        if let palette = request.paletteHint, catalog.isPreset(palette) {
            lines.append("The creator picked the palette: \(palette). Use it.")
        }
        if let hint = request.paletteHint, let look = catalog.look(hint), request.mode != .nextLevel {
            lines.append(request.base != nil && request.base?.style.look != look.id
                         ? "The creator picked a new look: \(look.id). Redraw the game in it: style.look \"\(look.id)\" with colors, font and motif that fit it, and paint the cover in it."
                         : "The creator picked the look: \(look.id). Use it (style.look \"\(look.id)\").")
        } else if request.base != nil, request.mode != .create, request.mode != .daily {
            lines.append(keepsBaseLook
                         ? "Look: the request doesn't ask for a new look, so keep the base's style exactly (look, palette, colors, font, motif)."
                         : "Look: the request asks for a new look or theme, so pick the look and colors that fit it.")
        } else {
            let recent = recentLooks.filter { catalog.look($0) != nil }
            if !recent.isEmpty {
                lines.append("Looks of the last Bubbles made here: \(StudioManifestBuilder.unique(recent.reversed()).joined(separator: ", ")). Pick a different look unless the theme clearly calls for one of them.")
            }
        }
        if !request.audienceNames.isEmpty {
            lines.append("People in this audience (first names you may use): \(request.audienceNames.prefix(24).joined(separator: ", ")). Studio adds their portraits; leave avatar fields out.")
        }

        switch request.mode {
        case .create:
            if request.scope.hasPrefix("event:") {
                lines.append("")
                lines.append("""
                ## Icebreaker for \(request.scopeName ?? "this event")
                Help attendees learn each other's first names and one thing about each person before they meet. Use only the \
                people and facts below; never invent facts about a person.
                """)
            }
        case .edit:
            lines.append("")
            lines.append("""
            ## Edit
            Change the base Bubble as asked and keep everything that wasn't asked to change (formula, most concepts, content \
            and title, unless the request says otherwise). Return the whole updated draft. operators: what you changed, from \
            re-skin (look or theme), re-tune (difficulty or params), re-content (content), re-rule (mechanics), re-scope (audience). \
            If the request asks for harder or easier, the playtest compares your draft with the base.
            """)
        case .remix:
            lines.append("")
            lines.append("""
            ## Remix
            Fork the base Bubble into a new one with its own title and a clear twist from the request. Keep the formula unless \
            the request says otherwise. operators: "remix" plus what you changed (re-skin, re-tune, re-content, re-rule, re-scope).
            """)
        case .nextLevel:
            let index = (request.base?.chain?.index ?? 1) + 1
            let chainTitle = request.base?.chain?.title ?? request.base?.title ?? "this chain"
            lines.append("")
            lines.append("""
            ## Next level
            Make level \(index) of the Bubble Chain “\(chainTitle)”: same formula and theme, a fresh title (a new place, or \
            “\(chainTitle) \(index)”), clearly harder params (faster, tighter, fewer tries, shorter timers, more rounds) and \
            fresh content where it makes sense. The playtest compares it with level \(index - 1); it must play harder but stay \
            fair (still 10–120 s for a typical player). operators: ["next-level", "re-tune"] plus anything else you changed.
            """)
        case .daily:
            lines.append("")
            lines.append("""
            ## Today's Daily Bubble for \(request.scopeName ?? "the Group")
            One short game (30–90 s) that everyone in the Group plays today, same for everyone. Use a flow made for daily play \
            when the formula has one. Content must come only from the opted-in posts below: their places, words and facts. \
            Don't add outside facts about people. List the numbers of the posts you used in sources_used.
            """)
        }

        if !request.sources.isEmpty {
            lines.append("")
            lines.append(request.mode == .daily || request.scope.hasPrefix("group:")
                         ? "Opted-in posts (the only text you may use about people):"
                         : "What people shared (the only facts you may use about them):")
            for (index, source) in request.sources.prefix(16).enumerated() {
                lines.append("\(index + 1). \(source.author): \(source.text.replacingOccurrences(of: "\n", with: " "))")
            }
        }

        if let baseDraft, let base = request.base {
            lines.append("")
            lines.append("Base Bubble “\(base.title)” v\(base.version) (draft form):")
            lines.append(baseDraft.jsonString())
        }

        let social = StudioSocialHooks.promptLines(request)
        if !social.isEmpty {
            lines.append("")
            lines.append(contentsOf: social)
        }

        lines.append("")
        lines.append("Start now: pick the formula and start the cover in your first turn.")
        return lines.joined(separator: "\n")
    }

    /// What an empty request means in each mode.
    static func defaultIntent(_ request: StudioRequest) -> String {
        let who = StudioCopy.audience(request)
        switch request.mode {
        case .daily: return "today's Daily Bubble, so \(who) gets to know each other"
        case .edit: return "a fresh take on the same game"
        case .remix: return "a remix with its own twist"
        case .nextLevel: return "the next, harder level"
        case .create: return request.scope.hasPrefix("event:") ? "an icebreaker for \(who)" : "a quick game for \(who)"
        }
    }

    /// Sent when the model answers in prose instead of calling a tool.
    static let nudge = "Please continue with the tools. When the draft is ready, call finalize with it."

    // MARK: - Content (Ember)

    static func contentSystem() -> String {
        """
        You write content for Bubbles, tiny original games on Facebook that people play with their Groups and Events. Reply \
        with JSON only: {"items": [...]} with exactly the requested number of items, each following the item schema.
        - Short and specific: labels must fit in a bubble (as short as the schema allows). Sentence case unless the schema or \
        the instructions ask for uppercase.
        - Kind, family-friendly and fun. No real people, celebrities, brands or products; public places are fine. Only use \
        first names you are given.
        - No duplicates; vary the items.
        - When sources are given, use only names, places, words and facts from them.
        """
    }

    static func contentUser(spec: JSONValue, request: StudioRequest, brief: BubbleBrief, title: String?) -> String {
        var payload: [String: JSONValue] = spec.object ?? [:]
        payload["for_game"] = .string(title ?? "an untitled Bubble")
        payload["brief"] = ["intent": .string(brief.intent), "mood": .array(brief.mood.map { .string($0) }), "audience": .string(brief.audience)]
        if !request.audienceNames.isEmpty {
            payload["first_names_you_may_use"] = .array(request.audienceNames.prefix(24).map { .string($0) })
        }
        if !request.sources.isEmpty && (request.mode == .daily || request.scope.hasPrefix("event:") || request.scope.hasPrefix("group:")) {
            payload["sources"] = .array(request.sources.prefix(16).map { .string("\($0.author): \($0.text)") })
        }
        return JSONValue.object(payload).jsonString()
    }

    // MARK: - Cover (Image)

    /// How the cover is painted in each look (LOOKS.md: the cover prompt is written in the game's look).
    static let coverStyles: [String: String] = [
        "glow": "dreamy pastel illustration: iridescent soap bubbles with rainbow rims and soft white highlights, soft glow and halos, airy depth and gentle light",
        "paper": "layered paper-cutout diorama: flat cut-paper shapes with slightly irregular hand-cut edges, offset drop shadows between the layers, visible paper grain, warm tactile light",
        "pixel": "retro pixel art: chunky low-resolution pixels on a visible grid, a small limited palette, a dithered sky gradient, crisp one-pixel dark outlines, classic arcade feel",
        "neon": "neon line art at night: glowing outline strokes with soft bloom on a near-black background, a perspective grid or horizon line, electric sparks and light streaks",
        "ink": "whimsical hand-drawn ink illustration: wobbly pen outlines, cross-hatch shading, off-white paper, a few light watercolor washes, storybook charm",
        "clay": "soft 3D claymation diorama: chunky rounded toy-like shapes with smooth clay texture, soft studio lighting, a gentle vignette, contact shadows and small specular highlights",
        "riso": "risograph zine print: two or three bold spot colors, halftone dot fills, slight misregistration between the color layers, cream paper grain, graphic poster composition",
        "chalk": "chalk drawing on a dark slate chalkboard: textured chalk strokes, rough hand-filled shapes, soft chalk dust smudges, clever and calm like a classroom doodle",
    ]

    static func coverStyle(for look: BubbleLookSpec) -> String {
        coverStyles[look.id] ?? "\(look.title.lowercased()) style: \(look.describe.isEmpty ? look.title : look.describe)"
    }

    /// The cover prompt, written in the game's look and colors. No text, no logos.
    static func coverPrompt(scene: String, look: BubbleLookSpec, colors: String, motif: String? = nil) -> String {
        let cleanScene = scene.trimmingCharacters(in: .whitespacesAndNewlines)
        var prompt = "Square cover art for a tiny mobile game. Scene: \(cleanScene.isEmpty ? "a small hero in a San Francisco scene" : cleanScene)."
        prompt += " Style: \(coverStyle(for: look))."
        if !colors.isEmpty { prompt += " Colors: \(colors)." }
        if let motif, let phrase = BubbleLookSpec.motifPhrases[motif] { prompt += " Background: \(phrase)." }
        prompt += " One clear centered subject with breathing room around it."
        prompt += " No text, no letters, no numbers, no logos, no watermarks, no real people or brands."
        return prompt
    }
}
