import SwiftUI

/// The Plan step's state: Muse plans the game on the server (`HarnessPlanClient`), the person reads
/// the plan, answers up to 2 questions, changes a part in words if they like, and builds.
///
/// What it sends forward is a `StudioPlanHandoff`: `{request, spec, answers}`. The build will pass
/// those on once `POST /v1/generate` accepts `spec` and `answers` (asked of Max). Until then the
/// answers and changes are folded into the request text (`foldedRequest`), which today's
/// `/v1/generate` already reads, and the server re-plans from that text.
@MainActor
@Observable
final class StudioPlanModel {
    enum Phase: Equatable {
        case idle
        case planning(started: Date)
        case ready
        case failed(String)
        /// Planning is off on this server: the Brief step shows instead.
        case unavailable
    }

    private(set) var phase: Phase = .idle
    private(set) var plan: GamePlan?
    /// The person's words this plan was made from (with any changes folded in).
    private(set) var request = ""
    /// What they typed first.
    private(set) var original = ""
    /// "Change something" requests, in order.
    private(set) var changes: [String] = []
    /// Chosen answers, by slot.
    var answers: [String: String] = [:]
    /// The person chose the full Brief ("More options").
    var showsBrief = false

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private let client: HarnessPlanClient

    init(client: HarnessPlanClient = .shared) {
        self.client = client
    }

    /// Plans `text` unless this model already has (or is making) a plan for it.
    func start(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if trimmed == original, phase != .idle, !isFailed { return }
        original = trimmed
        changes = []
        answers = [:]
        run(trimmed)
    }

    func retry() {
        run(request.isEmpty ? original : request)
    }

    /// "Change something": re-plan with the change in words.
    func change(_ text: String) {
        let change = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !change.isEmpty else { return }
        changes.append(change)
        // Answers so far are part of what the new plan should keep.
        run(Self.fold(original, answers: answerList, changes: changes))
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    #if DEBUG
    /// Previews: show a plan without asking the server.
    func debugShow(_ plan: GamePlan, request: String) {
        original = request
        self.request = request
        self.plan = plan
        phase = .ready
    }
    #endif

    var isFailed: Bool {
        if case .failed = phase { return true }
        return false
    }

    private func run(_ text: String) {
        task?.cancel()
        request = text
        withAnimation(.easeInOut(duration: 0.25)) {
            phase = .planning(started: Date())
        }
        task = Task { [weak self, client] in
            do {
                let outcome = try await client.plan(request: text)
                guard let self, !Task.isCancelled else { return }
                withAnimation(.spring(response: 0.45, dampingFraction: 0.9)) {
                    switch outcome {
                    case .plan(let plan):
                        self.plan = plan
                        // Keep answers whose question is still asked.
                        let asked = Set(plan.questions.map(\.slot))
                        self.answers = self.answers.filter { asked.contains($0.key) }
                        self.phase = .ready
                    case .unavailable:
                        self.phase = .unavailable
                    }
                }
            } catch is CancellationError {
                return
            } catch {
                guard let self, !Task.isCancelled else { return }
                withAnimation { self.phase = .failed(Self.message(for: error)) }
            }
        }
    }

    // MARK: Hand-off

    struct Answer: Equatable, Sendable {
        var slot: String
        var question: String
        var value: String
    }

    var answerList: [Answer] {
        guard let plan else { return [] }
        return plan.questions.compactMap { q in
            guard let value = answers[q.slot]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
            return Answer(slot: q.slot, question: q.question, value: value)
        }
    }

    var handoff: StudioPlanHandoff {
        StudioPlanHandoff(request: original, spec: plan?.rawSpec, answers: answerList, changes: changes)
    }

    /// The request with the answers and changes in words, under the server's 2,000 characters.
    nonisolated static func fold(_ request: String, answers: [Answer], changes: [String]) -> String {
        var extra: [String] = []
        if !answers.isEmpty {
            extra.append("My answers: " + answers.map { "\($0.question) \($0.value)." }.joined(separator: " "))
        }
        if !changes.isEmpty {
            extra.append("Changes: " + changes.map { $0.hasSuffix(".") ? $0 : $0 + "." }.joined(separator: " "))
        }
        guard !extra.isEmpty else { return request }
        let tail = "\n\n" + extra.joined(separator: "\n")
        let room = max(0, HarnessPlanClient.maxRequestCharacters - 100 - tail.count)
        return String(request.prefix(room)) + tail
    }

    nonisolated static func message(for error: Error) -> String {
        switch error as? GamesAPIError {
        case .network?:
            return "Couldn't reach the game server. Check your connection and try again."
        case .signInRequired?:
            return "Couldn't sign in to the game server. Try again in a moment."
        default:
            return "Muse couldn't plan this one just now. Try again, or build it straight away."
        }
    }
}

/// What the Plan step sends to the build: `{request, spec, answers}` (plus changes in words).
///
/// TODO(build): pass `spec` and `answers` to `POST /v1/generate` once it accepts them (asked of
/// Max). Until then `foldedRequest` carries the answers and changes as text.
struct StudioPlanHandoff: Equatable, Sendable {
    var request: String
    var spec: JSONValue?
    var answers: [StudioPlanModel.Answer]
    var changes: [String]

