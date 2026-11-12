import SwiftUI

/// Step 4: play what Muse made, right here. Edit the title and rule, tweak it with Muse (for
/// microgames through `MicrogameComposer.revise`), customize it, or make the next level.
struct StudioTryStep: View {
    @Bindable var model: StudioModel
    @FocusState private var isTweakFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: FBSpacing.l) {
                    if model.levels.count > 1 {
                        StudioLevelPicker(model: model)
                    }
                    if let result = model.currentResult {
                        StudioPlayerCard(model: model, result: result)
                        StudioDetailsCard(model: model, result: result)
                            .id("details")
                    }
                    StudioTrySlots(model: model)
                    // SOUND SECTION: between Customize and Tweak.
                    soundSection
                    StudioTweakCard(model: model, isFocused: $isTweakFocused)
                        .id("tweak")
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.top, FBSpacing.s)
                .padding(.bottom, FBSpacing.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                StudioActionBar {
                    if model.canMakeNextLevel {
                        Button {
                            isTweakFocused = false
                            Haptics.light()
                            model.startCompose(.nextLevel)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "stairs")
                                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                                Text("Make level \(model.levelButtonNumber)")
                            }
                        }
                        .buttonStyle(.studioSecondary(expand: false, height: 44))
                        .accessibilityHint("Muse makes a harder next level that links to this one as a level chain")
                    }
                    Button {
                        isTweakFocused = false
                        Haptics.selection()
                        model.go(to: .float)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: model.isEditMode && model.levels.count == 1 ? "checkmark" : "paperplane.fill")
                                .font(.system(size: FBIconSize.medium, weight: .bold))
                            Text(model.isEditMode && model.levels.count == 1 ? "Save changes" : "Share with friends")
                        }
                    }
                    .buttonStyle(.studioPrimary)
                }
            }
            .task {
                // DEBUG screenshots: FB_STUDIO_SCROLL=details shows the details and the look.
                guard DebugLaunch.value("FB_STUDIO_SCROLL") == "details" else { return }
                try? await Task.sleep(nanoseconds: 400_000_000)
                proxy.scrollTo("details", anchor: .bottom)
            }
        }
        .task {
            guard model.focusTweak else { return }
            try? await Task.sleep(nanoseconds: 500_000_000)
            // Opened to Customize: its panel clears focusTweak, and the keyboard would cover it.
            guard model.focusTweak, !LengthCustomizer.shared.scrollPending,
                  DebugLaunch.value("FB_STUDIO_SCROLL") != "customize" else {
                model.focusTweak = false
                return
            }
            model.focusTweak = false
            isTweakFocused = true
        }
    }
}

extension StudioTryStep {
    /// SOUND SECTION: hear and change a microgame's sound set, music and loudness. Only microgames
    /// have a sound section (`SoundManifestEditor`); other games take their sounds from their feel,
    /// so the section stays hidden for them.
    @ViewBuilder
    var soundSection: some View {
        if let draft = model.currentResult?.manifest, draft.formula == .microgame {
            SoundCustomizeSection(manifest: draft) { newManifest in
                model.replaceManifest(newManifest)
            }
        }
    }
}

// MARK: - Levels

