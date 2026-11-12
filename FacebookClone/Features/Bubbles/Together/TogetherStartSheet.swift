import SwiftUI

/// "Make it together": pick what friends add (a question, words, a scene or a level), name the
/// game, and invite a group chat, a friend or a Group. Start sends the invite card and opens the
/// session, where contributions arrive.
struct TogetherStartSheet: View {
    /// A target to preselect: "group:<id>", "chat:<id>" or "friend:<id>" (empty picks New in SF crew).
    var preset: String = ""
    let onStarted: (String) -> Void

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss

    @State private var kind: TogetherAskKind = .question
    @State private var title = TogetherCopy.defaultTitle(.question)
    @State private var ask = TogetherCopy.defaultAsk(.question)
    @State private var targetID: String?
    @State private var editedTitle = false
    @State private var editedAsk = false
    /// A preset Group you're not a member of still shows, first.
    @State private var extraTarget: BubbleShareTarget?

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    private var targets: [BubbleShareTarget] {
        var list = BubbleSocialHub.targets(appStore: appStore, kinds: [.chat, .group, .friend])
        // Group chats first, then Groups, then friends; drop 1:1 chats that duplicate a friend.
        list = list.filter { target in
            guard target.kind == .chat, let chat = appStore.conversations.first(where: { $0.id == target.targetID }) else { return true }
            return chat.isGroup
        }
        let order: [BubbleShareTarget.Kind: Int] = [.chat: 0, .group: 1, .friend: 2]
        let sorted = list.enumerated().sorted { a, b in
            let oa = order[a.element.kind] ?? 9, ob = order[b.element.kind] ?? 9
            return oa != ob ? oa < ob : a.offset < b.offset
        }.map(\.element)
        var seen = Set<String>()
        return ([extraTarget].compactMap { $0 } + sorted).filter { seen.insert($0.id).inserted }.prefix(10).map { $0 }
    }

