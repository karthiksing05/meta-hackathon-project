import Foundation

/// Muse Studio support for the `learn` formula: lessons you learn together (docs/BUBBLES.md 7.8).
/// Owner: the "learn" feature. Teaches Muse to turn a topic or pasted notes into a lesson game
/// (accurate, checkable facts and one-sentence explanations), gives Studio an offline lesson
/// builder, and sets the playtest policy (practice shouldn't feel punishing).
/// Foundation only (the CLI compiles this file).
enum LearnStudio {
    static let hint = StudioFormulaHint(
        formula: "learn",
        keywords: ["learn", "lesson", "teach", "study", "quiz me", "flashcards", "flashcard", "practice", "notes", "language", "phrases", "history of", "vocabulary", "101"],
        nouns: ["101", "Lesson", "Basics"],
        looks: ["chalk", "paper", "riso"],
        composerGuide: composerGuide,
        offlineContent: { manifest, request, _ in offlineContent(&manifest, request: request) },
        playtestFlags: { manifest, _ in playtestFlags(manifest) },
        relaxedFlags: ["no_challenge"]
    )

    /// The composer's notes for lessons (appended under "Formula notes").
    static let composerGuide = """
    Use learn when someone wants to learn, teach, study or practice something ("teach my Group the hills", "quiz me on \
    Spanish greetings", pasted notes). Write content as {topic, subject, lesson: {title, points}, questions}.
    - Accuracy first: every fact must be accurate, widely known and checkable. Prefer conservative facts over surprising \
    ones. Skip numbers, dates and records you are not certain of.
    - lesson.points: 2–4 short points (90 characters max), and the questions must actually practice them. Set each \
    question's `point` to the index of the point it practices.
    - questions: 6–10, each {q (90 max), choices (2–4, 40 max each, all different and plausible), answer (index of the \
    right choice; vary its position), explain}. explain is one short sentence (120 max) that teaches why, not just "the \
    answer is X".
    - topic names the lesson ("SF hills"); subject is a short noun phrase for the Group meter ("the hills": "New in SF \
    knows 82% of the hills").
    - No medical, legal or financial advice. No real people or celebrities. A theme, franchise or brand the person asks \
    for is welcome; never add one they didn't ask for.
    - When the request includes notes, use only facts from those notes.
    - Keep the default length (rounds, one per question); use space.lesson_desk, input.select, rule.lesson_practice and \
    score.mastery. Chalk, paper and riso looks suit lessons.
    """

    /// Extra composer prompt lines: pasted notes, with "use only facts from these notes".
    static func promptLines(_ request: StudioRequest) -> [String] {
        guard let notes = request.social?.lessonNotes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty else {
            return []
        }
        let clipped = notes.count > 4000 ? String(notes.prefix(4000)) + "…" : notes
        return [
            "Lesson notes (make a learn game from these; use only facts from these notes, and keep each explanation close to what the notes say):",
            "\"\"\"",
            clipped,
            "\"\"\"",
        ]
    }

    // MARK: - Playtest policy

    /// A non-blocking note when the lesson has fewer than 5 questions.
    static func playtestFlags(_ manifest: BubbleManifest) -> [StudioPlaytest.Flag] {
        let count = manifest.content["questions"]?.array?.count ?? 0
        guard count < 5 else { return [] }
        return [StudioPlaytest.Flag(
            code: "lesson_short",
            message: "Short lesson: \(count) question\(count == 1 ? "" : "s"). 6–10 practice it better.",
            blocking: false
        )]
    }

    // MARK: - Offline lessons

    /// Fills `manifest.content` from the pasted notes (or note-like prompt) without Muse. Returns
    /// the timeline line, or nil (and leaves the content alone) when there are no usable notes:
    /// there is no built-in lesson to stand in.
    static func offlineContent(_ manifest: inout BubbleManifest, request: StudioRequest) -> String? {
        let notes = request.social?.lessonNotes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let source = !notes.isEmpty ? notes : (looksLikeNotes(request.prompt) ? request.prompt : "")
        if !source.isEmpty, let lesson = lesson(fromNotes: source, title: manifest.title) {
            manifest.content = lesson.content
            return "Wrote \(lesson.questions) practice questions from your notes"
        }
        return nil
    }

    /// Two or more sentences and enough words to quiz on.
    static func looksLikeNotes(_ text: String) -> Bool {
        sentences(in: text).count >= 3 && text.count >= 120
    }

