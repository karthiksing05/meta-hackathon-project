import SwiftUI

/// Step 1: describe the game. A big prompt, example chips for the launch context, who it's for,
/// an optional game type and an optional look.
struct StudioAskStep: View {
    @Bindable var model: StudioModel
    @FocusState private var isPromptFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: FBSpacing.xl) {
                    hero
                        .padding(.horizontal, FBMetrics.screenPadding)
                    if model.mode == .remix || model.mode == .nextLevel, let base = model.baseBubble {
                        StudioBaseBubbleCard(bubble: base, isRemix: model.mode == .remix)
                            .padding(.horizontal, FBMetrics.screenPadding)
                    }
                    VStack(alignment: .leading, spacing: FBSpacing.m) {
                        StudioPromptCard(model: model, isFocused: $isPromptFocused)
                            .padding(.horizontal, FBMetrics.screenPadding)
                        examples
                    }
                    StudioAskSlots(model: model)
                    if model.showsAudiencePicker {
                        StudioAudienceSection(model: model)
                    } else if model.mode == .daily, let group = model.audienceGroup {
                        StudioDailyScopeCard(group: group)
                            .padding(.horizontal, FBMetrics.screenPadding)
                    }
                    if model.showsFormulaPicker {
                        StudioFormulaSection(model: model)
                    }
                    if model.showsLookPicker {
                        StudioLookSection(model: model)
                            .id("look")
                    }
                }
                .padding(.top, FBSpacing.s)
                .padding(.bottom, FBSpacing.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            .task {
                // DEBUG screenshots: FB_STUDIO_SCROLL=look shows the look picker.
                guard DebugLaunch.value("FB_STUDIO_SCROLL") == "look" else { return }
                try? await Task.sleep(nanoseconds: 400_000_000)
                proxy.scrollTo("look", anchor: .bottom)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            StudioActionBar {
                Button {
                    isPromptFocused = false
                    Haptics.light()
                    model.draftBrief()
                } label: {
                    if model.isDraftingBrief {
                        HStack(spacing: FBSpacing.s) {
                            ProgressView()
                                .tint(BubbleGlow.ink)
                            Text("Reading your idea…")
                        }
                    } else {
                        HStack(spacing: 6) {
                            Text("Next")
                            Image(systemName: "arrow.right")
                                .font(.system(size: FBIconSize.medium, weight: .bold))
                        }
                    }
                }
                .buttonStyle(.studioPrimary)
                .disabled(model.effectivePrompt.isEmpty)
                .allowsHitTesting(!model.isDraftingBrief)
            }
        }
        .onAppear {
            // Like Facebook's composer, start typing right away. (Not for DEBUG step screenshots.)
            if model.trimmedPrompt.isEmpty && model.mode == .create && DebugLaunch.value("FB_STUDIO_STEP") == nil {
                isPromptFocused = true
            }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: FBSpacing.s) {
                Text(model.heroTitle)
                    .font(.fbLargeTitle)
                    .studioRounded()
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                BubbleOrb(size: 26, tint: BubbleGlow.pink)
                    .offset(y: -4)
            }
            Text(model.heroSubtitle)
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var examples: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            Text("Try one")
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
            ForEach(model.examples, id: \.self) { example in
                StudioChip(title: example, symbol: "sparkle", isSelected: model.trimmedPrompt == example, wraps: true) {
                    Haptics.selection()
                    withAnimation(.easeInOut(duration: 0.2)) {
                        model.prompt = example
                    }
                }
            }
        }
        .padding(.horizontal, FBMetrics.screenPadding)
    }
}

// MARK: - Prompt

