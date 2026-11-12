import SwiftUI
import UIKit

/// Step 3, Build: "Muse at work". The orb grows only when a real step arrives; under it the
/// storyboard (`ShowcaseBuildStage`) lights each beat Muse really reached (draft, check, fix N
/// issues, bots playtesting, ready), and the timeline streams the events themselves (model,
/// detail, concepts, problems and fixes, the bots' runs). Formula games come from the
/// `StudioEvent` stream; microgames from `MicrogameComposer` through `StudioMicrogameBridge`.
/// Takes 20–60 s with Muse (microgames can take longer).
struct StudioComposeStep: View {
    let model: StudioModel

    var body: some View {
        VStack(spacing: 0) {
            StudioComposeHeader(model: model)
                .padding(.horizontal, FBMetrics.screenPadding)
            ShowcaseBuildStage(
                events: model.events,
                isMicrogame: model.runIsMicrogame,
                kind: model.composeKind,
                isWorking: model.isComposing,
                failed: model.failure != nil
            )
            .padding(.bottom, FBSpacing.s)
            StudioComposeTimeline(model: model)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomBar
        }
    }

    @ViewBuilder
    private var bottomBar: some View {
        if model.isComposing {
            StudioActionBar {
                Button {
                    Haptics.light()
                    model.cancelCompose()
                } label: {
                    Text("Cancel")
                }
                .buttonStyle(.studioSecondary(expand: true, height: 44))
            }
            .transition(.opacity)
        } else if model.failure != nil {
            StudioActionBar {
                Button {
                    Haptics.selection()
                    model.cancelCompose()
                } label: {
                    Text(model.composeKind == .create ? "Back to the brief" : "Back to my \(ProductName.singular)")
                }
                .buttonStyle(.studioSecondary(expand: true, height: 44))
            }
            .transition(.opacity)
        }
    }
}

// MARK: - Header

private struct StudioComposeHeader: View {
    let model: StudioModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var smoother = GameProgressSmoother()
    @State private var coverImage: UIImage?

    var body: some View {
        VStack(spacing: 6) {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion || model.failure != nil)) { context in
                let target = model.progressTarget(at: context.date)
                StudioBlowingBubble(
                    progress: reduceMotion ? target : smoother.step(toward: target, at: context.date),
                    time: context.date.timeIntervalSinceReferenceDate,
                    palette: model.draftManifest.map { BubbleGlow.palette(for: $0.style) },
                    emoji: model.draftManifest?.style.emoji,
                    cover: coverImage,
                    isWorking: model.isComposing,
                    isFinished: model.isFinished,
                    reduceMotion: reduceMotion
                )
            }
            .frame(height: 140)
            .animation(.easeInOut(duration: 0.5), value: coverImage != nil)

