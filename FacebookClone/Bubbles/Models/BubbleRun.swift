import Foundation

/// One player input at a fixed-timestep tick. Everything is seeded, so a replay only needs these.
struct BubbleInput: Codable, Hashable, Sendable {
    /// Tick number (60 per second).
    var t: Int
    /// Pointer action: "tap" (finger down), "move" or "up". Everything else (keys, choices, launches)
    /// is derived from these by concepts, so a replay is just the pointer log. The one exception is
    /// "text": typed text from a microgame's native text field (docs/BUBBLES.md 7.11).
    var a: String
    /// Position in the 360x640 logical playfield as `[x, y]`, rounded to 0.1. For "text",
    /// `[kind, value]` with kind "submit" or "change".
    var v: JSONValue?

    init(t: Int, a: String, v: JSONValue? = nil) {
        self.t = t
        self.a = a
        self.v = v
    }
}

/// A recorded run: the seed plus every input. Powers Bursts, ghost replays and score checks.
struct BubbleInputLog: Codable, Hashable, Sendable {
    var seed: Int
    var tickRate: Int
    var totalTicks: Int
    var inputs: [BubbleInput]
    /// The length the run was played with, when it was locked (challenges, sessions, game nights;
    /// docs/BUBBLES.md 7.9). Verification replays with it, so every mode stays verifiable.
    var length: BubbleLength?

    init(seed: Int, tickRate: Int = 60, totalTicks: Int = 0, inputs: [BubbleInput] = [], length: BubbleLength? = nil) {
        self.seed = seed
        self.tickRate = tickRate
        self.totalTicks = totalTicks
        self.inputs = inputs
        self.length = length
    }

    enum CodingKeys: String, CodingKey {
        case seed, inputs, length
        case tickRate = "tick_rate"
        case totalTicks = "total_ticks"
    }

    var durationSec: Double {
        tickRate > 0 ? Double(totalTicks) / Double(tickRate) : 0
    }
}

/// What a finished run lets you share. Daily Bubbles never reveal the answer here.
struct BubbleShareArtifact: Codable, Hashable, Sendable {
    var headline: String
    var scoreText: String
    var emojiGrid: String?
    /// A short machine-readable result a kit reports for the app, never shown ("ending=ferry",
    /// "mastery=7/8", "right=4/5"). Keys are owned by the formula's feature (docs/BUBBLES.md 7.1).
    var tag: String?

    init(headline: String, scoreText: String, emojiGrid: String? = nil, tag: String? = nil) {
        self.headline = headline
        self.scoreText = scoreText
        self.emojiGrid = emojiGrid
        self.tag = tag
    }

    enum CodingKeys: String, CodingKey {
        case headline, tag
        case scoreText = "score_text"
        case emojiGrid = "emoji_grid"
    }
}

enum BubbleOutcome: String, Codable, Sendable {
    case fail
    case success
}

/// A finished run, posted by the runtime as a `result` message.
/// `score` is always "higher is better": the runtime turns attempts or time into points.
struct BubbleRunResult: Codable, Hashable, Sendable {
    var outcome: BubbleOutcome
    var score: Int
    var durationSec: Double
    var replay: BubbleInputLog
    var share: BubbleShareArtifact
    /// Microgames only: the engine's input log (`microgame-log/1` JSON text) for server checks
    /// (`MicrogameEngine.verify`). Nil for other formulas.
    var engineLog: String?

    init(outcome: BubbleOutcome, score: Int, durationSec: Double, replay: BubbleInputLog, share: BubbleShareArtifact) {
        self.outcome = outcome
        self.score = score
        self.durationSec = durationSec
        self.replay = replay
        self.share = share
    }

    enum CodingKeys: String, CodingKey {
        case outcome, score, replay, share
        case durationSec = "duration_sec"
        case engineLog = "engine_log"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        outcome = (try? c.decode(BubbleOutcome.self, forKey: .outcome)) ?? .fail
        if let whole = try? c.decode(Int.self, forKey: .score) {
            score = whole
        } else {
            score = Int((try? c.decode(Double.self, forKey: .score)) ?? 0)
        }
        durationSec = (try? c.decode(Double.self, forKey: .durationSec)) ?? 0
        replay = (try? c.decode(BubbleInputLog.self, forKey: .replay)) ?? BubbleInputLog(seed: 1)
        share = (try? c.decode(BubbleShareArtifact.self, forKey: .share))
            ?? BubbleShareArtifact(headline: "", scoreText: "\(score)")
        engineLog = try? c.decodeIfPresent(String.self, forKey: .engineLog)
    }
}