private struct StudioPromptCard: View {
    @Bindable var model: StudioModel
    var isFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            TextField(model.promptPlaceholder, text: $model.prompt, axis: .vertical)
                .font(.fbTitle.weight(.regular))
                .studioRounded()
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(3...6)
                .focused(isFocused)
                .submitLabel(.done)
                .onChange(of: model.prompt) { _, newValue in
                    // Return finishes typing instead of adding a line.
                    if newValue.contains("\n") {
                        model.prompt = newValue.replacingOccurrences(of: "\n", with: " ")
                            .trimmingCharacters(in: .whitespaces)
                        isFocused.wrappedValue = false
                    }
                }
                .accessibilityLabel("Describe a game")
            HStack(spacing: FBSpacing.s) {
                Button {
                    Haptics.selection()
                    let options = StudioModel.surprises.filter { $0 != model.trimmedPrompt }
                    model.prompt = options.randomElement() ?? model.prompt
                } label: {
                    Label("Surprise me", systemImage: "dice")
                }
                .buttonStyle(.studioSecondary(expand: false, height: 32))
                Spacer()
                if !model.prompt.isEmpty {
                    Button {
                        model.prompt = ""
                        isFocused.wrappedValue = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: FBIconSize.large))
                            .foregroundStyle(FBColor.tertiaryText)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
            }
            .frame(minHeight: 44)
        }
        .padding(.bottom, -FBSpacing.s)
        .studioCard(highlighted: isFocused.wrappedValue)
        .bubbleGlow(BubbleGlow.pink, radius: 10, opacity: isFocused.wrappedValue ? 0.25 : 0)
        .animation(.easeInOut(duration: 0.2), value: isFocused.wrappedValue)
        .contentShape(Rectangle())
        .onTapGesture {
            isFocused.wrappedValue = true
        }
    }
}

// MARK: - Base Bubble (remix, next level)

struct StudioBaseBubbleCard: View {
    let bubble: Bubble
    let isRemix: Bool

    var body: some View {
        HStack(spacing: FBSpacing.m) {
            BubbleCoverView(bubble: bubble)
                .frame(width: 56, height: 70)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(isRemix ? "Remixing \(bubble.creator.isMe ? "your bubble" : "\(bubble.creator.firstName)'s bubble")" : "Continuing")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                Text(bubble.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(bubble.rule)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if !isRemix {
                Text("Level \(bubble.levelIndex ?? 1)")
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(BubbleGlow.ink)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(BubbleGlow.brandGradient, in: Capsule())
            }
        }
        .studioCard(padding: FBSpacing.m)
        .accessibilityElement(children: .combine)
    }
}

private struct StudioDailyScopeCard: View {
    let group: FBGroup

    var body: some View {
        HStack(spacing: FBSpacing.m) {
            StudioGroupThumbnail(group: group)
            VStack(alignment: .leading, spacing: 2) {
                Text("For \(group.name)")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text("Daily Bubble · the same game for everyone in the group today")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: FBIconSize.large))
                .foregroundStyle(FBColor.secondaryText)
        }
        .studioCard(padding: FBSpacing.m)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Audience

private struct StudioAudienceSection: View {
    let model: StudioModel

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(title: "Who it's for")
                .padding(.horizontal, FBMetrics.screenPadding)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: FBSpacing.s) {
                    ForEach(StudioAudienceKind.allCases) { kind in
                        StudioChip(title: kind.title, symbol: kind.symbol, isSelected: model.audience.kind == kind) {
                            Haptics.selection()
                            withAnimation(.easeInOut(duration: 0.2)) {
                                model.selectAudienceKind(kind)
                            }
                        }
                        .disabled(isUnavailable(kind))
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.vertical, 2)
            }
            StudioScopePicker(model: model)
                .padding(.horizontal, FBMetrics.screenPadding)
        }
    }

    private func isUnavailable(_ kind: StudioAudienceKind) -> Bool {
        switch kind {
        case .group: return model.myGroups.isEmpty
        case .event: return model.myEvents.isEmpty
        case .everyone, .friends: return false
        }
    }
}

/// Picks which Group or Event, when the audience is one.
struct StudioScopePicker: View {
    let model: StudioModel

    var body: some View {
        switch model.audience {
        case .group:
            if let group = model.audienceGroup {
                Menu {
                    ForEach(model.myGroups) { option in
                        Button(option.name) {
                            Haptics.selection()
                            model.setAudience(.group(option.id))
                        }
                    }
                } label: {
                    StudioScopeRow(title: group.name, subtitle: "\(group.privacyText) · \(group.memberCount.fbCompact) members") {
                        StudioGroupThumbnail(group: group)
                    }
                }
                .accessibilityLabel("Group: \(group.name). Change group")
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        case .event:
            if let event = model.audienceEvent {
                Menu {
                    ForEach(model.myEvents) { option in
                        Button(option.title) {
                            Haptics.selection()
                            model.setAudience(.event(option.id))
                        }
                    }
                } label: {
                    StudioScopeRow(title: event.title, subtitle: StudioEventDateTile.subtitle(for: event)) {
                        StudioEventDateTile(date: event.startDate)
                    }
                }
                .accessibilityLabel("Event: \(event.title). Change event")
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        case .everyone, .friends:
            EmptyView()
        }
    }
}

private struct StudioScopeRow<Leading: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var leading: Leading

    var body: some View {
        HStack(spacing: FBSpacing.m) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
        }
        .studioCard(padding: 10, radius: FBMetrics.radiusLarge)
        .multilineTextAlignment(.leading)
    }
}

