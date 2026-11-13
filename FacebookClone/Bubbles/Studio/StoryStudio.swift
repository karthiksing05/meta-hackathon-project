import Foundation

/// Muse Studio support for the `story` formula: Adventures, stories you play (docs/BUBBLES.md 7.6).
/// Owner: the "story" feature. Teaches Muse to plan a branching graph before it writes, gives the
/// offline composer a deterministic 7-scene, 3-ending adventure built from the prompt or from the
/// creator's own story, and makes the playtest prove every ending can be reached.
/// Foundation only (the CLI compiles this file).
enum StoryStudio {
    static let hint = StudioFormulaHint(
        formula: "story",
        keywords: ["adventure", "choose your own", "choose your path", "story", "branching", "quest", "what would you do", "my first week", "my story"],
        nouns: ["Path", "Tale", "Adventure"],
        looks: ["paper", "ink", "riso"],
        composerGuide: composerGuide,
        offlineContent: { manifest, request, _ in offlineContent(&manifest, request: request) },
        playtestFlags: { manifest, runs in playtestFlags(manifest, runs: runs) },
        relaxedFlags: ["no_challenge", "flat"]
    )

    static let composerGuide = """
    Plan the graph before you write a word. Sketch 6–12 scenes and 3–4 endings: one of them a \
    secret ending whose choice `need`s a flag that a bold choice earlier `set`s. Keep the longest \
    path at 10 choices or fewer, give every scene that isn't an ending 1–3 choices, never loop back, \
    and make sure every scene can be reached from `start`. Then write each scene in the second \
    person, present tense, in 160 characters or fewer: warm, specific, original, set in the \
    synthetic New in SF world (fog, hills, ferries, cable cars, the Group's picnic). Choice text is \
    28 characters or fewer and starts with a verb; give every choice `past`, the same choice in the \
    past tense ("took the ferry"), because friends see "Maya took the ferry". Add at most two skill \
    moments ({kind: "timing", window: 0.22–0.32, miss: <a scene>}) on bold choices; a miss leads \
    somewhere fun, never a punishment. Endings get {id, title, emoji, tone: good|odd|secret}. Use \
    space.story_page, input.select, rule.story_paths and score.story_points.
    """

    /// Extra composer prompt lines: the creator's own story, to turn into an adventure about them.
    static func promptLines(_ request: StudioRequest) -> [String] {
        guard let story = request.social?.personalStory?.trimmingCharacters(in: .whitespacesAndNewlines), !story.isEmpty else {
            return []
        }
        return [
            "Their own story (use the story formula, category Adventure): \"\(String(story.prefix(1200)))\"",
            "Turn this into an adventure about the person who wrote it; keep real details they gave, invent nothing private.",
        ]
    }

    // MARK: - Offline adventure

