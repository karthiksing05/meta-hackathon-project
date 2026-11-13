import Foundation

// Prompts for the game anatomy conversation (docs/BUBBLES.md 7.13): Muse takes the person's idea
// apart into its working parts before it builds, and maps later changes onto those parts.
extension MusePrompts {
    /// The fragments the microgame engine has, as "id: what it does", when the catalog isn't
    /// loaded. Kept short; the live catalog's own descriptions win when Studio has them.
    static let anatomyFallbackFragments: [(String, String)] = [
        ("beat_target", "win by beating a friend's score"), ("checkpoint", "progress kept after a setback"),
        ("choice_story", "branching story scenes with 2–3 choices"), ("collide", "overlap checks between the player and things"),
        ("combo", "combo multiplier for streaks"), ("countdown", "visible clock counting down"),
        ("daily_seed", "same puzzle for everyone today"), ("difficulty_curve", "difficulty that ramps over time"),
        ("endless", "no win, a level that climbs forever"), ("ghost_score", "race a friend's recorded run"),
        ("gravity_jump", "tap to hop, gravity pulls down"), ("grid_board", "tappable board of square cells"),
        ("hint", "limited-use hint button"), ("keyboard", "on-screen letter keyboard"),
        ("lanes", "discrete lane movement left and right"), ("lives", "N lives, lose one per hit"),
        ("match_pairs", "memory match over face-down cards"), ("pickups", "collectibles that appear over time"),
        ("player_drag", "drag to steer an avatar"), ("quiz", "multiple-choice questions"),
        ("reveal", "hidden text uncovered letter by letter"), ("rounds", "a finite run of N rounds"),
        ("score", "points per event, optional target"), ("sequence_memory", "watch-and-repeat pattern memory"),
        ("shared_progress", "a Group's combined total"), ("sort_bins", "sort items into labelled bins"),
        ("spawn_wave", "objects spawn from an edge and move across"), ("speed_ramp", "spawn speed rises over time"),
        ("tile_slide", "sliding-tile board that merges in one direction"), ("timer_bar", "a draining time bar with refills"),
        ("turns", "pass-and-play turns on one phone"), ("waves", "escalating waves with breathers"),
        ("word_check", "guess a hidden word with per-letter feedback"),
    ]

    /// What the microgame engine can't do yet (engine/SPEC-v0.2.md, bubble-kit-microgame.js), so Muse
    /// flags it instead of quietly faking it. Names are the `engine-gap:<name>` plan values.
    static let anatomyEngineGaps: [(String, String)] = [
        ("share_grid", "a custom shared result such as a colored-square grid of your guesses (a microgame shares its score text only)"),
        ("segment_collision", "lines, ropes or beams hitting things (physics and overlaps cover circles and axis-aligned boxes only)"),
        ("joints", "ropes, chains, hinges or springs linking bodies (no joints; a swing can only be drawn with angle math)"),
        ("rotated_shapes", "rotated boxes or polygons that collide"),
        ("device_sensors", "camera, microphone, voice, location or tilt"),
        ("live_multiplayer", "real-time play between phones (turns on one phone are fine)"),
        ("3d", "3D scenes or perspective"),
    ]

    static var anatomyEngineGapLines: String {
        anatomyEngineGaps.map { "  - \($0.0): \($0.1)" }.joined(separator: "\n")
    }

    static var anatomyFallbackFragmentLines: String {
        anatomyFallbackFragments.map { "- \($0.0): \($0.1)" }.joined(separator: "\n")
    }

    static let anatomySchema = """
    {"anatomy": "game-anatomy/0.1", "title": string, "genre": "word"|"puzzle"|"action"|"story"|"party",
     "parts": {
      "core_loop":  {"text": string, META},
      "verbs":      {"items": [string], META},
      "pieces":     {"items": [{"name": string, "has": [string]}], META},
      "state":      {"items": [{"name": string, "type": string}], META},
      "rules":      [{"n": number, "text": string, "check": string, META}],
      "end":        {"win": string|null, "lose": string|null, "score": string|null, META},
      "structure":  {"turns": string, "timing": string, "length_s": [number, number], META},
      "randomness": {"seed": string, META},
      "share":      {"grid": string, META},
      "theme":      {"text": string, META}
     }}
    META is: "source": "you"|"guess", "familiarity": "known"|"approximate"|"unfamiliar", \
    "plan": "fragment:<id>"|"custom:<builtin>, <builtin> - <what they do>"|"gate:<playtest check>"|"engine-gap:<name>", \
    "question": string|null, "options": [string]
    """

