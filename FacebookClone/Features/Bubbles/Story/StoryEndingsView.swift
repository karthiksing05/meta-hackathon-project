import SwiftUI

// Endings you and friends found (docs/BUBBLES.md 7.6): the panel the result sheet, the Bubble page
// and the endings screen share, the endings screen itself, and the send-your-path sheet.

/// Where the endings panel sits; it trims itself to fit.
enum StoryPanelStyle {
    /// The result sheet, right after an ending.
    case result
    /// The Bubble page, under the actions.
    case detail
    /// The endings screen.
    case screen
}

/// Endings found (unfound ones stay hidden), friends' paths ("Maya took the ferry"), and the
/// one-tap ways to bring someone in: send your path, add friend, play to find the rest.
struct StoryEndingsPanel: View {
    let bubble: Bubble
    let style: StoryPanelStyle
    /// Send your path (nil hides the button).
    var onSendPath: (() -> Void)?
    /// Play again to find the rest (nil hides the button).
    var onPlay: (() -> Void)?
    /// The run just played (the result sheet); nil shows your latest.
    var run: StoryRunTag? = nil

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var progress: StoryProgressStore { StoryProgressStore.shared }

    var body: some View {
        if let story = StoryAdventure(bubble.manifest) {
            let found = progress.foundEndings(bubble.id)
            let mine = run ?? progress.latestTag(bubble.id)
            VStack(alignment: .leading, spacing: 12) {
                header(story, found: found)
                if style == .result, let mine, let ending = story.ending(id: mine.ending) {
                    yourEnding(ending, total: story.endings.count, tag: mine, story: story)
                }
                endingChips(story, found: found)
                friendsSection(story, found: found, mine: mine)
                actions(hasPath: mine != nil, allFound: found.count >= story.endings.count)
            }
            .padding(12)
            .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .onAppear {
                progress.loadFriends(for: bubble, bubbleStore: bubbleStore)
            }
        }
    }

    // MARK: Parts

