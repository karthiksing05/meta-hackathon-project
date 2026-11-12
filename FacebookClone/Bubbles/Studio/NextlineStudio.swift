import Foundation

/// Muse Studio support for the `nextline` formula: Guess what they say next (docs/BUBBLES.md 7.7).
/// Owner: the "nextline" feature. Teaches Muse to write short original scenes that freeze before
/// the punchline, with three decoy lines, and writes five scenes offline when Muse is unreachable.
/// Foundation only (the CLI compiles this file).
enum NextlineStudio {
    static let hint = StudioFormulaHint(
        formula: "nextline",
        keywords: [
            "what they say next", "what they'll say", "say next", "says next", "next line", "punchline", "punchlines",
            "finish the line", "comeback", "comebacks", "dialogue", "scene", "scenes", "sitcom", "skit", "skits",
            "game night", "quiz night", "trivia night", "party game", "roommate", "roommates",
        ],
        nouns: ["Lines", "Night", "Comebacks"],
        looks: ["riso", "paper", "clay"],
        composerGuide: composerGuide,
        offlineContent: { manifest, request, _ in
            offlineContent(&manifest, prompt: request.prompt)
        },
        playtestFlags: { _, runs in
            playtestFlags(runs)
        },
        relaxedFlags: ["no_challenge"]
    )

    /// Extra composer prompt lines for this request (empty when it doesn't apply).
    static func promptLines(_ request: StudioRequest) -> [String] {
        []
    }

    // MARK: Composer guide

    static let composerGuide = """
    A quiz night "guess what they say next" game. Plan 5 short, original scenes from the request \
    (for example "roommates figuring out the thermostat"), one per episode, each a tiny story with a \
    setup and a punchline. For every episode write: title (≤ 40), setting (one line, ≤ 80), cast of 2–3 \
    characters with neutral first names (no real people) and a shape each (blob, square, tall, round, \
    star) and a role (primary, secondary, accent: their color), 4–5 lines of dialogue (who, text ≤ 70; \
    keep most under 50 so they type out quickly), next_who (the character who says the punchline), \
    answer (the real next line: funny, surprising and in character, ≤ 60) and exactly 3 decoys \
    (plausible next lines of similar length and tone that are clearly wrong in context; never repeat \
    the answer). Add reveal_emoji (one emoji for the reveal). The last line before the freeze should \
    set up the punchline so a sharp player can guess it. Keep it family-friendly. No real people, \
    shows, movies, quotes, brands, songs or celebrities. Use rule.next_line (round_seconds 8; 10 for \
    long lines) and score.quick_answer. Pick a look that fits: riso for zine-like comedy, paper for \
    cozy, clay for cute.
    """

    // MARK: Playtest

    /// Runs should last 15–90 s: shorter means too few or too short scenes.
    static func playtestFlags(_ runs: [StudioPlaytest.Run]) -> [StudioPlaytest.Flag] {
        let done = runs.filter(\.ok).map(\.seconds).sorted()
        guard !done.isEmpty else { return [] }
        let median = done[done.count / 2]
        if median < 15 {
            return [StudioPlaytest.Flag(code: "nextline_short",
                                        message: "Scenes are over in about \(Int(median.rounded())) s. Write at least 3 episodes with 4–5 lines each.",
                                        blocking: true)]
        }
        if median > 90 {
            return [StudioPlaytest.Flag(code: "nextline_long",
                                        message: "A night takes about \(Int(median.rounded())) s. Shorten lines or play fewer scenes.",
                                        blocking: false)]
        }
        return []
    }

    // MARK: Offline

    /// Fills five original scenes from a canned bank, with the request's subject in them. Deterministic.
    static func offlineContent(_ manifest: inout BubbleManifest, prompt: String) -> String? {
        let subject = subject(of: prompt)
        let names = cast(for: prompt)
        let episodes = templates.map { $0.episode(subject: subject, names: names) }
        manifest.content = .object(["episodes": .array(episodes)])
        manifest.oneLineRule = "Guess what they say next."
        if !manifest.concepts.contains(where: { $0.use == "rule.next_line" }) { return nil }
        return "Wrote 5 scenes from your idea"
    }

    /// The thing the scenes are about: "the thermostat" from "roommates figuring out the thermostat".
    static func subject(of prompt: String) -> String {
        let stop: Set<String> = ["a", "an", "the", "of", "and", "or", "to", "for", "with", "about", "in", "on", "at", "my", "our", "your",
                                 "quiz", "night", "game", "games", "party", "guess", "what", "they", "say", "says", "next", "line", "lines",
                                 "figuring", "out", "trying", "learning", "dealing", "arguing", "over", "who", "is", "are", "new", "make",
                                 "scene", "scenes", "punchline", "roommates", "roommate", "friends", "neighbors", "coworkers", "two", "three"]
        let words = prompt.lowercased()
            .components(separatedBy: CharacterSet.letters.inverted)
            .filter { !$0.isEmpty }
        let content = words.filter { !stop.contains($0) && $0.count > 2 }
        guard let last = content.last else { return "the plan" }
        // Keep a two-word subject when the words sit together ("group chat", "street parking").
        if let i = words.lastIndex(of: last), i > 0, !stop.contains(words[i - 1]), words[i - 1].count > 2 {
            let pair = "\(words[i - 1]) \(last)"
            if pair.count <= 18 { return "the \(pair)" }
        }
        return "the \(String(last.prefix(16)))"
    }

