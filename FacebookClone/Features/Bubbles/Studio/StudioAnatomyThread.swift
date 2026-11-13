import Foundation
import SwiftUI

/// The game anatomy conversation in Studio (docs/BUBBLES.md 7.13). Before the build, Muse proposes
/// the game's parts and the person corrects them; on Try, each "Change the game" message is mapped
/// onto those parts first, then the existing tweak path rebuilds the game with the updated anatomy.
///
/// The app asks no model itself, and the server has no anatomy endpoint yet, so a new game's
/// anatomy isn't drafted and "Change the game" isn't available (`isAvailable`; the card and the
/// chat say so). A game's saved anatomy still loads (`load`), and the person's own edits work.
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
    /// Set when Muse couldn't answer.
    private(set) var note: String?
    /// Slots changed by the last refinement, highlighted for a moment.
    private(set) var highlighted: Set<String> = []
    /// True once the person edited or answered something Muse hasn't read yet.
    private(set) var hasLocalChanges = false
    /// "Change the game" turns, oldest first.
    private(set) var turns: [Turn] = []

    /// False until the server can draft and revise an anatomy with Muse (docs/LIVE_DATA_AUDIT.md).
    static let isAvailable = false

    var isMapping: Bool { turns.last?.status == .mapping }

    // MARK: Draft (Brief step)

    /// Muse's first read of the request. Not available yet: the card shows `note`.
    func draft(request: String, audience: String?) {
        self.request = request
        self.audience = audience
        anatomy = nil
        lastReply = nil
        highlighted = []
        hasLocalChanges = false
        turns = []
        isWorking = false
        note = LiveDataCopy.anatomy
    }

    /// Sets an anatomy agreed earlier (a saved game's).
    func load(_ anatomy: GameAnatomy, request: String) {
        self.request = request
        self.anatomy = anatomy
        isWorking = false
        note = nil
    }

    /// Muse rereads the anatomy with the person's words, edits and answers. Not available yet; the
    /// person's edits are kept.
    func refine(_ change: String) {
        guard anatomy != nil, !isWorking else { return }
        note = LiveDataCopy.anatomy
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

    /// Maps the person's words onto the anatomy. Not available yet: the turn says so, and the
    /// change can't be made (a tweak needs a server endpoint too).
    func proposeChange(_ text: String, afterPlaying: Bool = true) {
        let change = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !change.isEmpty, !isMapping else { return }
        var turn = Turn(ask: change)
        turn.status = .failed(LiveDataCopy.anatomy)
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            turns.append(turn)
            if turns.count > 6 { turns.removeFirst(turns.count - 6) }
        }
    }

    /// The person made the change: the proposed anatomy becomes the agreed one. Returns the text
    /// for the tweak run: their words, what changes, and the updated anatomy.
    func confirm(_ id: UUID) -> String? {
        guard let turn = turns.first(where: { $0.id == id }) else { return nil }
        if let proposed = turn.proposed {
            var agreed = proposed
            agreed.reply = nil
            agreed.changed = []
            anatomy = agreed
        }
        update(id) { $0.status = .applied }
        return Self.tweakText(for: turn, anatomy: anatomy, request: request)
    }

    func dismiss(_ id: UUID) {
        update(id) { $0.status = .dismissed }
    }

    /// What the tweak run reads: the person's words first (so the timeline quotes them), then
    /// what changes and the anatomy to follow.
    static func tweakText(for turn: Turn, anatomy: GameAnatomy?, request: String) -> String {
        guard let anatomy else { return turn.ask }
        var lines = [turn.ask, ""]
        if !turn.slots.isEmpty {
            lines.append("\(anatomy.changeSentence(turn.slots)) Keep every other part as it is.")
        }
        lines.append(anatomy.agreedText(request: request))
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
        isWorking = false
        if let index = turns.indices.last, turns[index].status == .mapping {
            turns[index].status = .failed("Stopped.")
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

    /// The Try step's "Change the game" card: for new games (it says it isn't available yet) and
    /// for games with a saved anatomy.
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
    /// rebuilds the game with it.
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