    struct OfflineLesson {
        var content: JSONValue
        var questions: Int
    }

    /// Deterministic cloze questions from notes: each sentence becomes "fill the blank" on its
    /// key word, with key words from other sentences as the other choices, and the sentence itself
    /// as the explanation. Nil when the notes give fewer than 2 questions.
    static func lesson(fromNotes text: String, title: String) -> OfflineLesson? {
        let all = sentences(in: text).filter { $0.split(separator: " ").count >= 5 }
        let usable = Array(all.prefix(10))
        let keyed: [(sentence: String, key: String)] = usable.compactMap { sentence in
            keyWord(in: sentence).map { (sentence, $0) }
        }
        guard keyed.count >= 2 else { return nil }
        let keys = StudioManifestBuilder.unique(keyed.map(\.key))
        guard keys.count >= 2 else { return nil }

        let points = keyed.prefix(4).map { clip($0.sentence, 90) }
        var questions: [JSONValue] = []
        for (index, item) in keyed.enumerated() {
            let blanked = blank(item.key, in: item.sentence)
            guard blanked.count <= 90 else { continue }
            var others = keys.filter { $0.caseInsensitiveCompare(item.key) != .orderedSame }
            let rotate = others.isEmpty ? 0 : (index * 7 + 3) % others.count
            others = Array(others[rotate...] + others[..<rotate])
            let distractors = Array(others.prefix(2))
            guard !distractors.isEmpty else { continue }
            var choices = distractors.map { clip($0, 40) }
            let answer = index % (choices.count + 1)
            choices.insert(clip(item.key, 40), at: answer)
            var question: [String: JSONValue] = [
                "q": .string(blanked),
                "choices": .array(choices.map { .string($0) }),
                "answer": .number(Double(answer)),
                "explain": .string(clip("From your notes: " + item.sentence, 120)),
            ]
            if index < points.count {
                question["point"] = .number(Double(index))
            }
            questions.append(.object(question))
        }
        guard questions.count >= 2 else { return nil }
        let topic = clip(title, 40)
        let content: JSONValue = .object([
            "topic": .string(topic),
            "subject": .string(clip("the " + topic.lowercased(), 32)),
            "lesson": .object([
                "title": .string(clip(title, 48)),
                "points": .array(points.map { .string($0) }),
            ]),
            "questions": .array(questions),
        ])
        return OfflineLesson(content: content, questions: questions.count)
    }

    // MARK: Text helpers

    static func sentences(in text: String) -> [String] {
        var out: [String] = []
        var current = ""
        for char in text {
            if char == "." || char == "!" || char == "?" || char == "\n" || char == ";" {
                if char != "\n" && char != ";" { current.append(char) }
                let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "-•*")))
                if !trimmed.isEmpty { out.append(trimmed) }
                current = ""
            } else {
                current.append(char)
            }
        }
        let tail = current.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "-•*")))
        if !tail.isEmpty { out.append(tail) }
        return out
    }

    private static let stopwords: Set<String> = [
        "about", "after", "also", "because", "been", "before", "being", "could", "does", "each", "from", "have", "into",
        "just", "like", "many", "more", "most", "much", "only", "other", "over", "same", "some", "such", "than", "that",
        "their", "them", "then", "there", "these", "they", "this", "those", "through", "very", "were", "what", "when",
        "where", "which", "while", "with", "would", "your", "means", "called", "known",
    ]

    /// The word a cloze question blanks out: a capitalized word that isn't the first word (a
    /// name or place), else the longest word that isn't a stopword.
    static func keyWord(in sentence: String) -> String? {
        let words = sentence.split(separator: " ").map { $0.trimmingCharacters(in: .punctuationCharacters) }
        let candidates = words.enumerated().filter { _, w in w.count >= 4 && !stopwords.contains(w.lowercased()) }
        if let proper = candidates.first(where: { index, w in index > 0 && w.first?.isUppercase == true }) {
            return proper.element
        }
        return candidates.max { a, b in a.element.count == b.element.count ? a.offset > b.offset : a.element.count < b.element.count }?.element
    }

    static func blank(_ key: String, in sentence: String) -> String {
        guard let range = sentence.range(of: key) else { return sentence }
        var out = sentence
        out.replaceSubrange(range, with: "___")
        return out
    }

    static func clip(_ text: String, _ limit: Int) -> String {
        text.count <= limit ? text : String(text.prefix(limit - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }
}
