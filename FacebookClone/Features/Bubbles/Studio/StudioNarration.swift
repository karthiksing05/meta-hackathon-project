import SwiftUI

/// Turns Studio's progress into `MuseNarrator` lines: the brief, each step of the Build timeline,
/// the playtest verdict and Try. Lines are written here from the events Studio already has (step
/// and title); nothing asks Muse for them. Attach once, on `StudioView`.
///
/// One line per moment: a build that just finished already said it's ready, so arriving on Try
/// right after it says nothing more (the done line tells them to play).
struct StudioNarration: ViewModifier {
    let model: StudioModel

    @State private var narrator = MuseNarrator.shared
    /// Steps already said in this build, so repeated events (two fix rounds) say it once.
    @State private var saidSteps: Set<StudioStep> = []
    /// When the last build said its done line.
    @State private var saidReadyAt: Date?

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
            .onChange(of: model.isWaitingForAnatomy) { _, waiting in
                if waiting { narrator.say(StudioNarrationCopy.readingAnatomy) }
            }
            .onChange(of: model.events.count) { old, new in
                if new < old || new == 0 { saidSteps = [] }
                guard new > old, let event = model.events.last else { return }
                narrate(event)
            }
            .onChange(of: model.failure?.message) { _, message in
                if message != nil { narrator.say(StudioNarrationCopy.failed, urgent: true) }
            }
            .onChange(of: model.stage) { old, stage in
                narrator.holdForGame = false
                switch stage {
                case .brief where old == .ask:
                    narrator.say(StudioNarrationCopy.briefReady)
                case .tryIt:
                    // Straight from a build: its done line already said to play.
                    if saidReadyAt.map({ Date().timeIntervalSince($0) > 8 }) ?? true {
                        narrator.say(StudioNarrationCopy.tryIt)
                    }
                    // After this, stay quiet while they play.
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
        if event.step == .done {
            saidReadyAt = Date()
            narrator.say(model.buildChanges == nil ? StudioNarrationCopy.ready : StudioNarrationCopy.readyWithChanges, urgent: true)
            return
        }
        if event.step == .failed {
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
    static let readingAnatomy = "Muse is finishing how the game works, then it starts building."
    static let ready = "It passed the playtest. Give it a try."
    static let readyWithChanges = "It's ready. Play it, then add your changes if you like."
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
        case .done: return ready
        case .failed: return failed
        }
    }
}