/// How the runtime should run a manifest.
enum BubbleRunMode: Hashable, Sendable {
    /// Interactive.
    case play
    /// Plays back a recorded run exactly. Tapping takes over.
    case replay(BubbleInputLog)
    /// The built-in bot plays. Tapping takes over.
    case demo
    /// One still frame, for thumbnails.
    case poster

    var name: String {
        switch self {
        case .play: return "play"
        case .replay: return "replay"
        case .demo: return "demo"
        case .poster: return "poster"
        }
    }

    var replayLog: BubbleInputLog? {
        if case .replay(let log) = self { return log }
        return nil
    }
}

enum BubblePhase: String, Codable, Sendable {
    case intro
    case playing
    case fail
    case success
    case result
}

/// Speed numbers the host reports in `perf` messages (docs/BUBBLES.md, 4.8): after each
/// activation and every few seconds while a session plays. Every field is optional because
/// a host only sends what it measured.
struct BubblePerf: Codable, Hashable, Sendable {
    var prepareMs: Double?
    var activateMs: Double?
    var firstFrameMs: Double?
    var fps: Double?
    var heapMB: Double?

    init(prepareMs: Double? = nil, activateMs: Double? = nil, firstFrameMs: Double? = nil, fps: Double? = nil, heapMB: Double? = nil) {
        self.prepareMs = prepareMs
        self.activateMs = activateMs
        self.firstFrameMs = firstFrameMs
        self.fps = fps
        self.heapMB = heapMB
    }

    enum CodingKeys: String, CodingKey {
        case fps
        case prepareMs = "prepare_ms"
        case activateMs = "activate_ms"
        case firstFrameMs = "first_frame_ms"
        case heapMB = "heap_mb"
    }
}

/// Messages the runtime posts through `window.webkit.messageHandlers.bubble`.
enum BubbleBridgeMessage: Sendable {
    case ready(title: String?)
    case phase(BubblePhase)
    case score(Int)
    case result(BubbleRunResult)
    case haptic(String)
    case takeover
    case error(String)
    case unknown(String)
    /// Timing from the host (docs/BUBBLES.md, 4.8).
    case perf(BubblePerf)
    /// A play run's log so far, posted every 2 s and on pause, so it can be resumed (4.8).
    case checkpoint(BubbleInputLog, score: Int)

    /// Parses a WKScriptMessage body (a dictionary with a "type" key).
    init(body: Any) {
        let value = JSONValue(foundationObject: body)
        let type = value["type"]?.string ?? ""
        switch type {
        case "ready":
            self = .ready(title: value["title"]?.string)
        case "phase":
            self = .phase(BubblePhase(rawValue: value["name"]?.string ?? "") ?? .playing)
        case "score":
            self = .score(value["value"]?.int ?? 0)
        case "result":
            if let result = try? value.decode(BubbleRunResult.self) {
                self = .result(result)
            } else {
                self = .error("Couldn't read the run result")
            }
        case "haptic":
            self = .haptic(value["style"]?.string ?? "light")
        case "takeover":
            self = .takeover
        case "error":
            self = .error(value["message"]?.string ?? "Unknown runtime error")
        case "checkpoint":
            if let log = try? value["replay"]?.decode(BubbleInputLog.self) {
                self = .checkpoint(log, score: value["score"]?.int ?? 0)
            } else {
                self = .unknown(type)
            }
        case "perf":
            self = .perf(BubblePerf(
                prepareMs: value["prepare_ms"]?.double,
                activateMs: value["activate_ms"]?.double,
                firstFrameMs: value["first_frame_ms"]?.double,
                fps: value["fps"]?.double,
                heapMB: value["heap_mb"]?.double
            ))
        default:
            self = .unknown(type)
        }
    }

    /// The session that posted a message body: every message from a 4.8 host carries `key`.
    /// Nil for hosts that only run one session (the stub runtime).
    static func sessionKey(in body: Any) -> String? {
        (body as? [String: Any])?["key"] as? String
    }
}
