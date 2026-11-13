import Foundation

/// Muse Studio support for making together and "Games about me" (docs/BUBBLES.md 7.4): Muse
/// stitches every maker's contribution into one game, credits every maker in `lineage.makers`,
/// and builds about-me games from the subject's answers (manifest `about`). Every Muse step has
/// an offline fallback.
///
/// Everything here reads `request.social` only, and does nothing unless it carries contributions,
/// more than one maker, or an about-me template, so remixes and plain creates are untouched.
/// Owner: the "together" feature. Foundation only (the CLI compiles this file).
enum TogetherStudio {
    // MARK: - Hooks

    /// Composer prompt lines: the contributions to stitch, or the about-me answers.
    static func promptLines(_ request: StudioRequest) -> [String] {
        guard let social = request.social else { return [] }
        var lines: [String] = []
        if isMadeTogether(social) {
            let makers = normalizedMakers(social, creatorName: request.creatorName)
            lines.append("## Made together")
            lines.append("\(names(makers.map(\.name))) made this game together. \(makers.first?.name ?? request.creatorName) started it; every contribution below is theirs, word for word:")
            for (index, item) in social.contributions.enumerated() {
                let text = item.text.replacingOccurrences(of: "\n", with: " · ")
                lines.append("\(index + 1). \(item.makerName) added \(kindPhrase(item.kind)): \(text)")
            }
            lines.append("""
            Rules: keep each maker's wording (fix only spelling), use every contribution, and credit everyone. \
            A question becomes one round whose right answer is the maker's answer; write 3 plausible wrong answers when they \
            gave fewer. Words become the word list, with a short clue each. Scenes become scenes in their order. A level is a \
            description: turn it into params and content for the formula. The content must fit the formula's content schema \
            exactly. If there are fewer than 5 rounds, add your own short rounds on the same theme after theirs to reach 5; \
            give those the note "Added by Muse" and never credit a maker for them. A theme, franchise or brand the makers ask \
            for is welcome; never add one they didn't ask for.
            """)
        }
        if let templateID = social.aboutMeTemplate {
            let subject = social.makers.first?.name ?? request.creatorName
            let template = template(templateID)
            lines.append("## About \(subject)")
            lines.append("A \"Games about me\" game (\(template?.title ?? templateID)): friends play to show how well they know \(subject). \(subject)'s own answers:")
            for (question, answer) in orderedAnswers(social.aboutMeAnswers, template: template) {
                lines.append("Q: \(question.label) A: \(answer)")
            }
            if let posts = social.aboutMeAnswers[postsKey], !posts.isEmpty {
                lines.append("From \(subject)'s opted-in posts: \(posts)")
            }
            lines.append("""
            Rules: use the answer formula with an answer key. Each answer above is the right choice of one round, asked about \
            \(subject) in the third person ("What's \(subject)'s favorite food?"). Decoys are plausible but clearly not \
            \(subject)'s, and never add brands, teams or businesses that aren't in the answers above. Keep the rounds in the order given\(templateID == "first-month" ? " (they tell the month in order)" : ""). \
            Nothing private beyond what's given here. Title it like "\(template?.gameTitle(subject) ?? "About \(subject)")".
            """)
        }
        return lines
    }

