import SwiftUI

/// The Plan step, between Describe and Build: Muse plans the game on the server (about 30 s), then
/// shows it in a card that reads in five seconds: the title, the kind of game it is, the theme,
/// the goal, how you play, how it ends, how scores compare, and how you play it with friends.
/// Up to 2 quick questions as chips. One obvious next tap: "Looks good, build it".
///
/// Planning off on the server (404) or a create-only flow it doesn't apply to: the Brief step
/// shows instead, exactly as before (`StudioPlanGate`). No dead ends: every failure offers Try
/// again and "Build it now".
///
/// DEBUG: `FB_STUDIO_PLAN=normal|questions|gap|opinion|story|loading|failed|off` answers from
/// `GamePlanFixtures` (see `HarnessPlanClient`), and opens Studio straight on this step when the
/// hook patch's DEBUG line is in.
struct StudioPlanStep: View {
    @Bindable var plan: StudioPlanModel
    let studio: StudioModel
    let onBuild: (StudioPlanHandoff) -> Void
    let onBack: () -> Void

    @State private var isChanging = false
    @State private var changeText = ""
    @State private var changeVoice = VoiceInput()
    @FocusState private var changeFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FBSpacing.l) {
                header
                switch plan.phase {
                case .planning(let started):
                    StudioPlanProgress(started: started)
                case .failed(let message):
                    failedCard(message)
                case .ready:
                    if let current = plan.plan {
                        if isChanging { changeCard }
                        StudioPlanCard(plan: current, onMoreOptions: { plan.showsBrief = true })
                        if !current.questions.isEmpty {
                            StudioPlanQuestions(plan: plan, questions: current.questions)
                        }
                    }
                case .idle, .unavailable:
                    EmptyView()
                }
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.top, FBSpacing.s)
            .padding(.bottom, FBSpacing.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            StudioActionBar { actions }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: FBSpacing.m) {
            StudioMuseAvatar()
            VStack(alignment: .leading, spacing: 4) {
                Text(headline)
                    .font(.fbHeadline)
                    .studioRounded()
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\u{201C}\(plan.original)\u{201D}")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
                Button {
                    Haptics.selection()
                    onBack()
                } label: {
                    Label("Edit your idea", systemImage: "pencil")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
    }

    private var headline: String {
        switch plan.phase {
        case .planning: return "Muse is planning your \(ProductName.singular)"
        case .failed: return "The plan didn't come through"
        default:
            let asks = plan.plan?.questions.count ?? 0
            return asks > 0 ? "Here's my plan. \(asks == 1 ? "One quick question" : "Two quick questions"), then I'll build it."
                            : "Here's my plan. Look good?"
        }
    }

    // MARK: Failure

    private func failedCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            Label {
                Text(message)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.bubble")
                    .foregroundStyle(GameColor.deep)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    // MARK: Change something

    private var changeCard: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            Text("What should change?")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            HStack(alignment: .center, spacing: FBSpacing.s) {
                TextField("Like \u{201C}make it 3 rounds\u{201D} or \u{201C}set it in space\u{201D}", text: $changeText, axis: .vertical)
                    .font(.fbBodyLarge)
                    .lineLimit(1...4)
                    .focused($changeFocused)
                    .submitLabel(.done)
                    .onSubmit(submitChange)
                    .accessibilityLabel("What should change")
                VoiceInputButton(voice: changeVoice, text: $changeText)
            }
            VoiceInputNote(voice: changeVoice)
            Text("Muse plans it again with your change.")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .studioCard(highlighted: true)
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func submitChange() {
        let text = changeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Haptics.light()
        changeVoice.stop()
        plan.change(text)
        changeText = ""
        withAnimation { isChanging = false }
    }

    // MARK: Actions

    @ViewBuilder
    private var actions: some View {
        switch plan.phase {
        case .planning:
            Button {
                Haptics.light()
                plan.cancel()
                onBuild(plan.handoff)
            } label: {
                Text("Skip the plan, build it now")
            }
            .buttonStyle(.studioSecondary(expand: true, height: 48))
        case .failed:
            Button {
                Haptics.selection()
                onBuild(plan.handoff)
            } label: {
                Text("Build it now")
            }
            .buttonStyle(.studioSecondary(expand: false, height: 44))
            Button {
                Haptics.light()
                plan.retry()
            } label: {
                Label("Try again", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.studioPrimary)
        default:
            if isChanging {
                Button {
                    Haptics.selection()
                    changeVoice.stop()
                    withAnimation { isChanging = false }
                } label: {
                    Text("Cancel")
                }
                .buttonStyle(.studioSecondary(expand: false, height: 44))
                Button(action: submitChange) {
                    Label("Plan it again", systemImage: "sparkles")
                }
                .buttonStyle(.studioPrimary)
                .disabled(changeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } else {
                // One obvious next tap on top; the change is a quieter second line.
                VStack(spacing: FBSpacing.xs) {
                    Button {
                        Haptics.light()
                        onBuild(plan.handoff)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "sparkles")
                                .font(.system(size: FBIconSize.medium, weight: .bold))
                            Text("Looks good, build it")
                        }
                    }
                    .buttonStyle(.studioPrimary)
                    Button {
                        Haptics.selection()
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.9)) { isChanging = true }
                        changeFocused = true
                    } label: {
                        Text("Change something")
                            .font(.fbButton)
                            .foregroundStyle(FBColor.accent)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - Gate

/// Shows the Plan step before the Brief for new games, and the Brief alone when planning is off
/// on the server, the game isn't new (edit, remix, next level, Daily), or the person picked
/// "More options". The plan is kept per Studio session, so Back from Try it shows it again.
struct StudioPlanGate<Brief: View>: View {
    @Bindable var model: StudioModel
    @ViewBuilder var brief: () -> Brief

    @State private var plan: StudioPlanModel

    init(model: StudioModel, @ViewBuilder brief: @escaping () -> Brief) {
        self.model = model
        self.brief = brief
        _plan = State(initialValue: StudioPlanMemory.plan(for: model))
    }

    private var usesPlan: Bool { model.mode == .create }
    private var showsPlan: Bool { usesPlan && !plan.showsBrief && plan.phase != .unavailable }

    var body: some View {
        Group {
            if showsPlan {
                StudioPlanStep(plan: plan, studio: model, onBuild: build, onBack: { model.go(to: .ask, direction: -1) })
                    .transition(.opacity)
            } else {
                brief()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: showsPlan)
        // The Brief step (planning off, or the person chose it) shows the anatomy: draft it then.
        .onChange(of: showsPlan) { if !showsPlan { model.draftAnatomyIfNeeded() } }
        .onAppear {
            guard usesPlan else { return }
            plan.showsBrief = false
            plan.start(model.effectivePrompt)
        }
    }

    /// Builds with the plan's answers and changes. Today they go to `/v1/generate` folded into the
    /// request text: the prompt is swapped for the folded text only while `startCompose` builds the
    /// request (synchronously), then restored, so Describe still shows what the person typed.
    /// TODO(build): send `handoff.generateFields` (`spec`, `answers`) once `/v1/generate` takes them.
    private func build(_ handoff: StudioPlanHandoff) {
        StudioPlanMemory.lastHandoff = handoff
        let typed = model.prompt
        let folded = handoff.foldedRequest
        if folded != model.effectivePrompt { model.prompt = folded }
        model.startCompose(.create)
        model.prompt = typed
    }
}

/// The plan for the Studio session on screen, and the last hand-off to the build.
@MainActor
enum StudioPlanMemory {
    private static var current: (owner: ObjectIdentifier, plan: StudioPlanModel)?
    static var lastHandoff: StudioPlanHandoff?

    static func plan(for model: StudioModel) -> StudioPlanModel {
        let key = ObjectIdentifier(model)
        if let current, current.owner == key { return current.plan }
        let plan = StudioPlanModel()
        current = (key, plan)
        return plan
    }
}

// MARK: - Planning progress

/// The three real steps the server runs, ticked off on a clock (the endpoint answers once, at the
/// end): understanding (about 5–10 s), finding the game type (well under a second, after it), and
/// planning (most of the 30 s).
private struct StudioPlanProgress: View {
    let started: Date

    private static let steps: [(title: String, symbol: String, startsAt: TimeInterval)] = [
        ("Understanding your idea", "text.magnifyingglass", 0),
        ("Finding the kind of game it is", "square.grid.2x2", 7),
        ("Planning every part of it", "list.bullet.rectangle", 9),
    ]

    var body: some View {
        TimelineView(.periodic(from: started, by: 0.5)) { context in
            let elapsed = context.date.timeIntervalSince(started)
            VStack(alignment: .leading, spacing: FBSpacing.m) {
                ForEach(Self.steps.indices, id: \.self) { index in
                    row(index, elapsed: elapsed)
                }
                Text(elapsed < 40 ? "This takes about 30 seconds." : "Almost there. Muse is checking the plan.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.top, FBSpacing.xs)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .studioCard()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Muse is planning your game. This takes about 30 seconds.")
    }

    private func row(_ index: Int, elapsed: TimeInterval) -> some View {
        let step = Self.steps[index]
        let next = index + 1 < Self.steps.count ? Self.steps[index + 1].startsAt : .infinity
        let isDone = elapsed >= next
        let isActive = elapsed >= step.startsAt && !isDone
        return HStack(spacing: FBSpacing.m) {
            ZStack {
                Circle()
                    .fill(isDone || isActive ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(StudioGlow.track))
                    .frame(width: 30, height: 30)
                Image(systemName: isDone ? "checkmark" : step.symbol)
                    .font(.system(size: FBIconSize.small, weight: .bold))
                    .foregroundStyle(isDone || isActive ? BubbleGlow.ink : FBColor.tertiaryText)
            }
            Text(step.title)
                .font(isActive ? .fbBody.weight(.semibold) : .fbBody)
                .foregroundStyle(isDone || isActive ? FBColor.primaryText : FBColor.tertiaryText)
            Spacer(minLength: 0)
            if isActive {
                GameLoader(style: .dots)
                    .accessibilityHidden(true)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: isDone)
    }
}

// MARK: - Plan card

private struct StudioPlanCard: View {
    let plan: GamePlan
    let onMoreOptions: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            VStack(alignment: .leading, spacing: 4) {
                Text(plan.title.isEmpty ? "Your \(ProductName.singular)" : plan.title)
                    .font(.fbTitle)
                    .studioRounded()
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                if let line = StudioPlanCopy.typeLine(plan) {
                    Text(line)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            together
            VStack(alignment: .leading, spacing: FBSpacing.s) {
                if let theme = StudioPlanCopy.theme(plan) { row("paintpalette", "Theme", theme) }
                if let goal = StudioPlanCopy.goal(plan) { row("scope", "Goal", goal) }
                if let how = StudioPlanCopy.howToPlay(plan) { row("hand.tap", "How you play", how) }
                if let end = StudioPlanCopy.howItEnds(plan) { row("flag.checkered", "How it ends", end) }
                scoreRow
            }
            ForEach(StudioPlanCopy.gapLines(plan), id: \.self) { line in
                Label {
                    Text(line)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "info.circle")
                }
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            }
            Button(action: onMoreOptions) {
                Text("More options: look, length and sound")
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.accent)
                    .frame(minHeight: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(highlighted: true)
    }

    /// How this game brings people together, first and in the brand wash.
    private var together: some View {
        let info = StudioPlanCopy.groupPlay(plan)
        return HStack(spacing: FBSpacing.s) {
            Image(systemName: info.symbol)
                .font(.system(size: FBIconSize.medium, weight: .semibold))
                .foregroundStyle(GameColor.deep)
            Text(info.planLine)
                .font(.fbBody.weight(.semibold))
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FBSpacing.m)
        .padding(.vertical, FBSpacing.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GameColor.wash, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var scoreRow: some View {
        let ranked = StudioPlanCopy.isRanked(plan)
        return HStack(alignment: .firstTextBaseline, spacing: FBSpacing.s) {
            Image(systemName: ranked ? "trophy" : "equal.circle")
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 20)
            Text(StudioPlanCopy.scoreLine(plan))
                .font(.fbBody.weight(.semibold))
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Text(ranked ? "Ranked" : "Unranked")
                .font(.fbCaptionEmphasized)
                .foregroundStyle(ranked ? BubbleGlow.ink : FBColor.secondaryText)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(ranked ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(StudioGlow.track), in: Capsule())
        }
        .accessibilityElement(children: .combine)
    }

    private func row(_ symbol: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: FBSpacing.s) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 20)
            (Text(title + "  ").font(.fbMetaEmphasized).foregroundColor(FBColor.secondaryText)
                + Text(text).font(.fbBody).foregroundColor(FBColor.primaryText))
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Questions

/// Up to 2 questions, 2–4 choices each, plus "Other" with typed or spoken words. Skipping one
/// keeps Muse's guess.
private struct StudioPlanQuestions: View {
    @Bindable var plan: StudioPlanModel
    let questions: [GamePlanSlot]

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.l) {
            ForEach(questions) { question in
                StudioPlanQuestionRow(plan: plan, question: question)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }
}

private struct StudioPlanQuestionRow: View {
    @Bindable var plan: StudioPlanModel
    let question: GamePlanSlot

    @State private var isOther = false
    @State private var otherText = ""
    @State private var voice = VoiceInput()

    private var selected: String? { plan.answers[question.slot] }

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            Text(question.question)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            FlowLayout(spacing: 8, lineSpacing: 8) {
                ForEach(question.choices, id: \.self) { choice in
                    StudioChip(title: choice, isSelected: !isOther && selected == choice) {
                        Haptics.selection()
                        isOther = false
                        plan.answers[question.slot] = selected == choice ? nil : choice
                    }
                }
                StudioChip(title: "Other", symbol: "pencil", isSelected: isOther) {
                    Haptics.selection()
                    isOther.toggle()
                    plan.answers[question.slot] = isOther ? nonEmpty(otherText) : nil
                }
            }
            if isOther {
                HStack(spacing: FBSpacing.s) {
                    TextField("Your answer", text: $otherText)
                        .font(.fbBodyLarge)
                        .submitLabel(.done)
                        .padding(.horizontal, FBSpacing.m)
                        .frame(minHeight: 44)
                        .background(StudioGlow.fieldFill, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
                        .accessibilityLabel("Your answer to: \(question.question)")
                    VoiceInputButton(voice: voice, text: $otherText)
                }
                VoiceInputNote(voice: voice)
            }
            if selected == nil, !question.value.isEmpty {
                Text("Skip it and Muse goes with \u{201C}\(question.value)\u{201D}.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.tertiaryText)
            }
        }
        .onChange(of: otherText) { _, text in
            if isOther { plan.answers[question.slot] = nonEmpty(text) }
        }
    }

    private func nonEmpty(_ text: String) -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

#if DEBUG
#Preview("Plan: questions") {
    let model = StudioPlanModel()
    model.debugShow(GamePlanFixtures.plan("questions"), request: "a harry potter krillion")
    return StudioPlanStep(plan: model, studio: StudioModel(launch: StudioLaunch(prompt: "a harry potter krillion")), onBuild: { _ in }, onBack: {})
        .background(StudioBackdrop(palette: nil))
        .previewEnvironment()
}
#endif
