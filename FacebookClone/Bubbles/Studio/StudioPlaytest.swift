import Foundation

/// Bot playtests: every Bubble is played headless by bots of different skill before it ships
/// (docs/BUBBLES.md 4.6, "Simulation"). A good Bubble lasts 10–120 s with the bot, can be failed
/// and can score.
enum StudioPlaytest {
    struct Bot: Sendable, Hashable {
        var label: String
        /// 0...1, how well the bot plays (the runtime's `bot_skill`).
        var skill: Double
        /// Varies the bot's choices (`bot_seed`).
        var botSeed: Int
        /// Added to the manifest seed, to try another layout.
        var seedOffset: Int
    }

    /// A weak, a typical and a strong player, plus the typical player on two more seeds (one
    /// layout can be unlucky, so the typical player is the median of three runs).
    static let bots: [Bot] = [
        Bot(label: "new player", skill: 0.35, botSeed: 11, seedOffset: 0),
        Bot(label: "regular", skill: 0.7, botSeed: 23, seedOffset: 0),
        Bot(label: "pro", skill: 0.95, botSeed: 37, seedOffset: 0),
        Bot(label: "regular, seed 2", skill: 0.7, botSeed: 41, seedOffset: 7),
        Bot(label: "regular, seed 3", skill: 0.7, botSeed: 53, seedOffset: 13),
    ]

    static func isTypical(_ bot: Bot) -> Bool { bot.label.hasPrefix("regular") }

    /// Runs are cut off here; a Bubble that nobody finishes by then never ends.
    static let maxSeconds: Double = 150

    struct Run: Sendable {
        var bot: Bot
        var ok: Bool
        var error: String?
        /// "fail", "success", "timeout" or "error".
        var outcome: String
        var score: Int
        var seconds: Double
        var events: [String: Int]
    }

    struct Flag: Sendable, Hashable {
        var code: String
        var message: String
        /// Blocking flags go back to Muse for a repair; the rest are notes.
        var blocking: Bool
    }

    struct Report: Sendable {
        var runs: [Run]
        var flags: [Flag]

        var blocking: [Flag] { flags.filter(\.blocking) }
        var passed: Bool { blocking.isEmpty }

        /// The typical player's run: the median of the regular-skill runs.
        var typical: Run? {
            let regular = runs.filter { $0.ok && StudioPlaytest.isTypical($0.bot) }.sorted { $0.seconds < $1.seconds }
            if !regular.isEmpty { return regular[regular.count / 2] }
            return runs.first { $0.ok } ?? runs.first
        }

        var completedRuns: [Run] { runs.filter { $0.ok } }

        var scoreRange: ClosedRange<Int>? {
            let scores = completedRuns.map(\.score)
            guard let low = scores.min(), let high = scores.max() else { return nil }
            return low...high
        }

        var secondsRange: ClosedRange<Double>? {
            let seconds = completedRuns.map(\.seconds)
            guard let low = seconds.min(), let high = seconds.max() else { return nil }
            return low...high
        }

        var medianSeconds: Double {
            StudioPlaytest.median(completedRuns.map(\.seconds))
        }

        /// "the bot survived 34 s and scored 18"
        var headline: String {
            guard let run = typical else { return "the bots couldn't play it" }
            return StudioPlaytest.describe(run)
        }

        /// "4 bots scored 9–31 over 18–52 s · 3 popped, 1 cleared it"
        var spread: String {
            let done = completedRuns
            guard !done.isEmpty, let scores = scoreRange, let seconds = secondsRange else {
                return "No bot run finished"
            }
            let scoreText = scores.lowerBound == scores.upperBound ? "\(scores.lowerBound)" : "\(scores.lowerBound)–\(scores.upperBound)"
            let lowSeconds = Int(seconds.lowerBound.rounded())
            let highSeconds = Int(seconds.upperBound.rounded())
            let secondsText = lowSeconds == highSeconds ? "\(lowSeconds) s" : "\(lowSeconds)–\(highSeconds) s"
            var parts = ["\(done.count) bots scored \(scoreText) over \(secondsText)"]
            let fails = done.filter { $0.outcome == "fail" }.count
            let wins = done.filter { $0.outcome == "success" }.count
            let timeouts = done.filter { $0.outcome == "timeout" }.count
            var outcomes: [String] = []
            if fails > 0 { outcomes.append("\(fails) lost") }
            if wins > 0 { outcomes.append("\(wins) cleared it") }
            if timeouts > 0 { outcomes.append("\(timeouts) still going at \(Int(StudioPlaytest.maxSeconds)) s") }
            if !outcomes.isEmpty { parts.append(outcomes.joined(separator: ", ")) }
            return parts.joined(separator: " · ")
        }

