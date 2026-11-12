import SwiftUI

/// The "Sounds" section of Studio's Try / Customize step: hear every moment of the game's sound
/// set, pick another set, turn music on or off, set the loudness, and ask Muse for a tweak
/// ("softer", "more bouncy").
///
/// Self-contained: give it the game and take the changed game back.
///
/// ```swift
/// SoundCustomizeSection(manifest: draft) { newManifest in draft = newManifest }
/// SoundCustomizeSection(manifest: $draft)
/// ```
///
/// - Microgames Muse built (with `content.authoring_json`) get everything. Set, music and loudness
///   edit the manifest's `sound` section directly and re-expand it (about a second, no Muse call);
///   free-text tweaks run `MicrogameComposer.revise`.
/// - Other games show a short note: their sounds follow the game's feel, not a sound set.
///
/// Previews play through `GameSound` with a Swift copy of the engine's synth: the same notes,
/// waves, envelopes and master filter as in the game, so close but not bit-exact.
struct SoundCustomizeSection: View {
    let manifest: BubbleManifest
    let onChange: (BubbleManifest) -> Void
    /// Makes the composer for Muse tweaks. Pass a scripted Muse in tests.
    let makeComposer: @MainActor () -> MicrogameComposer

    init(
        manifest: BubbleManifest,
        makeComposer: @escaping @MainActor () -> MicrogameComposer = { MicrogameComposer() },
        onChange: @escaping (BubbleManifest) -> Void
    ) {
        self.manifest = manifest
        self.makeComposer = makeComposer
        self.onChange = onChange
    }

    init(manifest: Binding<BubbleManifest>) {
        self.init(manifest: manifest.wrappedValue) { manifest.wrappedValue = $0 }
    }

    @State private var pending: GameSoundSection?
    @State private var working: String?
    @State private var errorText: String?
    @State private var request = ""
    @State private var task: Task<Void, Never>?
    @FocusState private var requestFocused: Bool

    private var section: GameSoundSection? {
        pending ?? SoundManifestEditor.section(of: manifest)
    }

