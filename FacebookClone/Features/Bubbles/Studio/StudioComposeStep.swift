import SwiftUI
import UIKit

/// Step 3, Build: "Muse at work". A new game takes a few minutes (3 to 4) on the server, so the step
/// gives the person something to read and answer while it runs:
/// - a compact header: the orb, what Muse is doing now, the clock and a progress bar that moves
///   with the real steps (`StudioBuildPhase`);
/// - "Muse at work": the storyboard (`ShowcaseBuildStage`: Draft → Check → Playtest → Ready, lit by
///   real events), the latest step with the bots' runs, and every step on request;
/// - the brief, as a compact card;
/// - "How the game works" (`StudioAnatomyCard`), with Muse's open questions answerable inline.
///   Edits and answers made after the build started go in as one quick change once the game is
///   ready (`StudioModel.buildChanges`, offered on Try).
///
/// Changes to a game (tweaks, next levels) have no brief or anatomy to show, so they keep the
/// full live timeline. When the game is ready the step moves to Try on its own, unless the
/// keyboard is up; then "Play" waits in the action bar. A failure shows the server's words with
/// Try again and Edit the idea.
struct StudioComposeStep: View {
    let model: StudioModel

    var body: some View {
        VStack(spacing: 0) {
            if showsCompanion {
                StudioComposeHeader(model: model, isCompact: true)
                    .padding(.horizontal, FBMetrics.screenPadding)
                StudioBuildCompanion(model: model)
            } else {
                StudioComposeHeader(model: model, isCompact: false)
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
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomBar
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            model.holdsAutoAdvance = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            model.holdsAutoAdvance = false
        }
        .onDisappear { model.holdsAutoAdvance = false }
    }

    /// A new game (or a remix) shows its brief and anatomy while it builds.
    private var showsCompanion: Bool {
        model.composeKind == .create && model.brief != nil
    }

    /// One bar that stays put; only its buttons change (a bar swapped in and out of the safe-area
    /// inset could go missing).
    private var bottomBar: some View {
        StudioActionBar {
            if model.isComposing {
                Button {
                    Haptics.light()
                    model.cancelCompose()
                } label: {
                    Text(model.composeKind == .create ? "Stop building" : "Cancel")
                }
                .buttonStyle(.studioSecondary(expand: true, height: 44))
                .accessibilityHint("Muse stops, and you go back to where you were")
            } else if model.failure != nil {
                Button {
                    Haptics.selection()
                    if model.composeKind == .create && model.mode != .remix && model.mode != .nextLevel {
                        model.editIdea()
                    } else {
                        model.cancelCompose()
                    }
                } label: {
                    Text(backTitle)
                }
                .buttonStyle(.studioSecondary(expand: false, height: 44))

                Button {
                    Haptics.light()
                    model.retry()
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.studioPrimary)
            } else {
                Button {
                    Haptics.medium()
                    model.go(to: .tryIt)
                } label: {
                    Label(playTitle, systemImage: "play.fill")
                }
                .buttonStyle(.studioPrimary)
                .disabled(!model.isFinished)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.isComposing)
        .animation(.easeInOut(duration: 0.2), value: model.failure)
    }

    private var backTitle: String {
        switch model.composeKind {
        case .create:
            return model.mode == .remix || model.mode == .nextLevel ? "Back to the brief" : "Edit the idea"
        case .tweak, .nextLevel:
            return "Back to my \(ProductName.singular)"
        }
    }

    private var playTitle: String {
        let title = (model.draftManifest?.title ?? "").trimmingCharacters(in: .whitespaces)
        return title.isEmpty ? "Play it" : "Play \(title)"
    }
}

// MARK: - Header

private struct StudioComposeHeader: View {
    let model: StudioModel
    /// The Build step with cards under it: the orb sits beside the words, with a progress bar.
    var isCompact: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var smoother = GameProgressSmoother()
    @State private var coverImage: UIImage?

    var body: some View {
        Group {
            if isCompact {
                HStack(alignment: .center, spacing: FBSpacing.m) {
                    orb
                        .frame(width: 92, height: 108)
                    VStack(alignment: .leading, spacing: 6) {
                        headlineText
                            .font(.fbHeadline)
                            .multilineTextAlignment(.leading)
                        statusLine
                        StudioBuildProgressBar(model: model)
                            .padding(.top, 2)
                        estimateLine
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.bottom, FBSpacing.s)
            } else {
                VStack(spacing: 6) {
                    orb
                        .frame(height: 140)
                    headlineText
                        .font(.fbTitle)
                        .multilineTextAlignment(.center)
                    statusLine
                    tipLine
                }
                .padding(.bottom, FBSpacing.m)
            }
        }
        .task(id: model.draftCover) {
            coverImage = model.draftCover.flatMap { UIImage(data: $0) }
        }
    }

    private var orb: some View {
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
        .animation(.easeInOut(duration: 0.5), value: coverImage != nil)
    }

    private var headlineText: some View {
        Text(headline)
            .studioRounded()
            .foregroundStyle(FBColor.primaryText)
            .fixedSize(horizontal: false, vertical: true)
            .contentTransition(.opacity)
            .animation(.easeInOut(duration: 0.3), value: headline)
            .accessibilityAddTraits(.isHeader)
    }

    private var headline: String {
        if model.failure != nil { return "This \(ProductName.singular) didn't get made" }
        let title = model.draftManifest?.title
        switch model.composeKind {
        case .create:
            if model.isFinished {
                let name = (title ?? "").trimmingCharacters(in: .whitespaces)
                return name.isEmpty ? "Your \(ProductName.singular) is ready" : "\(name) is ready"
            }
            if model.mode == .remix { return "Muse is remixing \(model.baseTitle)" }
            if model.runIsMicrogame { return "Muse is building your \(ProductName.singular) from scratch" }
            if model.mode == .nextLevel { return "Muse is making level \((model.baseBubble?.levelIndex ?? 1) + 1)" }
            return "Muse is making your \(ProductName.singular)"
        case .tweak:
            let name = model.currentResult?.manifest.title ?? "your \(ProductName.singular)"
            return model.isFinished ? "Changed and ready" : "Muse is changing \(name)"
        case .nextLevel:
            let number = model.levels.last.flatMap { $0.manifest.chain?.index } ?? model.levelButtonNumber
            return model.isFinished ? "Level \(number) is ready" : "Muse is making level \(model.levelButtonNumber)"
        }
    }

    private var statusLine: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(statusText(at: context.date))
                .monospacedDigit()
                .lineLimit(isCompact ? 2 : 1)
                .multilineTextAlignment(isCompact ? .leading : .center)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
                .transaction { $0.animation = nil }
        }
    }

    private func statusText(at date: Date) -> String {
        let clock = model.clockText(at: date)
        if model.isFinished { return "Made in \(clock)" }
        if model.failure != nil { return "Stopped at \(clock)" }
        if model.isWaitingForAnatomy { return "\(clock) · Reading how your game works" }
        if model.generationWait != nil { return "\(clock) · Waiting for a free slot" }
        // Server events carry the composer's own words.
        let step = model.runIsMicrogame ? (model.currentEvent?.title ?? "Getting started") : (model.currentEvent?.step.title ?? "Getting started")
        return "\(clock) · \(step)"
    }

    /// "Usually a few minutes": the honest expectation, then what to do meanwhile.
    private var estimateLine: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(model.estimateText(at: context.date))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .transaction { $0.animation = nil }
        }
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

/// A slim bar that moves with the real steps: each step lifts it to where that step usually
/// starts, and it eases toward where the step usually ends while Muse works on it, never past it.
struct StudioBuildProgressBar: View {
    let model: StudioModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            let value = model.isFinished ? 1 : model.buildProgress(at: context.date)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(StudioGlow.track)
                    Capsule()
                        .fill(model.failure != nil ? AnyShapeStyle(StudioGlow.issue.opacity(0.7)) : AnyShapeStyle(BubbleGlow.brandGradient))
                        .frame(width: max(6, proxy.size.width * value))
                        .animation(.linear(duration: 0.2), value: value)
                }
            }
            .frame(height: 6)
            .accessibilityElement()
            .accessibilityLabel("Build progress")
            .accessibilityValue(model.isFinished ? "Done" : "About \(Int((value * 100).rounded())) percent")
        }
    }
}

