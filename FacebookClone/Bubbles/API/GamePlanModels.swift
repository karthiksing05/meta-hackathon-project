import Foundation

// The plan the server makes before it builds a game (docs/HARNESS_V2.md, step 4):
//
//     POST /v1/harness/plan {request} -> {plan, clarify, spec, types, timings}
//
// `spec` is `game-spec/1`: ten named parts (theme, goal, loop, pieces, constraints, progression,
// end, score, social, feel). `social` is the group-play part (docs/harness-gaps/group-play.md on
// `harness-v2`): how a game sent into a chat or a Group is compared.
//
// Decoding is deliberately forgiving: the planner's output is Muse's, the shape is still moving
// (`social` changed on `harness-v2` the same day), and a missing or oddly typed field must never
// stop the Plan step. Everything is read from `JSONValue`, every field has a default, and a
// string-or-array or number-or-string field reads either way. The raw `spec` is kept as it came,
// so it can be sent on to the build unchanged.

struct GamePlan: Equatable, Sendable {
    /// The game's working title (`plan.anatomy.title`), else empty.
    var title: String
    /// The design block's one-line pitch.
    var pitch: String
    /// The catalog types the plan uses, best match first.
    var types: [GamePlanType]
    /// How the types combine ("rare-answer scoring from …, the timer from …").
    var blend: String
    var typeIDs: [String]
    var toolIDs: [String]
    /// Tools the idea needs that aren't built yet, and what the game does instead.
    var gaps: [GamePlanGap]
    /// Every checklist slot as settled. Up to 2 carry a question.
    var clarify: [GamePlanSlot]
    var spec: GameSpec
    /// `spec` exactly as the server sent it, to pass on to the build.
    var rawSpec: JSONValue?
    var timings: GamePlanTimings

    /// The slots Muse wants the person to answer: at most 2, each with 2 to 4 choices.
    var questions: [GamePlanSlot] {
        Array(clarify.filter { !$0.question.isEmpty && $0.choices.count >= 2 }.prefix(2))
            .map { slot in
                var slot = slot
                slot.choices = Array(slot.choices.prefix(4))
                return slot
            }
    }

    /// The best-matching type.
    var mainType: GamePlanType? {
        if let first = typeIDs.first, let match = types.first(where: { $0.id == first }) { return match }
        return types.first
    }
}

struct GamePlanType: Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var family: String
    var score: Double
    /// A well-known game the request named that matched this type ("Krillion"), when the server
    /// says so: from `like`, `aliases`, or a match reason of the form `alias: Krillion`.
    var like: String?
}

struct GamePlanGap: Equatable, Sendable {
    var tool: String
    var status: String
    var approximation: String
    var familiarity: String
}

struct GamePlanSlot: Equatable, Sendable, Identifiable {
    var slot: String
    var value: String
    var guessed: Bool
    var question: String
    var choices: [String]

    var id: String { slot }
}

struct GamePlanTimings: Equatable, Sendable {
    var understandMs: Int
    var retrieveMs: Int
    var lookupMs: Int
    var planMs: Int
    var totalMs: Int
}

/// `game-spec/1`.
struct GameSpec: Equatable, Sendable {
    struct Theme: Equatable, Sendable { var world = "", named: [String] = [], tone = "", look = "", terms: [String] = [] }
    struct Goal: Equatable, Sendable { var text = "", target = "", measure = "" }
    struct Loop: Equatable, Sendable { var verb = "", sees = "", input = "", feedback = "", cycleSeconds: Double = 0 }
    struct Piece: Equatable, Sendable { var name = "", role = "", count = "", content = "" }
    struct Constraint: Equatable, Sendable { var kind = "", value = "", enforcedBy = "", hud = "" }
    struct Step: Equatable, Sendable { var at = "", change = "" }
    struct Progression: Equatable, Sendable { var steps: [Step] = [], levers: [String] = [] }
    struct End: Equatable, Sendable { var win = "", lose = "", endsWhen: [String] = [], sessionSeconds: [Int] = [] }
    struct Score: Equatable, Sendable {
        var kind = "points", measures = "", unit = "", direction = "higher", countsWhen = "any"
        var aggregate = "best", tieBreak = "", format = "", events: [String] = [], reason = ""
        /// False: no fair ranking (an opinion game compares agreement instead).
        var ranked = true
    }
    struct PlayResult: Equatable, Sendable {
        /// score, ending, picks or creation.
        var kind = "score"
        /// score, ending, agreement or none.
        var compare = "score"
        var display = ""
        var endings: [String] = []
        var state: [String] = []
    }
    struct Social: Equatable, Sendable {
        /// same_seed_async, series, group_round, weekly_board or opinion_compare.
        var mode = "same_seed_async"
        var modes: [String] = []
        var roundSeconds = 0
        var result = PlayResult()
        var shareLine = ""
        var bestOf = 0
        var board = ""
        var sameSeed = true
        var reason = ""
    }
    struct Feel: Equatable, Sendable { var juice: [String] = [], sounds = "", look = "" }