private struct StudioLevelPicker: View {
    let model: StudioModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: FBSpacing.s) {
                ForEach(Array(model.levels.enumerated()), id: \.element.id) { index, level in
                    StudioChip(
                        title: "Level \(level.manifest.chain?.index ?? index + 1)",
                        symbol: index == model.selectedLevel ? "play.fill" : nil,
                        isSelected: index == model.selectedLevel
                    ) {
                        Haptics.selection()
                        withAnimation(.easeInOut(duration: 0.25)) {
                            model.selectedLevel = index
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityLabel("Levels")
    }
}

// MARK: - Player

private struct StudioPlayerCard: View {
    let model: StudioModel
    let result: StudioResult

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var revision = 0
    @State private var lastRun: BubbleRunResult?
    @State private var runtimeError: String?

    var body: some View {
        // The badge sits under the card, so it never covers the game's own top-left HUD.
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            player
            MuseBadge()
                .padding(.leading, FBSpacing.xs)
        }
    }

    private var player: some View {
        let shape = RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
        return BubbleWebView(
            manifest: result.manifest,
            mode: .play,
            playerName: model.me?.firstName ?? "",
            bestScore: nil,
            isActive: scenePhase == .active && !model.isPopping,
            isMuted: GameSound.isMuted,
            reducedMotion: reduceMotion,
            onMessage: handle
        )
        .id("\(result.manifest.id)#\(result.manifest.version)#\(revision)")
        .frame(height: 400)
        .background(BubbleGlow.palette(for: result.manifest.style).gradient)
        .clipShape(shape)
        .overlay(shape.strokeBorder(BubbleGlow.iridescent, lineWidth: 1.5).opacity(0.9))
        .shadow(color: GameColor.periwinkle.opacity(0.3), radius: 18, y: 8)
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 0) {
                StudioCircleButton(symbol: GameSound.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill", accessibilityLabel: GameSound.isMuted ? "Turn sound on" : "Turn sound off") {
                    Haptics.light()
                    GameSound.toggleMute()
                }
                StudioCircleButton(symbol: "arrow.counterclockwise", accessibilityLabel: "Restart") {
                    restart()
                }
            }
            .padding(FBSpacing.xs)
        }
        .overlay(alignment: .bottom) {
            if let lastRun {
                resultPill(lastRun)
                    .padding(FBSpacing.m)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if let runtimeError {
                Text(runtimeError)
                    .font(.fbMeta)
                    .foregroundStyle(.white)
                    .padding(FBSpacing.m)
                    .background(Color.black.opacity(0.55), in: Capsule())
                    .padding(FBSpacing.m)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: lastRun)
        .onChange(of: result.id) {
            lastRun = nil
            runtimeError = nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(result.manifest.title), playable preview")
    }

    private func resultPill(_ run: BubbleRunResult) -> some View {
        Button {
            restart()
        } label: {
            HStack(spacing: FBSpacing.s) {
                Image(systemName: run.outcome == .success ? "star.fill" : "sparkles")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                Text(run.share.scoreText.isEmpty ? "\(run.score) points" : run.share.scoreText)
                    .font(.fbButton)
                Text("·")
                Text("Play again")
                    .font(.fbButton)
            }
            .foregroundStyle(BubbleGlow.ink)
            .padding(.horizontal, FBSpacing.l)
            .frame(minHeight: 44)
            .background(BubbleGlow.brandGradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.75), lineWidth: 1))
            .shadow(color: GameColor.periwinkle.opacity(0.4), radius: 10, y: 4)
        }
        .buttonStyle(.pressable)
    }

    private func restart() {
        Haptics.light()
        lastRun = nil
        runtimeError = nil
        revision += 1
    }

    private func handle(_ message: BubbleBridgeMessage) {
        switch message {
        case .result(let run):
            lastRun = run
            Haptics.success()
        // The runtime pool plays the game's own haptics for the active host.
        case .error(let message):
            runtimeError = message.isEmpty ? "This \(ProductName.singular) didn't load" : "This \(ProductName.singular) didn't load: \(message)"
        default:
            break
        }
    }
}

// MARK: - Details