// MARK: - Timeline (changes to a game)

private struct StudioComposeTimeline: View {
    let model: StudioModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if model.events.isEmpty && model.isComposing {
                        StudioStartingRow(model: model)
                    }
                    ForEach(Array(model.events.enumerated()), id: \.element.id) { index, event in
                        StudioComposeEventRow(model: model, index: index, showsConnector: index < model.events.count - 1)
                            .id(event.id)
                            .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                    }
                    if let failure = model.failure {
                        StudioComposeFailureCard(failure: failure)
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
}

/// One step of the run, with the bots' real runs under the playtest result that carried them.
struct StudioComposeEventRow: View {
    let model: StudioModel
    let index: Int
    var showsConnector = false

    var body: some View {
        let event = model.events[index]
        VStack(alignment: .leading, spacing: 0) {
            StudioTimelineRow(event: event, state: state, showsConnector: showsConnector, onServer: model.runIsServer)
            if let report = model.playtestReports[event.id], !report.runs.isEmpty {
                ShowcaseBotLanes(lanes: MakeRecord.lanes(from: report))
                    .padding(.leading, FBSpacing.m + 32 + FBSpacing.m)
                    .padding(.trailing, FBSpacing.m)
                    .padding(.bottom, FBSpacing.s)
            }
        }
    }

    private var state: StudioRowState {
        let event = model.events[index]
        if event.step == .failed { return .failed }
        guard index == model.events.count - 1 else { return .done }
        if model.failure != nil { return .failed }
        return model.isComposing ? .active : .done
    }
}

/// Shown until Muse's first step arrives: reading the anatomy, waiting in line, or starting.
struct StudioStartingRow: View {
    let model: StudioModel

    var body: some View {
        StudioTimelineRow(event: event, state: .active, showsConnector: false)
            .animation(.easeInOut(duration: 0.3), value: model.generationWait)
    }