    var foldedRequest: String {
        StudioPlanModel.fold(request, answers: answers, changes: changes)
    }

    /// The body `/v1/generate` will take: `{request, spec, answers: [{slot, question, value}]}`.
    var generateFields: [String: JSONValue] {
        var out: [String: JSONValue] = ["request": .string(request)]
        if let spec { out["spec"] = spec }
        if !answers.isEmpty {
            out["answers"] = .array(answers.map {
                .object(["slot": .string($0.slot), "question": .string($0.question), "value": .string($0.value)])
            })
        }
        if !changes.isEmpty { out["changes"] = .array(changes.map(JSONValue.string)) }
        return out
    }
}

// MARK: - Plain words

/// Turns plan parts into short plain sentences. Never says spec, harness or context.
enum StudioPlanCopy {
    /// "Like Krillion: find the rarest answer", or "Order rush: finish the most orders".
    static func typeLine(_ plan: GamePlan) -> String? {
        let what = firstNonEmpty(plan.spec.goal.target, plan.spec.goal.text, plan.pitch)
        guard let type = plan.mainType else { return what.map(sentenceStart) }
        let lead = type.like.map { "Like \($0)" } ?? type.name
        guard let what else { return lead }
        return "\(lead): \(what.lowercasedFirst)"
    }

    static func theme(_ plan: GamePlan) -> String? {
        let named = plan.spec.theme.named.joined(separator: ", ")
        if let world = firstNonEmpty(plan.spec.theme.world) { return sentenceStart(world) }
        return named.isEmpty ? nil : named
    }

    static func goal(_ plan: GamePlan) -> String? {
        firstNonEmpty(plan.spec.goal.text, plan.spec.goal.target).map(sentenceStart)
    }

    /// "See a category like 'a spell' and a 10-second timer, then type."
    static func howToPlay(_ plan: GamePlan) -> String? {
        let loop = plan.spec.loop
        let verb = loop.verb.trimmingCharacters(in: .whitespaces)
        let sees = loop.sees.trimmingCharacters(in: .whitespaces)
        switch (verb.isEmpty, sees.isEmpty) {
        case (false, false): return "See \(sees.lowercasedFirst), then \(verb.lowercased())."
        case (false, true): return "You \(verb.lowercased())."
        case (true, false): return sentenceStart(sees) + "."
        default: return nil
        }
    }

    /// "After the last prompt", "When the 60 s run out", "When you're crowned".
    static func howItEnds(_ plan: GamePlan) -> String? {
        let end = plan.spec.end
        let timeLimit = timeLimitSeconds(plan)
        var parts: [String] = []
        for reason in end.endsWhen {
            switch reason {
            case "time_up": parts.append(timeLimit.map { "When the \($0) s run out" } ?? "When time runs out")
            case "all_prompts_done": parts.append("After the last prompt")
            case "lives_gone": parts.append("When you're out of lives")
            case "target_reached":
                let target = plan.spec.goal.target.trimmingCharacters(in: .whitespaces)
                parts.append(target.isEmpty ? "When you reach the goal" : "When you \(target.lowercasedFirst)")
            case "ending_reached": parts.append("When you reach an ending")
            case "choices_used_up": parts.append("or when your choices run out")
            default: break
            }
        }
        if parts.isEmpty, let win = firstNonEmpty(end.win) { return "When " + win.lowercasedFirst }
        guard !parts.isEmpty else { return nil }
        return parts.enumerated().map { $0.offset == 0 ? $0.element : $0.element.lowercasedFirst }
            .joined(separator: parts.count > 1 && parts.last?.hasPrefix("or") == true ? " " : ", ")
    }

