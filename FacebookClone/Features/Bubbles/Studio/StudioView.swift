import SwiftUI

/// Muse Studio: blow a Bubble with Muse. Describe it, read and edit Muse's brief, watch Muse
/// compose it live, try it, then float it to your feed, a Group or an Event. The same flow edits,
/// remixes, adds levels and makes Daily Bubbles (`StudioLaunch.mode`).
///
/// DEBUG launch variables (with `FB_OPEN=studio`, `studio:<prompt>`, `edit:<id>`, `remix:<id>`,
/// `next:<id>` or `daily:<groupID>`; see `App/DebugLaunch.swift`):
/// - `FB_STUDIO_STEP=ask|brief|compose|try|float|error`: open on that step with fake data.
/// - `FB_STUDIO_LOOK=paper` (or glow, pixel, neon, ink, clay, riso, chalk): preselect a look.
/// - `FB_STUDIO_SERVICE=scripted`: a realistic ~40 s Muse run with no network.
///   `FB_STUDIO_SPEED=4` plays it 4× faster; `FB_STUDIO_FAIL=1` makes it fail halfway.
/// - `FB_STUDIO_AUTOPILOT=1`: drives the whole flow (describe → brief → compose → try → tweak →
///   new look → level 2 → float) and logs each step as `[Studio autopilot] …`.
struct StudioView: View {
    let launch: StudioLaunch

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var model: StudioModel
    @State private var isConfirmingClose = false

    init(launch: StudioLaunch) {
        self.launch = launch
        _model = State(initialValue: StudioModel(launch: launch))
    }

    var body: some View {
        ZStack {
            StudioBackdrop(palette: model.backdropPalette)
            if model.isReady {
                VStack(spacing: 0) {
                    StudioTopBar(model: model, onClose: requestClose)
                    stageContent
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 96)
        }
        .onAppear {
            model.attach(bubbleStore: bubbleStore, appStore: appStore)
        }
        .onDisappear {
            model.stopAll()
        }
        .onChange(of: model.floatSignal) {
            float()
        }
        .confirmationDialog(closeTitle, isPresented: $isConfirmingClose, titleVisibility: .visible) {
            Button(model.isEditMode ? "Discard changes" : "Discard", role: .destructive) {
                close()
            }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text(model.isComposing ? "Muse will stop working on it." : "You can't undo this.")
        }
    }

    @ViewBuilder
    private var stageContent: some View {
        ZStack {
            switch model.stage {
            case .ask:
                StudioAskStep(model: model)
                    .transition(stageTransition)
            case .brief:
                StudioBriefStep(model: model)
                    .transition(stageTransition)
            case .compose:
                StudioComposeStep(model: model)
                    .transition(stageTransition)
            case .tryIt:
                StudioTryStep(model: model)
                    .transition(stageTransition)
            case .float:
                StudioFloatStep(model: model, onFloat: float)
                    .transition(stageTransition)
            }
        }
    }

    private var stageTransition: AnyTransition {
        let offset = CGFloat(40 * model.direction)
        return .asymmetric(
            insertion: .opacity.combined(with: .offset(x: offset)),
            removal: .opacity.combined(with: .offset(x: -offset))
        )
    }

    private var closeTitle: String {
        model.isEditMode ? "Discard your changes?" : "Discard this bubble?"
    }

    private func requestClose() {
        if model.hasUnsavedWork {
            Haptics.warning()
            isConfirmingClose = true
        } else {
            close()
        }
    }

    private func close() {
        model.stopAll()
        dismiss()
    }

    /// Pops the bubble, publishes it, then opens it on the Bubbles tab.
    private func float() {
        guard !model.isPopping, !model.levels.isEmpty else { return }
        Haptics.medium()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.65)) {
            model.isPopping = true
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard let outcome = model.commitFloat() else {
                model.isPopping = false
                return
            }
            Haptics.success()
            model.stopAll()
            // Open the new Bubble underneath first, so closing Studio reveals it.
            router.selectedTab = .bubbles
            router.push(.bubble(outcome.bubbleID))
            appStore.showToast(outcome.toast, symbol: "bubbles.and.sparkles.fill")
            dismiss()
        }
    }
}

// MARK: - Top bar

/// Facebook-style top bar for the Studio cover: close, title, Muse status and step progress.
private struct StudioTopBar: View {
    let model: StudioModel
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: FBSpacing.s) {
            ZStack {
                VStack(spacing: 1) {
                    Text("Muse Studio")
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    Text(model.topBarSubtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
                .padding(.horizontal, 96)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)

                HStack {
                    StudioCircleButton(symbol: "xmark", accessibilityLabel: "Close", action: onClose)
                        .disabled(model.isPopping)
                    Spacer()
                    status
                        .padding(.trailing, FBSpacing.s)
                }
            }
            StudioStepProgress(stage: model.stage)
                .padding(.horizontal, FBMetrics.screenPadding)
        }
        .padding(.leading, FBSpacing.xs)
        .padding(.bottom, FBSpacing.s)
    }

    @ViewBuilder
    private var status: some View {
        if model.isMuseConnected {
            MuseBadge(compact: true)
        } else {
            HStack(spacing: 4) {
                Image(systemName: "bolt.horizontal.circle")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                Text("Offline")
                    .font(.fbCaptionEmphasized)
            }
            .foregroundStyle(FBColor.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(StudioGlow.cardFill, in: Capsule())
            .overlay(Capsule().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75))
            .accessibilityLabel("Muse is offline. Studio uses its built-in composer.")
        }
    }
}

/// Five short segments, like story progress: filled up to the current step.
struct StudioStepProgress: View {
    let stage: StudioStage

    var body: some View {
        HStack(spacing: 4) {
            ForEach(StudioStage.allCases) { step in
                Capsule()
                    .fill(step <= stage ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(StudioGlow.track))
                    .frame(height: 3)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: stage)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(stage.rawValue + 1) of \(StudioStage.allCases.count): \(stage.title)")
    }
}

// MARK: - Bottom action bar

/// Pins a step's actions to the bottom in a frosted bar, so content scrolls under it cleanly.
struct StudioActionBar<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: FBSpacing.s) {
            content
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.top, FBSpacing.m)
        .padding(.bottom, FBSpacing.s)
        .frame(maxWidth: .infinity)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                Rectangle().fill(StudioGlow.base.opacity(0.84))
            }
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(StudioGlow.cardStroke)
                    .frame(height: 0.5)
            }
            .shadow(color: .black.opacity(0.05), radius: 8, y: -2)
            .ignoresSafeArea(edges: .bottom)
        }
    }
}

#Preview {
    StudioView(launch: StudioLaunch(prompt: "A chill game about SF hills for my running club"))
        .previewEnvironment()
}
