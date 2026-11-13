import SwiftUI

/// "Post": the Try step's main action. A small Facebook composer (caption prefilled, audience
/// Friends, the playable card) publishes the game and puts it on my feed; then "Posted to your
/// feed" offers sharing it further: a Group, Messenger, my story, a challenge or a link. "Done"
/// closes Studio onto Home with the new post on top.

// MARK: - Composer

struct StudioPostComposer: View {
    let model: StudioModel
    let onPost: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @FocusState private var isEditorFocused: Bool

    init(model: StudioModel, onPost: @escaping (String) -> Void) {
        self.model = model
        self.onPost = onPost
        _text = State(initialValue: model.postCaptionSuggestion)
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            HairlineDivider()
            ScrollView {
                VStack(alignment: .leading, spacing: FBSpacing.m) {
                    authorRow
                    TextField("Say something about this \(ProductName.singular)…", text: $text, axis: .vertical)
                        .font(.system(size: 17))
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2...6)
                        .focused($isEditorFocused)
                        .accessibilityLabel("Caption")
                    if let result = model.levels.first {
                        StudioPostCardPreview(bubble: model.previewBubble(for: result), levels: model.levels.count)
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.vertical, FBSpacing.m)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(FBColor.surface)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(model.isPopping)
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: FBIconSize.large, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.isPopping)
            .accessibilityLabel("Cancel")

            Text("Create post")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)

            Spacer(minLength: 8)

            Button {
                isEditorFocused = false
                onPost(text.trimmingCharacters(in: .whitespacesAndNewlines))
            } label: {
                if model.isPopping {
                    ProgressView()
                        .tint(.white)
                        .accessibilityLabel("Posting")
                } else {
                    Text("Post")
                }
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
            .disabled(model.isPopping)
            .accessibilityHint("Posts it to your feed for your friends to play")
        }
        .padding(.horizontal, 10)
        .frame(height: 52)
    }

    private var authorRow: some View {
        HStack(alignment: .top, spacing: 10) {
            if let me = model.me {
                AvatarView(user: me, size: FBAvatarSize.post)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(model.me?.name ?? "You")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                HomeComposerChip(symbol: Audience.friends.symbol, title: Audience.friends.title, showsChevron: false) {}
                    .allowsHitTesting(false)
                    .accessibilityLabel("Audience: Friends")
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Posted

/// "Posted to your feed", the card, then where else it can go.
struct StudioPostedSheet: View {
    let bubbleID: String
    /// Groups to offer: mine on the games server and in the app.
    let groups: [FBGroup]
    let onDone: () -> Void

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @State private var isChallenging = false
    @State private var addedToStory = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    header
                }
                if let bubble = bubbleStore.bubble(id: bubbleID) {
                    Section {
                        NavigationLink {
                            StudioShareTargetList(bubble: bubble, title: "Share to a Group", groups: groups, kinds: [])
                        } label: {
                            StudioShareOptionLabel(symbol: "person.3.fill", title: "Share to a Group", subtitle: groupSubtitle)
                        }
                        .disabled(groups.isEmpty)
                        NavigationLink {
                            StudioShareTargetList(bubble: bubble, title: "Send in Messenger", groups: [], kinds: [.chat, .friend])
                        } label: {
                            StudioShareOptionLabel(symbol: "message.fill", title: "Send in Messenger", subtitle: "Friends or a group chat")
                        }
                        Button {
                            addToStory(bubble)
                        } label: {
                            StudioShareOptionLabel(
                                symbol: addedToStory ? "checkmark.circle.fill" : "plus.circle.fill",
                                title: addedToStory ? "Added to your story" : "Add to your story",
                                subtitle: "For 24 hours"
                            )
                        }
                        .disabled(addedToStory)
                        Button {
                            Haptics.selection()
                            isChallenging = true
                        } label: {
                            StudioShareOptionLabel(symbol: "flag.checkered", title: "Challenge a friend", subtitle: "Same course for both of you")
                        }
                        Button {
                            copyLink(bubble)
                        } label: {
                            StudioShareOptionLabel(symbol: "link", title: "Copy link", subtitle: nil)
                        }
                    } header: {
                        Text("Share it further")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(FBColor.background)
            .navigationTitle("Posted")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onDone)
                        .font(.fbButton)
                }
            }
        }
        .overlay(alignment: .bottom) {
            ToastHost().padding(.bottom, 16)
        }
        .sheet(isPresented: $isChallenging) {
            ChallengePickerSheet(bubbleID: bubbleID, draft: nil)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled()
    }

    private var groupSubtitle: String {
        switch groups.count {
        case 0: return "Join a Group to share it there"
        case 1: return groups[0].name
        default: return "\(groups[0].name) and \(groups.count - 1) more"
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            HStack(spacing: FBSpacing.s) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: FBIconSize.xl))
                    .foregroundStyle(FBColor.brandBlue)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Posted to your feed")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Your friends can play it right from your post.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            .accessibilityElement(children: .combine)
            if let bubble = bubbleStore.bubble(id: bubbleID) {
                StudioPostCardPreview(bubble: bubble, levels: 1)
            }
        }
        .padding(.vertical, FBSpacing.xs)
        .listRowBackground(FBColor.surface)
    }

    private func addToStory(_ bubble: Bubble) {
        let target = BubbleShareTarget(kind: .story, targetID: "", title: "Your story")
        if RemixCenter.shared.share(bubble, to: target, score: nil, result: nil, request: nil, note: "", appStore: appStore, bubbleStore: bubbleStore) {
            Haptics.success()
            addedToStory = true
        }
    }

    private func copyLink(_ bubble: Bubble) {
        Haptics.light()
        UIPasteboard.general.string = Self.playLink(for: bubble)
        appStore.showToast("Link copied", symbol: "link")
    }

    /// The web player's link for a game (`backend/README.md`, Web player).
    static func playLink(for bubble: Bubble) -> String {
        "https://games.ol4ol.com/play/?game=\(bubble.serverID)"
    }
}