    /// Offline path: stitch contributions or answers into the content.
    static func applyOffline(_ manifest: inout BubbleManifest, request: StudioRequest, brief: BubbleBrief) {
        guard let social = request.social else { return }
        if let templateID = social.aboutMeTemplate, let template = template(templateID) {
            let subject = social.makers.first?.name ?? request.creatorName
            let rounds = aboutMeRounds(template: template, answers: social.aboutMeAnswers, subject: subject)
            if manifest.formula == .answer, rounds.count >= 2 {
                configureAnswerKey(&manifest, rounds: rounds)
                manifest.title = template.gameTitle(subject)
                manifest.oneLineRule = clip("Pick \(subject)'s real answer each round.", 70)
                manifest.style.emoji = template.emoji
                note(&manifest, "Wrote \(rounds.count) rounds from \(subject)'s answers")
            }
            return
        }
        guard isMadeTogether(social) else { return }
        let title = quotedTitle(in: request.prompt)
        let makers = normalizedMakers(social, creatorName: request.creatorName)
        if manifest.formula == .answer {
            let stitched = stitchedRounds(social.contributions)
            guard !stitched.rounds.isEmpty || stitched.topUp > 0 else { return }
            configureAnswerKey(&manifest, rounds: stitched.rounds)
            manifest.oneLineRule = clip("Answer the questions \(names(makers.map(\.name))) wrote.", 70)
            if manifest.oneLineRule.count >= 70 { manifest.oneLineRule = "Answer the questions your friends wrote." }
            if let title { manifest.title = title }
            note(&manifest, "Stitched \(stitched.rounds.count - stitched.topUp) questions from \(makers.count) makers"
                 + (stitched.topUp > 0 ? "; added \(stitched.topUp) Muse questions to reach 5 rounds" : ""))
        } else if manifest.formula == .guess, manifest.uses("rule.letter_feedback") {
            let words = stitchedWords(social.contributions)
            guard words.count >= 1, var content = manifest.content.object else { return }
            content["words"] = .array(words.map { .string($0.word) })
            content["clues"] = .object(Dictionary(uniqueKeysWithValues: words.map { ($0.word, JSONValue.string($0.clue)) }))
            content.removeValue(forKey: "target")
            if let dictionary = content["dictionary"]?.strings {
                content["dictionary"] = .array(unique(dictionary + words.map(\.word)).map { .string($0) })
            }
            manifest.content = .object(content)
            if !manifest.uses("content.seed") {
                manifest.concepts.insert(ConceptUse("content.seed", params: ["list": .string("words"), "into": .string("target")]), at: 0)
            }
            // A game friends made is replayable, not a once-a-day word.
            manifest.concepts.removeAll { $0.use == "flow.daily_gate" }
            if manifest.structure.cadence == "daily" { manifest.structure.cadence = "endless" }
            if let title { manifest.title = title }
            manifest.oneLineRule = clip("Guess a word \(names(makers.map(\.name))) picked.", 70)
            note(&manifest, "Stitched \(words.count) words from \(makers.count) makers")
        }
        // Scenes and levels need Muse: offline keeps the template's content and still credits
        // every maker (finalize).
    }

    /// Fills `lineage.makers` and `about` from `request.social`. Metadata only.
    static func finalize(_ manifest: BubbleManifest, request: StudioRequest) -> BubbleManifest {
        guard let social = request.social else { return manifest }
        var out = manifest
        if isMadeTogether(social) {
            out.lineage.makers = normalizedMakers(social, creatorName: request.creatorName)
        }
        if let templateID = social.aboutMeTemplate {
            let subject = social.makers.first
            out.about = BubbleAboutMe(
                subjectID: subject?.id ?? "me",
                subjectName: subject?.name ?? request.creatorName,
                template: templateID
            )
        }
        return out
    }

    // MARK: - Who made it

    /// True for a co-made request: contributions, or more than one maker.
    static func isMadeTogether(_ social: StudioSocialContext) -> Bool {
        !social.contributions.isEmpty || social.makers.count > 1
    }

    /// The starter first (role "starter"), then each contributor once, in order of arrival, with
    /// what they added ("a question", "2 questions", "6 words").
    static func normalizedMakers(_ social: StudioSocialContext, creatorName: String) -> [BubbleMaker] {
        var order: [String] = []
        var named: [String: String] = [:]
        let starter = social.makers.first(where: { $0.role == "starter" }) ?? social.makers.first
        if let starter {
            order.append(starter.id)
            named[starter.id] = starter.name
        }
        for maker in social.makers where !order.contains(maker.id) {
            order.append(maker.id)
            named[maker.id] = maker.name
        }
        for item in social.contributions where !order.contains(item.makerID) {
            order.append(item.makerID)
            named[item.makerID] = item.makerName
        }
        if order.isEmpty { return [] }
        return order.enumerated().map { index, id in
            let mine = social.contributions.filter { $0.makerID == id }
            let given = social.makers.first { $0.id == id }?.contribution
            return BubbleMaker(
                id: id,
                name: named[id] ?? creatorName,
                role: index == 0 ? "starter" : "contributor",
                contribution: mine.isEmpty ? (given ?? (index == 0 ? "started it" : nil)) : summary(of: mine)
            )
        }
    }