    /// Fills `content` with a 7-scene, 3-ending adventure built from the request's own story (or
    /// prompt), deterministically. Always valid: start → two paths, one timing moment, a secret
    /// ending gated by the flag the timing moment sets.
    static func offlineContent(_ manifest: inout BubbleManifest, request: StudioRequest) -> String? {
        guard manifest.formula == .story else { return nil }
        let own = request.social?.personalStory?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // Without an own story, the prompt's first sentence is the ask ("an adventure about…");
        // any sentences after it are story beats.
        let source = own.isEmpty ? Self.dropFirstSentence(request.prompt) : own
        let subject = Self.subject(of: request.prompt)
        let beats = Self.beats(from: source, subject: subject)
        let key = Self.hash(source)
        let pairs = Self.choicePairs.rotated(by: Int(key % UInt64(Self.choicePairs.count)))
        let emojis = Self.sceneEmojis.rotated(by: Int((key / 7) % UInt64(Self.sceneEmojis.count)))

        func choice(_ id: String, _ pair: (String, String), to: String, set: [String] = [], need: [String] = [], skill: (Double, String)? = nil) -> JSONValue {
            var out: [String: JSONValue] = ["id": .string(id), "text": .string(pair.0), "past": .string(pair.1), "to": .string(to)]
            if !set.isEmpty { out["set"] = .array(set.map(JSONValue.string)) }
            if !need.isEmpty { out["need"] = .array(need.map(JSONValue.string)) }
            if let skill { out["skill"] = .object(["kind": "timing", "window": .number(skill.0), "miss": .string(skill.1)]) }
            return .object(out)
        }
        func scene(_ index: Int, _ choices: [JSONValue]) -> JSONValue {
            .object(["id": .string("s\(index + 1)"), "emoji": .string(emojis[index % emojis.count]), "text": .string(beats[index]), "choices": .array(choices)])
        }
        func ending(_ id: String, _ title: String, _ emoji: String, _ tone: String, _ text: String) -> JSONValue {
            .object(["id": .string("e-\(id)"), "emoji": .string(emoji), "text": .string(text),
                     "ending": .object(["id": .string(id), "title": .string(title), "emoji": .string(emoji), "tone": .string(tone)])])
        }
        let p = pairs
        let scenes: [JSONValue] = [
            scene(0, [choice("a", p[0].a, to: "s2"), choice("b", p[0].b, to: "s3")]),
            scene(1, [choice("bold", p[1].a, to: "s5", set: ["brave"], skill: (0.3, "s4")), choice("steady", p[1].b, to: "s4")]),
            scene(2, [choice("left", p[2].a, to: "s4"), choice("right", p[2].b, to: "s6")]),
            scene(3, [choice("on", p[3].a, to: "s6"), choice("home", p[3].b, to: "e-good")]),
            scene(4, [choice("up", p[4].a, to: "s7"), choice("rest", p[4].b, to: "e-good")]),
            scene(5, [choice("wander", p[5].a, to: "e-odd"), choice("onward", p[5].b, to: "s7")]),
            scene(6, [choice("settle", p[6].a, to: "e-good"), choice("secret", ("Follow the hunch", "followed a hunch"), to: "e-secret", need: ["brave"])]),
            ending("good", "A Week to Remember", "🌇", "good", "It all lands at once: the city feels a little more like yours, and your phone keeps buzzing with new friends."),
            ending("odd", "The Long Way Round", "🌀", "odd", "You end up somewhere no map mentions. It's strange, it's lovely, and it makes the best story you tell all month."),
            ending("secret", "Found Your People", "✨", "secret", "The hunch pays off: a table of people who feel like old friends already. Same time next week, they say."),
        ]
        manifest.content = .object(["start": "s1", "scenes": .array(scenes)])
        manifest.oneLineRule = own.isEmpty ? "Pick your path through \(subject)." : "Pick your path through a true story from New in SF."
        if let title = Self.title(from: subject) { manifest.title = title }
        if manifest.style.emoji == "🥖" { manifest.style.emoji = "🧭" }
        return own.isEmpty ? "Wrote 7 scenes and 3 endings from your idea" : "Wrote 7 scenes and 3 endings from your story"
    }