private struct StudioShareOptionLabel: View {
    let symbol: String
    let title: String
    let subtitle: String?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.medium, weight: .semibold))
                .foregroundStyle(FBColor.primaryText)
                .frame(width: 36, height: 36)
                .background(FBColor.buttonGray, in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                if let subtitle {
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Groups (posted with the playable card through the feed hook, which also alerts a server
/// Group's members), or Messenger chats and friends (a playable card through `RemixCenter`).
private struct StudioShareTargetList: View {
    let bubble: Bubble
    let title: String
    let groups: [FBGroup]
    let kinds: Set<BubbleShareTarget.Kind>

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @State private var sentIDs: Set<String> = []

    var body: some View {
        List {
            if !groups.isEmpty {
                Section {
                    ForEach(groups) { group in
                        row(id: "group:\(group.id)", title: group.name, subtitle: "Group · \(group.memberCount.fbCompact) members") {
                            RemoteImage(url: group.coverURL)
                                .frame(width: FBAvatarSize.post, height: FBAvatarSize.post)
                                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                        } send: {
                            BubbleSurfaceHooks.float(
                                bubble, result: nil, to: group,
                                message: "Made a \(ProductName.singular) for us: \(bubble.title). Play it!",
                                appStore: appStore, bubbleStore: bubbleStore
                            ) != nil
                        }
                    }
                }
            }
            let targets = BubbleSocialHub.targets(appStore: appStore, kinds: kinds)
            if !targets.isEmpty {
                Section {
                    ForEach(targets) { target in
                        row(id: target.id, title: target.title, subtitle: subtitle(target)) {
                            avatar(target)
                        } send: {
                            RemixCenter.shared.share(bubble, to: target, score: nil, result: nil, request: nil, note: "",
                                                     appStore: appStore, bubbleStore: bubbleStore)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(FBColor.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row<Leading: View>(id: String, title: String, subtitle: String, @ViewBuilder leading: () -> Leading, send: @escaping () -> Bool) -> some View {
        let sent = sentIDs.contains(id)
        return HStack(spacing: 12) {
            leading()
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                if send() {
                    Haptics.success()
                    sentIDs.insert(id)
                } else {
                    Haptics.light()
                    appStore.showToast("Couldn't send it. Try again.", symbol: "exclamationmark.circle")
                }
            } label: {
                if sent {
                    Label("Sent", systemImage: "checkmark")
                } else {
                    Text("Send")
                }
            }
            .buttonStyle(.fb(sent ? .secondary : .primary, expand: false, height: 32))
            .disabled(sent)
            .accessibilityLabel(sent ? "Sent to \(title)" : "Send to \(title)")
        }
        .padding(.vertical, 2)
        .listRowBackground(FBColor.surface)
    }

    private func subtitle(_ target: BubbleShareTarget) -> String {
        if target.kind == .chat, let chat = appStore.conversations.first(where: { $0.id == target.targetID }), chat.isGroup {
            return "Group chat · \(chat.participants.count + 1) people"
        }
        return "Messenger"
    }

    @ViewBuilder
    private func avatar(_ target: BubbleShareTarget) -> some View {
        let size = FBAvatarSize.post
        switch target.kind {
        case .chat:
            let people = appStore.conversations.first { $0.id == target.targetID }?.participants ?? []
            if let person = people.first {
                AvatarView(user: person, size: size)
            } else {
                Circle().fill(FBColor.buttonGray).frame(width: size, height: size)
            }
        default:
            AvatarView(user: appStore.user(id: target.targetID) ?? bubbleStore.resolvePerson(target.targetID), size: size)
        }
    }
}

// MARK: - Card preview

/// The playable card as it shows in the post: cover, title, rule and Play.
struct StudioPostCardPreview: View {
    let bubble: Bubble
    let levels: Int

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            BubbleCoverView(bubble: bubble)
                .aspectRatio(16.0 / 10.0, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .clipped()
            HStack(alignment: .center, spacing: FBSpacing.s) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(bubble.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text(levels > 1 ? "\(levels) levels · \(bubble.rule)" : bubble.rule)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11, weight: .bold)) // Small glyph inside a 32 pt pill
                    Text("Play")
                        .font(.fbCaptionEmphasized)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(FBColor.brandBlue, in: Capsule())
            }
            .padding(12)
        }
        .background(FBColor.surface)
        .clipShape(shape)
        .overlay(shape.strokeBorder(FBColor.divider, lineWidth: 0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(ProductName.singular): \(bubble.title). \(bubble.rule)")
    }
}