    var theme = Theme()
    var goal = Goal()
    var loop = Loop()
    var pieces: [Piece] = []
    var constraints: [Constraint] = []
    var progression = Progression()
    var end = End()
    var score = Score()
    var social = Social()
    var feel = Feel()
}

// MARK: - Decoding

extension GamePlan {
    /// Reads a `/v1/harness/plan` reply. Throws only when the body isn't JSON at all.
    static func decode(_ data: Data) throws -> GamePlan {
        do {
            return GamePlan(reply: try JSONValue.parse(data))
        } catch {
            throw GamesAPIError.decoding("plan: \(String(describing: error).prefix(160))")
        }
    }

    init(reply: JSONValue) {
        let plan = reply["plan"] ?? .object([:])
        let specValue = reply["spec"].flatMap { $0.isNull ? nil : $0 } ?? plan["spec"].flatMap { $0.isNull ? nil : $0 }
        let clarifyValue = (reply["clarify"]?.array?.isEmpty == false ? reply["clarify"] : nil) ?? plan["clarify"]
        title = plan["anatomy"]?["title"].text ?? ""
        pitch = plan["design"]?["pitch"].text ?? ""
        types = (reply["types"]?.array ?? []).map(GamePlanType.init(json:)).filter { !$0.id.isEmpty }
        blend = plan["blend"].text ?? ""
        typeIDs = plan["type_ids"].list
        toolIDs = plan["tool_ids"].list
        gaps = (plan["gaps"]?.array ?? []).map(GamePlanGap.init(json:)).filter { !$0.tool.isEmpty }
        clarify = (clarifyValue?.array ?? []).map(GamePlanSlot.init(json:)).filter { !$0.slot.isEmpty }
        spec = specValue.map(GameSpec.init(json:)) ?? GameSpec()
        rawSpec = specValue
        let t = reply["timings"]
        timings = GamePlanTimings(
            understandMs: t?["understand_ms"].number ?? 0, retrieveMs: t?["retrieve_ms"].number ?? 0,
            lookupMs: t?["lookup_ms"].number ?? 0, planMs: t?["plan_ms"].number ?? 0, totalMs: t?["total_ms"].number ?? 0
        )
    }
}

extension GamePlanType {
    init(json: JSONValue) {
        id = json["id"].text ?? ""
        name = json["name"].text ?? ""
        family = json["family"].text ?? ""
        score = json["score"]?.double ?? json["match"]?["score"]?.double ?? 0
        let reasons = json["reasons"].list + (json["match"]?["reasons"]).list
        let fromReason = reasons.lazy
            .compactMap { reason -> String? in
                guard reason.lowercased().hasPrefix("alias:") else { return nil }
                return reason.dropFirst("alias:".count).trimmingCharacters(in: .whitespaces)
            }
            .first { !$0.isEmpty }
        like = json["like"].text ?? fromReason ?? json["named_refs"].list.first
    }
}

extension GamePlanGap {
    init(json: JSONValue) {
        tool = json["tool"].text ?? ""
        status = json["status"].text ?? ""
        approximation = json["approximation"].text ?? ""
        familiarity = json["familiarity"].text ?? ""
    }
}

extension GamePlanSlot {
    init(json: JSONValue) {
        slot = json["slot"].text ?? ""
        value = json["value"].text ?? ""
        guessed = json["guessed"]?.bool ?? true
        question = json["question"].text ?? ""
        choices = json["choices"].list.filter { !$0.isEmpty }
    }
}