    /// "a question", "2 questions", "5 words", "a scene".
    static func summary(of items: [StudioContribution]) -> String {
        let kind = items.first?.kind ?? "question"
        if kind == "words" {
            let count = items.reduce(0) { $0 + parseWords($1.text).count }
            return count == 1 ? "a word" : "\(count) words"
        }
        let noun = kind == "scene" ? "scene" : kind == "level" ? "level" : "question"
        return items.count == 1 ? "a \(noun)" : "\(items.count) \(noun)s"
    }

    static func kindPhrase(_ kind: String) -> String {
        switch kind {
        case "words": return "words"
        case "scene": return "a scene"
        case "level": return "a level idea"
        default: return "a question"
        }
    }

    /// "Maya", "Maya and Diego", "Maya, Diego and Alex".
    static func names(_ list: [String]) -> String {
        switch list.count {
        case 0: return ""
        case 1: return list[0]
        default: return list.dropLast().joined(separator: ", ") + " and " + list[list.count - 1]
        }
    }

    // MARK: - Question contributions

    /// A trivia question someone added: their question, their answer, and any wrong answers
    /// they suggested.
    struct QuestionParts: Hashable, Sendable {
        var question: String
        var answer: String
        var decoys: [String]
        var note: String?

        init(question: String, answer: String, decoys: [String] = [], note: String? = nil) {
            self.question = question
            self.answer = answer
            self.decoys = decoys
            self.note = note
        }
    }

    /// The text a question contribution carries (card extras `text`, `StudioContribution.text`):
    /// "Which hill has the best sunset?\nAnswer: Bernal Hill\nAlso: Twin Peaks, Tank Hill".
    static func encodeQuestion(_ parts: QuestionParts) -> String {
        var lines = [parts.question.trimmingCharacters(in: .whitespacesAndNewlines),
                     "Answer: " + parts.answer.trimmingCharacters(in: .whitespacesAndNewlines)]
        let decoys = parts.decoys.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if !decoys.isEmpty { lines.append("Also: " + decoys.joined(separator: ", ")) }
        return lines.joined(separator: "\n")
    }

    /// Reads `encodeQuestion`'s format back; a bare "Question? Answer" line also works.
    static func parseQuestion(_ text: String) -> QuestionParts? {
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard let first = lines.first else { return nil }
        var question = first
        var answer = ""
        var decoys: [String] = []
        for line in lines.dropFirst() {
            let lower = line.lowercased()
            if lower.hasPrefix("answer:") {
                answer = String(line.dropFirst(7)).trimmingCharacters(in: .whitespaces)
            } else if lower.hasPrefix("also:") {
                decoys = String(line.dropFirst(5)).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            }
        }
        if answer.isEmpty, let mark = first.firstIndex(of: "?"), first.index(after: mark) < first.endIndex {
            question = String(first[...mark])
            answer = first[first.index(after: mark)...].trimmingCharacters(in: CharacterSet(charactersIn: " -–—:"))
        }
        guard !question.isEmpty, !answer.isEmpty else { return nil }
        return QuestionParts(question: question, answer: answer, decoys: decoys)
    }

