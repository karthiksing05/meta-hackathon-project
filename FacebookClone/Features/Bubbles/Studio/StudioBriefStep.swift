import SwiftUI

/// Step 2: Muse's brief, in Muse's voice, for the creator to edit before Muse builds it: the vibe
/// (mood, energy, competition), the length, the look and the sound, plus how Muse builds it (a
/// ready formula or a microgame from scratch). Daily and Group games also list the opted-in posts
/// Muse may read.
struct StudioBriefStep: View {
    @Bindable var model: StudioModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: FBSpacing.l) {
                    StudioMuseSaysCard(model: model)
                    if model.showsAnatomyCard {
                        StudioAnatomyCard(thread: model.anatomyThread)
                            .id("anatomy")
                    }
                    StudioBriefCard(model: model)
                    if model.showsSources {
                        StudioSourcesCard(model: model)
                            .id("sources")
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.top, FBSpacing.s)
                .padding(.bottom, FBSpacing.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            .task {
                // DEBUG screenshots: FB_STUDIO_SCROLL=sources shows the opted-in posts;
                // `anatomy`, `anatomy-rules` or `anatomy-<part>` (e.g. `anatomy-pieces`) a part of
                // "How the game works".
                guard let target = DebugLaunch.value("FB_STUDIO_SCROLL"), target == "sources" || target.hasPrefix("anatomy") else { return }
                try? await Task.sleep(nanoseconds: 400_000_000)
                proxy.scrollTo(target, anchor: target == "sources" ? .bottom : .top)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            StudioActionBar {
                Button {
                    Haptics.selection()
                    model.go(to: .ask, direction: -1)
                } label: {
                    Text("Back")
                }
                .buttonStyle(.studioSecondary(expand: false, height: 44))

                Button {
                    Haptics.light()
                    model.startCompose(.create)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                            .font(.system(size: FBIconSize.medium, weight: .bold))
                        Text(model.mode == .nextLevel ? "Make level \((model.baseBubble?.levelIndex ?? 1) + 1)" : "Make it")
                    }
                }
                .buttonStyle(.studioPrimary)
                .disabled(model.brief?.intent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            }
        }
    }
}

// MARK: - Muse says

private struct StudioMuseSaysCard: View {
    let model: StudioModel

    var body: some View {
        HStack(alignment: .top, spacing: FBSpacing.m) {
            StudioMuseAvatar()
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Muse")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    StudioModelChip(model: model.isMuseConnected ? "muse-wonder-1.0" : nil, isOffline: !model.isMuseConnected)
                }
                StudioTypewriterText(text: model.museReading)
                    .font(.fbHeadline)
                    .studioRounded()
                    .foregroundStyle(FBColor.primaryText)
                Text(model.musePlan)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(model.briefNote ?? "Here's my plan. Change anything before I start.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .studioCard(highlighted: true)
        .accessibilityElement(children: .combine)
    }
}

/// Types its text out once, the first time it appears. Full text right away with Reduce Motion.
struct StudioTypewriterText: View {
    let text: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = 0
    @State private var hasTyped = false