    private var selected: BubbleShareTarget? {
        targets.first { $0.id == targetID } ?? targets.first
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    hero
                    kindPicker
                    fields
                    invitePicker
                }
                .padding(FBMetrics.screenPadding)
            }
            .background(FBColor.background)
            .safeAreaInset(edge: .bottom) { startBar }
            .navigationTitle(TogetherCopy.startTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TogetherCopy.cancel) { dismiss() }
                }
            }
        }
        .onAppear(perform: applyPreset)
    }

    // MARK: Sections

    private var hero: some View {
        HStack(alignment: .top, spacing: 12) {
            TogetherBadge(size: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(TogetherCopy.startTitle)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Text(TogetherCopy.startSubtitle)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var kindPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(TogetherCopy.whatFriendsAdd)
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(TogetherAskKind.allCases) { option in
                    Button {
                        Haptics.selection()
                        select(option)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: TogetherCopy.kindSymbol(option))
                                .font(.system(size: FBIconSize.medium, weight: .semibold))
                                .foregroundStyle(kind == option ? Color.white : FBColor.accent)
                                .frame(width: 32, height: 32)
                                .background(kind == option ? AnyShapeStyle(TogetherStyle.gradient) : AnyShapeStyle(FBColor.tintedBlueBackground), in: Circle())
                            VStack(alignment: .leading, spacing: 1) {
                                Text(TogetherCopy.kindTitle(option))
                                    .font(.fbName)
                                    .foregroundStyle(FBColor.primaryText)
                                Text(TogetherCopy.kindSubtitle(option))
                                    .font(.fbCaption)
                                    .foregroundStyle(FBColor.secondaryText)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(10)
                        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                                .strokeBorder(kind == option ? FBColor.brandBlue : FBColor.divider, lineWidth: kind == option ? 2 : 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(TogetherCopy.kindTitle(option))
                    .accessibilityAddTraits(kind == option ? .isSelected : [])
                }
            }
        }
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(TogetherCopy.gameName)
            TextField(TogetherCopy.gameName, text: $title)
                .font(.fbBodyLarge)
                .padding(12)
                .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .onChange(of: title) { editedTitle = true }
                .accessibilityLabel(TogetherCopy.gameName)
            sectionTitle(TogetherCopy.askThem)
                .padding(.top, 4)
            TextField(TogetherCopy.askThem, text: $ask, axis: .vertical)
                .lineLimit(2...4)
                .font(.fbBodyLarge)
                .padding(12)
                .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .onChange(of: ask) { editedAsk = true }
                .accessibilityLabel(TogetherCopy.askThem)
        }
    }

    private var invitePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(TogetherCopy.invite)
            if targets.isEmpty {
                Text(TogetherCopy.noTargets)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(targets.enumerated()), id: \.element.id) { index, target in
                        if index > 0 { HairlineDivider().padding(.leading, 64) }
                        targetRow(target)
                    }
                }
                .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            }
        }
    }

    private func targetRow(_ target: BubbleShareTarget) -> some View {
        let isOn = selected?.id == target.id
        let people = peopleCount(target)
        return Button {
            Haptics.selection()
            targetID = target.id
        } label: {
            HStack(spacing: 12) {
                targetArt(target)
                    .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(target.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text(TogetherCopy.targetSubtitle(target.kind, people: people))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: FBIconSize.large))
                    .foregroundStyle(isOn ? FBColor.brandBlue : FBColor.tertiaryText)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(target.title), \(TogetherCopy.targetSubtitle(target.kind, people: people))")
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    @ViewBuilder
    private func targetArt(_ target: BubbleShareTarget) -> some View {
        switch target.kind {
        case .chat:
            let chat = appStore.conversations.first { $0.id == target.targetID }
            TogetherMakersStack(users: Array((chat?.participants ?? []).prefix(2)), size: 30, limit: 2)
        case .friend:
            AvatarView(user: appStore.user(id: target.targetID) ?? bubbleStore.resolvePerson(target.targetID), size: 40)
        case .group:
            if let group = appStore.group(id: target.targetID) {
                StudioGroupThumbnail(group: group, size: 40)
            } else {
                TogetherBadge(symbol: "person.3.fill", size: 40)
            }
        case .feed, .story:
            TogetherBadge(symbol: "globe.americas.fill", size: 40)
        }
    }

    private var startBar: some View {
        VStack(spacing: 0) {
            HairlineDivider()
            Button {
                start()
            } label: {
                Label(TogetherCopy.startButton, systemImage: "paperplane.fill")
            }
            .buttonStyle(.fb(.primary, height: 44))
            .disabled(selected == nil || title.trimmingCharacters(in: .whitespaces).isEmpty)
            .padding(FBMetrics.screenPadding)
        }
        .background(FBColor.surface)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.fbHeadline)
            .foregroundStyle(FBColor.primaryText)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: Actions

    private func select(_ option: TogetherAskKind) {
        let oldKind = kind
        kind = option
        if !editedTitle || title == TogetherCopy.defaultTitle(oldKind) {
            title = TogetherCopy.defaultTitle(option)
            editedTitle = false
        }
        if !editedAsk || ask == TogetherCopy.defaultAsk(oldKind) {
            ask = TogetherCopy.defaultAsk(option)
            editedAsk = false
        }
    }

    private func applyPreset() {
        guard targetID == nil else { return }
        let parts = preset.split(separator: ":", maxSplits: 1).map(String.init)
        if parts.count == 2, let kind = BubbleShareTarget.Kind(rawValue: parts[0]) {
            let id = "\(kind.rawValue):\(parts[1])"
            if targets.contains(where: { $0.id == id }) {
                targetID = id
            } else if kind == .group, let group = appStore.group(id: parts[1]) {
                let target = BubbleShareTarget(kind: .group, targetID: group.id, title: group.name)
                extraTarget = target
                targetID = target.id
            }
        }
        if targetID == nil {
            targetID = "chat:\(BubbleSocialCast.newInSFCrew.id)"
        }
        // editedTitle/editedAsk flip on the first onChange; reset after setup.
        DispatchQueue.main.async {
            editedTitle = false
            editedAsk = false
        }
    }

    private func peopleCount(_ target: BubbleShareTarget) -> Int {
        switch target.kind {
        case .chat: return (appStore.conversations.first { $0.id == target.targetID }?.participants.count ?? 0) + 1
        case .group: return appStore.group(id: target.targetID)?.memberCount ?? 0
        default: return 1
        }
    }

    private func start() {
        guard let target = selected else { return }
        Haptics.success()
        let session = TogetherCenter.shared.start(kind: kind, title: title, ask: ask, target: target, appStore: appStore, bubbleStore: bubbleStore)
        dismiss()
        onStarted(session.id)
    }
}