    /// Words in a words contribution ("BLANKET, FRISBEE (what Diego always brings)"): A-Z, 3–10
    /// letters, uppercased, each with its clue if one was given in parentheses.
    static func parseWords(_ text: String) -> [(word: String, clue: String?)] {
        var out: [(String, String?)] = []
        for piece in text.split(whereSeparator: { $0 == "," || $0 == "\n" || $0 == ";" }) {
            var raw = piece.trimmingCharacters(in: .whitespaces)
            var clue: String?
            if let open = raw.firstIndex(of: "("), let close = raw.lastIndex(of: ")"), open < close {
                clue = String(raw[raw.index(after: open)..<close]).trimmingCharacters(in: .whitespaces)
                raw = String(raw[..<open]).trimmingCharacters(in: .whitespaces)
            }
            let word = raw.uppercased().filter { $0.isASCII && $0.isLetter }
            guard word.count >= 3, word.count <= 10, word == raw.uppercased(), !out.contains(where: { $0.0 == word }) else { continue }
            out.append((word, clue?.isEmpty == false ? clue : nil))
        }
        return out
    }

    /// Answer rounds from question contributions, in order, topped up with Muse's own picnic and
    /// city questions to reach 5 rounds (so playtests pass). `topUp` counts the added ones.
    static func stitchedRounds(_ contributions: [StudioContribution]) -> (rounds: [JSONValue], topUp: Int) {
        var rounds: [JSONValue] = []
        var asked = Set<String>()
        for item in contributions where item.kind == "question" {
            guard let parts = parseQuestion(item.text), asked.insert(parts.question.lowercased()).inserted else { continue }
            rounds.append(answerRound(parts, note: "\(item.makerName)'s question"))
            if rounds.count == 12 { break }
        }
        var topUp = 0
        for extra in toppers where rounds.count < 5 {
            guard asked.insert(extra.question.lowercased()).inserted else { continue }
            rounds.append(answerRound(extra, note: extra.note ?? "Added by Muse"))
            topUp += 1
        }
        return (rounds, topUp)
    }

    /// Words from words contributions, each clued with who picked it.
    static func stitchedWords(_ contributions: [StudioContribution]) -> [(word: String, clue: String)] {
        var out: [(String, String)] = []
        for item in contributions where item.kind == "words" {
            for entry in parseWords(item.text) where !out.contains(where: { $0.0 == entry.word }) {
                out.append((entry.word, clip(entry.clue.map { "\(item.makerName): \($0)" } ?? "Picked by \(item.makerName)", 90)))
                if out.count == 12 { return out }
            }
        }
        return out
    }

    /// One answer-key round: the right answer plus decoys (theirs first, then the pool), at a
    /// stable position.
    static func answerRound(_ parts: QuestionParts, note: String?) -> JSONValue {
        let answer = clip(parts.answer, 32)
        var choices = [answer]
        let pool = parts.decoys + decoyPool(for: parts.question, answer: answer)
        for decoy in pool where choices.count < 4 {
            let clipped = clip(decoy, 32)
            guard !clipped.isEmpty, !choices.contains(where: { $0.lowercased() == clipped.lowercased() }) else { continue }
            choices.append(clipped)
        }
        let slot = Int(stableHash(parts.question) % UInt64(choices.count))
        choices.swapAt(0, slot)
        var round: [String: JSONValue] = [
            "prompt": .string(clip(parts.question, 90)),
            "choices": .array(choices.map { .string($0) }),
            "answer": .number(Double(slot)),
        ]
        if let note, !note.isEmpty { round["note"] = .string(clip(note, 80)) }
        return .object(round)
    }

