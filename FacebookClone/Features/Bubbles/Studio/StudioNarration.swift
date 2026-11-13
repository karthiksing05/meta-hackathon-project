import SwiftUI

/// Turns Studio's progress into `MuseNarrator` lines: drafting the brief, each step of the Build
/// timeline, the playtest verdict and Try. Lines are written here from the events Studio already
/// has (step and title); nothing asks Muse for them. Attach once, on `StudioView`.
struct StudioNarration: ViewModifier {
    let model: StudioModel

    @State private var narrator = MuseNarrator.shared
    /// Steps already said in this build, so repeated events (two fix rounds) say it once.
    @State private var saidSteps: Set<StudioStep> = []

    func body(content: Content) -> some View {
        content
            .onAppear { narrator.reset() }
            .onDisappear {
                narrator.holdForGame = false
                narrator.stop()
            }
            .onChange(of: model.isDraftingBrief) { _, drafting in
                if drafting {
                    narrator.say(StudioNarrationCopy.draftingBrief)
                } else if model.brief != nil, model.stage == .brief {
                    narrator.say(StudioNarrationCopy.briefReady)
                }
            }
            .onChange(of: model.events.count) { old, new in
                if new < old || new == 0 { saidSteps = [] }
                guard new > old, let event = model.events.last else { return }
                narrate(event)
            }
            .onChange(of: model.failure?.message) { _, message in
                if message != nil { narrator.say(StudioNarrationCopy.failed, urgent: true) }
            }
            .onChange(of: model.stage) { _, stage in
                narrator.holdForGame = false
                switch stage {
                case .tryIt:
                    narrator.say(StudioNarrationCopy.tryIt)
                    // After this line, stay quiet while they play.
                    narrator.holdForGame = true
                case .float:
                    narrator.say(StudioNarrationCopy.share)
                default:
                    break
                }
            }
            .onChange(of: GameSound.isMuted) { _, muted in
                if muted { narrator.stop() }
            }
    }

    private func narrate(_ event: StudioEvent) {
        if event.step == .done || event.step == .failed {
            narrator.say(StudioNarrationCopy.line(for: event), urgent: true)
            return
        }
        guard !saidSteps.contains(event.step) else { return }
        saidSteps.insert(event.step)
        narrator.say(StudioNarrationCopy.line(for: event))
    }
}

extension View {
    /// Spoken narration of what Muse is doing (`MuseNarrator`).
    func studioNarration(_ model: StudioModel) -> some View {
        modifier(StudioNarration(model: model))
    }
}

/// The narration lines: short, plain, sentence case. One place, so copy changes stay small.
enum StudioNarrationCopy {
    static let draftingBrief = "Muse is reading your idea and writing a brief."
    static let briefReady = "Here's the brief. Change anything you like, then build it."
    static let tryIt = "It's ready. Give it a try."
    static let share = "Pick who to share it with."
    static let failed = "Muse hit a snag. You can try again."

    static func line(for event: StudioEvent) -> String {
        switch event.step {
        case .understand: return "Muse is reading your request."
        case .brief: return "Writing the brief."
        case .compose: return "Muse is picking the rules."
        case .glue: return "Writing a little custom code."
        case .content: return "Making the content."
        case .validate: return "Checking that everything's wired up."
        case .repair: return "Fixing a couple of things."
        case .playtest: return "Now playtesting with bots."
        case .cover: return "Painting the cover."
        case .polish: return "Final touches."
        case .done: return "It passed. Your \(ProductName.singular) is ready."
        case .failed: return failed
        }
    }
}