            Text(headline)
                .font(.fbTitle)
                .studioRounded()
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
                .contentTransition(.opacity)
                .animation(.easeInOut(duration: 0.3), value: headline)
                .accessibilityAddTraits(.isHeader)
            statusLine
            tipLine
        }
        .padding(.bottom, FBSpacing.m)
        .task(id: model.draftCover) {
            coverImage = model.draftCover.flatMap { UIImage(data: $0) }
        }
    }

    private var headline: String {
        if model.failure != nil { return "This \(ProductName.singular) didn't load" }
        let title = model.draftManifest?.title
        switch model.composeKind {
        case .create:
            if model.isFinished {
                let name = (title ?? "").trimmingCharacters(in: .whitespaces)
                return name.isEmpty ? "Your \(ProductName.singular) is ready" : name
            }
            if model.mode == .remix { return "Muse is remixing \(model.baseTitle)" }
            if model.runIsMicrogame { return "Muse is building your \(ProductName.singular) from scratch" }
            if model.mode == .nextLevel { return "Muse is making level \((model.baseBubble?.levelIndex ?? 1) + 1)" }
            return "Muse is making your \(ProductName.singular)"
        case .tweak:
            let name = model.currentResult?.manifest.title ?? "your \(ProductName.singular)"
            return model.isFinished ? "Tweaked and ready" : "Muse is tweaking \(name)"
        case .nextLevel:
            let number = model.levels.last.flatMap { $0.manifest.chain?.index } ?? model.levelButtonNumber
            return model.isFinished ? "Level \(number) is ready" : "Muse is making level \(model.levelButtonNumber)"
        }
    }

    private var statusLine: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(spacing: 6) {
                Text(statusText(at: context.date))
                    .monospacedDigit()
                    .lineLimit(1)
                if model.sawOfflineEvent || !model.isMuseConnected {
                    StudioModelChip(info: StudioModelInfo(name: "Offline composer", tint: StudioGlow.offline, symbol: "bolt.horizontal.circle"))
                }
            }
            .font(.fbMetaEmphasized)
            .foregroundStyle(FBColor.secondaryText)
            .transaction { $0.animation = nil }
        }
    }

    private func statusText(at date: Date) -> String {
        let clock = model.clockText(at: date)
        if model.isFinished { return "Made in \(clock)" }
        if model.failure != nil { return "Stopped at \(clock)" }
        // Microgame events carry the composer's own words; formula steps use the step's name.
        let step = model.runIsMicrogame ? (model.currentEvent?.title ?? "Getting started") : (model.currentEvent?.step.title ?? "Getting started")
        return "\(clock) · \(step)"
    }

    private var tipLine: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let tip = model.tip(at: context.date)
            ZStack {
                Text(tip)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                    .id(tip)
                    .transition(.blurReplace)
            }
            .animation(.easeInOut(duration: 0.5), value: tip)
        }
        .opacity(model.isComposing ? 1 : 0)
        .accessibilityHidden(!model.isComposing)
    }
}

// MARK: - Timeline

private struct StudioComposeTimeline: View {
    let model: StudioModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if model.events.isEmpty && model.isComposing {
                        StudioStartingRow()
                    }
                    ForEach(Array(model.events.enumerated()), id: \.element.id) { index, event in
                        VStack(alignment: .leading, spacing: 0) {
                            StudioTimelineRow(
                                event: event,
                                state: state(at: index),
                                showsConnector: index < model.events.count - 1
                            )
                            if let report = model.playtestReports[event.id], !report.runs.isEmpty {
                                // The bots' real runs, under the playtest result that carried them.
                                ShowcaseBotLanes(lanes: MakeRecord.lanes(from: report))
                                    .padding(.leading, FBSpacing.m + 32 + FBSpacing.m)
                                    .padding(.trailing, FBSpacing.m)
                                    .padding(.bottom, FBSpacing.s)
                            }
                        }
                        .id(event.id)
                        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                    }
                    if let failure = model.failure {
                        StudioComposeFailureCard(model: model, failure: failure)
                            .padding(.top, FBSpacing.m)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(StudioComposeTimeline.bottomID)
                }
                .padding(.horizontal, FBMetrics.screenPadding - FBSpacing.xs)
                .padding(.bottom, FBSpacing.l)
            }
            .scrollIndicators(.hidden)
            .defaultScrollAnchor(.bottom)
            .onChange(of: model.events.count) {
                withAnimation(.easeOut(duration: 0.35)) {
                    proxy.scrollTo(StudioComposeTimeline.bottomID, anchor: .bottom)
                }
            }
            .onChange(of: model.failure) {
                withAnimation(.easeOut(duration: 0.35)) {
                    proxy.scrollTo(StudioComposeTimeline.bottomID, anchor: .bottom)
                }
            }
            .onAppear {
                proxy.scrollTo(StudioComposeTimeline.bottomID, anchor: .bottom)
            }
        }
        .mask {
            // Rows fade out under the header as they scroll up.
            LinearGradient(colors: [.clear, .black, .black], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.06))
        }
    }

    private static let bottomID = "studio-timeline-bottom"

    private func state(at index: Int) -> StudioRowState {
        let event = model.events[index]
        if event.step == .failed { return .failed }
        guard index == model.events.count - 1 else { return .done }
        if model.failure != nil { return .failed }
        return model.isComposing ? .active : .done
    }
}

