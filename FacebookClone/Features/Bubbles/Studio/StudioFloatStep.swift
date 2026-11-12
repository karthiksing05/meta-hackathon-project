import SwiftUI

/// Step 5: float it to your feed, a Group or an Event (or save the edit). Floating pops the bubble,
/// publishes it and opens it on the Bubbles tab.
struct StudioFloatStep: View {
    @Bindable var model: StudioModel
    let onFloat: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: FBSpacing.xl) {
                StudioFloatPreview(model: model)
                if model.isEditMode && model.levels.count == 1 {
                    StudioSaveNote(model: model)
                } else {
                    StudioDestinationCard(model: model)
                    if showsCaption {
                        StudioCaptionCard(model: model)
                    }
                }
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.top, FBSpacing.m)
            .padding(.bottom, FBSpacing.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            StudioActionBar {
                Button {
                    Haptics.selection()
                    model.go(to: .tryIt, direction: -1)
                } label: {
                    Text("Back")
                }
                .buttonStyle(.studioSecondary(expand: false, height: 44))
                .disabled(model.isPopping)

                Button(action: onFloat) {
                    HStack(spacing: 6) {
                        Image(systemName: model.floatButtonTitle == "Save changes" ? "checkmark" : "sparkles")
                            .font(.system(size: FBIconSize.medium, weight: .bold))
                        Text(buttonTitle)
                    }
                }
                .buttonStyle(.studioPrimary)
                .disabled(model.isPopping)
            }
        }
    }

    private var showsCaption: Bool {
        if case .event = model.destination { return false }
        return true
    }

    private var buttonTitle: String {
        if model.floatButtonTitle == "Save changes" { return "Save changes" }
        if model.mode == .daily { return "Share today's \(ProductName.singular)" }
        let name = model.destination == .feed ? "your feed" : model.destinationName
        return name.count <= 20 ? "Share to \(name)" : "Share"
    }
}

// MARK: - Preview

private struct StudioFloatPreview: View {
    let model: StudioModel

    var body: some View {
        if let result = model.levels.first {
            ZStack {
                VStack(spacing: FBSpacing.s) {
                    cover(result)
                        .modifier(StudioBob())
                        .padding(.bottom, FBSpacing.s)
                    Text(result.manifest.title)
                        .font(.fbTitle)
                        .studioRounded()
                        .foregroundStyle(FBColor.primaryText)
                        .multilineTextAlignment(.center)
                    Text(result.manifest.oneLineRule)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    if model.levels.count > 1 {
                        Label("\(model.levels.count) levels · Level chain", systemImage: "link")
                            .font(.fbCaptionEmphasized)
                            .foregroundStyle(BubbleGlow.ink)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(BubbleGlow.brandGradient, in: Capsule())
                    }
                }
                .scaleEffect(model.isPopping ? 1.18 : 1)
                .opacity(model.isPopping ? 0 : 1)
                .blur(radius: model.isPopping ? 10 : 0)
                if model.isPopping {
                    StudioPopBurst()
                        .offset(y: -50)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
        }
    }

    private func cover(_ result: StudioResult) -> some View {
        let shape = RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
        return BubbleCoverView(bubble: model.previewBubble(for: result))
            .frame(width: 176, height: 220)
            .clipShape(shape)
            .overlay(shape.strokeBorder(BubbleGlow.iridescent, lineWidth: 2))
            .overlay(alignment: .topLeading) {
                MuseBadge(compact: true)
                    .padding(FBSpacing.s)
            }
            .shadow(color: BubbleGlow.pink.opacity(0.4), radius: 22, y: 10)
            .accessibilityHidden(true)
    }
}

// MARK: - Destination

private struct StudioDestinationCard: View {
    let model: StudioModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StudioSectionTitle(title: model.mode == .daily ? "Goes to" : "Share to")
                .padding(.bottom, FBSpacing.s)
            if model.mode == .daily, let group = model.audienceGroup {
                StudioDestinationRow(
                    title: group.name,
                    subtitle: "Today's Daily \(ProductName.singular) · same game for everyone",
                    isSelected: true,
                    action: {}
                ) {
                    StudioGroupThumbnail(group: group)
                }
            } else {
                feedRow
                if let group = groupForRow {
                    HairlineDivider(leadingInset: FBAvatarSize.post + FBSpacing.m)
                    groupRow(group)
                }
                if let event = eventForRow {
                    HairlineDivider(leadingInset: FBAvatarSize.post + FBSpacing.m)
                    eventRow(event)
                }
            }
        }
        .studioCard()
    }