    private var isEditable: Bool { SoundManifestEditor.canEdit(manifest) }

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.l) {
            header
            if GameSound.isMuted {
                mutedBanner
            }
            if let section, isEditable {
                setPicker(section)
                momentList(section)
                musicRow(section)
                loudnessRow(section)
                askMuse
            } else {
                notEditableNote
            }
        }
        .padding(FBSpacing.l)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge))
        .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge).strokeBorder(FBColor.divider, lineWidth: 0.5))
        .onChange(of: manifest.content) { _, _ in
            pending = nil
        }
        .onDisappear {
            task?.cancel()
            GameSound.stopMusic()
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: FBSpacing.s) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sounds")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text("Every sound is synthesized for this game. Tap one to hear it.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
            if let working {
                GameLoader(style: .dots, label: working, size: 6)
            }
        }
    }

    private var mutedBanner: some View {
        HStack(spacing: FBSpacing.s) {
            Image(systemName: "speaker.slash.fill")
                .foregroundStyle(GameColor.deep)
                .accessibilityHidden(true)
            Text("\(ProductName.display) sound is off")
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
            Spacer(minLength: 0)
            Button("Turn on") {
                Haptics.light()
                GameSound.isMuted = false
            }
            .font(.fbButton)
            .foregroundStyle(GameColor.deep)
        }
        .padding(FBSpacing.m)
        .background(GameColor.wash, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium))
    }

    private var notEditableNote: some View {
        HStack(alignment: .top, spacing: FBSpacing.s) {
            Image(systemName: "waveform")
                .foregroundStyle(GameColor.deep)
                .accessibilityHidden(true)
            Text(manifest.formula == .microgame
                 ? "This \(ProductName.singular) was made before sound sets, so its sounds can't be changed here."
                 : "This kind of game takes its sounds from its feel. Sound sets are for games Muse builds from scratch.")
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Sets

    private func setPicker(_ section: GameSoundSection) -> some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            sectionLabel("Sound set")
            ScrollView(.horizontal) {
                HStack(spacing: FBSpacing.s) {
                    ForEach(SoundLibrary.sets) { set in
                        setCard(set, selected: set.id == section.set.id)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func setCard(_ set: SoundSet, selected: Bool) -> some View {
        Button {
            choose(set)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(set.title)
                        .font(.fbName)
                    Spacer(minLength: 0)
                    if selected {
                        Image(systemName: "checkmark.circle.fill")
                            .accessibilityHidden(true)
                    }
                }
                Text(set.describe)
                    .font(.fbCaption)
                    .lineLimit(3, reservesSpace: true)
                    .multilineTextAlignment(.leading)
                    .opacity(0.85)
                Label(set.music ?? "No music", systemImage: set.music == nil ? "music.note.slash" : "music.note")
                    .font(.fbMicroEmphasized)
                    .opacity(0.8)
            }
            .foregroundStyle(selected ? GameColor.ink : FBColor.primaryText)
            .padding(FBSpacing.m)
            .frame(width: 150, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge)
                    .fill(selected ? AnyShapeStyle(GameColor.gradient) : AnyShapeStyle(FBColor.inputBackground))
            }
            .overlay {
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge)
                    .strokeBorder(selected ? Color.white.opacity(0.7) : Color.clear, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge))
        }
        .buttonStyle(.plain)
        .gamePress()
        .disabled(working != nil)
        .accessibilityLabel("\(set.title) sounds. \(set.describe)")
        .accessibilityAddTraits(selected ? [.isSelected, .playsSound] : .playsSound)
    }

    // MARK: Moments

    private func momentList(_ section: GameSoundSection) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                sectionLabel("Moments")
                Spacer()
                Button {
                    playAll(section)
                } label: {
                    Label("Play all", systemImage: "play.fill")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(GameColor.deep)
                }
                .accessibilityAddTraits(.playsSound)
            }
            .padding(.bottom, FBSpacing.xs)
            ForEach(SoundMoment.allCases) { moment in
                SoundPreviewRow(
                    moment: moment,
                    tone: section.tone(for: moment),
                    soundName: section.soundName(for: moment),
                    isCustom: section.isOverridden(moment)
                )
                if moment != SoundMoment.allCases.last {
                    Divider().padding(.leading, 48)
                }
            }
        }
    }

    // MARK: Music and loudness

    private func musicRow(_ section: GameSoundSection) -> some View {
        let name = section.musicName
        let playing = GameSound.playingMusic != nil
        return HStack(spacing: FBSpacing.m) {
            Image(systemName: section.hasMusic ? "music.note" : "music.note.slash")
                .font(.system(size: FBIconSize.medium, weight: .semibold))
                .foregroundStyle(GameColor.ink)
                .frame(width: 36, height: 36)
                .background(GameColor.gradient, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Music")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(name.map { "\($0.capitalized) loop while you play" } ?? "No music, just sounds")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 4)
            if let loop = section.musicLoop, let name {
                Button {
                    if playing {
                        GameSound.stopMusic()
                    } else {
                        GameSound.playMusic(loop, named: name, volume: section.effectiveVolume)
                    }
                } label: {
                    Image(systemName: playing ? "stop.circle.fill" : "play.circle.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(GameColor.deep)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? "Stop music" : "Play music")
            }
            Toggle("Music", isOn: Binding(
                get: { section.hasMusic },
                set: { setMusic($0) }
            ))
            .labelsHidden()
            .tint(GameColor.deepFill)
            .disabled(working != nil)
        }
    }

    private enum Loudness: Double, CaseIterable, Identifiable {
        case quiet = 0.4, medium = 0.7, full = 1
        var id: Double { rawValue }
        var title: String {
            switch self {
            case .quiet: return "Quiet"
            case .medium: return "Medium"
            case .full: return "Full"
            }
        }
    }

    private func loudnessRow(_ section: GameSoundSection) -> some View {
        let current = Loudness.allCases.min { abs($0.rawValue - (section.volume ?? 1)) < abs($1.rawValue - (section.volume ?? 1)) } ?? .full
        return VStack(alignment: .leading, spacing: FBSpacing.s) {
            sectionLabel("Loudness")
            Picker("Loudness", selection: Binding(get: { current }, set: { setLoudness($0) })) {
                ForEach(Loudness.allCases) { level in
                    Text(level.title).tag(level)
                }
            }
            .pickerStyle(.segmented)
            .disabled(working != nil)
        }
    }

    // MARK: Ask Muse

    private static let suggestions = ["Softer", "More bouncy", "Calmer", "Squishier taps", "No music"]

    private var askMuse: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            sectionLabel("Ask Muse")
            HStack(spacing: FBSpacing.s) {
                TextField("Make the sounds…", text: $request)
                    .font(.fbBody)
                    .focused($requestFocused)
                    .submitLabel(.send)
                    .onSubmit { ask(request) }
                    .padding(.horizontal, FBSpacing.m)
                    .frame(minHeight: 40)
                    .background(FBColor.inputBackground, in: Capsule())
                Button {
                    ask(request)
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: FBIconSize.medium, weight: .bold))
                        .foregroundStyle(GameColor.ink)
                        .frame(width: 40, height: 40)
                        .background(GameColor.gradient, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(trimmed(request).isEmpty || working != nil)
                .accessibilityLabel("Ask Muse")
            }
            ScrollView(.horizontal) {
                HStack(spacing: FBSpacing.s) {
                    ForEach(Self.suggestions, id: \.self) { text in
                        Button(text) { quick(text) }
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(GameColor.deep)
                            .padding(.horizontal, FBSpacing.m)
                            .frame(minHeight: 32)
                            .background(GameColor.wash, in: Capsule())
                            .buttonStyle(.plain)
                            .disabled(working != nil)
                    }
                }
            }
            .scrollIndicators(.hidden)
            if let errorText {
                Text(errorText)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.notificationRed)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.fbMetaEmphasized)
            .foregroundStyle(FBColor.secondaryText)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: Actions

    private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func choose(_ set: SoundSet) {
        Haptics.selection()
        let preview = GameSoundSection(setName: set.id, volume: section?.volume)
        // The set's signature: a score, then the win.
        if let pickup = preview.tone(for: .pickup) { GameSound.preview(pickup) }
        if let win = preview.tone(for: .win) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { GameSound.preview(win) }
        }
        guard var next = section, next.set.id != set.id else { return }
        next.setName = set.id
        // A new set brings its own sounds and music.
        next.moments = [:]
        next.music = nil
        apply(next, label: "Switching to \(set.title)")
    }

    private func setMusic(_ on: Bool) {
        guard var next = section else { return }
        GameSound.stopMusic()
        next.music = on ? (next.set.music == nil ? .bool(true) : nil) : .bool(false)
        apply(next, label: on ? "Adding music" : "Turning music off")
    }

    private func setLoudness(_ level: Loudness) {
        guard var next = section else { return }
        next.volume = level == .full ? nil : level.rawValue
        apply(next, label: "Setting loudness")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            if let tone = next.tone(for: .pickup) { GameSound.preview(tone) }
        }
    }

    /// Chips that are plain edits run locally; the rest ask Muse.
    private func quick(_ text: String) {
        guard var next = section else { return }
        switch text {
        case "Softer":
            next.volume = max(0.3, ((next.volume ?? 1) * 0.6 * 100).rounded() / 100)
            apply(next, label: "Making it softer")
        case "No music":
            next.music = .bool(false)
            GameSound.stopMusic()
            apply(next, label: "Turning music off")
        default:
            ask(text)
        }
    }

    private func playAll(_ section: GameSoundSection) {
        let order: [SoundMoment] = [.tap, .pickup, .combo, .level, .hit, .win]
        for (index, moment) in order.enumerated() {
            guard let tone = section.tone(for: moment) else { continue }
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.45) {
                GameSound.preview(tone)
            }
        }
    }

    private func apply(_ next: GameSoundSection, label: String) {
        guard working == nil else { return }
        let base = manifest
        pending = next
        errorText = nil
        working = label
        task = Task { @MainActor in
            defer { working = nil }
            do {
                let updated = try await SoundManifestEditor.applying(next, to: base)
                guard !Task.isCancelled else { return }
                onChange(updated)
            } catch {
                guard !Task.isCancelled else { return }
                pending = nil
                errorText = "Couldn't change the sound: \(error.localizedDescription)"
            }
        }
    }

    private func ask(_ text: String) {
        let wish = trimmed(text)
        guard !wish.isEmpty, working == nil else { return }
        requestFocused = false
        errorText = nil
        working = "Muse is tuning the sounds"
        let base = manifest
        let composer = makeComposer()
        let prompt = "Change only the game's sound section (sound set, volume, music or single moments), nothing else: \(wish)"
        task = Task { @MainActor in
            defer { working = nil }
            do {
                let updated = try await composer.revise(base, request: prompt) { event in
                    switch event {
                    case .done, .failed: break
                    default: working = event.summary
                    }
                }
                guard !Task.isCancelled else { return }
                request = ""
                onChange(updated)
                if let tone = SoundManifestEditor.section(of: updated)?.tone(for: .pickup) {
                    GameSound.preview(tone)
                }
            } catch {
                guard !Task.isCancelled else { return }
                errorText = "Muse couldn't change the sound: \(error.localizedDescription)"
            }
        }
    }
}

// MARK: - Preview

private enum SoundCustomizePreviewData {
    /// A seed microgame with a small authoring manifest attached, so the section is editable.
    static func manifest() -> BubbleManifest? {
        guard let url = Bundle.main.url(forResource: "bubble-seed-mg-gust-glider", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              var manifest = try? BubbleManifest.decode(data) else { return nil }
        var content = manifest.content.object ?? [:]
        content["authoring_json"] = .string("""
        {"title": "Gust Glider", "sound": {"set": "soft", "volume": 0.8, "moments": {"win": "tada"}}}
        """)
        manifest.content = .object(content)
        return manifest
    }
}

private struct SoundCustomizePreviewHost: View {
    @State var manifest: BubbleManifest

    var body: some View {
        ScrollView {
            SoundCustomizeSection(manifest: $manifest)
                .padding()
        }
        .background(FBColor.background)
    }
}

#Preview("Sounds") {
    if let manifest = SoundCustomizePreviewData.manifest() {
        SoundCustomizePreviewHost(manifest: manifest)
    } else {
        Text("Seed not found")
    }
}
