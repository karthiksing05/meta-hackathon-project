import Foundation
import SwiftUI

/// The game anatomy conversation in Studio (docs/BUBBLES.md 7.13). Before the build, Muse proposes
/// the game's parts and the person corrects them; on Try, each "Change the game" message is mapped
/// onto those parts first, then the tweak path rebuilds the game with the updated parts.
///
/// The server asks Muse (`POST /v1/anatomy` and `/v1/anatomy/revise`, about 5 to 10 s each); the app
/// decodes the reply (`GameAnatomy.decode`) and calibrates it against the engine's fragments
/// (`GameAnatomy.calibrated`). When a call fails, the server's message is shown as is ("Muse is not
/// set up on this server yet" for a 503, "Muse couldn't take this game apart" for a 502) and the
/// person can try again or make the change as written.
@MainActor
@Observable
final class StudioAnatomyThread {
    /// One "Change the game" exchange on Try.
    struct Turn: Identifiable, Equatable {
        enum Status: Equatable {
            /// Muse is mapping the words onto the anatomy.
            case mapping
            /// Mapped; waiting for the person to make the change.
            case proposed
            /// The rebuild is running or done.
            case applied
            /// Not made (the person said "Not quite").
            case dismissed
            case failed(String)
        }

        let id = UUID()
        var ask: String
        var status: Status = .mapping
        /// "This changes rule 2 and how it ends."
        var reply: String?
        /// Changed slots ("end", "rules.2").
        var slots: [String] = []
        /// The anatomy with the change, once mapped.
        var proposed: GameAnatomy?
    }

    /// The person's own words for the game, verbatim.
    private(set) var request = ""
    private(set) var audience: String?
    var anatomy: GameAnatomy?
    /// Muse is drafting or refining the anatomy (the Brief step).
    private(set) var isWorking = false
    /// Muse's reply to the last refinement on the Brief step.
    private(set) var lastReply: String?
    /// Set when Muse couldn't answer: the server's words, shown as is.
    private(set) var note: String?
    /// Slots changed by the last refinement, highlighted for a moment.
    private(set) var highlighted: Set<String> = []
    /// True once the person edited or answered something Muse hasn't read yet.
    private(set) var hasLocalChanges = false
    /// "Change the game" turns, oldest first.
    private(set) var turns: [Turn] = []

    @ObservationIgnored private var task: Task<Void, Never>?
    /// The engine's fragment ids, for calibrating Muse's familiarity (empty if the catalog didn't load).
    @ObservationIgnored private var fragmentIDs: Set<String>?
    @ObservationIgnored private let api: any GamesAPI

    init(api: any GamesAPI = GamesAPIFactory.current) {
        self.api = api
    }

    var isMapping: Bool { turns.last?.status == .mapping }

    // MARK: Draft (Brief step)

    /// Muse's first read of the request (`POST /v1/anatomy`). Replaces any earlier anatomy.
    func draft(request: String, audience: String?) {
        task?.cancel()
        self.request = request
        self.audience = audience
        anatomy = nil
        lastReply = nil
        note = nil
        highlighted = []
        hasLocalChanges = false
        turns = []
        isWorking = true
        let api = api
        task = Task { [weak self] in
            guard let self else { return }
            do {
                async let known = self.knownFragments()
                let value = try await api.anatomy(request: request, audience: audience)
                let drafted = try Self.read(value, knownFragments: await known)
                guard !Task.isCancelled else { return }
                self.finishWork(drafted)
            } catch {
                guard !Task.isCancelled, !(error is CancellationError) else { return }
                self.isWorking = false
                self.note = Self.message(for: error, doing: "take the game apart")
            }
        }
    }

    /// Sets an anatomy agreed earlier (a saved game's).
    func load(_ anatomy: GameAnatomy, request: String) {
        task?.cancel()
        self.request = request
        self.anatomy = anatomy
        isWorking = false
        note = nil
    }

    /// Muse rereads the anatomy with the person's words, edits and answers
    /// (`POST /v1/anatomy/revise`). `change` may be empty ("Check my answers"). The person's edits
    /// are kept when it fails.
    func refine(_ change: String) {
        guard let current = anatomy, !isWorking else { return }
        task?.cancel()
        isWorking = true
        note = nil
        let request = request
        let api = api
        task = Task { [weak self] in
            guard let self else { return }
            do {
                async let known = self.knownFragments()
                let value = try await api.reviseAnatomy(current.json, change: change, request: request, afterPlaying: false)
                let revised = try Self.read(value, knownFragments: await known)
                guard !Task.isCancelled else { return }
                self.finishWork(revised, from: current)
            } catch {
                guard !Task.isCancelled, !(error is CancellationError) else { return }
                self.isWorking = false
                self.note = Self.message(for: error, doing: "read that change") + " Your edits are kept."
            }
        }
    }