    private var groupForRow: FBGroup? {
        model.destinationGroup ?? model.audienceGroup ?? model.defaultGroup
    }

    private var eventForRow: FBEvent? {
        model.destinationEvent ?? model.audienceEvent ?? model.defaultEvent
    }

    private var feedRow: some View {
        StudioDestinationRow(
            title: "Your feed",
            subtitle: "Friends and the \(ProductName.display) tab",
            isSelected: model.destination == .feed,
            action: { select(.feed) }
        ) {
            if let me = model.me {
                AvatarView(user: me, size: FBAvatarSize.post)
            }
        }
    }

    private func groupRow(_ group: FBGroup) -> some View {
        StudioDestinationRow(
            title: group.name,
            subtitle: "Group · \(group.memberCount.fbCompact) members",
            isSelected: model.destination == .group(group.id),
            action: { select(.group(group.id)) }
        ) {
            StudioGroupThumbnail(group: group)
        } accessory: {
            if model.myGroups.count > 1 {
                Menu {
                    ForEach(model.myGroups) { option in
                        Button(option.name) { select(.group(option.id)) }
                    }
                } label: {
                    changeLabel
                }
                .accessibilityLabel("Choose another group")
            }
        }
    }

    private func eventRow(_ event: FBEvent) -> some View {
        StudioDestinationRow(
            title: StudioModel.shortTitle(of: event),
            subtitle: "Event · " + event.startDate.formatted(.dateTime.weekday(.wide).hour().minute()),
            isSelected: model.destination == .event(event.id),
            action: { select(.event(event.id)) }
        ) {
            StudioEventDateTile(date: event.startDate)
        } accessory: {
            if model.myEvents.count > 1 {
                Menu {
                    ForEach(model.myEvents) { option in
                        Button(option.title) { select(.event(option.id)) }
                    }
                } label: {
                    changeLabel
                }
                .accessibilityLabel("Choose another event")
            }
        }
    }

    private var changeLabel: some View {
        Text("Change")
            .font(.fbMetaEmphasized)
            .foregroundStyle(FBColor.accent)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
    }

    private func select(_ destination: StudioDestination) {
        Haptics.selection()
        withAnimation(.easeInOut(duration: 0.2)) {
            model.destination = destination
        }
    }
}

private struct StudioDestinationRow<Leading: View, Accessory: View>: View {
    let title: String
    let subtitle: String
    let isSelected: Bool
    let action: () -> Void
    @ViewBuilder var leading: Leading
    @ViewBuilder var accessory: Accessory

    init(
        title: String,
        subtitle: String,
        isSelected: Bool,
        action: @escaping () -> Void,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder accessory: () -> Accessory = { EmptyView() }
    ) {
        self.title = title
        self.subtitle = subtitle
        self.isSelected = isSelected
        self.action = action
        self.leading = leading()
        self.accessory = accessory()
    }

    var body: some View {
        HStack(spacing: FBSpacing.s) {
            Button(action: action) {
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
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            accessory
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: FBIconSize.xl))
                .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.tertiaryText)
                .frame(width: 28)
                .contentShape(Rectangle())
                .onTapGesture(perform: action)
                .accessibilityHidden(true)
        }
        .padding(.vertical, FBSpacing.s)
    }
}

// MARK: - Caption

private struct StudioCaptionCard: View {
    @Bindable var model: StudioModel

    var body: some View {
        HStack(alignment: .top, spacing: FBSpacing.m) {
            if let me = model.me {
                AvatarView(user: me, size: FBAvatarSize.post)
            }
            TextField("Say something about this \(ProductName.singular)…", text: $model.caption, axis: .vertical)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(2...5)
                .padding(.top, 9)
                .accessibilityLabel("Caption")
        }
        .studioCard()
    }
}

// MARK: - Edit save

private struct StudioSaveNote: View {
    let model: StudioModel

    var body: some View {
        HStack(alignment: .top, spacing: FBSpacing.m) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: FBIconSize.large, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: FBAvatarSize.post, height: FBAvatarSize.post)
                .background(StudioGlow.fieldFill, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text("Saves version \(nextVersion) of \(model.baseTitle)")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text("Earlier versions stay in its history. Plays and the board carry over.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .studioCard()
        .accessibilityElement(children: .combine)
    }

    private var nextVersion: Int {
        let base = model.baseBubble?.manifest.version ?? 1
        let edited = model.levels.first?.manifest.version ?? base
        return max(edited, base + 1)
    }
}