    var body: some View {
        Text(text)
            .opacity(0)
            .overlay(alignment: .topLeading) {
                Text(String(text.prefix(shown)))
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text)
            .task(id: text) {
                guard !hasTyped, !reduceMotion else {
                    shown = text.count
                    return
                }
                hasTyped = true
                shown = 0
                for count in 1...max(text.count, 1) {
                    try? await Task.sleep(nanoseconds: 16_000_000)
                    if Task.isCancelled { break }
                    shown = count
                }
                shown = text.count
            }
    }
}

// MARK: - Brief

private struct StudioBriefCard: View {
    @Bindable var model: StudioModel
    @State private var isAddingMood = false
    @State private var newMood = ""
    @FocusState private var isMoodFieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.l) {
            StudioSectionTitle(title: "The brief", symbol: "doc.text")
            field("What it's about") {
                TextField("What the game is about", text: intent, axis: .vertical)
                    .font(.fbBodyLarge)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1...4)
                    .padding(.horizontal, FBSpacing.m)
                    .padding(.vertical, 10)
                    .background(StudioGlow.fieldFill, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            }
            field("Who it's for") {
                StudioBriefAudienceMenu(model: model)
            }
            field("Mood") {
                moods
            }
            field("Energy") {
                StudioOptionRow(options: StudioModel.energyOptions, selection: model.brief?.energy, title: StudioModel.title(forEnergy:)) { value in
                    model.brief?.energy = value
                }
            }
            field("Competition") {
                StudioOptionRow(options: options(StudioModel.competitionOptions, including: model.brief?.competition), selection: model.brief?.competition, title: StudioModel.title(forCompetition:)) { value in
                    model.brief?.competition = value
                }
            }
            field("Occasion") {
                StudioOptionRow(options: occasionOptions, selection: model.brief?.occasion ?? "", title: { StudioModel.title(forOccasion: $0.isEmpty ? nil : $0) }) { value in
                    model.brief?.occasion = value.isEmpty ? nil : value
                }
            }
            if model.canBuildMicrogame {
                field("How Muse builds it") {
                    Text("On the server, from scratch on the game engine: Muse writes the rules, art and sound, then checks and playtests them.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !model.buildsMicrogame {
                field("Length") {
                    StudioOptionRow(options: Self.lengthOptions.map(\.id), selection: Self.lengthID(model.length), title: Self.lengthTitle) { value in
                        model.length = Self.lengthOptions.first { $0.id == value }?.length
                    }
                }
            }
            field("Sound") {
                StudioOptionRow(options: Self.soundOptions, selection: model.soundHint ?? "", title: Self.soundTitle) { value in
                    model.soundHint = value.isEmpty ? nil : value
                }
            }
            field("Look") {
                let line = model.briefLook
                StudioLookRow(look: line.look, title: line.title, detail: line.detail) {
                    if model.showsLookPicker {
                        StudioLookMenu(title: "Change", current: model.lookHint, includesMusePicks: true) { look in
                            withAnimation(.easeInOut(duration: 0.2)) { model.lookHint = look }
                        }
                    }
                }
            }
        }
        .studioCard()
    }

    private var intent: Binding<String> {
        Binding(
            get: { model.brief?.intent ?? "" },
            set: { model.brief?.intent = $0 }
        )
    }

    private var occasionOptions: [String] {
        var values = StudioModel.occasionOptions.map { $0 ?? "" }
        if let current = model.brief?.occasion, !values.contains(current) {
            values.append(current)
        }
        return values
    }

    private func options(_ base: [String], including current: String?) -> [String] {
        guard let current, !current.isEmpty, !base.contains(current) else { return base }
        return base + [current]
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            Text(title)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
            content()
        }
    }