    /// Three neutral names, picked by the prompt so the same idea gets the same cast.
    static func cast(for prompt: String) -> [String] {
        let pool = ["Juno", "Pax", "Wren", "Ada", "Rio", "Noor", "Bo", "Tess", "Milo", "Kai", "Lux", "Remy", "Sol", "Ivy", "Nico", "Oona"]
        var h: UInt64 = 1469598103934665603
        for b in prompt.lowercased().utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        let start = Int(h % UInt64(pool.count))
        return [pool[start], pool[(start + 5) % pool.count], pool[(start + 11) % pool.count]]
    }

    struct Template {
        let title: String
        let setting: String
        /// (speaker index, text with {S} for the subject, {Sc} capitalized).
        let lines: [(Int, String)]
        let nextWho: Int
        let answer: String
        let decoys: [String]
        let emoji: String

        func episode(subject: String, names: [String]) -> JSONValue {
            let cap = subject.prefix(1).uppercased() + subject.dropFirst()
            func fill(_ s: String) -> String {
                s.replacingOccurrences(of: "{Sc}", with: cap).replacingOccurrences(of: "{S}", with: subject)
            }
            let used = Set(lines.map(\.0) + [nextWho]).sorted()
            let shapes = ["blob", "square", "tall"]
            let roles = ["primary", "secondary", "accent"]
            let cast: [JSONValue] = used.map { i in
                .object(["name": .string(names[i]), "shape": .string(shapes[i]), "role": .string(roles[i])])
            }
            return .object([
                "title": .string(fill(title)),
                "setting": .string(fill(setting)),
                "cast": .array(cast),
                "lines": .array(lines.map { .object(["who": .string(names[$0.0]), "text": .string(String(fill($0.1).prefix(70)))]) }),
                "next_who": .string(names[nextWho]),
                "answer": .string(String(fill(answer).prefix(60))),
                "decoys": .array(decoys.map { .string(String(fill($0).prefix(60))) }),
                "reveal_emoji": .string(emoji),
            ])
        }
    }

    static let templates: [Template] = [
        Template(
            title: "Who's in charge?", setting: "Day one with {S}.",
            lines: [(0, "Okay, who's in charge of {S}?"), (1, "I thought you were."), (0, "I thought you were."), (1, "So... nobody is.")],
            nextWho: 0, answer: "Great. {Sc} is in charge of us now.",
            decoys: ["Let's ask the neighbors for help.", "I'll read the instructions tonight.", "Want to grab some lunch?"],
            emoji: "🫠"
        ),
        Template(
            title: "The manual", setting: "Someone found the instructions.",
            lines: [(1, "I found the manual for {S}."), (0, "What does page one say?"), (1, "\"Good luck.\""), (0, "And page two?")],
            nextWho: 1, answer: "Page two is just a drawing of a cat.",
            decoys: ["Page two has the warranty info.", "It's all in tiny print.", "I think I lost page two."],
            emoji: "🐱"
        ),
        Template(
            title: "The expert", setting: "A friend shows up to help.",
            lines: [(2, "I heard you two need an expert."), (0, "You know about {S}?"), (2, "I watched one video about it."), (1, "That's one more than us.")],
            nextWho: 2, answer: "Then I'm officially the expert. Stand back.",
            decoys: ["Then let's watch it together.", "Maybe we should call a pro.", "Sorry, I have to run."],
            emoji: "🦸"
        ),
        Template(
            title: "A small problem", setting: "Something went a little wrong.",
            lines: [(0, "Small problem with {S}."), (1, "How small?"), (0, "On a scale of one to ten?"), (1, "Sure, one to ten.")],
            nextWho: 0, answer: "Eleven. But a cute eleven.",
            decoys: ["About a two, honestly.", "Let's not talk about it.", "Ask me again tomorrow."],
            emoji: "🙈"
        ),
        Template(
            title: "Victory", setting: "It finally works.",
            lines: [(1, "We did it. {Sc} works!"), (2, "Group hug?"), (0, "Wait. What's that noise?"), (1, "Nobody. Touch. Anything.")],
            nextWho: 2, answer: "Too late. I touched everything.",
            decoys: ["It's just the fridge humming.", "I'll go check outside.", "Let's celebrate with pizza."],
            emoji: "🎉"
        ),
    ]
}