    /// Wrong answers that fit the question: neighborhoods for "where", people for "who", and so on.
    static func decoyPool(for question: String, answer: String) -> [String] {
        let q = question.lowercased()
        let pool: [String]
        if q.hasPrefix("who") {
            pool = ["Maya", "Diego", "Priya", "Chloe", "Theo", "Aiko", "Omar", "Lena"]
        } else if q.contains("hill") {
            pool = ["Twin Peaks", "Tank Hill", "Nob Hill", "Russian Hill", "Bernal Hill", "Telegraph Hill"]
        } else if q.contains("where") || q.contains("park") || q.contains("neighborhood") || q.contains("beach") {
            pool = ["Dolores Park", "Crissy Field", "Ocean Beach", "Alamo Square", "Golden Gate Park", "Lands End"]
        } else if q.contains("how many") || q.contains("how much") || q.contains("what year") {
            pool = ["About 10", "About 25", "About 50", "Over 100"]
        } else if q.contains("eat") || q.contains("food") || q.contains("snack") || q.contains("bread") {
            pool = ["Sourdough", "Dumplings", "Burritos", "Grapes", "Cookies", "Empanadas"]
        } else {
            pool = ["The fog", "A cable car", "The bridge", "A picnic blanket", "Sea lions", "A frisbee"]
        }
        let start = Int(stableHash(answer + question) % UInt64(pool.count))
        return (0..<pool.count).map { pool[($0 + start) % pool.count] }.filter { $0.lowercased() != answer.lowercased() }
    }

    /// Muse's own short questions for topping a stitched quiz up to 5 rounds. Original, true,
    /// city-and-picnic themed.
    static let toppers: [QuestionParts] = [
        QuestionParts(question: "What's the fog's local nickname?", answer: "Karl", decoys: ["Gary", "Misty", "Fogbert"], note: "Added by Muse"),
        QuestionParts(question: "Which beach is at the end of the N line?", answer: "Ocean Beach", decoys: ["Baker Beach", "China Beach", "Crissy Field"], note: "Added by Muse"),
        QuestionParts(question: "What runs up and down Powell Street?", answer: "Cable cars", decoys: ["Ferries", "Streetcars", "Gondolas"], note: "Added by Muse"),
        QuestionParts(question: "Which hill has the wild parrots?", answer: "Telegraph Hill", decoys: ["Bernal Hill", "Russian Hill", "Nob Hill"], note: "Added by Muse"),
        QuestionParts(question: "Best thing to bring when the fog rolls in?", answer: "A warm layer", decoys: ["Sunscreen only", "Flip-flops", "An umbrella"], note: "Added by Muse"),
    ]

    // MARK: - Answer-key wiring

    /// Makes an answer manifest an answer-key quiz with these rounds: rule.answer_key and
    /// score.answer_points (in place of the consensus pair), flow.rounds set to the round count.
    static func configureAnswerKey(_ manifest: inout BubbleManifest, rounds: [JSONValue]) {
        var concepts = manifest.concepts.filter { $0.use != "rule.consensus" && $0.use != "score.closeness" }
        if !concepts.contains(where: { $0.use == "space.answer_stage" }) { concepts.insert(ConceptUse("space.answer_stage"), at: 0) }
        if !concepts.contains(where: { $0.use == "input.select" }) { concepts.insert(ConceptUse("input.select"), at: 1) }
        if !concepts.contains(where: { $0.use == "rule.answer_key" }) {
            concepts.insert(ConceptUse("rule.answer_key", params: ["round_seconds": .number(12), "reveal_seconds": .number(1.8)]), at: 2)
        }
        if !concepts.contains(where: { $0.use == "score.answer_points" }) {
            concepts.insert(ConceptUse("score.answer_points"), at: 3)
        }
        let flow: [String: JSONValue] = ["count": .number(Double(rounds.count)), "pause": .number(110), "pass_ratio": .number(0.5)]
        if let index = concepts.firstIndex(where: { $0.use == "flow.rounds" }) {
            var params = concepts[index].params ?? [:]
            params.merge(flow) { _, new in new }
            concepts[index].params = params
        } else {
            concepts.insert(ConceptUse("flow.rounds", params: flow), at: 4)
        }
        manifest.concepts = concepts
        var content = manifest.content.object ?? [:]
        content["rounds"] = .array(rounds)
        content.removeValue(forKey: "crowd")
        manifest.content = .object(content)
    }

    // MARK: - Games about me