    private var event: StudioEvent {
        if model.isWaitingForAnatomy {
            return StudioEvent(step: .understand, title: "Reading how your game works",
                               detail: "Muse is finishing its read of the parts, so the build follows them")
        }
        if let wait = model.generationWait {
            let detail: String
            switch wait.position {
            case 1?: detail = "You're next in line"
            case let n? where n > 1: detail = "\(n - 1) ahead of you in line"
            default: detail = "Games are made one at a time. Yours starts soon"
            }
            return StudioEvent(step: .understand, title: "Waiting for a free slot", detail: detail)
        }
        return StudioEvent(step: .understand, title: "Waking up Muse",
                           detail: model.runIsServer ? "Sending your brief to the game server" : "Sending your brief to Muse Studio")
    }
}

/// The server's words for what went wrong. Try again and Edit the idea sit in the action bar.
struct StudioComposeFailureCard: View {
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
            Text("Your brief and how the game works are kept.")
                .font(.fbMeta)
                .foregroundStyle(FBColor.tertiaryText)
        }
        .studioCard()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Progress and tips

extension StudioModel {
    /// The header orb's size target: the build's progress (`buildProgress`), which moves only
    /// within the step Muse really reached.
    func progressTarget(at date: Date) -> Double {
        guard isComposing || failure != nil else { return reachedProgress }
        return min(0.97, max(0.04, buildProgress(at: date)))
    }

    /// 0...1: where the progress bar is. Frozen when the run ends.
    func buildProgress(at date: Date) -> Double {
        if isFinished { return 1 }
        let end = composeEndedAt.map { min($0, date) } ?? date
        return buildPhase.value(at: end)
    }

    /// "0:23".
    func clockText(at date: Date) -> String {
        guard let start = composeStartedAt else { return "0:00" }
        return StudioFormat.clock((composeEndedAt ?? date).timeIntervalSince(start))
    }

    /// Under the progress bar: how long it usually takes, and what to do meanwhile.
    func estimateText(at date: Date) -> String {
        if isFinished { return "Opening it for you to play…" }
        if failure != nil { return "Nothing was kept from this try." }
        let elapsed = composeStartedAt.map { date.timeIntervalSince($0) } ?? 0
        let readOn = showsAnatomyCard ? " Read or answer below while you wait." : ""
        if elapsed > 300 { return "Taking a little longer than usual." + readOn }
        if events.last?.step == .playtest { return "Almost there." + readOn }
        return "Usually a few minutes." + readOn
    }

    /// What Muse is doing right now, rotating every few seconds during long steps.
    func tip(at date: Date) -> String {
        if isWaitingForAnatomy {
            return "Muse is finishing how the game works, so the build follows it."
        }
        if generationWait != nil {
            return "Each person gets one game at a time on the server. Yours starts as soon as a slot opens."
        }
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

/// Where the Build step's progress bar is. Each real step lifts it to where that step usually
/// starts (never backward); while Muse works on a step it eases toward where the step usually
/// ends (`ceiling`), with time constant `tau`, and never passes it. From a real Muse run: the
/// draft is about 35 s, a check under a second, a fix or polish round about 30 s, the bots about
/// 3 s.
struct StudioBuildPhase {
    var floor: Double
    var ceiling: Double
    var tau: TimeInterval
    var startedAt: Date

    /// Before any run.
    static let idle = StudioBuildPhase(floor: 0, ceiling: 0, tau: 1, startedAt: .distantPast)

    /// A run just started: waking Muse up, or waiting for a slot.
    static func start(at date: Date) -> StudioBuildPhase {
        StudioBuildPhase(floor: 0.02, ceiling: 0.08, tau: 6, startedAt: date)
    }

    func value(at date: Date) -> Double {
        let t = max(0, date.timeIntervalSince(startedAt))
        return floor + (ceiling - floor) * (1 - exp(-t / tau))
    }

    /// The phase a new event starts, continuing from `progress`.
    func next(for event: StudioEvent, progress: Double, at date: Date) -> StudioBuildPhase {
        let (start, end, tau): (Double, Double, TimeInterval)
        switch event.step {
        case .understand, .brief: (start, end, tau) = (0.02, 0.08, 6)
        case .compose, .glue, .content: (start, end, tau) = (0.08, 0.55, 24)
        case .validate: (start, end, tau) = (0.55, 0.62, 2)
        case .repair: (start, end, tau) = (0.62, 0.86, 22)
        case .playtest: (start, end, tau) = (0.86, 0.96, 4)
        case .cover, .polish: (start, end, tau) = (0.9, 0.97, 10)
        case .done: (start, end, tau) = (1, 1, 1)
        case .failed: return StudioBuildPhase(floor: progress, ceiling: progress, tau: 1, startedAt: date)
        }
        let floor = max(start, progress)
        let ceiling = min(0.97, max(end, floor + 0.04))
        return StudioBuildPhase(floor: floor, ceiling: event.step == .done ? 1 : ceiling, tau: tau, startedAt: date)
    }
}