struct StudioGroupThumbnail: View {
    let group: FBGroup
    var size: CGFloat = FBAvatarSize.post

    var body: some View {
        RemoteImage(url: group.coverURL)
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Facebook's event date tile: month in red over the day.
struct StudioEventDateTile: View {
    let date: Date
    var size: CGFloat = FBAvatarSize.post

    var body: some View {
        VStack(spacing: 0) {
            Text(date.formatted(.dateTime.month(.abbreviated)).uppercased())
                .font(.fbMicroEmphasized)
                .foregroundStyle(FBColor.eventRed)
            Text(date.formatted(.dateTime.day()))
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
        }
        .frame(width: size, height: size)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous).strokeBorder(FBColor.divider, lineWidth: 0.5))
        .accessibilityHidden(true)
    }

    static func subtitle(for event: FBEvent) -> String {
        let when = event.startDate.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        return event.locationName.isEmpty ? when : "\(when) · \(event.locationName)"
    }
}

// MARK: - Game type

private struct StudioFormulaSection: View {
    let model: StudioModel

    // Microgames come from the authoring path (docs/BUBBLES.md, "microgame"), not this picker.
    private static let formulas = BubbleFormula.allCases.filter { $0 != .make && $0 != .microgame }

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(title: "Game type", detail: "Optional")
                .padding(.horizontal, FBMetrics.screenPadding)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: FBSpacing.s) {
                    StudioChip(title: "Muse picks", symbol: "sparkles", isSelected: model.formulaHint == nil) {
                        Haptics.selection()
                        model.formulaHint = nil
                    }
                    ForEach(Self.formulas, id: \.self) { formula in
                        StudioChip(title: formula.title, symbol: formula.symbol, isSelected: model.formulaHint == formula) {
                            Haptics.selection()
                            model.formulaHint = formula
                        }
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.vertical, 2)
            }
            Text(Self.blurb(for: model.formulaHint))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.horizontal, FBMetrics.screenPadding)
                .fixedSize(horizontal: false, vertical: true)
                .animation(nil, value: model.formulaHint)
        }
    }

    static func blurb(for formula: BubbleFormula?) -> String {
        switch formula {
        case .none: return "Muse picks the kind of game that fits your idea best."
        case .dodge: return "One-touch survival: float through the gaps."
        case .guess: return "Find the hidden word or answer in a few tries."
        case .group: return "Sort things into the right groups."
        case .answer: return "Pick or type answers, then see how your crowd answered."
        case .time: return "Tap at just the right moment."
        case .merge: return "Drop bubbles and merge them into bigger ones."
        case .make: return "Make something together."
        case .story: return "A story you play: pick a path, find every ending."
        case .nextline: return "Guess what they say next, against the clock."
        case .learn: return "A short lesson, then practice until it sticks."
        case .microgame: return "Any game Muse can build, with its own art and sound."
        }
    }
}

// MARK: - Look

/// Optional: pick the game's look. Each tile is drawn in its look; "Muse picks" is the default.
private struct StudioLookSection: View {
    let model: StudioModel

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(title: "Look", detail: "Optional")
                .padding(.horizontal, FBMetrics.screenPadding)
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: FBSpacing.s) {
                        tile(nil)
                        ForEach(StudioLook.allCases) { look in
                            tile(look)
                        }
                    }
                    .padding(.horizontal, FBMetrics.screenPadding)
                    .padding(.vertical, 6)
                }
                .onAppear {
                    if let look = model.lookHint { proxy.scrollTo(look.id, anchor: .center) }
                }
            }
            Text(blurb)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.horizontal, FBMetrics.screenPadding)
                .fixedSize(horizontal: false, vertical: true)
                .animation(nil, value: model.lookHint)
        }
    }

    private func tile(_ look: StudioLook?) -> some View {
        StudioLookTile(look: look, isSelected: model.lookHint == look) {
            Haptics.selection()
            model.lookHint = look
        }
        .id(look?.id ?? "muse")
    }

    private var blurb: String {
        guard let look = model.lookHint else {
            return "Muse picks a look that fits your idea, so every bubble looks like itself."
        }
        return "\(look.title): \(look.feel.prefix(1).lowercased() + look.feel.dropFirst())."
    }
}
