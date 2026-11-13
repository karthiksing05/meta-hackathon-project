import SwiftUI

/// Step 5, Share: everything that brings people in, in one step. Who to challenge (friends' faces,
/// three picked to start), a preview of the chat card they'll get, where it posts (your feed, a
/// Group or an Event) and a caption. Sharing publishes it, sends the challenges through the
/// existing challenge and share paths, keeps "How Muse made it", then opens the game page.
/// Editing saves a new version instead.
struct StudioShareStep: View {
    @Bindable var model: StudioModel
    let onShare: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: FBSpacing.l) {
                StudioSharePreview(model: model)
                if model.isEditMode && model.levels.count == 1 {
                    StudioSaveNote(model: model)
                } else {
                    if !model.friendChoices.isEmpty && model.mode != .daily {
                        StudioChallengeCard(model: model)
                    }
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
        .onAppear { model.pickDefaultFriendsIfNeeded() }
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

                Button(action: onShare) {
                    if model.isPopping {
                        HStack(spacing: FBSpacing.s) {
                            GameLoader(style: .dots)
                                .accessibilityHidden(true)
                            Text(model.challengeIDs.isEmpty || model.isEditMode ? "Sharing" : "Sending")
                        }
                        .accessibilityElement(children: .combine)
                    } else {
                        HStack(spacing: 6) {
                            Image(systemName: symbol)
                                .font(.system(size: FBIconSize.medium, weight: .bold))
                            Text(buttonTitle)
                                .minimumScaleFactor(0.75)
                        }
                    }
                }
                .buttonStyle(.studioPrimary)
                .disabled(model.isPopping)
                .accessibilityHint(accessibilityHint)
            }
        }
    }

    private var showsCaption: Bool {
        if case .event = model.destination { return false }
        return true
    }

    private var isSave: Bool { model.floatButtonTitle == "Save changes" }

    private var symbol: String {
        if isSave { return "checkmark" }
        return model.challengeIDs.isEmpty ? "sparkles" : "flag.checkered"
    }

    private var buttonTitle: String {
        if isSave { return "Save changes" }
        if model.mode == .daily { return "Share today's \(ProductName.singular)" }
        let people = model.challengedPeople.map(\.firstName)
        if !people.isEmpty {
            let verb = model.sendsChallenge ? "Challenge" : "Send to"
            let names = MakeRecord.names(people)
            return names.count <= 26 ? "\(verb) \(names)" : "\(verb) \(people.count) friends"
        }
        let name = model.destination == .feed ? "your feed" : model.destinationName
        return name.count <= 20 ? "Share to \(name)" : "Share"
    }

    private var accessibilityHint: String {
        if isSave { return "Saves a new version" }
        if model.challengeIDs.isEmpty { return "Shares to \(model.destinationName)" }
        return "Shares to \(model.destinationName) and sends it to \(model.challengeIDs.count) friends in Messenger"
    }
}

// MARK: - Preview

private struct StudioSharePreview: View {
    let model: StudioModel

    var body: some View {
        if let result = model.levels.first {
            HStack(spacing: FBSpacing.m) {
                BubbleCoverView(bubble: model.previewBubble(for: result))
                    .frame(width: 84, height: 105)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                            .strokeBorder(GameColor.rim, lineWidth: 1.5)
                    }
                    .shadow(color: GameColor.periwinkle.opacity(0.45), radius: 14, y: 6)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.manifest.title)
                        .font(.fbTitle)
                        .studioRounded()
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(result.manifest.oneLineRule)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    if model.levels.count > 1 {
                        Label("\(model.levels.count) levels · Level chain", systemImage: "link")
                            .font(.fbCaptionEmphasized)
                            .foregroundStyle(GameColor.ink)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(GameColor.gradient, in: Capsule())
                    }
                }
                Spacer(minLength: 0)
            }
            .opacity(model.isPopping ? 0.6 : 1)
            .animation(GameMotion.reveal, value: model.isPopping)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Challenge friends

/// "Challenge Maya, Leo and Priya": pick friends, and see the card they'll get in Messenger.
private struct StudioChallengeCard: View {
    let model: StudioModel

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(
                title: model.sendsChallenge ? "Challenge friends" : "Send to friends",
                detail: model.challengeIDs.isEmpty ? "Optional" : "\(model.challengeIDs.count) picked",
                symbol: model.sendsChallenge ? "flag.checkered" : "paperplane"
            )
            StudioFriendPicker(model: model)
            if let result = model.levels.first, !model.challengedPeople.isEmpty {
                StudioChatCardPreview(model: model, result: result)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            } else {
                Text("Pick friends to send it to in Messenger. Everyone plays the same course.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .studioCard()
        .animation(GameMotion.appear, value: model.challengeIDs)
    }
}

/// What friends get in Messenger: a message from you carrying the playable card.
private struct StudioChatCardPreview: View {
    let model: StudioModel
    let result: StudioResult

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("To \(MakeRecord.names(model.challengedPeople.map(\.firstName))) in Messenger")
                .font(.fbMicroEmphasized)
                .foregroundStyle(FBColor.tertiaryText)
            HStack(alignment: .bottom, spacing: FBSpacing.s) {
                Spacer(minLength: 40)
                card
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Preview of the Messenger card: \(model.cardHeadline(for: result.manifest.title)). Play.")
    }

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) {
            BubbleCoverView(bubble: model.previewBubble(for: result), showsEmoji: false)
                .frame(height: 96)
                .frame(maxWidth: .infinity)
                .clipped()
            VStack(alignment: .leading, spacing: 4) {
                Text(model.cardHeadline(for: result.manifest.title))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(model.sendsChallenge ? "Same course for everyone · \(ProductName.singular)" : "A \(ProductName.singular) by \(model.me?.firstName ?? "you")")
                    .font(.fbMicro)
                    .foregroundStyle(FBColor.secondaryText)
                HStack(spacing: 4) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11, weight: .bold)) // Small glyph inside a 30 pt pill
                    Text("Play")
                        .font(.fbCaptionEmphasized)
                }
                .foregroundStyle(GameColor.ink)
                .frame(maxWidth: .infinity, minHeight: 30)
                .background(GameColor.gradient, in: Capsule())
                .padding(.top, 4)
            }
            .padding(10)
        }
        .frame(width: 220)
        .background(FBColor.surface)
        .clipShape(shape)
        .overlay(shape.strokeBorder(FBColor.divider, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.06), radius: 6, y: 2)
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
            subtitle: "Friends and the \(ProductName.short) tab",
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
