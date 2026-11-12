import SwiftUI

/// The make-a-game flow: prompt, brief review, live generation, preview, publish.
struct SGCreateFlowView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store
    @State private var model = SGCreateModel()
    let onPublished: (SGGame, SGFeedItem?) -> Void

    var body: some View {
        VStack(spacing: 0) {
            topBar
            HairlineDivider()
            Group {
                switch model.step {
                case .prompt: SGPromptStep(model: model)
                case .brief: SGBriefStep(model: model)
                case .generating: SGGeneratingStep(model: model)
                case .preview: SGPreviewStep(model: model, onPublish: publish)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(FBColor.surface)
        .overlay(alignment: .bottom) {
            ToastHost().padding(.bottom, 24)
        }
        .interactiveDismissDisabled(model.step == .generating)
    }

    private var title: String {
        switch model.step {
        case .prompt: return "Make a game"
        case .brief: return "Review the brief"
        case .generating: return "Building your game"
        case .preview: return "Preview"
        }
    }

    private var topBar: some View {
        HStack(spacing: FBSpacing.s) {
            CircleButton(
                accessibilityLabel: backIsClose ? "Close" : "Back",
                action: back
            ) {
                Image(systemName: backIsClose ? "xmark" : "chevron.left")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
            }
            Text(title)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer()
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.vertical, FBSpacing.s)
    }

    private var backIsClose: Bool { model.step == .prompt }

    private func back() {
        switch model.step {
        case .prompt:
            model.cancelGeneration()
            dismiss()
        case .brief:
            model.step = .prompt
        case .generating:
            model.cancelGeneration()
            model.step = .brief
        case .preview:
            model.step = .brief
        }
    }

    private func publish() {
        Task {
            guard let (game, item) = await model.publish() else { return }
            if game.moderation?.isFlagged == true {
                store.showToast("Published. Only you can see it until it is reviewed.", symbol: "flag.fill")
            } else {
                store.showToast("Published to Scroll Games", symbol: "checkmark.circle.fill")
            }
            onPublished(game, item)
            dismiss()
        }
    }
}

// MARK: - Step 1: prompt

private struct SGPromptStep: View {
    @Bindable var model: SGCreateModel

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 3)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FBSpacing.l) {
                VStack(alignment: .leading, spacing: FBSpacing.s) {
                    Text("What kind of game?")
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    TextField("A trivia game about our Lisbon trip...", text: $model.prompt, axis: .vertical)
                        .font(.fbBodyLarge)
                        .lineLimit(3...6)
                        .padding(FBSpacing.m)
                        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                }

                VStack(alignment: .leading, spacing: FBSpacing.s) {
                    Text("Creator level")
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    Picker("Creator level", selection: $model.level) {
                        ForEach(SGCreatorLevel.allCases) { level in
                            Text(level.title).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)
                    Text(model.level.blurb)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }

                mediaSection

                Button {
                    Task { await model.requestBrief() }
                } label: {
                    if model.isLoadingBrief {
                        ProgressView().tint(.white)
                    } else {
                        Text("Review brief")
                    }
                }
                .buttonStyle(.fb(.primary, height: 44))
                .disabled(!model.canContinue || model.isLoadingBrief)
                .opacity(model.canContinue ? 1 : 0.5)
            }
            .padding(FBMetrics.screenPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .task { await model.loadMedia() }
    }

    private var mediaSection: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            Toggle(isOn: $model.useMedia.animation(.easeInOut(duration: 0.2))) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Use these photos to make my game")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Off by default. Photos are only sent if you turn this on.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            .tint(FBColor.brandBlue)

            if model.useMedia {
                if model.mediaIsSample {
                    Label("Offline: sample photos", systemImage: "wifi.slash")
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                } else {
                    Text("Demo photos from synthetic groups.")
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.tertiaryText)
                }
                groupChips
                if model.isLoadingMedia {
                    ProgressView().frame(maxWidth: .infinity).padding()
                } else {
                    LazyVGrid(columns: columns, spacing: 4) {
                        ForEach(model.visibleMedia) { item in
                            tile(item)
                        }
                    }
                    Text("\(model.selectedMediaIDs.count) of \(SGCreateModel.maxPhotos) selected")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
        }
    }

    private var groupChips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: FBSpacing.s) {
                ChipView(title: "All", isSelected: model.selectedGroupID == nil) {
                    model.selectedGroupID = nil
                }
                ForEach(model.groups) { group in
                    ChipView(title: group.name, isSelected: model.selectedGroupID == group.id) {
                        model.selectedGroupID = group.id
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func tile(_ item: SGMedia) -> some View {
        let isSelected = model.selectedMediaIDs.contains(item.id)
        return Button {
            Haptics.selection()
            model.toggle(item)
        } label: {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay { RemoteImage(url: URL(string: item.url)) }
                .overlay {
                    if isSelected {
                        Color.black.opacity(0.25)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: FBIconSize.large))
                        .foregroundStyle(isSelected ? FBColor.brandBlue : .white)
                        .background(isSelected ? Circle().fill(.white) : nil)
                        .padding(6)
                }
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusXS, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.caption.isEmpty ? "Photo" : item.caption)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Step 2: brief

private struct SGBriefStep: View {
    @Bindable var model: SGCreateModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FBSpacing.l) {
                provenance
                if let note = model.briefNote {
                    Label(note, systemImage: "wifi.slash")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Text("This is the plan Wonder will build from. Change anything before you generate.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)

                field("Title idea", keys: SGBriefDraft.titleKeys)
                HStack(spacing: FBSpacing.m) {
                    field("Mood", keys: SGBriefDraft.moodKeys)
                    field("Energy", keys: SGBriefDraft.energyKeys)
                }
                HStack(spacing: FBSpacing.m) {
                    field("Rounds", keys: SGBriefDraft.roundsKeys, numeric: true)
                    field("Duration (s)", keys: SGBriefDraft.durationKeys, numeric: true)
                }
                glueIdeas

                Button("Generate game") { model.generate() }
                    .buttonStyle(.fb(.primary, height: 44))
            }
            .padding(FBMetrics.screenPadding)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var provenance: some View {
        let response = model.briefResponse
        let source = response?.source ?? "fallback"
        return HStack(spacing: FBSpacing.s) {
            pill(
                source == "muse" ? "From Muse" : (source == "offline" ? "Offline sample" : "Fallback brief"),
                symbol: source == "muse" ? "sparkles" : "tray"
            )
            if let ms = response?.ms {
                pill("\(ms) ms", symbol: "timer")
            }
            if response?.cached == true {
                pill("Cached", symbol: "bolt.fill")
            }
        }
    }

    private func pill(_ text: String, symbol: String) -> some View {
        Label(text, systemImage: symbol)
            .font(.fbCaptionEmphasized)
            .foregroundStyle(FBColor.accent)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(FBColor.tintedBlueBackground, in: Capsule())
    }

    private func field(_ label: String, keys: [String], numeric: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
            TextField(
                label,
                text: Binding(
                    get: { model.draft.text(keys) },
                    set: { model.draft.setText(keys, $0) }
                )
            )
            .keyboardType(numeric ? .numberPad : .default)
            .font(.fbBodyLarge)
            .padding(.horizontal, FBSpacing.m)
            .frame(height: 44)
            .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        }
    }

    private var glueIdeas: some View {
        let keys = SGBriefDraft.glueKeys
        let ideas = model.draft.list(keys)
        return VStack(alignment: .leading, spacing: FBSpacing.s) {
            Text("Glue ideas")
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
            ForEach(ideas.indices, id: \.self) { index in
                HStack(spacing: FBSpacing.s) {
                    TextField(
                        "A twist for the rules",
                        text: Binding(
                            get: { model.draft.list(keys)[safe: index] ?? "" },
                            set: { value in
                                var current = model.draft.list(keys)
                                if current.indices.contains(index) {
                                    current[index] = value
                                    model.draft.setList(keys, current)
                                }
                            }
                        )
                    )
                    .font(.fbBodyLarge)
                    .padding(.horizontal, FBSpacing.m)
                    .frame(height: 44)
                    .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                    Button {
                        var current = model.draft.list(keys)
                        current.remove(at: index)
                        model.draft.setList(keys, current)
                    } label: {
                        Image(systemName: "minus.circle")
                            .font(.system(size: FBIconSize.large))
                            .foregroundStyle(FBColor.secondaryText)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Remove idea")
                }
            }
            Button {
                model.draft.setList(keys, ideas + [""])
            } label: {
                Label("Add an idea", systemImage: "plus")
            }
            .buttonStyle(.fb(.tinted, expand: false))
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

// MARK: - Step 3: generating

private struct SGGeneratingStep: View {
    var model: SGCreateModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FBSpacing.l) {
                VStack(alignment: .leading, spacing: FBSpacing.xs) {
                    Text(model.prompt)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                    totalTime
                }

                VStack(spacing: 0) {
                    ForEach(model.stageOrder, id: \.key) { row in
                        stageRow(key: row.key, title: row.title)
                        HairlineDivider(leadingInset: 40)
                    }
                }
                .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))

                if let error = model.generateError {
                    VStack(alignment: .leading, spacing: FBSpacing.s) {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.fbBody)
                            .foregroundStyle(FBColor.notificationRed)
                        HStack {
                            Button("Try again") { model.generate() }
                                .buttonStyle(.fb(.primary, expand: false))
                            Button("Edit brief") { model.step = .brief }
                                .buttonStyle(.fb(.secondary, expand: false))
                        }
                    }
                } else if model.game != nil {
                    Button("Preview game") {
                        model.step = .preview
                    }
                    .buttonStyle(.fb(.primary, height: 44))
                    if let source = model.game?.gen?.source {
                        Text("Built from: \(source)")
                            .font(.fbCaption)
                            .foregroundStyle(FBColor.tertiaryText)
                    }
                }
            }
            .padding(FBMetrics.screenPadding)
        }
    }

    @ViewBuilder
    private var totalTime: some View {
        if let total = model.totalMs {
            Text("Done in \(formatted(ms: total))")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
        } else if model.generateError != nil {
            Text("Stopped")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
        } else {
            TimelineView(.periodic(from: .now, by: 0.1)) { context in
                let elapsed = model.generationStart.map { context.date.timeIntervalSince($0) } ?? 0
                Text("Building... \(String(format: "%.1f", max(0, elapsed)))s")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .monospacedDigit()
            }
        }
    }

    private func formatted(ms: Int) -> String {
        ms < 1000 ? "\(ms) ms" : String(format: "%.1f s", Double(ms) / 1000)
    }

    private func stageRow(key: String, title: String) -> some View {
        let info = model.stages[key]
        return HStack(spacing: FBSpacing.m) {
            Group {
                switch info?.status {
                case .done:
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(FBColor.online)
                case .running:
                    ProgressView()
                case nil:
                    Image(systemName: model.generateError != nil ? "xmark.circle" : "circle")
                        .foregroundStyle(FBColor.tertiaryText)
                }
            }
            .font(.system(size: FBIconSize.large))
            .frame(width: 24, height: 24)
            Text(title)
                .font(.fbBodyLarge)
                .foregroundStyle(info == nil ? FBColor.secondaryText : FBColor.primaryText)
            Spacer()
            if let ms = info?.ms, info?.status == .done {
                Text("\(ms) ms")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, FBSpacing.m)
        .frame(minHeight: 48)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Step 4/5: preview and publish

private struct SGPreviewStep: View {
    var model: SGCreateModel
    let onPublish: () -> Void

    @State private var seed = SGConfig.randomSeed()
    @State private var attempt = 0
    @State private var previewScore: Int?

    var body: some View {
        VStack(spacing: 0) {
            if let game = model.game {
                SGPlayerSurface(gameID: game.id, seed: seed) { result in
                    previewScore = result.score
                }
                .id(attempt)
            }
            VStack(spacing: FBSpacing.s) {
                if let previewScore {
                    HStack {
                        Text("Preview score: \(previewScore)")
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Spacer()
                        Button("Play again") {
                            self.previewScore = nil
                            seed = SGConfig.randomSeed()
                            attempt += 1
                        }
                        .buttonStyle(.fb(.tinted, expand: false, height: 32))
                    }
                }
                if let error = model.publishError {
                    Text(error)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.notificationRed)
                }
                Button {
                    onPublish()
                } label: {
                    if model.isPublishing {
                        ProgressView().tint(.white)
                    } else {
                        Text("Publish")
                    }
                }
                .buttonStyle(.fb(.primary, height: 44))
                .disabled(model.isPublishing || model.game?.moderation?.isBlocked == true)
                SGModerationNote(moderation: model.game?.moderation) { model.step = .brief }
            }
            .padding(FBMetrics.screenPadding)
            .background(FBColor.surface)
        }
    }
}
