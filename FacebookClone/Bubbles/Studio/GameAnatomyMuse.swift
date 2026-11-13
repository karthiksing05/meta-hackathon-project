import Foundation

/// Asks Muse for a game's anatomy (`GameAnatomy`) and for changes to it. One JSON turn each, on
/// the fast model by default: in tests it took about 5 s a call and read mechanics as well as the
/// planner (30–55 s), which matters in a back-and-forth. Without a Muse key Studio uses
/// `GameAnatomyFixtures` instead.
struct GameAnatomyMuse: Sendable {
    let client: MuseClient
    let model: String
    /// Seconds per call before Studio stops waiting.
    var timeout: TimeInterval
    var reasoningEffort: String? = "low"

    init(client: MuseClient = .studio, model: String? = nil, timeout: TimeInterval = 40) {
        self.client = client
        self.model = model ?? client.config.fastModel
        self.timeout = timeout
    }

    var isConfigured: Bool { client.isConfigured }

    /// Muse's first read of the request.
    func draft(request: String, audience: String?, fragments: String) async throws -> GameAnatomy {
        try await ask(
            system: MusePrompts.anatomySystem(fragments: fragments),
            user: MusePrompts.anatomyUser(request: request, audience: audience),
            purpose: "anatomy",
            fragments: fragments
        )
    }

    /// The anatomy with the person's change (and any answers) folded in; `changed` and `reply` say
    /// what moved.
    func revise(_ anatomy: GameAnatomy, request: String, change: String, afterPlaying: Bool, fragments: String) async throws -> GameAnatomy {
        try await ask(
            system: MusePrompts.anatomySystem(fragments: fragments),
            user: MusePrompts.anatomyReviseUser(anatomy: anatomy.json, request: request, change: change, answers: anatomy.answers, afterPlaying: afterPlaying),
            purpose: afterPlaying ? "anatomy change" : "anatomy refine",
            fragments: fragments
        )
    }

    /// Muse's reply, decoded, then calibrated (`GameAnatomy.calibrated`) unless `calibrates` is off.
    var calibrates = true

    private func ask(system: String, user: String, purpose: String, fragments: String) async throws -> GameAnatomy {
        let client = self.client
        let model = self.model
        let options = MuseClient.ChatOptions(maxTokens: 12_000, reasoningEffort: reasoningEffort, timeout: timeout, maxAttempts: 2, purpose: purpose)
        let value = try await StudioAsync.withTimeout(timeout + 5) {
            try await client.chatJSON(model: model, system: system, user: user, options: options).value
        }
        guard let anatomy = GameAnatomy.decode(value) else {
            throw MuseError.invalidReply("\(model) didn't return a game anatomy")
        }
        return calibrates ? anatomy.calibrated(knownFragments: GameAnatomy.fragmentIDs(in: fragments)) : anatomy
    }

    /// The engine's fragment list for the prompt: the live microgame catalog when it loads quickly,
    /// otherwise the built-in list.
    @MainActor
    static func fragmentLines(timeout: TimeInterval = 8) async -> String {
        let catalog = try? await StudioAsyncMain.withTimeout(timeout, operation: "read the catalog") {
            try await MicrogameStudio.shared.catalog()
        }
        guard let catalog, !catalog.fragments.isEmpty else { return MusePrompts.anatomyFallbackFragmentLines }
        return catalog.fragments.map { fragment in
            let first = fragment.describe.split(separator: ".", maxSplits: 1).first.map(String.init) ?? fragment.describe
            return "- \(fragment.id): \(first.trimmingCharacters(in: .whitespaces))"
        }.joined(separator: "\n")
    }
}

// MARK: - Fixtures

