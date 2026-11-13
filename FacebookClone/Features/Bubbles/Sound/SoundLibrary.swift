import Foundation

// The microgame sound library, in Swift, so the app can preview a game's sounds without the
// engine. A copy of `authoring/expander/sound.mjs` (authoring/SPEC.md 2.9): the same moments,
// presets, sets and music loops. If that file changes, change this one too.

/// When a game plays a sound (authoring/SPEC.md 1.8).
enum SoundMoment: String, CaseIterable, Identifiable, Sendable {
    case tap, pickup, hit, combo, level, countdown, win, lose

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tap: return "Tap"
        case .pickup: return "Score"
        case .hit: return "Miss"
        case .combo: return "Streak"
        case .level: return "Level up"
        case .countdown: return "Countdown"
        case .win: return "Win"
        case .lose: return "Lose"
        }
    }

    /// When it plays, in plain words.
    var detail: String {
        switch self {
        case .tap: return "A tap, a hop or a choice"
        case .pickup: return "A point, a pickup or a right answer"
        case .hit: return "A hit, a miss or a wrong answer"
        case .combo: return "A streak grows or tiles merge"
        case .level: return "A new wave, level or checkpoint"
        case .countdown: return "The last seconds on the clock"
        case .win: return "The end of a winning run"
        case .lose: return "The end of a run that didn't make it"
        }
    }

    var symbol: String {
        switch self {
        case .tap: return "hand.tap"
        case .pickup: return "star"
        case .hit: return "bolt"
        case .combo: return "flame"
        case .level: return "arrow.up.circle"
        case .countdown: return "timer"
        case .win: return "trophy"
        case .lose: return "cloud.drizzle"
        }
    }
}

/// One synthesized sound: a note (optionally sliding) or a short jingle of notes. The same shape
/// as an engine sound action body.
struct SoundTone: Hashable, Sendable {
    enum Wave: String, Sendable { case sine, square, triangle, sawtooth }

    var wave: Wave = .sine
    /// One frequency for a note, several for a jingle (Hz).
    var frequencies: [Double]
    /// Note length, or each jingle step's length (seconds).
    var step: Double
    /// The last note slides to this frequency (Hz).
    var slide: Double?
    /// 0...1, before the set's and the game's volume.
    var volume: Double = 0.6

    var duration: Double { step * Double(max(frequencies.count, 1)) }

    /// Reads an engine-style body: `{wave, note | notes, ms | step_ms, slide, volume}`.
    init?(body: JSONValue) {
        guard body.object != nil else { return nil }
        wave = body["wave"]?.string.flatMap(Wave.init(rawValue:)) ?? .sine
        if let notes = body["notes"]?.array {
            frequencies = notes.compactMap(SoundTone.hertz)
            step = (body["step_ms"]?.double ?? 90) / 1000
        } else if let note = body["note"], let hz = SoundTone.hertz(note) {
            frequencies = [hz]
            step = (body["ms"]?.double ?? 100) / 1000
        } else {
            return nil
        }
        guard !frequencies.isEmpty else { return nil }
        slide = body["slide"].flatMap(SoundTone.hertz)
        volume = body["volume"]?.double ?? 0.6
    }

    init(wave: Wave, notes: [String], stepMS: Double, slide: String? = nil, volume: Double) {
        self.wave = wave
        frequencies = notes.compactMap { SoundTone.hertz(.string($0)) }
        step = stepMS / 1000
        self.slide = slide.flatMap { SoundTone.hertz(.string($0)) }
        self.volume = volume
    }

    init(wave: Wave, note: String, ms: Double, slide: String? = nil, volume: Double) {
        self.init(wave: wave, notes: [note], stepMS: ms, slide: slide, volume: volume)
    }