/// Shown until Muse's first step arrives.
private struct StudioStartingRow: View {
    var body: some View {
        StudioTimelineRow(
            event: StudioEvent(step: .understand, title: "Waking up Muse", detail: "Sending your brief to Muse Studio"),
            state: .active,
            showsConnector: false
        )
    }
}

private struct StudioComposeFailureCard: View {
    let model: StudioModel
    let failure: StudioFailure

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            HStack(spacing: FBSpacing.s) {
                Image(systemName: "exclamationmark.bubble.fill")
                    .font(.system(size: FBIconSize.large, weight: .semibold))
                    .foregroundStyle(StudioGlow.issue)
                Text("Muse hit a snag")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
            }
            Text(failure.message)
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            if let detail = failure.detail {
                Text(detail)
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Haptics.light()
                model.retry(offline: false)
            } label: {
                Label("Try again", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.studioPrimary)
            if model.runIsMicrogame && model.composeKind == .create {
                // A microgame that won't come together can still be a game today.
                Button {
                    Haptics.light()
                    model.useFormulaInstead()
                } label: {
                    Label("Make it with a ready formula", systemImage: "square.stack.3d.up")
                }
                .buttonStyle(.studioSecondary(expand: true, height: 44))
            }
            if model.canTryOffline && !model.runIsMicrogame {
                Button {
                    Haptics.light()
                    model.retry(offline: true)
                } label: {
                    Label("Try the offline composer", systemImage: "bolt.horizontal.circle")
                }
                .buttonStyle(.studioSecondary(expand: true, height: 44))
            }
        }
        .studioCard()
    }
}

// MARK: - Progress and tips

extension StudioModel {
    /// The header orb's size target: the furthest step really reached. It never grows on time
    /// alone; between events the orb breathes instead (`StudioBlowingBubble`'s wobble).
    func progressTarget(at date: Date) -> Double {
        let reached = reachedProgress
        guard isComposing else { return reached }
        return min(0.97, max(0.04, reached))
    }

    /// "0:23".
    func clockText(at date: Date) -> String {
        guard let start = composeStartedAt else { return "0:00" }
        return StudioFormat.clock((composeEndedAt ?? date).timeIntervalSince(start))
    }

    /// What Muse is doing right now, rotating every few seconds during long steps.
    func tip(at date: Date) -> String {
        let step = currentEvent?.step ?? .understand
        let tips = (runIsMicrogame ? StudioModel.microgameTips(for: step) : StudioModel.tips(for: step)) + StudioModel.generalTips
        let waited = max(0, date.timeIntervalSince(lastEventAt ?? date))
        return tips[Int(waited / 6) % tips.count]
    }

    nonisolated static let generalTips = [
        "Every \(ProductName.singular) is playtested by bots before anyone plays.",
        "You can tweak anything with Muse once it's ready.",
        "When it's ready, challenge friends to beat your score.",
    ]

    nonisolated static func microgameTips(for step: StudioStep) -> [String] {
        switch step {
        case .compose: return ["Muse is writing the whole game: rules, art and sound."]
        case .validate: return ["The game engine builds Muse's draft and checks every rule."]
        case .repair: return ["Muse gets each problem with where it is, and fixes it."]
        case .playtest: return ["New, regular and pro bots play it on the real engine."]
        default: return tips(for: step)
        }
    }

    nonisolated static func tips(for step: StudioStep) -> [String] {
        switch step {
        case .understand: return ["Muse is reading your idea and who it's for."]
        case .brief: return ["Turning your words into a game brief."]
        case .compose: return ["Picking concepts from the library and wiring them together."]
        case .glue: return ["Writing a few lines of custom code for your twist."]
        case .content: return ["Ember is writing the words, clues and names."]
        case .validate: return ["Checking every rule connects and the game can end."]
        case .repair: return ["Fixing what the checks found, then checking again."]
        case .playtest: return ["A bot is playing your \(ProductName.singular) to make sure it's fair and finishable."]
        case .cover: return ["Muse Image is painting your cover."]
        case .polish: return ["Naming it and writing the one-line rule."]
        case .done: return ["Ready to play."]
        case .failed: return ["Something went wrong."]
        }
    }
}