    /// Seven second-person beats from the text: its sentences first, then gentle filler built
    /// around the subject.
    static func beats(from text: String, subject: String) -> [String] {
        let sentences = text
            .replacingOccurrences(of: "\n", with: ". ")
            .split(whereSeparator: { ".!?".contains($0) })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.count >= 8 }
            .map { secondPerson(String($0)) }
        let filler = [
            "It's \(subject), and the city is still new. The fog is lifting and your phone buzzes: something is happening today.",
            "A neighbor waves you over. Somewhere down the hill, music starts. You could follow it, or keep to your plan.",
            "The cable car bell clangs. A stranger holds the door and asks if you're new here. You say yes, and smile.",
            "You take a wrong turn and find a tiny bakery that smells like heaven. The line is long, but it moves.",
            "Up on the hill the whole city spreads out below you. The bay sparkles. Someone nearby is taking a group photo.",
            "Your Group chat lights up: the crew is meeting at the park. You're halfway there already, if you hurry.",
            "As the light turns gold, you notice a small door with a hand-painted sign: NEWCOMERS WELCOME. It's ajar.",
        ]
        var out: [String] = []
        for index in 0..<7 {
            let beat = index < sentences.count ? sentences[index] : filler[index]
            out.append(clip(beat, to: 160))
        }
        return out
    }

    /// "I moved here on Monday" → "You moved here on Monday".
    static func secondPerson(_ sentence: String) -> String {
        let swaps: [String: String] = [
            "i": "you", "i'm": "you're", "i've": "you've", "i'd": "you'd", "i'll": "you'll", "me": "you",
            "my": "your", "mine": "yours", "myself": "yourself", "we": "you", "us": "you", "our": "your", "am": "are", "was": "were",
        ]
        var words = sentence.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        for index in words.indices {
            let raw = words[index]
            let core = raw.trimmingCharacters(in: .punctuationCharacters).lowercased()
            guard let swap = swaps[core] else { continue }
            // "was" only follows I/we; keep "it was".
            if core == "was" || core == "am" {
                guard index > 0, ["you"].contains(words[index - 1].lowercased()) else { continue }
            }
            words[index] = raw.lowercased().replacingOccurrences(of: core, with: swap)
        }
        var out = words.joined(separator: " ")
        if let first = out.first { out = first.uppercased() + out.dropFirst() }
        if let last = out.last, !".!?\"".contains(last) { out += "." }
        return out
    }

    static func dropFirstSentence(_ text: String) -> String {
        guard let end = text.firstIndex(where: { ".!?\n".contains($0) }) else { return "" }
        return String(text[text.index(after: end)...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "your first week in SF" → "My First Week in SF"; nil for the generic subject.
    static func title(from subject: String) -> String? {
        guard subject != "your first week in the city" else { return nil }
        let small: Set<String> = ["a", "an", "the", "in", "on", "of", "at", "to", "and", "for", "with"]
        let words = subject.split(separator: " ").enumerated().map { index, word -> String in
            var w = String(word)
            if w.lowercased() == "your" { w = "my" }
            if w == w.uppercased() && w.count > 1 { return w }
            if index > 0 && small.contains(w.lowercased()) { return w.lowercased() }
            return w.prefix(1).uppercased() + w.dropFirst()
        }
        let out = words.joined(separator: " ")
        return out.count >= 4 && out.count <= 40 ? out : nil
    }

    static func clip(_ text: String, to limit: Int) -> String {
        guard text.count > limit else { return text }
        let cut = text.prefix(limit - 1)
        let trimmed = cut.lastIndex(of: " ").map { String(cut[..<$0]) } ?? String(cut)
        return trimmed + "…"
    }

    /// "an adventure about my first week" → "your first week".
    static func subject(of prompt: String) -> String {
        let ask = prompt.split(whereSeparator: { ".!?\n".contains($0) }).first.map(String.init) ?? prompt
        for marker in ["about ", "of "] {
            if let range = ask.range(of: marker, options: .caseInsensitive) {
                let rest = secondPerson(String(ask[range.upperBound...])).trimmingCharacters(in: CharacterSet(charactersIn: ". "))
                if rest.count >= 4 { return clip(rest.prefix(1).lowercased() + rest.dropFirst(), to: 40) }
            }
        }
        return "your first week in the city"
    }

    static let choicePairs: [(a: (String, String), b: (String, String))] = [
        (("Say yes", "said yes"), ("Play it safe", "played it safe")),
        (("Go for it", "went for it"), ("Wait and see", "waited to see")),
        (("Ask a neighbor", "asked a neighbor"), ("Figure it out", "figured it out alone")),
        (("Take the bus", "took the bus"), ("Walk it", "walked it")),
        (("Text the crew", "texted the crew"), ("Explore solo", "explored solo")),
        (("Follow the music", "followed the music"), ("Head home", "headed home")),
        (("Stay a while", "stayed a while"), ("Keep moving", "kept moving")),
    ]
    static let sceneEmojis = ["🌁", "🚋", "☕", "🗺️", "🎶", "⛰️", "🔑"]

    static func hash(_ text: String) -> UInt64 {
        var h: UInt64 = 1469598103934665603
        for byte in text.utf8 { h = (h ^ UInt64(byte)) &* 1099511628211 }
        return h
    }

    // MARK: - Playtest

    /// "ending_unreachable" (blocking) when the bots found fewer endings than the story has AND a
    /// static walk (flags respected) can't reach them either. Bots that simply didn't wander far
    /// enough get a note instead.
    static func playtestFlags(_ manifest: BubbleManifest, runs: [StudioPlaytest.Run]) -> [StudioPlaytest.Flag] {
        guard manifest.formula == .story else { return [] }
        let graph = StoryGraphCheck(content: manifest.content)
        let total = graph.endingIDs.count
        guard total > 0 else { return [] }
        var found = Set<Int>()
        for run in runs where run.ok {
            for (name, count) in run.events where count > 0 && name.hasPrefix("story.reached_") {
                if let number = Int(name.dropFirst("story.reached_".count)) { found.insert(number) }
            }
        }
        guard found.count < total else { return [] }
        let unreachable = graph.unreachableEndings()
        if !unreachable.isEmpty {
            return [StudioPlaytest.Flag(
                code: "ending_unreachable",
                message: "No path reaches \(unreachable.joined(separator: ", ")) with flags respected (a choice needs a flag nothing sets before it). Fix the set/need flags or the choices that lead there.",
                blocking: true
            )]
        }
        return [StudioPlaytest.Flag(
            code: "endings_rare",
            message: "Bots found \(found.count) of \(total) endings; the rest are reachable but rare paths. That's fine for a secret ending.",
            blocking: false
        )]
    }
}

/// A static walk over a story's scenes (a port of the kit's validator reachability check): which
/// endings a player can reach when flags are respected (a flag must be set before a choice needs it).
struct StoryGraphCheck {
    struct Choice {
        var to: String
        var miss: String?
        var set: [String]
        var need: [String]
    }

    var start: String
    var choices: [String: [Choice]] = [:]
    /// Ending scene id → ending id, in content order.
    var endingIDs: [(scene: String, id: String)] = []

    init(content: JSONValue) {
        start = content["start"]?.string ?? ""
        for scene in content["scenes"]?.array ?? [] {
            guard let id = scene["id"]?.string else { continue }
            if let ending = scene["ending"], ending.object != nil {
                endingIDs.append((id, ending["id"]?.string ?? id))
                continue
            }
            choices[id] = (scene["choices"]?.array ?? []).compactMap { choice in
                guard let to = choice["to"]?.string else { return nil }
                return Choice(to: to, miss: choice["skill"]?["miss"]?.string, set: choice["set"]?.strings ?? [], need: choice["need"]?.strings ?? [])
            }
        }
    }

    /// Ending ids no path reaches.
    func unreachableEndings() -> [String] {
        var reached = Set<String>()
        var seen = Set<String>()
        var queue: [(String, Set<String>)] = [(start, [])]
        var head = 0
        while head < queue.count, head < 6000 {
            let (scene, flags) = queue[head]
            head += 1
            if endingIDs.contains(where: { $0.scene == scene }) {
                reached.insert(scene)
                continue
            }
            for choice in choices[scene] ?? [] where Set(choice.need).isSubset(of: flags) {
                var next = [(choice.to, flags.union(choice.set))]
                if let miss = choice.miss { next.append((miss, flags)) }
                for (target, targetFlags) in next {
                    let key = target + "|" + targetFlags.sorted().joined(separator: ",")
                    if seen.insert(key).inserted { queue.append((target, targetFlags)) }
                }
            }
        }
        return endingIDs.filter { !reached.contains($0.scene) }.map(\.id)
    }
}

private extension Array {
    func rotated(by offset: Int) -> [Element] {
        guard !isEmpty else { return self }
        let k = ((offset % count) + count) % count
        return Array(self[k...] + self[..<k])
    }
}