    /// "C5", "F#4", "Bb3" or a number of Hz.
    static func hertz(_ value: JSONValue) -> Double? {
        if let hz = value.double { return hz }
        guard let text = value.string else { return nil }
        let chars = Array(text)
        guard chars.count >= 2, let letter = chars.first,
              let base = ["C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2][String(letter)] else { return nil }
        var semis = base
        var index = 1
        if chars[index] == "#" { semis += 1; index += 1 } else if chars[index] == "b" { semis -= 1; index += 1 }
        guard index == chars.count - 1, let octave = Int(String(chars[index])) else { return nil }
        return 440 * pow(2, Double(octave - 4) + Double(semis) / 12)
    }
}

/// A short music loop: eighth-note melody, quarter-note bass (Hz; nil is a rest).
struct SoundLoop: Hashable, Sendable {
    var bpm: Double
    var wave: SoundTone.Wave
    var volume: Double
    var melody: [Double?]
    var bass: [Double?]

    init(bpm: Double, wave: SoundTone.Wave, volume: Double, melody: [String?], bass: [String?]) {
        self.bpm = bpm
        self.wave = wave
        self.volume = volume
        self.melody = melody.map { $0.flatMap { SoundTone.hertz(.string($0)) } }
        self.bass = bass.map { $0.flatMap { SoundTone.hertz(.string($0)) } }
    }

    /// The model's own loop (`{melody, bass, bpm, wave, volume}`), filled in from `lullaby`.
    init(custom: JSONValue) {
        let base = SoundLibrary.music["lullaby"]!
        func notes(_ key: String) -> [Double?]? {
            custom[key]?.array?.map { SoundTone.hertz($0) }
        }
        bpm = custom["bpm"]?.double ?? base.bpm
        wave = custom["wave"]?.string.flatMap(SoundTone.Wave.init(rawValue:)) ?? base.wave
        volume = custom["volume"]?.double ?? base.volume
        melody = notes("melody") ?? base.melody
        bass = notes("bass") ?? base.bass
    }

    /// One pass of the loop, in seconds.
    var length: Double {
        let eighth = 30 / bpm
        return Double(max(melody.count, bass.count * 2, 1)) * eighth
    }
}

/// A named sound set: one preset per moment, plus optional music.
struct SoundSet: Identifiable, Hashable, Sendable {
    let id: String
    let describe: String
    let moments: [SoundMoment: String]
    let music: String?
    let volume: Double

    var title: String { id.prefix(1).uppercased() + id.dropFirst() }
}

enum SoundLibrary {
    static let presets: [String: SoundTone] = [
        // taps
        "blip": SoundTone(wave: .sine, note: "E5", ms: 50, volume: 0.45),
        "tick": SoundTone(wave: .triangle, note: "A5", ms: 30, volume: 0.4),
        "click": SoundTone(wave: .square, note: "C6", ms: 25, volume: 0.25),
        "pluck": SoundTone(wave: .triangle, note: "G4", ms: 70, volume: 0.5),
        "bubble": SoundTone(wave: .sine, note: "C5", ms: 70, slide: "G5", volume: 0.45),
        "pip": SoundTone(wave: .square, note: "E5", ms: 35, volume: 0.25),
        // good things
        "ding": SoundTone(wave: .sine, note: "A5", ms: 90, volume: 0.5),
        "coin": SoundTone(wave: .square, notes: ["B5", "E6"], stepMS: 55, volume: 0.3),
        "sparkle": SoundTone(wave: .triangle, notes: ["E6", "B6"], stepMS: 45, volume: 0.4),
        "chirp": SoundTone(wave: .sine, note: "C6", ms: 80, slide: "G6", volume: 0.4),
        "bell": SoundTone(wave: .sine, notes: ["G5", "D6"], stepMS: 70, volume: 0.45),
        "woodblock": SoundTone(wave: .triangle, note: "D5", ms: 45, volume: 0.55),
        // bad things
        "thud": SoundTone(wave: .triangle, note: "C3", ms: 140, slide: "G2", volume: 0.6),
        "buzz": SoundTone(wave: .square, note: "C3", ms: 120, volume: 0.35),
        "zap": SoundTone(wave: .sawtooth, note: "A3", ms: 160, slide: "A2", volume: 0.3),
        "bonk": SoundTone(wave: .sine, note: "F3", ms: 110, slide: "C3", volume: 0.6),
        "crunch": SoundTone(wave: .square, note: "D3", ms: 90, slide: "A2", volume: 0.3),
        // streaks and steps
        "rise": SoundTone(wave: .triangle, note: "C5", ms: 120, slide: "C6", volume: 0.45),
        "arpeggio": SoundTone(wave: .square, notes: ["C5", "E5", "G5"], stepMS: 50, volume: 0.25),
        "shimmer": SoundTone(wave: .sine, notes: ["E5", "G5", "B5"], stepMS: 60, volume: 0.4),
        "levelup": SoundTone(wave: .square, notes: ["G4", "C5", "E5", "G5"], stepMS: 70, volume: 0.25),
        "chime": SoundTone(wave: .sine, notes: ["C6", "G6"], stepMS: 90, volume: 0.4),
        // stings
        "fanfare": SoundTone(wave: .square, notes: ["C5", "E5", "G5", "C6"], stepMS: 90, volume: 0.3),
        "tada": SoundTone(wave: .triangle, notes: ["G4", "C5", "E5", "G5", "C6"], stepMS: 80, volume: 0.5),
        "glow": SoundTone(wave: .sine, notes: ["C5", "G5", "E6"], stepMS: 120, volume: 0.45),
        "hooray": SoundTone(wave: .square, notes: ["E5", "G5", "E6", "C6", "G6"], stepMS: 75, volume: 0.25),
        "sigh": SoundTone(wave: .sine, notes: ["E5", "C5", "A4"], stepMS: 140, volume: 0.45),
        "fall": SoundTone(wave: .triangle, notes: ["G4", "E4", "C4"], stepMS: 120, slide: "G3", volume: 0.5),
        "wah": SoundTone(wave: .sawtooth, notes: ["E4", "D#4", "D4"], stepMS: 160, slide: "C#4", volume: 0.25),
        "powerdown": SoundTone(wave: .square, note: "C5", ms: 420, slide: "C3", volume: 0.25),
    ]