    /// One question on a "Games about me" form.
    struct AboutQuestion: Hashable, Sendable {
        /// Key in `StudioSocialContext.aboutMeAnswers`.
        var id: String
        /// What the form asks ("Your favorite food").
        var label: String
        /// The round's prompt, with {name} for the subject ("What's {name}'s favorite food?").
        var prompt: String
        /// Plausible wrong answers.
        var decoys: [String]
        /// A demo answer for Alex, used to prefill the form.
        var sample: String
    }

    /// A "Games about me" template.
    struct Template: Hashable, Sendable, Identifiable {
        var id: String
        var title: String
        var emoji: String
        var questions: [AboutQuestion]

        /// "How well do you know Alex?"
        func gameTitle(_ name: String) -> String {
            switch id {
            case "first-month": return "\(name)'s First Month in SF"
            case "favorite-spot": return "Guess \(name)'s Favorite Spot"
            default: return "How Well Do You Know \(name)?"
            }
        }
    }

    /// Key for text pulled from the subject's opted-in posts in `aboutMeAnswers`.
    static let postsKey = "from_posts"

    static let templates: [Template] = [
        Template(id: "how-well", title: "How well do you know me?", emoji: "🤔", questions: [
            AboutQuestion(id: "food", label: "Your favorite food", prompt: "What's {name}'s favorite food?",
                          decoys: ["Ramen", "Pizza", "Dumplings", "Pho", "Sushi", "Curry"], sample: "Breakfast tacos"),
            AboutQuestion(id: "hometown", label: "Where you grew up", prompt: "Where did {name} grow up?",
                          decoys: ["Chicago", "Seattle", "Denver", "Atlanta", "Boston", "Portland"], sample: "Austin, Texas"),
            AboutQuestion(id: "weekend", label: "Your perfect weekend", prompt: "{name}'s perfect weekend?",
                          decoys: ["Brunch and a nap", "Board games", "Beach day", "Museum crawl", "Farmers market"], sample: "Trail run, then brunch"),
            AboutQuestion(id: "coffee", label: "Your coffee order", prompt: "{name}'s coffee order?",
                          decoys: ["Oat latte", "Cold brew", "Drip, black", "Matcha", "Tea, actually"], sample: "Cortado"),
            AboutQuestion(id: "owl", label: "Morning person or night owl?", prompt: "Is {name} a morning person or a night owl?",
                          decoys: ["Night owl", "Morning person", "Afternoon napper", "Depends on coffee"], sample: "Morning person"),
            AboutQuestion(id: "superpower", label: "A superpower you'd pick", prompt: "Which superpower would {name} pick?",
                          decoys: ["Flying", "Invisibility", "Time travel", "Talking to dogs", "Super speed"], sample: "Teleporting"),
        ]),
        Template(id: "first-month", title: "My first month in SF", emoji: "🌁", questions: [
            AboutQuestion(id: "week1", label: "Week 1: the first thing you did", prompt: "Week 1: what did {name} do first?",
                          decoys: ["Climbed Twin Peaks", "Rode a cable car", "Got lost in the fog", "Joined a run club", "Bought a warm jacket"],
                          sample: "Walked the Embarcadero"),
            AboutQuestion(id: "home", label: "The neighborhood you moved into", prompt: "Which neighborhood did {name} move into?",
                          decoys: ["Mission", "Sunset", "Inner Richmond", "Nob Hill", "Marina", "Hayes Valley"], sample: "Noe Valley"),
            AboutQuestion(id: "meal", label: "Your first great meal here", prompt: "{name}'s first great SF meal?",
                          decoys: ["Dim sum", "Clam chowder", "A giant burrito", "Pho", "Sourdough toast"], sample: "Late-night dumplings"),
            AboutQuestion(id: "surprise", label: "What surprised you most", prompt: "What surprised {name} most?",
                          decoys: ["Cold summers", "The steep hills", "Wild parrots", "Tiny apartments", "Microclimates"], sample: "Fog in July"),
            AboutQuestion(id: "friend", label: "Where you made your first friend", prompt: "Where did {name} make a first friend?",
                          decoys: ["A climbing gym", "The dog park", "A run club", "At work", "A cooking class"], sample: "The New in SF picnic"),
            AboutQuestion(id: "week4", label: "Week 4: a moment you'll remember", prompt: "Week 4: {name}'s best moment?",
                          decoys: ["Sunset at Lands End", "A free concert", "Biking the bridge", "A picnic in the park"], sample: "Running up Bernal Hill"),
        ]),
        Template(id: "favorite-spot", title: "Guess my favorite spot", emoji: "📍", questions: [
            AboutQuestion(id: "hood", label: "The neighborhood it's in", prompt: "Which neighborhood is {name}'s favorite spot in?",
                          decoys: ["Mission", "Richmond", "North Beach", "Presidio", "Sunset", "Marina"], sample: "Bernal Heights"),
            AboutQuestion(id: "spot", label: "The spot itself", prompt: "What's {name}'s favorite spot?",
                          decoys: ["Lands End trail", "Dolores Park", "Ocean Beach", "Tank Hill", "Crissy Field"], sample: "The swing on Bernal Hill"),
            AboutQuestion(id: "when", label: "The best time to go", prompt: "When does {name} like to go?",
                          decoys: ["Sunrise", "Lunchtime", "After dark", "Rainy days"], sample: "Golden hour"),
            AboutQuestion(id: "with", label: "Who you bring", prompt: "Who does {name} bring along?",
                          decoys: ["Nobody, solo", "The dog", "Roommates", "Family visiting"], sample: "My running crew"),
            AboutQuestion(id: "why", label: "Why you love it", prompt: "Why does {name} love it?",
                          decoys: ["It's quiet", "The snacks nearby", "People-watching", "It's never foggy"], sample: "You can see the whole city"),
        ]),
    ]

