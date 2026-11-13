import Foundation
import Observation

/// What Muse did to make one game, kept after Studio closes so its page can show "How Muse made
/// it". Built only from real Studio events (`StudioEvent`) and real playtest reports; the brief
/// and the model stamp stay in the manifest, so this side record holds the rest: building blocks,
/// checks and fixes, the playtest, and who it was sent to.
///
/// A side store keyed by game id, on this device (UserDefaults), because the manifest contract
/// (`BubbleManifest`) isn't ours to change. Friends' devices see the manifest-only version.
struct MakeRecord: Codable, Hashable, Sendable {
    /// One round of "found a problem, fixed it".
    struct Repair: Codable, Hashable, Sendable {
        /// "Fixing 2 issues", "Fixed 2 problems".
        var title: String
        /// What the checks found.
        var problems: [String]
        /// What Muse changed, when the pipeline says (formula games).
        var fixes: [String]
    }

    /// One bot's playtest run.
    struct Lane: Codable, Hashable, Sendable {
        var bot: String
        var skill: Double
        /// "fail", "success", "timeout" or "error".
        var outcome: String
        var score: Int
        var seconds: Double
    }

    struct Playtest: Codable, Hashable, Sendable {
        /// "Playtested: the bot survived 34 s and scored 18".
        var title: String
        /// "4 bots scored 9–31 over 18–52 s · 3 lost, 1 cleared it".
        var detail: String?
        var passed: Bool?
        var lanes: [Lane]
    }

    /// A person it was sent to.
    struct Person: Codable, Hashable, Sendable {
        var id: String
        var name: String
    }

    /// One line of the trail (the timeline, compacted).
    struct Step: Codable, Hashable, Sendable {
        var step: String
        var title: String
        var detail: String?
        var model: String?
        var elapsed: Double
    }

    var gameID: String
    /// True for games built on the microgame engine (made from scratch), false for formula games.
    var isMicrogame: Bool
    /// Concepts or fragments Muse used, as ids ("behavior.spawn_stream", "fragment.timer_bar").
    var concepts: [String]
    /// What Ember wrote ("Wrote 12 hill names: Twin Peaks, Bernal Hill…").
    var content: [String]
    var repairs: [Repair]
    var playtest: Playtest?
    var models: [String]
    var seconds: Double?
    var isOffline: Bool
    var sourcesUsed: [String]
    var trail: [Step]
    /// Friends challenged (or sent it) from the Share step.
    var sentTo: [Person] = []
    /// Where it was shared ("your feed", "New in SF").
    var sharedTo: String?
    var madeAt: Date = Date()
}

extension MakeRecord {
    /// A record from one Studio run. `reports` are the playtest reports by event id (microgames).
    static func build(
        gameID: String,
        events: [StudioEvent],
        reports: [UUID: StudioPlaytest.Report],
        isMicrogame: Bool,
        concepts: [String],
        models: [String],
        seconds: Double?,
        isOffline: Bool,
        sourcesUsed: [String]
    ) -> MakeRecord {
        var repairs: [Repair] = []
        var pendingProblems: [String] = []
        for event in events {
            switch event.step {
            case .validate:
                if let issues = event.issues, !issues.isEmpty { pendingProblems = issues }
            case .repair:
                if isMicrogame {
                    // The composer's repair event lists the problems it sends back.
                    repairs.append(Repair(title: event.title, problems: event.issues ?? [], fixes: []))
                } else {
                    repairs.append(Repair(title: event.title, problems: pendingProblems, fixes: event.issues ?? []))
                }
                pendingProblems = []
            default:
                break
            }
        }

        var playtest: Playtest?
        if let last = events.last(where: { $0.step == .playtest && (reports[$0.id] != nil || $0.detail != nil) }) ?? events.last(where: { $0.step == .playtest }) {
            let report = reports[last.id]
            playtest = Playtest(
                title: last.title,
                detail: last.detail,
                passed: report?.passed,
                lanes: report.map(lanes(from:)) ?? []
            )
        }

        let content = events.filter { $0.step == .content }.map { event in
            [event.title, event.detail].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ": ")
        }

        let trail = events.suffix(24).map { event in
            Step(step: event.step.rawValue, title: event.title, detail: event.detail, model: event.model, elapsed: event.elapsed)
        }

        return MakeRecord(
            gameID: gameID,
            isMicrogame: isMicrogame,
            concepts: concepts,
            content: content,
            repairs: repairs,
            playtest: playtest,
            models: models,
            seconds: seconds,
            isOffline: isOffline,
            sourcesUsed: sourcesUsed,
            trail: Array(trail)
        )
    }

    static func lanes(from report: StudioPlaytest.Report) -> [Lane] {
        report.runs.map { run in
            Lane(bot: run.bot.label, skill: run.bot.skill, outcome: run.outcome, score: run.score, seconds: run.seconds)
        }
    }

    /// "Maya, Leo and Priya".
    static func names(_ people: [String]) -> String {
        switch people.count {
        case 0: return ""
        case 1: return people[0]
        case 2: return "\(people[0]) and \(people[1])"
        case 3: return "\(people[0]), \(people[1]) and \(people[2])"
        default: return "\(people[0]), \(people[1]) and \(people.count - 2) others"
        }
    }
}

/// Make records by game id, saved on this device.
@MainActor
@Observable
final class MakeRecordStore {
    static let shared = MakeRecordStore()

    private(set) var records: [String: MakeRecord] = [:]

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let key = "studio.makeRecords.v1"
    /// Keeps the store small: the newest records win.
    @ObservationIgnored private let limit = 60

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key),
           let saved = try? JSONDecoder().decode([String: MakeRecord].self, from: data) {
            records = saved
        }
    }

    func record(for gameID: String) -> MakeRecord? {
        records[gameID]
    }

    func save(_ record: MakeRecord) {
        records[record.gameID] = record
        if records.count > limit {
            let oldest = records.values.sorted { $0.madeAt < $1.madeAt }.prefix(records.count - limit)
            for item in oldest { records[item.gameID] = nil }
        }
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(records) else { return }
        defaults.set(data, forKey: key)
    }
}