/// Ready-made anatomies for when Muse isn't configured, and for screenshots
/// (`FB_STUDIO_ANATOMY=fixture`). They go through `GameAnatomy.decode`, like Muse's replies.
enum GameAnatomyFixtures {
    /// A fixture that fits the request: a word game, a grid puzzle, or a dodge game in the
    /// request's own theme.
    static func anatomy(for request: String) -> GameAnatomy {
        let words = Set(request.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init))
        if !words.isDisjoint(with: ["word", "words", "letter", "letters", "wordle", "spell", "guess"]) {
            return decoded(wordGuess)
        }
        if !words.isDisjoint(with: ["grid", "row", "rows", "column", "columns", "region", "regions", "crown", "crowns", "queen", "queens", "logic", "place"]) {
            return decoded(gridLogic)
        }
        var anatomy = decoded(dodge)
        let theme = request.trimmingCharacters(in: .whitespacesAndNewlines)
        if !theme.isEmpty, let index = anatomy.parts.firstIndex(where: { $0.key == .theme }) {
            anatomy.parts[index].text = theme
            anatomy.parts[index].meta.source = .you
        }
        return anatomy
    }

    /// A stand-in for Muse's revise: answers become the person's words, and the change becomes a
    /// new rule (and the end or timing, when it talks about them).
    static func revised(_ anatomy: GameAnatomy, change: String) -> GameAnatomy {
        var out = anatomy
        out.changed = []
        for index in out.parts.indices where out.parts[index].meta.answer != nil {
            let answer = out.parts[index].meta.answer ?? ""
            out.parts[index].text = "\(out.parts[index].text.replacingOccurrences(of: ", picked by Muse", with: "")) (\(answer))"
            out.parts[index].meta.source = .you
            out.parts[index].meta.question = nil
            out.parts[index].meta.options = []
            out.parts[index].meta.answer = nil
            out.changed.append(out.parts[index].id)
        }
        for index in out.rules.indices where out.rules[index].meta.answer != nil {
            let answer = out.rules[index].meta.answer ?? ""
            out.rules[index].text += " (\(answer))"
            out.rules[index].meta.source = .you
            out.rules[index].meta.question = nil
            out.rules[index].meta.options = []
            out.rules[index].meta.answer = nil
            out.changed.append(out.rules[index].id)
        }
        let text = change.trimmingCharacters(in: .whitespacesAndNewlines)
        var note: String?
        if !text.isEmpty {
            // One part per change: how it ends, the timing, or a new rule.
            let short = paraphrase(text)
            let lower = short.lowercased()
            if lower.hasPrefix("lose ") || lower.hasPrefix("win ") || lower.contains("game over"),
               let index = out.parts.firstIndex(where: { $0.key == .end }) {
                let isLose = !lower.hasPrefix("win ")
                let prefix = isLose ? "Lose" : "Win"
                func isLine(_ line: String) -> Bool { line.hasPrefix("\(prefix):") || line.hasPrefix("\(prefix) ") }
                var details = out.parts[index].details.filter { !isLine($0) }
                if isLine(out.parts[index].text) { out.parts[index].text = short } else { details.insert(short, at: 0) }
                out.parts[index].details = details
                out.parts[index].fields[isLose ? "lose" : "win"] = .string(short)
                out.parts[index].meta.source = .you
                out.parts[index].meta.familiarity = .approximate
                out.parts[index].meta.plan = "custom:grid, neighbors8, count - checks the new \(isLose ? "lose" : "win") condition after each move"
                out.changed.append(out.parts[index].id)
                note = "I'll check it with custom rules after each move and confirm it in playtests."
            } else if ["faster", "slower", "seconds", "timer", "time limit", "longer", "shorter"].contains(where: lower.contains),
                      let index = out.parts.firstIndex(where: { $0.key == .structure }) {
                out.parts[index].details = [short] + out.parts[index].details.filter { !$0.hasPrefix("Timing:") }
                out.parts[index].fields["timing"] = .string(short)
                out.parts[index].meta.source = .you
                out.changed.append(out.parts[index].id)
            } else {
                out.addRule(short)
                if let last = out.rules.last { out.changed.append(last.id) }
                note = "The new rule is mine to work out, so I'll write custom rules for it and check it in playtests."
            }
        }
        var reply = out.changeSentence(out.changed)
        if let note { reply += " " + note }
        out.reply = reply
        return out
    }

    /// The person's words as a short part line: "Actually, you also lose if two crowns touch." →
    /// "Lose if two crowns touch".
    static func paraphrase(_ change: String) -> String {
        var text = change.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        let fillers = ["actually,", "actually", "also,", "also", "please", "i want", "i'd like", "can you", "make it so",
                       "and", "so", "then", "now", "it should be that", "let's", "lets"]
        var changed = true
        while changed {
            changed = false
            for filler in fillers where text.lowercased().hasPrefix(filler + " ") || text.lowercased() == filler {
                text = String(text.dropFirst(filler.count)).trimmingCharacters(in: .whitespaces)
                changed = true
            }
        }
        let subjects = ["you also ", "you ", "players also ", "players ", "the player also ", "the player "]
        for subject in subjects where text.lowercased().hasPrefix(subject) {
            text = String(text.dropFirst(subject.count))
            break
        }
        for (from, to) in [("loses ", "lose "), ("wins ", "win "), ("lose when ", "lose if ")] where text.lowercased().hasPrefix(from) {
            text = to + text.dropFirst(from.count)
        }
        return GameAnatomy.sentence(text)
    }

    static func decoded(_ text: String) -> GameAnatomy {
        guard let value = try? JSONValue.parse(text), let anatomy = GameAnatomy.decode(value) else {
            return GameAnatomy(title: "Your game", genre: "puzzle", parts: [], rules: [])
        }
        return anatomy
    }

    /// A daily word guess (the familiar case: every part known or close).
    static let wordGuess = #"""
    {"anatomy": "game-anatomy/0.1", "title": "Shelf Word", "genre": "word",
     "parts": {
      "core_loop": {"text": "Guess a hidden 5-letter word; each guess colors its letters to show how close you are", "source": "you", "familiarity": "known", "plan": "fragment:word_check"},
      "verbs": {"items": ["Tap letters on the keyboard", "Submit a guess", "Erase a letter"], "source": "guess", "familiarity": "known", "plan": "fragment:keyboard"},
      "pieces": {"items": [{"name": "Guess row", "has": ["5 letter tiles"]}, {"name": "Tile", "has": ["letter", "color: right spot, wrong spot, not in word"]}], "source": "guess", "familiarity": "known", "plan": "fragment:word_check"},
      "state": {"items": [{"name": "hidden word", "type": "word"}, {"name": "guesses left", "type": "number"}], "source": "guess", "familiarity": "known", "plan": "fragment:word_check"},
      "rules": [
       {"n": 1, "text": "The hidden word is a 5-letter word from a book title", "check": "every answer in the list has 5 letters", "source": "you", "familiarity": "approximate", "plan": "custom: book-title word list in content"},
       {"n": 2, "text": "A guess must be a real 5-letter word", "check": "a made-up word is refused and costs no try", "source": "guess", "familiarity": "known", "plan": "fragment:word_check"},
       {"n": 3, "text": "Letters turn violet in the right spot, blue in the wrong spot, gray if not in the word", "check": "feedback matches the hidden word for a scripted guess", "source": "guess", "familiarity": "known", "plan": "fragment:word_check"}
      ],
      "end": {"win": "Guess the word", "lose": "Run out of 6 tries", "score": "Fewer tries scores more", "source": "guess", "familiarity": "approximate", "plan": "fragment:word_check", "question": "How many tries should people get?", "options": ["5 tries", "6 tries", "8 tries"]},
      "structure": {"turns": "One guess at a time", "timing": "No clock", "length_s": [30, 120], "source": "guess", "familiarity": "known", "plan": "fragment:rounds"},
      "randomness": {"seed": "Same word for everyone each day", "source": "you", "familiarity": "known", "plan": "fragment:daily_seed"},
      "share": {"grid": "Colored squares for each guess, no letters", "source": "guess", "familiarity": "approximate", "plan": "custom: emoji grid from tile colors"},
      "theme": {"text": "Books and reading", "source": "you", "familiarity": "known"}
     }}
    """#

    /// A grid logic puzzle with one part that's new to Muse (the color regions).
    static let gridLogic = #"""
    {"anatomy": "game-anatomy/0.1", "title": "Crown Rows", "genre": "puzzle",
     "parts": {
      "core_loop": {"text": "Place crowns on a colored grid until every row, column and color region has exactly one", "source": "you", "familiarity": "approximate", "plan": "fragment:grid_board"},
      "verbs": {"items": ["Tap a cell to place a crown", "Tap again to mark it empty", "Tap a third time to clear"], "source": "guess", "familiarity": "known", "plan": "fragment:grid_board"},
      "pieces": {"items": [{"name": "Board", "has": ["7 by 7 cells, picked by Muse"]}, {"name": "Cell", "has": ["color region", "crown, mark or empty"]}], "source": "guess", "familiarity": "approximate", "plan": "fragment:grid_board", "question": "How big should the board be?", "options": ["6 by 6", "7 by 7", "8 by 8"]},
      "state": {"items": [{"name": "board", "type": "grid of cells"}, {"name": "region map", "type": "grid of colors"}, {"name": "crowns placed", "type": "number"}], "source": "guess", "familiarity": "approximate", "plan": "custom: region map next to the board"},
      "rules": [
       {"n": 1, "text": "Exactly one crown in every row", "check": "a second crown in a row shows a clash", "source": "you", "familiarity": "approximate", "plan": "custom: row count check"},
       {"n": 2, "text": "Exactly one crown in every column", "check": "a second crown in a column shows a clash", "source": "you", "familiarity": "approximate", "plan": "custom: column count check"},
       {"n": 3, "text": "Exactly one crown in every color region", "check": "the solver finds one crown per region in the answer", "source": "you", "familiarity": "unfamiliar", "plan": "custom: region map and per-region count"},
       {"n": 4, "text": "Every puzzle has exactly one solution", "check": "a solver confirms one answer before the puzzle ships", "source": "guess", "familiarity": "unfamiliar", "plan": "gate: unique solution", "question": "Should a puzzle always have just one answer?", "options": ["Yes, one answer", "Any answer that fits"]}
      ],
      "end": {"win": "Every row, column and region has one crown", "lose": null, "score": "Faster solves score more", "source": "guess", "familiarity": "approximate", "plan": "custom: solved check"},
      "structure": {"turns": "Solo, at your own pace", "timing": "A clock counts up", "length_s": [45, 120], "source": "guess", "familiarity": "known", "plan": "fragment:countdown"},
      "randomness": {"seed": "One new board for everyone each day", "source": "guess", "familiarity": "known", "plan": "fragment:daily_seed"},
      "share": {"grid": "Your time and a small crown grid, no answers", "source": "guess", "familiarity": "approximate", "plan": "custom: share grid"},
      "theme": {"text": "Crowns on a colorful quilt", "source": "guess", "familiarity": "known"}
     }}
    """#

    /// An action game; its theme is replaced with the person's words.
    static let dodge = #"""
    {"anatomy": "game-anatomy/0.1", "title": "Starlane Run", "genre": "action",
     "parts": {
      "core_loop": {"text": "Steer your ship between lanes to dodge what flies at you and grab fuel", "source": "guess", "familiarity": "known", "plan": "fragment:lanes"},
      "verbs": {"items": ["Tap left or right to switch lanes"], "source": "guess", "familiarity": "known", "plan": "fragment:lanes", "question": "How should people steer?", "options": ["Tap left or right", "Drag freely"]},
      "pieces": {"items": [{"name": "Ship", "has": ["lane"]}, {"name": "Rock", "has": ["speed"]}, {"name": "Fuel cell", "has": ["points"]}], "source": "guess", "familiarity": "known", "plan": "fragment:spawn_wave"},
      "state": {"items": [{"name": "lives", "type": "number"}, {"name": "distance", "type": "number"}], "source": "guess", "familiarity": "known", "plan": "fragment:lives"},
      "rules": [
       {"n": 1, "text": "Hitting a rock costs a life", "check": "a scripted crash drops lives by one", "source": "guess", "familiarity": "known", "plan": "fragment:collide"},
       {"n": 2, "text": "Fuel cells add points", "check": "a pickup raises the score", "source": "guess", "familiarity": "known", "plan": "fragment:pickups"},
       {"n": 3, "text": "Rocks come faster over time", "check": "the third wave is faster than the first", "source": "guess", "familiarity": "known", "plan": "fragment:speed_ramp"}
      ],
      "end": {"win": null, "lose": "Lose all 3 lives", "score": "Distance plus fuel", "source": "guess", "familiarity": "known", "plan": "fragment:lives"},
      "structure": {"turns": "Solo", "timing": "Real time", "length_s": [20, 90], "source": "guess", "familiarity": "known", "plan": "fragment:difficulty_curve"},
      "randomness": {"seed": "New rock pattern each run", "source": "guess", "familiarity": "known", "plan": "fragment:spawn_wave"},
      "share": {"grid": "Distance and fuel collected", "source": "guess", "familiarity": "known", "plan": "fragment:score"},
      "theme": {"text": "Space", "source": "guess", "familiarity": "known"}
     }}
    """#
}