    static func template(_ id: String) -> Template? {
        templates.first { $0.id == id }
    }

    /// The template's answered questions, in template order.
    static func orderedAnswers(_ answers: [String: String], template: Template?) -> [(AboutQuestion, String)] {
        guard let template else { return [] }
        return template.questions.compactMap { question in
            let answer = answers[question.id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return answer.isEmpty ? nil : (question, answer)
        }
    }

    /// Answer-key rounds about the subject: their answer is right, decoys come from the pool.
    /// Unanswered questions are skipped; the rounds keep the template's order.
    static func aboutMeRounds(template: Template, answers: [String: String], subject: String) -> [JSONValue] {
        orderedAnswers(answers, template: template).map { question, answer in
            answerRound(
                QuestionParts(question: question.prompt.replacingOccurrences(of: "{name}", with: subject), answer: answer, decoys: question.decoys),
                note: nil
            )
        }
    }

    // MARK: - Helpers

    /// The first quoted title in the prompt (“Picnic Trivia” or "Picnic Trivia").
    static func quotedTitle(in prompt: String) -> String? {
        for (open, close) in [("“", "”"), ("\"", "\"")] {
            guard let start = prompt.range(of: open) else { continue }
            guard let end = prompt.range(of: close, range: start.upperBound..<prompt.endIndex) else { continue }
            let title = prompt[start.upperBound..<end.lowerBound].trimmingCharacters(in: .whitespaces)
            if !title.isEmpty, title.count <= 40 { return title }
        }
        return nil
    }

    static func clip(_ text: String, _ limit: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > limit else { return trimmed }
        return String(trimmed.prefix(limit - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    static func unique(_ list: [String]) -> [String] {
        var seen = Set<String>()
        return list.filter { seen.insert($0).inserted }
    }

    private static func note(_ manifest: inout BubbleManifest, _ line: String) {
        manifest.brief.notes = [manifest.brief.notes, line].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// FNV-1a, so decoy picks and answer positions are the same on every device.
    static func stableHash(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100_0000_01b3
        }
        return hash
    }
}
