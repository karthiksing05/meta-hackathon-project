import SwiftUI

/// Muse Studio: make a game with Muse, from idea to friends. Describe it (for whom first), read
/// and edit Muse's brief, watch Muse build it live ("Muse at work"), try it, then share it and
/// challenge friends. The same flow edits, remixes, adds levels and makes Daily games
/// (`StudioLaunch.mode`).
///
/// DEBUG launch variables (with `FB_OPEN=studio`, `studio:<prompt>`, `edit:<id>`, `remix:<id>`,
/// `next:<id>` or `daily:<groupID>`; see `App/DebugLaunch.swift`):
/// - `FB_STUDIO_SCROLL=look|sources|anatomy|customize`: scroll a step to that section.
///
/// Every game is made on the server (`/v1/generate`); there is no scripted or offline run.
///
/// Narration: `MuseNarrator` speaks what Muse is doing (`StudioNarration`); the top bar's waveform
/// button turns it off. It follows the app-wide game mute.
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
            // Back after `onDisappear` stopped the auto-advance: don't strand a finished build on
            // the compose step, which has no buttons once Muse is done.
            if model.stage == .compose && model.isFinished {
                model.go(to: .tryIt)
            }
        }
        .onDisappear {
            model.stopAll()
        }
        .studioNarration(model)
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
                StudioShareStep(model: model, onShare: float)
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
        model.isEditMode ? "Discard your changes?" : "Discard this \(ProductName.singular)?"
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

    /// Shares it: shows the pending state, publishes, sends the challenges, then opens the game
    /// page. The pending state lasts exactly as long as the work (no fixed wait).
    private func float() {
        guard !model.isPopping, !model.levels.isEmpty else { return }
        Haptics.medium()
        withAnimation(GameMotion.tap) {
            model.isPopping = true
        }
        Task { @MainActor in
            // Let the pending state draw before the main-actor work starts.
            await Task.yield()
            guard let outcome = model.commitFloat() else {
                model.isPopping = false
                return
            }
            GameSound.play(.publish, haptic: true)
            model.saveAnatomy(gameIDs: [outcome.bubbleID] + model.levels.map(\.manifest.id))
            model.stopAll()
            // Open the new Bubble underneath first, so closing Studio reveals it.
            router.selectedTab = .bubbles
            router.push(.bubble(outcome.bubbleID))
            appStore.showToast(outcome.toast, symbol: "sparkles")
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
                    StudioNarrationToggle()
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

/// Turns Muse's spoken narration on or off. Off (and struck through) while the game sound is muted.
private struct StudioNarrationToggle: View {
    @State private var narrator = MuseNarrator.shared

    var body: some View {
        let on = narrator.isActive
        StudioCircleButton(
            symbol: on ? "waveform" : "waveform.slash",
            accessibilityLabel: on ? "Turn off Muse narration" : "Turn on Muse narration",
            size: 32
        ) {
            Haptics.light()
            if GameSound.isMuted {
                GameSound.isMuted = false
                narrator.isEnabled = true
            } else {
                narrator.isEnabled.toggle()
            }
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