    private func header(_ story: StoryAdventure, found: Set<String>) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: BubbleCategory.adventure.symbol)
                .font(.system(size: FBIconSize.medium, weight: .semibold))
                .foregroundStyle(FBColor.accent)
                .accessibilityHidden(true)
            Text(StoryCopy.endingsTitle)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            Text(found.isEmpty ? StoryCopy.notPlayedYet : found.count >= story.endings.count ? StoryCopy.allFound : StoryCopy.foundCount(found.count, story.endings.count))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
        }
    }

    private func yourEnding(_ ending: StoryAdventure.Ending, total: Int, tag: StoryRunTag, story: StoryAdventure) -> some View {
        let path = story.choices(along: tag)
        return HStack(alignment: .top, spacing: 12) {
            Text(ending.emoji)
                .font(.system(size: 34)) // display emoji
                .frame(width: 52, height: 52)
                .background(FBColor.surface, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(ending.isSecret ? StoryCopy.secretOf(ending.number, total) : StoryCopy.endingOf(ending.number, total))
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(FBColor.accent)
                Text(ending.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if !path.isEmpty {
                    Text(path.map(\.text).joined(separator: " → "))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("\(StoryCopy.yourPath): \(path.map(\.text).joined(separator: ", "))")
                }
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func endingChips(_ story: StoryAdventure, found: Set<String>) -> some View {
        FlowLayout(spacing: 6, lineSpacing: 6) {
            ForEach(story.endings) { ending in
                let isFound = found.contains(ending.id)
                HStack(spacing: 4) {
                    if isFound {
                        Text(ending.emoji)
                        Text(ending.title)
                            .lineLimit(1)
                    } else {
                        Image(systemName: ending.isSecret ? "sparkles" : "questionmark")
                            .font(.system(size: FBIconSize.xs, weight: .bold))
                        Text(ending.isSecret ? StoryCopy.secretEnding : "?")
                    }
                }
                .font(.fbCaptionEmphasized)
                .foregroundStyle(isFound ? FBColor.accent : FBColor.secondaryText)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(isFound ? FBColor.tintedBlueBackground : FBColor.buttonGray, in: Capsule())
                .accessibilityElement(children: .combine)
                .accessibilityLabel(isFound ? "\(StoryCopy.endingOf(ending.number, story.endings.count)): \(ending.title)" : "\(StoryCopy.hiddenEnding) \(ending.number)")
            }
        }
    }

    @ViewBuilder
    private func friendsSection(_ story: StoryAdventure, found: Set<String>, mine: StoryRunTag?) -> some View {
        let paths = progress.friends[bubble.id] ?? []
        let isLoading = progress.loadingFriends.contains(bubble.id)
        if !paths.isEmpty || isLoading {
            VStack(alignment: .leading, spacing: 4) {
                Text(StoryCopy.friendsPathsTitle)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                ForEach(paths) { path in
                    StoryFriendRow(path: path, story: story, isKnown: found.contains(path.tag.ending), myFirst: mine?.first, bubbleID: bubble.id)
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .bottom)))
                }
                if isLoading {
                    HStack(spacing: 10) {
                        Circle().fill(FBColor.skeleton).frame(width: FBAvatarSize.comment, height: FBAvatarSize.comment)
                        Text(StoryCopy.friendsLoading)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    .shimmering()
                    .padding(.vertical, 6)
                    .accessibilityElement(children: .combine)
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: paths.count)
        }
    }

    @ViewBuilder
    private func actions(hasPath: Bool, allFound: Bool) -> some View {
        if onSendPath != nil || onPlay != nil {
            VStack(spacing: 8) {
                if let onSendPath, hasPath {
                    Button {
                        Haptics.light()
                        onSendPath()
                    } label: {
                        Label(StoryCopy.sendPath, systemImage: "paperplane.fill")
                    }
                    .buttonStyle(.fb(style == .result ? .tinted : .primary, height: 40))
                    .accessibilityHint(StoryCopy.sendPathSubtitle)
                }
                if let onPlay, !allFound {
                    Button {
                        Haptics.light()
                        onPlay()
                    } label: {
                        Label(hasPath ? StoryCopy.playToFind : StoryCopy.play, systemImage: "signpost.right.and.left")
                    }
                    .buttonStyle(.fb(hasPath || onSendPath == nil ? .secondary : .primary, height: 40))
                }
            }
        }
    }
}

/// "Maya took the ferry" · which ending she found · Add friend when she isn't one yet.
struct StoryFriendRow: View {
    let path: StoryFriendPath
    let story: StoryAdventure
    /// You've found this ending too, so its title isn't a spoiler.
    let isKnown: Bool
    let myFirst: String?
    let bubbleID: String

    @Environment(AppStore.self) private var appStore

    var body: some View {
        let first = story.firstChoice(id: path.tag.first)
        let ending = story.ending(id: path.tag.ending)
        let otherPath = myFirst != nil && myFirst != path.tag.first
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                AvatarView(user: path.user, size: FBAvatarSize.comment)
                VStack(alignment: .leading, spacing: 1) {
                    Text(StoryCopy.took(path.user.firstName, first?.pastTense ?? StoryCopy.foundAnEnding))
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                    if let ending {
                        Text(StoryCopy.friendFound(ending, known: isKnown))
                            .font(.fbMeta)
                            .foregroundStyle(ending.isSecret ? FBColor.accent : FBColor.secondaryText)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 6)
                if otherPath {
                    Text(StoryCopy.otherPathTag)
                        .font(.fbMicroEmphasized)
                        .foregroundStyle(FBColor.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(FBColor.surface, in: Capsule())
                        .fixedSize()
                }
                if let ending {
                    Text(isKnown || ending.isSecret ? ending.emoji : "❔")
                        .font(.system(size: 22)) // display emoji
                        .accessibilityHidden(true)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText(first: first, ending: ending, otherPath: otherPath))
            // Add friend stays its own control, so VoiceOver can reach it without the row's text.
            addFriend
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background {
            if otherPath {
                RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                    .fill(FBColor.tintedBlueBackground)
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var addFriend: some View {
        let user = path.user
        if user.friendship == .none || user.friendship == .requestSent {
            Button {
                guard user.friendship == .none else { return }
                Haptics.light()
                appStore.sendRequest(to: user)
                BubbleSocialSignals.post(.addFriendFromGame, bubbleID: bubbleID, with: [user.id])
            } label: {
                Image(systemName: user.friendship == .requestSent ? "person.fill.checkmark" : "person.fill.badge.plus")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .frame(width: 36, height: 32)
            }
            .buttonStyle(.fb(user.friendship == .requestSent ? .secondary : .tinted, expand: false, height: 32))
            .accessibilityLabel(user.friendship == .requestSent ? StoryCopy.requestSent : "\(StoryCopy.addFriend): \(user.name)")
        }
    }

    private func accessibilityText(first: StoryAdventure.Choice?, ending: StoryAdventure.Ending?, otherPath: Bool) -> String {
        var parts = [StoryCopy.took(path.user.firstName, first?.pastTense ?? StoryCopy.foundAnEnding)]
        if let ending { parts.append(StoryCopy.friendFound(ending, known: isKnown)) }
        if otherPath { parts.append(StoryCopy.otherPath(path.user.firstName)) }
        return parts.joined(separator: ". ")
    }
}

// MARK: - Endings screen

/// `FB_OPEN=feature:story/endings/<bubbleID>`: the adventure's cover, the endings you and
/// friends found, who took the other path, and the ways to bring someone in.
struct StoryEndingsView: View {
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @State private var isSharing = false

    var body: some View {
        Group {
            if let bubble = bubbleStore.bubble(id: bubbleID), bubble.formula == .story {
                content(bubble)
            } else {
                ContentUnavailableView(
                    "This adventure isn't here",
                    systemImage: BubbleCategory.adventure.symbol,
                    description: Text("It may have been removed.")
                )
            }
        }
        .background(FBColor.surface)
        .navigationTitle(StoryCopy.endingsTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ bubble: Bubble) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                        .frame(height: 170)
                        .frame(maxWidth: .infinity)
                        .clipped()
                    VStack(alignment: .leading, spacing: 6) {
                        BubbleCategoryChip(category: bubble.category)
                        Text(bubble.title)
                            .font(.fbTitle)
                            .foregroundStyle(FBColor.primaryText)
                        Text(bubble.rule)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                        HStack(spacing: 6) {
                            AvatarView(user: bubble.creator, size: FBAvatarSize.tiny)
                            Text(bubble.creator.name + (bubble.group.map { " · \($0.name)" } ?? ""))
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                        }
                    }
                    .padding(12)
                }
                .background(FBColor.surface)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).strokeBorder(FBColor.divider, lineWidth: 1))
                .accessibilityElement(children: .combine)

                StoryEndingsPanel(
                    bubble: bubble,
                    style: .screen,
                    onSendPath: { isSharing = true },
                    onPlay: { router.play(bubble.id) }
                )
            }
            .padding(FBMetrics.screenPadding)
        }
        .sheet(isPresented: $isSharing) {
            StoryPathShareSheet(bubbleID: bubble.id)
        }
    }
}

// MARK: - Send your path

/// Send your path to a chat, a friend or a Group. The card plays the same seed, so friends walk
/// the same story ("Alex took the stairs. Which way would you go?").
struct StoryPathShareSheet: View {
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    private var progress: StoryProgressStore { StoryProgressStore.shared }

    var body: some View {
        NavigationStack {
            Group {
                if let bubble = bubbleStore.bubble(id: bubbleID), let card = progress.pathCard(for: bubble, appStore: appStore) {
                    list(bubble, card: card)
                } else {
                    ContentUnavailableView {
                        Label(StoryCopy.playFirst, systemImage: BubbleCategory.adventure.symbol)
                    } description: {
                        Text(StoryCopy.playFirstDetail)
                    } actions: {
                        Button(StoryCopy.play) {
                            dismiss()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { router.play(bubbleID) }
                        }
                        .buttonStyle(.fb(.primary, expand: false))
                    }
                }
            }
            .background(FBColor.surface)
            .navigationTitle(StoryCopy.sendPath)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(StoryCopy.done) { dismiss() }
                        .font(.fbButton)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .overlay(alignment: .bottom) {
            ToastHost().padding(.bottom, 16)
        }
    }

    private func list(_ bubble: Bubble, card: BubbleChatCard) -> some View {
        let targets = BubbleSocialHub.targets(appStore: appStore, kinds: [.chat, .group, .friend])
        let chats = targets.filter { $0.kind == .chat }
        let groups = targets.filter { $0.kind == .group }.sorted { a, _ in a.targetID == BubbleDemo.groupID }
        let chatIDs = Set(chats.map(\.targetID))
        let friends = targets.filter { target in
            target.kind == .friend && !chatIDs.contains(appStore.conversations.first { !$0.isGroup && $0.participants.first?.id == target.targetID }?.id ?? "")
        }
        return List {
            Section {
                StoryPathCardView(card: card, isFromMe: true, showsPlay: false)
                    .listRowInsets(EdgeInsets(top: 8, leading: FBMetrics.screenPadding, bottom: 8, trailing: FBMetrics.screenPadding))
                    .listRowSeparator(.hidden)
            } footer: {
                Text(StoryCopy.sendPathSubtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            if !chats.isEmpty {
                Section(StoryCopy.chats) { ForEach(chats.prefix(6)) { row($0, bubble: bubble) } }
            }
            if !groups.isEmpty {
                Section(StoryCopy.groups) { ForEach(groups.prefix(4)) { row($0, bubble: bubble) } }
            }
            if !friends.isEmpty {
                Section(StoryCopy.friends) { ForEach(friends.prefix(8)) { row($0, bubble: bubble) } }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(FBColor.background)
    }

    private func row(_ target: BubbleShareTarget, bubble: Bubble) -> some View {
        let sent = progress.wasSent(bubble.id, to: target)
        return HStack(spacing: 10) {
            targetIcon(target)
            Text(target.title)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button {
                guard !sent else { return }
                if progress.sendPath(of: bubble, to: target, appStore: appStore, bubbleStore: bubbleStore) {
                    Haptics.success()
                    appStore.showToast(StoryCopy.pathSentToast(target.title), symbol: "paperplane.fill")
                }
            } label: {
                Text(sent ? StoryCopy.sent : StoryCopy.send)
                    .frame(minWidth: 56)
            }
            .buttonStyle(.fb(sent ? .secondary : .primary, expand: false, height: 32))
            .disabled(sent)
            .accessibilityLabel(sent ? "\(StoryCopy.sent): \(target.title)" : "\(StoryCopy.send) \(StoryCopy.yourPath.lowercased()) to \(target.title)")
        }
        .listRowBackground(FBColor.surface)
    }

    @ViewBuilder
    private func targetIcon(_ target: BubbleShareTarget) -> some View {
        switch target.kind {
        case .friend:
            if let user = appStore.user(id: target.targetID) {
                AvatarView(user: user, size: FBAvatarSize.story)
            } else {
                symbolCircle("person.fill")
            }
        case .chat:
            if let chat = appStore.conversations.first(where: { $0.id == target.targetID }), let user = chat.participants.first {
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(user: user, size: FBAvatarSize.story)
                    if chat.isGroup, chat.participants.count > 1 {
                        AvatarView(user: chat.participants[1], size: FBAvatarSize.tiny)
                            .overlay(Circle().strokeBorder(FBColor.surface, lineWidth: 2))
                            .offset(x: 4, y: 4)
                    }
                }
            } else {
                symbolCircle("message.fill")
            }
        case .group:
            symbolCircle("person.3.fill")
        case .feed, .story:
            symbolCircle("square.and.arrow.up")
        }
    }

    private func symbolCircle(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: FBIconSize.medium, weight: .semibold))
            .foregroundStyle(FBColor.accent)
            .frame(width: FBAvatarSize.story, height: FBAvatarSize.story)
            .background(FBColor.tintedBlueBackground, in: Circle())
            .accessibilityHidden(true)
    }
}
