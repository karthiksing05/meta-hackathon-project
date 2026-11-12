import Foundation

// Length is a first-class primitive (docs/BUBBLES.md 7.9): every formula honors one shared
// contract, so a challenge, a group-chat session or a Group game night can lock everyone to the
// same mode and numbers. Foundation only: the CLI compiles this file too.
//
// Owner: the "length" feature. The scaffolding defines the shape; the length feature fills in
// labels, defaults per formula and the Customize panel.

/// How a run ends.
enum BubbleLengthMode: String, Codable, CaseIterable, Sendable {
    /// Play until you fail.
    case endless
    /// N rounds (questions, scenes, stacks…), then the run ends.
    case rounds
    /// N seconds, then the run ends.
    case timed
    /// N lives; each miss costs one.
    case lives
}

/// Manifest `length` (snake_case JSON: `{"mode": "rounds", "rounds": 10}`). Only the number that
/// belongs to the mode is read; the others are ignored. Nil fields use the formula's default.
struct BubbleLength: Codable, Hashable, Sendable {
    var mode: BubbleLengthMode
    var rounds: Int?
    var seconds: Int?
    var lives: Int?

    init(mode: BubbleLengthMode, rounds: Int? = nil, seconds: Int? = nil, lives: Int? = nil) {
        self.mode = mode
        self.rounds = rounds
        self.seconds = seconds
        self.lives = lives
    }

    static let endless = BubbleLength(mode: .endless)
    static func rounds(_ n: Int) -> BubbleLength { BubbleLength(mode: .rounds, rounds: n) }
    static func timed(_ seconds: Int) -> BubbleLength { BubbleLength(mode: .timed, seconds: seconds) }
    static func lives(_ n: Int) -> BubbleLength { BubbleLength(mode: .lives, lives: n) }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = (try? c.decodeIfPresent(BubbleLengthMode.self, forKey: .mode)) ?? .endless
        rounds = try? c.decodeIfPresent(Int.self, forKey: .rounds)
        seconds = try? c.decodeIfPresent(Int.self, forKey: .seconds)
        lives = try? c.decodeIfPresent(Int.self, forKey: .lives)
    }

    enum CodingKeys: String, CodingKey {
        case mode, rounds, seconds, lives
    }

    /// Player-facing label for intro cards, results and boards ("Endless", "10 rounds",
    /// "60 seconds", "3 lives"). The length feature may refine it ("Endless: beat 42").
    var label: String {
        switch mode {
        case .endless: return "Endless"
        case .rounds: return rounds.map { "\($0) rounds" } ?? "Rounds"
        case .timed: return seconds.map { "\($0) seconds" } ?? "Timed"
        case .lives: return lives.map { $0 == 1 ? "1 life" : "\($0) lives" } ?? "Lives"
        }
    }
}

extension BubbleManifest {
    /// This manifest with `length` set (nil keeps it). Changes the session key, so a prepared
    /// session for the plain manifest is never reused for a locked length.
    func withLength(_ length: BubbleLength?) -> BubbleManifest {
        guard let length else { return self }
        var copy = self
        copy.length = length
        return copy
    }

    /// This manifest with another seed (nil keeps it). Same-seed challenges and group-chat
    /// sessions play this way; the replay log records the seed, so the score stays verifiable.
    func withSeed(_ seed: Int?) -> BubbleManifest {
        guard let seed else { return self }
        var copy = self
        copy.seed = seed
        return copy
    }
}