    /// `fragments`: the engine's fragment list, one "- id: what it does" per line.
    static func anatomySystem(fragments: String) -> String {
        """
        You are Muse Studio's game designer. Before Muse builds a tiny phone game, you take the person's idea apart \
        into its working parts, so the game follows their mechanics and not just their style. Great games are often \
        new rules rather than new art (a daily five-letter guess, a grid where each row holds one piece): capture \
        the rules exactly as the person means them.

        Reply with one JSON object only, in this shape:
        \(anatomySchema)

        How to fill it
        - source: "you" when the person's words say it (even loosely), "guess" when you chose it.
        - familiarity is mechanical, not a feeling. Decide it from the plan:
          "known": it maps to a fragment listed below (plan "fragment:<id>", tuned by params is fine).
          "approximate": no fragment, but custom rules built from the engine builtins below do it (plan \
        "custom:<builtin>, <builtin> - <what they do>", e.g. "custom:grid, neighbors8, count - two crowns may not touch").
          "unfamiliar": it needs something the engine doesn't have (plan "engine-gap:<name>", see the list below), or \
        you have no clear plan from the builtins. Most parts are known or approximate; a part is new to you when it \
        touches a known gap or you can't name the builtins that build it.
        - Known engine gaps. Whenever a part needs one of these, mark it "unfamiliar" with plan "engine-gap:<name>", \
        even if you could fake it, and say in the text what you'd do instead:
        \(anatomyEngineGapLines)
        - Use "gate:<check>" for a rule that a playtest must confirm (e.g. every daily puzzle is solvable).
        - question: only on parts that are a guess AND not known. When there are such parts, ask 1 to 3 questions in \
        total, on the guesses that most change how the game plays (a board size, a number of tries, what happens on a \
        mistake). One short question each, with 2–4 short "options" (your pick first). Every other question is null.
        - Vague requests: pick concrete values yourself (grid size, word length, number of tries, speed, run length), \
        mark them "guess", and say what you picked in the text ("6 tries, picked by Muse").
        - rules: numbered, one testable sentence each. "check" says how a scripted playtest confirms it \
        ("placing a second crown in a row is refused").
        - end: say how a run is won, how it's lost, and how it scores. Use null for one that doesn't apply.
        - structure.length_s: the expected run length in seconds, 10 to 120.
        - theme: a short phrase (at most 6 words) for the setting and feel, never the whole request. When the person \
        names a theme, franchise or brand (for example "Star Wars"), copy just those words verbatim into theme.text with \
        source "you"; otherwise pick one that fits and mark it "guess". Requested themes are honored in names, art and words so the game keeps their \
        feel; the mechanics stay original to the person's idea, and you never copy a specific existing game's levels, \
        layouts or art.
        - Played by touch on a phone: taps, drags and swipes, never a physical keyboard.
        - Plain words a player understands, sentence case, at most about 20 words per text. No engine jargon.
        - Synthetic people only: use first names only when the request gives them.

        Fragment library (what the engine already knows):
        \(fragments)
        Engine builtins for custom rules (beyond fragments): custom state as int, float, string, list, set, map, grid \
        and vec; events, timers (every, after) and typed input (tap, drag, swipe, tap_cell, key presses); and the \
        functions \(GameAnatomy.promptBuiltins.joined(separator: ", ")).
        """
    }

    static func anatomyUser(request: String, audience: String?, mode: String = "create") -> String {
        var lines = ["Mode: \(mode)", "Request: “\(request.trimmingCharacters(in: .whitespacesAndNewlines))”"]
        if let audience, !audience.isEmpty { lines.append("For: \(audience)") }
        lines.append("Take this game apart into its anatomy.")
        return lines.joined(separator: "\n")
    }

    /// A change to an agreed anatomy: a correction before the build (`afterPlaying` false) or a
    /// change after trying the game.
    static func anatomyReviseUser(anatomy: JSONValue, request: String, change: String, answers: [(question: String, answer: String)], afterPlaying: Bool) -> String {
        var lines: [String] = []
        lines.append("The person's original request: “\(request.trimmingCharacters(in: .whitespacesAndNewlines))”")
        lines.append(afterPlaying
                     ? "They have played the game built from this anatomy:"
                     : "This is the anatomy you proposed, with the person's edits (parts marked source \"you\"):")
        lines.append(anatomy.jsonString())
        if !answers.isEmpty {
            lines.append("")
            lines.append("Their answers to your questions:")
            lines += answers.map { "- \($0.question) → \($0.answer)" }
        }
        let change = change.trimmingCharacters(in: .whitespacesAndNewlines)
        if !change.isEmpty {
            lines.append("")
            lines.append("They now say: “\(change)”")
        }
        lines.append("")
        lines.append("""
        Reply with the complete updated anatomy in the same JSON shape. Change only what their words and answers \
        touch; keep every other part and rule exactly as it is (same text, same numbering, a new rule goes at the end). \
        Fold each answer into its part (set source "you", clear its question). Mark what you changed as source "you" \
        and judge its familiarity again. Add two top-level fields:
        - "changed": the parts you changed, as keys ("core_loop", "verbs", "pieces", "state", "end", "structure", \
        "randomness", "share", "theme") or "rules.<n>" for a rule.
        - "reply": one plain sentence to the person naming what this changes, e.g. "This changes rule 2 and how the \
        game ends." If any changed part is new to you, say so in the reply and how you'll build it.
        """)
        return lines.joined(separator: "\n")
    }
}