    private func finishWork(_ new: GameAnatomy, from old: GameAnatomy? = nil) {
        isWorking = false
        hasLocalChanges = false
        if let old {
            let slots = new.changes(from: old)
            lastReply = new.reply ?? new.changeSentence(slots)
            highlighted = Set(slots)
        } else {
            lastReply = nil
            highlighted = []
        }
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
            anatomy = new
        }
    }

    // MARK: Local edits

    func setText(_ text: String, slot: String) {
        guard var current = anatomy, current.text(slot: slot) != text.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
        current.setText(text, slot: slot)
        anatomy = current
        hasLocalChanges = true
    }

    func answer(_ answer: String?, slot: String) {
        guard var current = anatomy else { return }
        current.setAnswer(answer, slot: slot)
        anatomy = current
        hasLocalChanges = true
    }

    // MARK: Change the game (Try step)

    /// Maps the person's words onto the anatomy (`POST /v1/anatomy/revise`, `afterPlaying`). The
    /// turn waits for `confirm` to rebuild. Without an anatomy (it was never drafted) the turn says
    /// so, and the person can make the change as written.
    func proposeChange(_ text: String, afterPlaying: Bool = true) {
        let change = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !change.isEmpty, !isMapping else { return }
        var turn = Turn(ask: change)
        if anatomy == nil {
            turn.status = .failed("Muse hasn't taken this game apart, so it can't show which parts change. You can still make the change as written.")
        }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            turns.append(turn)
            if turns.count > 6 { turns.removeFirst(turns.count - 6) }
        }
        guard let base = anatomy else { return }
        let id = turn.id
        let request = request
        let api = api
        task?.cancel()
        task = Task { [weak self] in
            guard let self else { return }
            do {
                async let known = self.knownFragments()
                let value = try await api.reviseAnatomy(base.json, change: change, request: request, afterPlaying: afterPlaying)
                let revised = try Self.read(value, knownFragments: await known)
                guard !Task.isCancelled else { return }
                self.finishTurn(id, base: base, revised: revised)
            } catch {
                guard !Task.isCancelled, !(error is CancellationError) else { return }
                let message = Self.message(for: error, doing: "map that")
                self.update(id) { $0.status = .failed("\(message) You can still make the change as written.") }
            }
        }
    }

    private func finishTurn(_ id: UUID, base: GameAnatomy, revised: GameAnatomy) {
        let slots = revised.changes(from: base)
        update(id) { turn in
            turn.slots = slots
            turn.proposed = revised
            var reply = revised.reply ?? revised.changeSentence(slots)
            let new = revised.unfamiliar(in: slots)
            if !new.isEmpty, revised.reply == nil {
                reply += " \(GameAnatomy.sentence(GameAnatomy.list(new.map { revised.label(slot: $0) }))) \(new.count == 1 ? "is" : "are") new to me."
            }
            turn.reply = reply
            turn.status = .proposed
        }
    }

    /// The person made the change: the proposed anatomy becomes the agreed one. Returns the text
    /// for the tweak run: their words, then what changes.
    func confirm(_ id: UUID) -> String? {
        guard let turn = turns.first(where: { $0.id == id }) else { return nil }
        if let proposed = turn.proposed {
            var agreed = proposed
            agreed.reply = nil
            agreed.changed = []
            anatomy = agreed
        }
        update(id) { $0.status = .applied }
        return Self.tweakText(for: turn, anatomy: anatomy)
    }

    func dismiss(_ id: UUID) {
        update(id) { $0.status = .dismissed }
    }

    /// What the tweak run reads: the person's words first (so the timeline quotes them), then
    /// which parts change and their new wording. The game being changed already follows the rest
    /// of the anatomy, and the server takes a short change (`GameRevision.maxChangeCharacters`).
    static func tweakText(for turn: Turn, anatomy: GameAnatomy?) -> String {
        guard let anatomy, !turn.slots.isEmpty else { return turn.ask }
        var lines = [turn.ask, "", "\(anatomy.changeSentence(turn.slots)) Keep every other part as it is."]
        for slot in turn.slots {
            let label = GameAnatomy.sentence(anatomy.label(slot: slot))
            if let text = anatomy.text(slot: slot) {
                lines.append("- \(label): \(text)")
            } else {
                lines.append("- \(label): removed")
            }
        }
        return lines.joined(separator: "\n")
    }

    private func update(_ id: UUID, _ body: (inout Turn) -> Void) {
        guard let index = turns.firstIndex(where: { $0.id == id }) else { return }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            body(&turns[index])
        }
    }

    // MARK: The build

    /// The agreed anatomy as the build reads it, or nil when there is none.
    var agreedText: String? {
        anatomy.map { $0.agreedText(request: request) }
    }

    func cancel() {
        task?.cancel()
        task = nil
        isWorking = false
        if let index = turns.indices.last, turns[index].status == .mapping {
            turns[index].status = .failed("Stopped.")
        }
    }

    // MARK: Server replies

    /// Decodes the server's `game-anatomy/0.1` reply and calibrates it on the phone.
    private static func read(_ value: JSONValue, knownFragments: Set<String>) throws -> GameAnatomy {
        guard let anatomy = GameAnatomy.decode(value) else { throw GamesAPIError.decoding("Muse's reply wasn't a game anatomy") }
        return anatomy.calibrated(knownFragments: knownFragments)
    }

    /// The engine's fragment ids from the microgame catalog, loaded once (waits at most 5 s; an
    /// empty set lets `calibrated` accept any fragment Muse names).
    private func knownFragments() async -> Set<String> {
        if let fragmentIDs { return fragmentIDs }
        let catalog = try? await StudioAsyncMain.withTimeout(5, operation: "read the catalog") {
            try await MicrogameStudio.shared.catalog()
        }
        let ids = Set((catalog?.fragments ?? []).map { $0.id.lowercased() }.filter { !$0.isEmpty })
        if !ids.isEmpty { fragmentIDs = ids }
        return ids
    }

    /// What the card says when a call fails: the server's own message for its errors (503 Muse
    /// isn't set up, 502 a bad reply, 429 busy), plain words otherwise.
    static func message(for error: Error, doing what: String) -> String {
        switch error as? GamesAPIError {
        case .server(_, let message)? where !message.isEmpty:
            let text = GameAnatomy.sentence(message)
            return text.hasSuffix(".") ? text : text + "."
        case .network?:
            return "Couldn't reach the game server, so Muse couldn't \(what). Check your connection and try again."
        case .signInRequired?:
            return "Couldn't sign in to the game server. Try again in a moment."
        default:
            return "Muse couldn't \(what) just now. Try again."
        }
    }
}