    private var moods: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            FlowLayout(spacing: FBSpacing.s, lineSpacing: FBSpacing.s) {
                ForEach(model.brief?.mood ?? [], id: \.self) { mood in
                    StudioChip(title: Self.display(mood), isSelected: true, trailingSymbol: "xmark") {
                        Haptics.light()
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                            model.removeMood(mood)
                        }
                    }
                    .accessibilityLabel("Remove \(mood)")
                    .transition(.scale.combined(with: .opacity))
                }
                if !isAddingMood {
                    StudioChip(title: "Add", symbol: "plus") {
                        Haptics.selection()
                        withAnimation(.easeInOut(duration: 0.2)) { isAddingMood = true }
                        isMoodFieldFocused = true
                    }
                    .accessibilityLabel("Add a mood")
                }
            }
            if isAddingMood {
                moodAdder
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var moodAdder: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            HStack(spacing: FBSpacing.s) {
                TextField("Add a mood", text: $newMood)
                    .font(.fbBody)
                    .focused($isMoodFieldFocused)
                    .submitLabel(.done)
                    .onSubmit(commitMood)
                    .padding(.horizontal, FBSpacing.m)
                    .frame(minHeight: 36)
                    .background(StudioGlow.fieldFill, in: Capsule())
                Button("Done") {
                    commitMood()
                    withAnimation(.easeInOut(duration: 0.2)) { isAddingMood = false }
                }
                .font(.fbButton)
                .foregroundStyle(FBColor.accent)
                .frame(minHeight: 44)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: FBSpacing.s) {
                    ForEach(StudioModel.moodSuggestions.filter { !(model.brief?.mood.contains($0) ?? false) }, id: \.self) { mood in
                        StudioChip(title: Self.display(mood), symbol: "plus") {
                            Haptics.selection()
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                                model.addMood(mood)
                            }
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func commitMood() {
        let mood = newMood
        newMood = ""
        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
            model.addMood(mood)
        }
    }

    /// Length chips: Muse picks, or one of the common shapes (docs/BUBBLES.md 7.9).
    static let lengthOptions: [(id: String, length: BubbleLength?)] = [
        ("", nil), ("timed60", .timed(60)), ("rounds5", .rounds(5)), ("lives3", .lives(3)), ("endless", .endless),
    ]

    static func lengthID(_ length: BubbleLength?) -> String {
        guard let length else { return "" }
        return lengthOptions.first { $0.length == length }?.id ?? "custom"
    }

    static func lengthTitle(_ id: String) -> String {
        guard let length = lengthOptions.first(where: { $0.id == id })?.length else { return id == "custom" ? "Custom" : "Muse picks" }
        return length.shortLabel
    }

    /// The sound sets the runtime plays (soft, bright, dreamy); "" lets Muse pick from the mood.
    static let soundOptions = ["", "soft", "bright", "dreamy"]

    static func soundTitle(_ value: String) -> String {
        value.isEmpty ? "Muse picks" : display(value)
    }

    static func display(_ mood: String) -> String {
        guard let first = mood.first else { return mood }
        return first.uppercased() + mood.dropFirst()
    }
}

/// One-of-many choice drawn as Glow chips.
private struct StudioOptionRow: View {
    let options: [String]
    let selection: String?
    let title: (String) -> String
    let onSelect: (String) -> Void

    var body: some View {
        FlowLayout(spacing: FBSpacing.s, lineSpacing: FBSpacing.s) {
            ForEach(options, id: \.self) { option in
                StudioChip(title: title(option), isSelected: selection == option) {
                    Haptics.selection()
                    withAnimation(.easeInOut(duration: 0.2)) {
                        onSelect(option)
                    }
                }
            }
        }
    }
}

private struct StudioBriefAudienceMenu: View {
    let model: StudioModel

    var body: some View {
        Menu {
            Button {
                model.setAudience(.everyone)
            } label: {
                Label("Everyone", systemImage: StudioAudienceKind.everyone.symbol)
            }
            Button {
                model.setAudience(.friends)
            } label: {
                Label("Friends", systemImage: StudioAudienceKind.friends.symbol)
            }
            if !model.myGroups.isEmpty {
                Section("Groups") {
                    ForEach(model.myGroups) { group in
                        Button(group.name) { model.setAudience(.group(group.id)) }
                    }
                }
            }
            if !model.myEvents.isEmpty {
                Section("Events") {
                    ForEach(model.myEvents) { event in
                        Button(event.title) { model.setAudience(.event(event.id)) }
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: model.audience.kind.symbol)
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                Text(model.audienceName)
                    .font(.fbButton)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
            }
            .foregroundStyle(BubbleGlow.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .background(BubbleGlow.brandGradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.75), lineWidth: 1))
        }
        .disabled(model.mode == .daily)
        .accessibilityLabel("Who it's for: \(model.audienceName)")
    }
}

// MARK: - Sources

private struct StudioSourcesCard: View {
    @Bindable var model: StudioModel

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(
                title: "From \(model.audienceName)",
                detail: model.sources.isEmpty ? nil : "\(model.sources.filter(\.isIncluded).count) of \(model.sources.count) posts",
                symbol: "text.bubble"
            )
            if model.sources.isEmpty {
                Text("No one has opted a post in yet, so Muse will use the group's name and what it's about.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 0) {
                    ForEach($model.sources) { $item in
                        StudioSourceRow(item: $item)
                        if item.id != model.sources.last?.id {
                            HairlineDivider(leadingInset: FBAvatarSize.comment + FBSpacing.m)
                        }
                    }
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "lock.fill")
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                Text("Only posts people opted in are used.")
                    .font(.fbMeta)
            }
            .foregroundStyle(FBColor.secondaryText)
            .accessibilityElement(children: .combine)
        }
        .studioCard()
    }
}

private struct StudioSourceRow: View {
    @Binding var item: StudioSourceItem

    var body: some View {
        HStack(alignment: .top, spacing: FBSpacing.m) {
            AvatarView(user: item.post.author, size: FBAvatarSize.comment)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.post.author.name)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(item.post.text)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
            }
            .opacity(item.isIncluded ? 1 : 0.5)
            Spacer(minLength: 0)
            Toggle("Use \(item.post.author.firstName)'s post", isOn: $item.isIncluded)
                .labelsHidden()
                .tint(FBColor.brandBlue)
                .onChange(of: item.isIncluded) { Haptics.light() }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}
