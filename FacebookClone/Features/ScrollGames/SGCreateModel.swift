import Observation
import SwiftUI

enum SGCreatorLevel: String, CaseIterable, Identifiable {
    case remix, compose, free

    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    var blurb: String {
        switch self {
        case .remix: return "Start from a ready-made game format and make it yours."
        case .compose: return "Pick the building blocks and let Scroll Games wire them up."
        case .free: return "Describe anything. The least guardrails, the most surprises."
        }
    }
}

/// The brief as editable fields (spec/brief.schema.json). The raw object is kept so unknown keys round-trip to the server.
/// Keys may be dotted paths into nested objects, e.g. `limits.rounds`.
struct SGBriefDraft {
    static let titleKeys = ["title_idea"]
    static let moodKeys = ["mood"]
    static let energyKeys = ["energy"]
    static let roundsKeys = ["limits.rounds"]
    static let durationKeys = ["limits.duration_s"]
    static let glueKeys = ["glue_ideas"]

    var raw: [String: JSONValue] = [:]

    var json: JSONValue { .object(raw) }

    private static func lookup(_ path: String, in object: [String: JSONValue]) -> JSONValue? {
        let parts = path.split(separator: ".").map(String.init)
        var current: JSONValue? = .object(object)
        for part in parts { current = current?[part] }
        return current
    }

    private static func assign(_ value: JSONValue, at parts: ArraySlice<String>, in object: inout [String: JSONValue]) {
        guard let head = parts.first else { return }
        if parts.count == 1 {
            object[head] = value
            return
        }
        var child = object[head]?.objectValue ?? [:]
        assign(value, at: parts.dropFirst(), in: &child)
        object[head] = .object(child)
    }

    private func key(_ candidates: [String]) -> String {
        candidates.first { Self.lookup($0, in: raw) != nil } ?? candidates[0]
    }

    func text(_ candidates: [String]) -> String {
        Self.lookup(key(candidates), in: raw)?.stringValue ?? ""
    }

    mutating func setText(_ candidates: [String], _ value: String) {
        let name = key(candidates)
        let newValue: JSONValue
        if case .number? = Self.lookup(name, in: raw) {
            // Numeric fields stay numeric; an empty or invalid entry becomes 0, which the server replaces with its default.
            newValue = .number(Double(value) ?? 0)
        } else {
            newValue = .string(value)
        }
        Self.assign(newValue, at: name.split(separator: ".").map(String.init)[...], in: &raw)
    }

    func list(_ candidates: [String]) -> [String] {
        (Self.lookup(key(candidates), in: raw)?.arrayValue ?? []).map { $0.stringValue ?? "" }
    }

    mutating func setList(_ candidates: [String], _ value: [String]) {
        let name = key(candidates)
        Self.assign(.array(value.map { .string($0) }), at: name.split(separator: ".").map(String.init)[...], in: &raw)
    }
}

struct SGStageInfo {
    enum Status { case running, done }
    var status: Status
    var ms: Int?
}

@Observable
@MainActor
final class SGCreateModel {
    enum Step { case prompt, brief, generating, preview }

    static let maxPhotos = 8
    static let stageTitles: [(key: String, title: String)] = [
        ("plan", "Planning with Wonder"),
        ("content", "Writing content with Ember"),
        ("glue", "Writing new mechanics"),
        ("validate", "Validating"),
        ("repair", "Repairing"),
        ("save", "Saving"),
    ]

    var step: Step = .prompt

    // Prompt step
    var prompt = ""
    var level: SGCreatorLevel = .remix
    var useMedia = false
    var groups: [SGGroup] = []
    var media: [SGMedia] = []
    var selectedGroupID: String?
    var selectedMediaIDs: [String] = []
    var isLoadingMedia = false
    var mediaIsSample = false

    // Brief step
    var briefResponse: SGBriefResponse?
    var draft = SGBriefDraft()
    var isLoadingBrief = false
    var briefNote: String?