private struct StudioDetailsCard: View {
    let model: StudioModel
    let result: StudioResult

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            HStack(alignment: .top, spacing: FBSpacing.m) {
                BubbleCoverView(bubble: model.previewBubble(for: result))
                    .frame(width: 76, height: 95)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.6), lineWidth: 1)
                    }
                    .accessibilityLabel(result.cover == nil ? "Cover" : "Cover art by Muse")
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        TextField("Title", text: title)
                            .font(.fbTitle)
                            .studioRounded()
                            .foregroundStyle(FBColor.primaryText)
                            .submitLabel(.done)
                            .accessibilityLabel("Title")
                        Image(systemName: "pencil")
                            .font(.system(size: FBIconSize.small, weight: .semibold))
                            .foregroundStyle(FBColor.tertiaryText)
                            .accessibilityHidden(true)
                    }
                    TextField("One-line rule", text: rule, axis: .vertical)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1...3)
                        .accessibilityLabel("One-line rule")
                    meta
                        .padding(.top, 2)
                }
            }
            if result.manifest.formula != .microgame {
                lookRow
            }
            if !result.sourcesUsed.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: FBIconSize.xs, weight: .semibold))
                    Text("\(StudioSourcesUsedLabel.text(for: result.sourcesUsed)), opted in")
                        .font(.fbMeta)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(FBColor.secondaryText)
                .accessibilityElement(children: .combine)
            }
            if !result.models.isEmpty {
                HStack(spacing: 6) {
                    Text("Made with")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    ForEach(result.models, id: \.self) { id in
                        if let info = StudioModelInfo(model: id, isOffline: false) {
                            StudioModelChip(info: info)
                        }
                    }
                    if result.isOffline {
                        StudioModelChip(info: StudioModelInfo(name: "Offline composer", tint: StudioGlow.offline, symbol: "bolt.horizontal.circle"))
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .studioCard()
    }

    private var title: Binding<String> {
        Binding(get: { model.currentResult?.manifest.title ?? "" }, set: { model.updateTitle($0) })
    }

    private var rule: Binding<String> {
        Binding(get: { model.currentResult?.manifest.oneLineRule ?? "" }, set: { model.updateRule($0) })
    }

    /// The look in words ("Paper cutout · Warm sunset colors · hills") and a chip to change it.
    private var lookRow: some View {
        let style = result.manifest.style
        let look = StudioLook(id: style.look) ?? .glow
        return StudioLookRow(look: look, colors: StudioLookColors(style: style), title: look.title, detail: StudioLookWords.detail(for: style)) {
            StudioLookMenu(title: "Change", header: "Muse redraws it in…", current: look) { newLook in
                if let newLook, newLook != look { model.changeLook(to: newLook) }
            }
        }
    }

    private var meta: some View {
        var parts: [String] = [result.manifest.formula.title]
        if let duration = result.duration, duration > 0 {
            parts.append("made in \(StudioFormat.elapsed(duration))")
        }
        if let chain = result.manifest.chain {
            parts.append("level \(chain.index)")
        }
        return HStack(spacing: 4) {
            Image(systemName: result.manifest.formula.symbol)
                .font(.system(size: FBIconSize.xs, weight: .semibold))
            Text(parts.joined(separator: " · "))
                .font(.fbMeta)
                .lineLimit(1)
        }
        .foregroundStyle(FBColor.secondaryText)
    }
}

// MARK: - Tweak

private struct StudioTweakCard: View {
    @Bindable var model: StudioModel
    var isFocused: FocusState<Bool>.Binding

    private static let suggestions = ["A little slower", "Make it harder", "Calmer colors", "Use our names"]
    private static let microgameSuggestions = ["A little slower", "Make it harder", "Softer sounds", "Brighter colors"]

    private var suggestions: [String] {
        model.currentResult?.manifest.formula == .microgame ? Self.microgameSuggestions : Self.suggestions
    }

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(title: "Tweak it", detail: "Muse edits this \(ProductName.singular)", symbol: "wand.and.stars")
            HStack(alignment: .bottom, spacing: FBSpacing.s) {
                TextField("Make it slower, add our inside jokes…", text: $model.tweakText, axis: .vertical)
                    .font(.fbBodyLarge)
                    .lineLimit(1...4)
                    .focused(isFocused)
                    .submitLabel(.send)
                    .onChange(of: model.tweakText) { _, newValue in
                        if newValue.contains("\n") {
                            model.tweakText = newValue.replacingOccurrences(of: "\n", with: " ")
                            send()
                        }
                    }
                    .padding(.horizontal, FBSpacing.m)
                    .padding(.vertical, 10)
                    .background(StudioGlow.fieldFill, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
                            .strokeBorder(isFocused.wrappedValue ? AnyShapeStyle(BubbleGlow.iridescent) : AnyShapeStyle(StudioGlow.cardStroke), lineWidth: isFocused.wrappedValue ? 1.5 : 0.75)
                    }
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 34)) // Display glyph: the send button, sized like Messenger's
                        .foregroundStyle(canSend ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(FBColor.tertiaryText))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.pressable)
                .disabled(!canSend)
                .accessibilityLabel("Tweak with Muse")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: FBSpacing.s) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        StudioChip(title: suggestion, symbol: "sparkle") {
                            Haptics.selection()
                            model.tweakText = suggestion
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .studioCard()
    }

    private var canSend: Bool {
        !model.tweakText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        guard canSend else { return }
        isFocused.wrappedValue = false
        Haptics.light()
        model.startCompose(.tweak)
    }
}