// MARK: - Studio

extension StudioModel {
    /// New games get the anatomy conversation; edits, remixes, levels and Dailies keep their base.
    var usesAnatomy: Bool { mode == .create }

    /// The agreed anatomy for the build, when there is one (new games, and remixes of a game that
    /// has one).
    var agreedAnatomyText: String? {
        anatomyThread.agreedText
    }

    /// "How the game works" shows on the Brief step for new games, and for remixes that carry
    /// their base's anatomy.
    var showsAnatomyCard: Bool { usesAnatomy || anatomyThread.anatomy != nil }

    /// Starts Muse on the anatomy when the request is new (going back to Describe and on again
    /// with the same words keeps the person's edits).
    func draftAnatomyIfNeeded() {
        guard usesAnatomy else { return }
        let thread = anatomyThread
        if thread.request == effectivePrompt, thread.anatomy != nil || thread.isWorking { return }
        thread.draft(request: effectivePrompt, audience: audience == .everyone ? nil : audiencePhrase)
    }

    /// The Try step's "Change the game" card: for new games and for games with a saved anatomy.
    var showsAnatomyChat: Bool { usesAnatomy || anatomyThread.anatomy != nil }

    /// Edit, Remix and the next level start from the base game's saved anatomy.
    func loadSavedAnatomy() {
        guard let base = baseBubble, let record = MakeRecordStore.shared.record(for: base.id),
              let text = record.anatomyJSON, let value = try? JSONValue.parse(text),
              let anatomy = GameAnatomy.decode(value) else { return }
        anatomyThread.load(anatomy, request: record.anatomyRequest ?? base.manifest.brief.intent)
    }

    /// Saves the agreed anatomy with each game Studio just shared or saved (its make record).
    func saveAnatomy(gameIDs: [String]) {
        guard let anatomy = anatomyThread.anatomy else { return }
        let text = anatomy.json.jsonString()
        let store = MakeRecordStore.shared
        for id in Set(gameIDs) {
            guard let bubble = bubbleStore?.bubble(id: id) else { continue }
            var record = store.record(for: id) ?? MakeRecord.build(
                gameID: id, events: [], reports: [:], isMicrogame: bubble.formula == .microgame,
                concepts: bubble.manifest.conceptIDs, models: bubble.manifest.studio?.models ?? [],
                seconds: bubble.manifest.studio?.durationSec, isOffline: bubble.manifest.studio?.offline ?? false, sourcesUsed: []
            )
            record.anatomyJSON = text
            record.anatomyRequest = anatomyThread.request
            store.save(record)
        }
    }

    /// Makes a mapped change: the updated anatomy becomes the agreed one and the tweak path
    /// rebuilds the game with its changed parts (a change on the server).
    func makeAnatomyChange(_ id: UUID) {
        guard !isComposing, let text = anatomyThread.confirm(id) else { return }
        startCompose(.tweak, text: text)
    }

    /// Muse couldn't map it: make the change from the person's words alone.
    func makeChangeAsWritten(_ id: UUID) {
        guard !isComposing, let turn = anatomyThread.turns.first(where: { $0.id == id }) else { return }
        anatomyThread.dismiss(id)
        startCompose(.tweak, text: turn.ask)
    }
}