    // Generating step
    var stages: [String: SGStageInfo] = [:]
    var generationStart: Date?
    var totalMs: Int?
    var generateError: String?
    var game: SGGame?
    private var generationTask: Task<Void, Never>?

    // Preview / publish
    var isPublishing = false
    var publishError: String?

    private let api = ScrollGamesAPI.shared

    var canContinue: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var visibleMedia: [SGMedia] {
        guard let selectedGroupID else { return media }
        let group = groups.first { $0.id == selectedGroupID }
        return media.filter { $0.groupID == selectedGroupID || group?.mediaIDs.contains($0.id) == true }
    }

    /// Photos that go to the server: none unless the user opted in.
    var mediaIDsToSend: [String] { useMedia ? selectedMediaIDs : [] }

    /// Known stages in pipeline order, plus any the server sends that we don't know (repair only when it runs).
    var stageOrder: [(key: String, title: String)] {
        var rows = Self.stageTitles.filter { $0.key != "repair" || stages["repair"] != nil }
        for key in stages.keys.sorted() where !rows.contains(where: { $0.key == key }) {
            rows.append((key, key.capitalized))
        }
        return rows
    }

    func loadMedia() async {
        guard media.isEmpty else { return }
        isLoadingMedia = true
        defer { isLoadingMedia = false }
        do {
            async let loadedGroups = api.groups()
            async let loadedMedia = api.media()
            groups = try await loadedGroups
            media = try await loadedMedia
            mediaIsSample = false
        } catch {
            groups = SGSample.groups
            media = SGSample.media
            mediaIsSample = true
        }
    }

    func toggle(_ item: SGMedia) {
        if let index = selectedMediaIDs.firstIndex(of: item.id) {
            selectedMediaIDs.remove(at: index)
        } else if selectedMediaIDs.count < Self.maxPhotos {
            selectedMediaIDs.append(item.id)
        }
    }

    func requestBrief() async {
        isLoadingBrief = true
        briefNote = nil
        defer { isLoadingBrief = false }
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let response = try await api.brief(prompt: text, mediaIDs: mediaIDsToSend, level: level.rawValue, optIn: useMedia)
            applyBrief(response)
        } catch {
            applyBrief(SGSample.brief(for: text))
            briefNote = "Couldn't reach the server (\(error.localizedDescription)). This is an offline sample brief."
        }
        step = .brief
    }

    private func applyBrief(_ response: SGBriefResponse) {
        briefResponse = response
        draft = SGBriefDraft(raw: response.brief.objectValue ?? [:])
    }

    func generate() {
        generationTask?.cancel()
        step = .generating
        stages = [:]
        totalMs = nil
        generateError = nil
        game = nil
        let start = Date()
        generationStart = start
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let stream = api.generate(prompt: text, brief: draft.json, mediaIDs: mediaIDsToSend)
        generationTask = Task {
            do {
                for try await event in stream {
                    switch event {
                    case .stage(let name, let status, let ms):
                        stages[name] = SGStageInfo(status: status == "done" ? .done : .running, ms: ms)
                    case .done(let created):
                        game = created
                        totalMs = Int(Date().timeIntervalSince(start) * 1000)
                        Haptics.success()
                    case .failed(let message):
                        generateError = message
                    }
                }
                if game == nil && generateError == nil {
                    generateError = "The server closed the stream before finishing."
                }
            } catch is CancellationError {
                return
            } catch {
                generateError = error.localizedDescription
            }
        }
    }

    func cancelGeneration() {
        generationTask?.cancel()
        generationTask = nil
    }

    func publish() async -> (SGGame, SGFeedItem?)? {
        guard let game else { return nil }
        isPublishing = true
        publishError = nil
        defer { isPublishing = false }
        do {
            let result = try await api.publish(gameID: game.id)
            Haptics.success()
            return (result.game ?? game, result.feedItem)
        } catch {
            publishError = error.localizedDescription
            return nil
        }
    }
}