        /// What the playtest tool returns to Muse.
        func json(comparison: Comparison? = nil) -> JSONValue {
            var out: [String: JSONValue] = [
                "passed": .bool(passed),
                "summary": .string("\(headline). \(spread)."),
                "runs": .array(runs.map { run in
                    var item: [String: JSONValue] = [
                        "bot": .string(run.bot.label),
                        "skill": .number(run.bot.skill),
                        "outcome": .string(run.outcome),
                        "score": .number(Double(run.score)),
                        "seconds": .number((run.seconds * 10).rounded() / 10),
                    ]
                    if let error = run.error { item["error"] = .string(error) }
                    return .object(item)
                }),
                "flags": .array(flags.map { flag in
                    ["code": .string(flag.code), "message": .string(flag.message), "blocking": .bool(flag.blocking)]
                }),
            ]
            if let comparison {
                out["compared_with_base"] = .string(comparison.line)
            }
            return .object(out)
        }
    }

    /// How a new version or level plays next to its base.
    struct Comparison: Sendable {
        /// nil when the runs can't be compared.
        var harder: Bool?
        var easier: Bool?
        var line: String
    }

    // MARK: - Analysis

    static func analyze(_ runs: [Run]) -> Report {
        var flags: [Flag] = []
        let done = runs.filter { $0.ok }

        if let broken = runs.first(where: { !$0.ok }) {
            flags.append(Flag(code: "runtime_error",
                              message: "The game crashed in a bot run: \(broken.error ?? "unknown error"). Check glue functions and params.",
                              blocking: true))
        }
        guard !done.isEmpty else {
            return Report(runs: runs, flags: flags)
        }

        let median = median(done.map(\.seconds))
        let maxScore = done.map(\.score).max() ?? 0
        let minScore = done.map(\.score).min() ?? 0
        let timeouts = done.filter { $0.outcome == "timeout" }
        let fails = done.filter { $0.outcome == "fail" }
        let weak = done.first { $0.bot.label == "new player" }
        let regulars = done.filter { isTypical($0.bot) }.sorted { $0.seconds < $1.seconds }
        let regular = regulars.isEmpty ? nil : regulars[regulars.count / 2]
        let pro = done.first { $0.bot.label == "pro" }

        if timeouts.count == done.count {
            flags.append(Flag(code: "never_ends",
                              message: "Never ends: no bot run ended within \(Int(maxSeconds)) s. Make the challenge ramp up (or add a clear finish) so a run can be failed.",
                              blocking: true))
        } else if median < 10, median >= 6, fails.isEmpty, timeouts.isEmpty {
            // Every bot solved it: bots read and answer far faster than people, so a puzzle they
            // clear in 6–10 s plays well past 10 s for a person.
            flags.append(Flag(code: "short",
                              message: "Short: bots clear it in about \(Int(median.rounded())) s; people take longer.",
                              blocking: false))
        } else if median < 10 {
            let lasted = Int(median.rounded())
            let isFail = fails.count * 2 >= done.count
            flags.append(Flag(code: "too_short",
                              message: isFail
                                ? "Too short and too hard: runs end after about \(lasted) s. A good game lasts 10–120 s; ease the start (slower speed, wider gaps, gentler gravity, more tries)."
                                : "Too short: runs are over in about \(lasted) s. A good game lasts 10–120 s; add rounds, items or tries.",
                              blocking: true))
        }

        if maxScore <= 0 {
            flags.append(Flag(code: "no_score",
                              message: "Nobody scored: every bot finished with 0 points. Check the score concept and that the content gives points.",
                              blocking: true))
        }

        if let pro, pro.outcome == "fail", pro.seconds < 8, median >= 10 {
            flags.append(Flag(code: "too_hard",
                              message: "Too hard: even the strongest bot lost after \(Int(pro.seconds.rounded())) s.",
                              blocking: true))
        } else if let regular, regular.outcome == "fail", regular.seconds < 10, median >= 10 {
            flags.append(Flag(code: "too_hard",
                              message: "Too hard: a typical player pops after \(Int(regular.seconds.rounded())) s. Ease the first seconds.",
                              blocking: true))
        }

        if let weak, weak.outcome != "fail", timeouts.count != done.count, fails.isEmpty, done.count > 2, minScore == maxScore {
            flags.append(Flag(code: "no_challenge",
                              message: "Even the weakest bot got the top score without failing; skill doesn't show yet.",
                              blocking: false))
        } else if done.count > 2, minScore == maxScore, maxScore > 0 {
            flags.append(Flag(code: "flat",
                              message: "Skill doesn't change the score (every bot scored \(maxScore)). Consider a twist that rewards good play.",
                              blocking: false))
        }

        let typicalTimedOut = regular?.outcome == "timeout" && regulars.filter { $0.outcome == "timeout" }.count * 2 > regulars.count
        if timeouts.count != done.count, typicalTimedOut || timeouts.count * 2 >= done.count {
            flags.append(Flag(code: "too_easy",
                              message: "Too easy: a typical player is still going after \(Int(maxSeconds)) s (\(timeouts.count) of \(done.count) bots never failed). Make it ramp up (faster pace, tighter gaps, a timer) so runs end in 10–120 s.",
                              blocking: true))
        } else if !timeouts.isEmpty && timeouts.count != done.count {
            let who = StudioCopy.list(timeouts.map(\.bot.label))
            flags.append(Flag(code: "long",
                              message: "Long for strong players: the \(who) bot was still going after \(Int(maxSeconds)) s.",
                              blocking: false))
        } else if median > 120 {
            flags.append(Flag(code: "long", message: "Long: runs take about \(Int(median.rounded())) s.", blocking: false))
        }

        return Report(runs: runs, flags: flags)
    }