    static let music: [String: SoundLoop] = [
        "lullaby": SoundLoop(
            bpm: 84, wave: .sine, volume: 0.32,
            melody: ["E5", nil, "G5", "A5", "G5", nil, "E5", nil, "D5", nil, "E5", "G5", "E5", nil, nil, nil],
            bass: ["C3", "C3", "A2", "A2", "F2", "F2", "G2", "G2"]
        ),
        "bounce": SoundLoop(
            bpm: 132, wave: .square, volume: 0.22,
            melody: ["C5", "E5", "G5", "E5", "A5", "G5", "E5", "D5", "C5", "E5", "G5", "C6", "B5", "G5", "A5", "G5"],
            bass: ["C3", "G2", "A2", "E2", "F2", "C3", "G2", "G2"]
        ),
        "drift": SoundLoop(
            bpm: 72, wave: .triangle, volume: 0.3,
            melody: ["A4", nil, "C5", nil, "E5", nil, "D5", "C5", "B4", nil, "G4", nil, "A4", nil, nil, nil],
            bass: ["A2", "A2", "F2", "F2", "G2", "G2", "E2", "E2"]
        ),
        "chip": SoundLoop(
            bpm: 144, wave: .square, volume: 0.2,
            melody: ["E5", "E5", nil, "C5", "D5", nil, "G4", nil, "A4", "C5", "E5", nil, "D5", "C5", "B4", nil],
            bass: ["A2", "A2", "F2", "F2", "C3", "C3", "G2", "E2"]
        ),
    ]

    /// In the order people see them. `classic` is what a game without a sound section gets.
    static let sets: [SoundSet] = [
        set("classic", "Plain, clear synth beeps.", ["blip", "ding", "buzz", "rise", "shimmer", "tick", "tada", "fall"], music: nil),
        set("soft", "Quiet, rounded tones for calm games.", ["bubble", "chirp", "bonk", "shimmer", "chime", "tick", "glow", "sigh"], music: "drift", volume: 0.8),
        set("arcade", "Bright bleeps for fast games.", ["pip", "coin", "zap", "arpeggio", "levelup", "click", "fanfare", "powerdown"], music: "bounce"),
        set("chime", "Bells and sparkles for puzzles and pairs.", ["tick", "bell", "bonk", "sparkle", "chime", "tick", "glow", "sigh"], music: nil),
        set("retro", "Chiptune blips and a looping 8-bit tune.", ["click", "coin", "crunch", "arpeggio", "levelup", "pip", "hooray", "wah"], music: "chip"),
        set("cozy", "Wooden plucks and a soft lullaby for stories and slow play.", ["woodblock", "pluck", "thud", "shimmer", "bell", "tick", "tada", "sigh"], music: "lullaby", volume: 0.9),
    ]