extension GameSpec {
    init(json s: JSONValue) {
        let th = s["theme"]
        theme = Theme(world: th?["world"].text ?? "", named: th?["named"].list ?? [], tone: th?["tone"].text ?? "",
                      look: th?["look"].text ?? "", terms: th?["terms"].list ?? [])
        let g = s["goal"]
        goal = Goal(text: g?["text"].text ?? "", target: g?["target"].text ?? "", measure: g?["measure"].text ?? "")
        let l = s["loop"]
        loop = Loop(verb: l?["verb"].text ?? "", sees: l?["sees"].text ?? "", input: l?["input"].text ?? "",
                    feedback: l?["feedback"].text ?? "", cycleSeconds: l?["cycle_seconds"]?.double ?? 0)
        pieces = (s["pieces"]?["items"]?.array ?? s["pieces"]?.array ?? []).map {
            Piece(name: $0["name"].text ?? "", role: $0["role"].text ?? "", count: $0["count"].text ?? "", content: $0["content"].text ?? "")
        }
        constraints = (s["constraints"]?["items"]?.array ?? s["constraints"]?.array ?? []).map {
            Constraint(kind: $0["kind"].text ?? "", value: $0["value"].text ?? "", enforcedBy: $0["enforced_by"].text ?? "", hud: $0["hud"].text ?? "")
        }
        let p = s["progression"]
        progression = Progression(
            steps: (p?["steps"]?.array ?? []).map { Step(at: $0["at"].text ?? "", change: $0["change"].text ?? "") },
            levers: p?["levers"].list ?? []
        )
        let e = s["end"]
        end = End(win: e?["win"].text ?? "", lose: e?["lose"].text ?? "", endsWhen: e?["ends_when"].list ?? [],
                  sessionSeconds: (e?["session_seconds"]?.array ?? []).compactMap { $0.double.map { Int($0) } ?? $0.string.flatMap { Int($0) } })
        let sc = s["score"]
        var score = Score()
        if let sc {
            score.kind = sc["kind"].text ?? score.kind
            score.measures = sc["measures"].text ?? ""
            score.unit = sc["unit"].text ?? ""
            score.direction = sc["direction"].text ?? score.direction
            score.countsWhen = sc["counts_when"].text ?? score.countsWhen
            score.aggregate = sc["aggregate"].text ?? score.aggregate
            score.tieBreak = sc["tie_break"].text ?? ""
            score.format = sc["format"].text ?? ""
            score.events = sc["events"].list
            score.reason = sc["reason"].text ?? ""
            score.ranked = sc["ranked"]?.bool ?? true
        }
        self.score = score
        social = Social(json: s["social"])
        let f = s["feel"]
        feel = Feel(juice: f?["juice"].list ?? [], sounds: f?["sounds"].text ?? "", look: f?["look"].text ?? "")
    }
}

extension GameSpec.Social {
    /// Reads the `social` part, or a manifest's `group_play` block (the same shape). Older plans
    /// wrote `{share, challenge, same_seed, board}`; `share` becomes the share line.
    init(json so: JSONValue?) {
        self.init()
        guard let so, so.object != nil else { return }
        mode = so["mode"].text ?? mode
        modes = so["modes"].list
        roundSeconds = so["round_seconds"].number ?? 0
        let r = so["result"]
        result = GameSpec.PlayResult(
            kind: r?["kind"].text ?? "score", compare: r?["compare"].text ?? "score", display: r?["display"].text ?? "",
            endings: r?["endings"].list ?? [], state: r?["state"].list ?? []
        )
        shareLine = so["share_line"].text ?? so["share"].text ?? ""
        bestOf = so["best_of"].number ?? 0
        board = so["board"].text ?? ""
        sameSeed = so["same_seed"]?.bool ?? true
        reason = so["reason"].text ?? ""
        if result.compare == "agreement", mode != "group_round" { mode = "opinion_compare" }
    }
}

// MARK: - Forgiving readers

private extension Optional where Wrapped == JSONValue {
    /// A string, or a number or bool written as text; nil for null, missing or empty.
    var text: String? {
        guard let value = self else { return nil }
        switch value {
        case .string(let s):
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        case .number(let n):
            return n.rounded() == n ? String(Int(n)) : String(n)
        case .bool(let b):
            return b ? "true" : "false"
        default:
            return nil
        }
    }

    /// A list of strings from an array or one string.
    var list: [String] {
        guard let value = self else { return [] }
        if let array = value.array {
            return array.compactMap { Optional($0).text }
        }
        return Optional(value).text.map { [$0] } ?? []
    }

    /// A whole number from a number or numeric text.
    var number: Int? {
        guard let value = self else { return nil }
        if let d = value.double, d.isFinite { return Int(d) }
        return value.string.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    }
}