    /// Compares runs bot by bot. Games that end when you fail (or time out) compare survival
    /// time, counting a timeout as the full run; games you clear compare score.
    static func compare(_ new: Report, to base: Report, baseLabel: String) -> Comparison {
        let pairs: [(Run, Run)] = new.runs.compactMap { run in
            guard run.ok, let other = base.runs.first(where: { $0.bot == run.bot && $0.ok }) else { return nil }
            return (run, other)
        }
        guard !pairs.isEmpty else {
            return Comparison(harder: nil, easier: nil, line: "Couldn't compare with \(baseLabel)")
        }
        let all = pairs.flatMap { [$0.0, $0.1] }
        let survivalGame = all.filter { $0.outcome == "fail" || $0.outcome == "timeout" }.count * 2 >= all.count
        func metric(_ run: Run) -> Double { survivalGame ? min(run.seconds, maxSeconds) : Double(run.score) }

        // Three signals, each bot paired with itself on the base: per-bot votes, the typical
        // player, and the average over every bot (steadier when single runs are noisy).
        var harder = 0
        var easier = 0
        for (a, b) in pairs {
            let (x, y) = (metric(a), metric(b))
            guard y > 0 else { continue }
            if x < y * 0.92 { harder += 1 } else if x > y * 1.08 { easier += 1 }
        }
        let typicalNew = new.typical ?? pairs[0].0
        let typicalBase = base.typical ?? pairs[0].1
        let (tn, tb) = (metric(typicalNew), metric(typicalBase))
        let typicalHarder = tb > 0 && tn < tb * 0.92
        let typicalEasier = tb > 0 && tn > tb * 1.08
        let averageNew = pairs.map { metric($0.0) }.reduce(0, +) / Double(pairs.count)
        let averageBase = pairs.map { metric($0.1) }.reduce(0, +) / Double(pairs.count)
        let averageHarder = averageBase > 0 && averageNew < averageBase * 0.92
        let averageEasier = averageBase > 0 && averageNew > averageBase * 1.08
        let score = (harder - easier).signum() + (typicalHarder ? 1 : typicalEasier ? -1 : 0) + (averageHarder ? 1 : averageEasier ? -1 : 0)

        let detail: String
        if typicalHarder || typicalEasier || !(averageHarder || averageEasier) {
            detail = survivalGame
                ? "the bot survives \(Int(typicalNew.seconds.rounded())) s vs \(Int(typicalBase.seconds.rounded())) s"
                : "the bot scores \(typicalNew.score) vs \(typicalBase.score)"
        } else {
            detail = survivalGame
                ? "bots last \(Int(averageNew.rounded())) s on average vs \(Int(averageBase.rounded())) s"
                : "bots average \(Int(averageNew.rounded())) points vs \(Int(averageBase.rounded()))"
        }
        if score > 0, !typicalEasier {
            return Comparison(harder: true, easier: false, line: "Harder than \(baseLabel): \(detail) (\(harder) of \(pairs.count) bots do worse)")
        }
        if score < 0, !typicalHarder {
            return Comparison(harder: false, easier: true, line: "Easier than \(baseLabel): \(detail) (\(easier) of \(pairs.count) bots do better)")
        }
        return Comparison(harder: false, easier: false, line: "Plays about the same as \(baseLabel): \(detail)")
    }

    /// "the bot survived 34 s and scored 18"
    static func describe(_ run: Run) -> String {
        let seconds = Int(run.seconds.rounded())
        switch run.outcome {
        case "fail":
            return "the bot survived \(seconds) s and scored \(run.score)"
        case "success":
            return "the bot cleared it in \(seconds) s and scored \(run.score)"
        case "timeout":
            return "the bot was still going after \(seconds) s with \(run.score) points"
        default:
            return "the bot run failed (\(run.error ?? "runtime error"))"
        }
    }

    static func median(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
    }
}