    /// The score in plain words: "Fastest time wins", "Most orders in 60 s", "Unranked: compare your picks".
    static func scoreLine(_ plan: GamePlan) -> String {
        let score = plan.spec.score
        let result = plan.spec.social.result
        if result.compare == "agreement" || result.kind == "picks" { return "Unranked: compare your picks" }
        if !score.ranked { return result.kind == "creation" ? "Unranked: show what you made" : "Unranked: compare your results" }
        if result.compare == "ending" || result.kind == "ending" { return "Best ending wins, then fewest choices" }
        let unit = plainUnit(score.unit)
        switch score.kind {
        case "time_to_complete": return "Fastest time wins"
        case "survival_time": return "Last the longest to win"
        case "count_in_time":
            let what = unit ?? "points"
            return timeLimitSeconds(plan).map { "Most \(what) in \($0) s" } ?? "Most \(what) before time runs out"
        case "accuracy": return "Most right answers wins"
        case "tiered_points": return "Rarer answers score more"
        case "streak": return "Longest streak wins"
        case "distance": return "Go the farthest to win"
        default:
            if score.direction == "lower" { return unit.map { "Fewest \($0) wins" } ?? "Lowest score wins" }
            return unit.map { "Most \($0) wins" } ?? "Highest score wins"
        }
    }

    static func isRanked(_ plan: GamePlan) -> Bool {
        let compare = plan.spec.social.result.compare
        return plan.spec.score.ranked && compare != "agreement" && compare != "none"
    }

    static func groupPlay(_ plan: GamePlan) -> GroupPlayInfo {
        GroupPlayInfo(social: plan.spec.social, ranked: plan.spec.score.ranked)
    }

    /// "World map isn't ready yet, so the country's name and flag colors are shown instead of a map."
    static func gapLines(_ plan: GamePlan) -> [String] {
        plan.gaps.prefix(2).map { gap in
            let name = humanize(gap.tool)
            let verb = name.hasSuffix("s") && !name.hasSuffix("ss") ? "aren't" : "isn't"
            let instead = gap.approximation.trimmingCharacters(in: .whitespacesAndNewlines)
            if instead.isEmpty { return "\(name) \(verb) ready yet, so Muse keeps it simple." }
            let tail = instead.hasSuffix(".") ? instead : instead + "."
            return "\(name) \(verb) ready yet, so \(tail.lowercasedFirst)"
        }
    }

    // MARK: Helpers

    static func timeLimitSeconds(_ plan: GamePlan) -> Int? {
        for c in plan.spec.constraints where c.kind == "time" {
            let digits = c.value.split(whereSeparator: { !$0.isNumber }).first.flatMap { Int($0) }
            if let digits, digits > 0 {
                return c.value.contains("min") ? digits * 60 : digits
            }
        }
        if let range = plan.spec.end.sessionSeconds.last, plan.spec.end.endsWhen.contains("time_up"), range > 0 { return range }
        return nil
    }

    static func humanize(_ id: String) -> String {
        sentenceStart(id.replacingOccurrences(of: "_", with: " "))
    }

    private static func plainUnit(_ unit: String) -> String? {
        let u = unit.trimmingCharacters(in: .whitespaces).lowercased()
        guard !u.isEmpty, !["ms", "points", "point", "pts", "%", "percent"].contains(u) else { return nil }
        return u
    }

    private static func firstNonEmpty(_ values: String...) -> String? {
        values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty }
    }

    static func sentenceStart(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }
}

private extension String {
    /// Lowercases the first letter unless the first word looks like a name ("Harry", "SF").
    var lowercasedFirst: String {
        guard let first = first, first.isUppercase else { return self }
        let word = prefix { !$0.isWhitespace }
        if word.count > 1, word.dropFirst().contains(where: \.isUppercase) { return self }
        if ["I", "I'm"].contains(String(word)) { return self }
        return first.lowercased() + dropFirst()
    }
}