    static func set(named name: String) -> SoundSet? { sets.first { $0.id == name } }

    static let defaultSet = sets[0]

    private static func set(_ id: String, _ describe: String, _ presets: [String], music: String?, volume: Double = 1) -> SoundSet {
        let moments = Dictionary(uniqueKeysWithValues: zip(SoundMoment.allCases, presets))
        return SoundSet(id: id, describe: describe, moments: moments, music: music, volume: volume)
    }
}

// MARK: - A game's sound section

/// The `sound` section of a microgame's authoring manifest (authoring/SPEC.md 2.9), read and
/// resolved the way the expander does.
struct GameSoundSection: Hashable, Sendable {
    /// What the manifest says. Nil fields mean "the default".
    var setName: String?
    var volume: Double?
    /// Absent (nil), `false`, `true`, a loop name or the model's own loop.
    var music: JSONValue?
    var moments: [String: JSONValue] = [:]

    init(setName: String? = nil, volume: Double? = nil, music: JSONValue? = nil, moments: [String: JSONValue] = [:]) {
        self.setName = setName
        self.volume = volume
        self.music = music
        self.moments = moments
    }

    init(json: JSONValue?) {
        setName = json?["set"]?.string
        volume = json?["volume"]?.double
        music = json?["music"]
        moments = json?["moments"]?.object ?? [:]
    }

    var json: JSONValue {
        var object: [String: JSONValue] = [:]
        if let setName { object["set"] = .string(setName) }
        if let volume { object["volume"] = .number((volume * 100).rounded() / 100) }
        if let music { object["music"] = music }
        if !moments.isEmpty { object["moments"] = .object(moments) }
        return .object(object)
    }

    var set: SoundSet { setName.flatMap(SoundLibrary.set(named:)) ?? SoundLibrary.defaultSet }

    /// The game's volume times the set's, as the expander scales every sound.
    var effectiveVolume: Double { (volume ?? 1) * set.volume }

    /// The sound a moment plays, or nil when it's silent.
    func tone(for moment: SoundMoment) -> SoundTone? {
        let tone: SoundTone?
        if let override = moments[moment.rawValue] {
            if override.isNull || override.bool == false { return nil }
            tone = override.string.flatMap { SoundLibrary.presets[$0] } ?? SoundTone(body: override)
        } else {
            tone = set.moments[moment].flatMap { SoundLibrary.presets[$0] }
        }
        guard var tone, effectiveVolume > 0 else { return nil }
        tone.volume *= effectiveVolume
        return tone
    }

    /// The preset name a moment uses, for labels ("chirp", "custom" or nil when silent).
    func soundName(for moment: SoundMoment) -> String? {
        if let override = moments[moment.rawValue] {
            if override.isNull || override.bool == false { return nil }
            return override.string ?? "custom"
        }
        return set.moments[moment]
    }

    func isOverridden(_ moment: SoundMoment) -> Bool { moments[moment.rawValue] != nil }

    /// The loop that plays during the game, or nil for none.
    var musicLoop: SoundLoop? {
        switch music {
        case nil: return set.music.flatMap { SoundLibrary.music[$0] }
        case .bool(false)?, .null?: return nil
        case .bool(true)?: return SoundLibrary.music[set.music ?? "lullaby"]
        case .string(let name)?: return SoundLibrary.music[name]
        case let custom?: return custom.object != nil ? SoundLoop(custom: custom) : nil
        }
    }

    /// A short name for the loop ("drift", "custom"), or nil for none.
    var musicName: String? {
        switch music {
        case nil: return set.music
        case .bool(false)?, .null?: return nil
        case .bool(true)?: return set.music ?? "lullaby"
        case .string(let name)?: return name
        case _?: return "custom"
        }
    }

    var hasMusic: Bool { musicLoop != nil }
}
