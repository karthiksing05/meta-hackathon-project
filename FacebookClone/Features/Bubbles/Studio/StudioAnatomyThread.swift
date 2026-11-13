import Foundation
import SwiftUI

/// The game anatomy conversation in Studio (docs/BUBBLES.md 7.13). Before the build, Muse proposes
/// the game's parts and the person corrects them; on Try, each "Change the game" message is mapped
/// onto those parts first, then the existing tweak path rebuilds the game with the updated anatomy.
///
/// Uses real Muse when it's configured; otherwise (or with `FB_STUDIO_ANATOMY=fixture`) the
/// fixtures in `GameAnatomyFixtures`, so the flow works offline and in screenshots.
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
    /// True when this anatomy came from the fixtures (no Muse).
    private(set) var usesFixtures = false

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var fragments: String?
    let muse = GameAnatomyMuse()

    /// Fixtures when Muse isn't configured or `FB_STUDIO_ANATOMY` (DEBUG) asks for them.
    var prefersFixtures: Bool {
        DebugLaunch.value("FB_STUDIO_ANATOMY") != nil || !muse.isConfigured
    }

    var isMapping: Bool { turns.last?.status == .mapping }

    // MARK: Draft (Brief step)

    /// Muse's first read of the request. Replaces any earlier anatomy.
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
        usesFixtures = prefersFixtures
        if usesFixtures {
            task = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 700_000_000)
                guard let self, !Task.isCancelled else { return }
                self.finishWork(GameAnatomyFixtures.anatomy(for: request))
            }
            return
        }
        let muse = muse
        task = Task { [weak self] in
            guard let self else { return }
            let fragments = await self.fragmentLines()
            do {
                let drafted = try await muse.draft(request: request, audience: audience, fragments: fragments)
                guard !Task.isCancelled else { return }
                self.finishWork(drafted)
            } catch {
                guard !Task.isCancelled else { return }
                self.isWorking = false
                self.note = "Muse couldn't take the game apart just now. You can still make it, or try again."
            }
        }
    }

    /// Sets a ready-made anatomy (DEBUG screenshots).
    /// Sets an anatomy agreed earlier: a saved game's (`fixtures` false) or a DEBUG fixture.
    func load(_ anatomy: GameAnatomy, request: String, fixtures: Bool = true) {
        task?.cancel()
        self.request = request
        self.anatomy = anatomy
        isWorking = false
        usesFixtures = fixtures || prefersFixtures
        note = nil
    }

    /// Muse rereads the anatomy with the person's words, edits and answers. `change` may be empty
    /// ("Check my answers").
    func refine(_ change: String) {
        guard let current = anatomy, !isWorking else { return }
        task?.cancel()
        isWorking = true
        note = nil
        let request = request
        if usesFixtures {
            task = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 600_000_000)
                guard let self, !Task.isCancelled else { return }
                self.finishWork(GameAnatomyFixtures.revised(current, change: change), from: current)
            }
            return
        }
        let muse = muse
        task = Task { [weak self] in
            guard let self else { return }
            let fragments = await self.fragmentLines()
            do {
                let revised = try await muse.revise(current, request: request, change: change, afterPlaying: false, fragments: fragments)
                guard !Task.isCancelled else { return }
                self.finishWork(revised, from: current)
            } catch {
                guard !Task.isCancelled else { return }
                self.isWorking = false
                self.note = "Muse couldn't read that change just now. Your edits are kept."
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

    /// Maps the person's words onto the anatomy. The turn waits for `confirm` to rebuild.
    func proposeChange(_ text: String, afterPlaying: Bool = true) {
        let change = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !change.isEmpty, !isMapping else { return }
        let base = anatomy ?? GameAnatomyFixtures.anatomy(for: request)
        var turn = Turn(ask: change)
        turn.status = .mapping
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            turns.append(turn)
            if turns.count > 6 { turns.removeFirst(turns.count - 6) }
        }
        let id = turn.id
        let request = request
        if usesFixtures || anatomy == nil {
            task = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 700_000_000)
                guard let self, !Task.isCancelled else { return }
                self.finishTurn(id, base: base, revised: GameAnatomyFixtures.revised(base, change: change))
            }
            return
        }
        let muse = muse
        task = Task { [weak self] in
            guard let self else { return }
            let fragments = await self.fragmentLines()
            do {
                let revised = try await muse.revise(base, request: request, change: change, afterPlaying: afterPlaying, fragments: fragments)
                guard !Task.isCancelled else { return }
                self.finishTurn(id, base: base, revised: revised)
            } catch {
                guard !Task.isCancelled else { return }
                self.update(id) { $0.status = .failed("Muse couldn't map that just now. You can still make the change as written.") }
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
        task?.cancel()
        task = nil
        isWorking = false
        if let index = turns.indices.last, turns[index].status == .mapping {
            turns[index].status = .failed("Stopped.")
        }
    }

    private func fragmentLines() async -> String {
        if let fragments { return fragments }
        let lines = await GameAnatomyMuse.fragmentLines()
        fragments = lines
        return lines
    }

    // MARK: DEBUG

    /// A finished "Change the game" turn, for screenshots.
    func debugAddTurn(_ ask: String, status: Turn.Status) {
        let base = anatomy ?? GameAnatomyFixtures.anatomy(for: request)
        let revised = GameAnatomyFixtures.revised(base, change: ask)
        var turn = Turn(ask: ask)
        turn.slots = revised.changes(from: base)
        turn.proposed = revised
        turn.reply = revised.reply
        turn.status = status
        if status == .applied {
            var agreed = revised
            agreed.reply = nil
            agreed.changed = []
            anatomy = agreed
        }
        turns.append(turn)
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

    /// The Try step's "Change the game" thread shows once there is an anatomy to change.
    var showsAnatomyChat: Bool { anatomyThread.anatomy != nil }

    /// Edit, Remix and the next level start from the base game's saved anatomy.
    func loadSavedAnatomy() {
        guard let base = baseBubble, let record = MakeRecordStore.shared.record(for: base.id),
              let text = record.anatomyJSON, let value = try? JSONValue.parse(text),
              let anatomy = GameAnatomy.decode(value) else { return }
        anatomyThread.load(anatomy, request: record.anatomyRequest ?? base.manifest.brief.intent, fixtures: false)
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
