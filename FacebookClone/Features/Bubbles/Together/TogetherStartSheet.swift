import SwiftUI

/// "Make it together": pick what friends add (a question, words, a scene or a level), name the
/// game, and invite one of your Groups or some friends. Start makes the session on the server,
/// which notifies everyone invited, and opens it.
struct TogetherStartSheet: View {
    /// A target to preselect: "group:<id>" or "friend:<id>" (empty picks the first Group).
    var preset: String = ""
    let onStarted: (String) -> Void

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss

    @State private var kind: TogetherAskKind = .question
    @State private var title = TogetherCopy.defaultTitle(.question)
    @State private var ask = TogetherCopy.defaultAsk(.question)
    @State private var editedTitle = false
    @State private var editedAsk = false
    /// Your server Groups and friends (the only people a session can invite).
    @State private var groups: [RemoteGroup] = []
    @State private var friends: [RemoteProfile] = []
    @State private var loading = true
    /// The Group picked, or nil when friends are picked.
    @State private var groupID: String?
    @State private var pickedFriends: Set<String> = []
    @State private var starting = false
    @State private var failure: String?

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    private var canStart: Bool {
        !starting && (groupID != nil || !pickedFriends.isEmpty) && !title.trimmingCharacters(in: .whitespaces).isEmpty
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
        .task { await loadPeople() }
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
                                .background(kind == option ? AnyShapeStyle(GameColor.accentGradient) : AnyShapeStyle(FBColor.tintedBlueBackground), in: Circle())
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
            if loading {
                LiveDataStateView(kind: .loading, title: TogetherCopy.loadingPeople)
            } else if groups.isEmpty && friends.isEmpty {
                Text(TogetherCopy.noTargets)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            } else {
                if !groups.isEmpty {
                    Text(TogetherCopy.startInGroups)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                    rows(groups.map { g in
                        row(id: "group:\(g.id)", title: g.name, subtitle: TogetherCopy.targetSubtitle(.group, people: g.memberCount),
                            art: AnyView(TogetherBadge(symbol: "person.3.fill", size: 40)), on: groupID == g.id) {
                            groupID = g.id
                            pickedFriends = []
                        }
                    })
                }
                if !friends.isEmpty {
                    Text(TogetherCopy.startWithFriends)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(.top, 4)
                    rows(friends.map { f in
                        row(id: "friend:\(f.id)", title: f.shownName, subtitle: TogetherCopy.targetSubtitle(.friend, people: 1),
                            art: AnyView(AvatarView(user: bubbleStore.person(id: f.id, name: f.shownName, isFriend: true), size: 40)),
                            on: pickedFriends.contains(f.id)) {
                            groupID = nil
                            if pickedFriends.contains(f.id) { pickedFriends.remove(f.id) } else { pickedFriends.insert(f.id) }
                        }
                    })
                }
            }
            if let failure {
                Label(failure, systemImage: "exclamationmark.circle")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
    }

    private func rows(_ items: [AnyView]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if index > 0 { HairlineDivider().padding(.leading, 64) }
                item
            }
        }
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    private func row(id: String, title: String, subtitle: String, art: AnyView, on isOn: Bool, action: @escaping () -> Void) -> AnyView {
        AnyView(Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 12) {
                art
                    .frame(width: 40, height: 40)
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
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: FBIconSize.large))
                    .foregroundStyle(isOn ? FBColor.brandBlue : FBColor.tertiaryText)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(subtitle)")
        .accessibilityAddTraits(isOn ? .isSelected : []))
    }

    private var startBar: some View {
        VStack(spacing: 0) {
            HairlineDivider()
            Button {
                start()
            } label: {
                if starting { ProgressView() } else { Label(TogetherCopy.startButton, systemImage: "paperplane.fill") }
            }
            .buttonStyle(.fb(.primary, height: 44))
            .disabled(!canStart)
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

    /// Your server Groups and friends, then the preset (a Group or a friend) or the first Group.
    private func loadPeople() async {
        guard loading else { return }
        _ = await GamesAccount.shared.waitForUser()
        async let g = try? GamesAPIFactory.current.groups(kind: "group", mine: true)
        async let f = try? GamesAPIFactory.current.friends()
        groups = await g ?? []
        friends = await f ?? []
        loading = false
        let parts = preset.split(separator: ":", maxSplits: 1).map(String.init)
        if parts.count == 2, parts[0] == "group", groups.contains(where: { $0.id == parts[1] }) {
            groupID = parts[1]
        } else if parts.count == 2, parts[0] == "friend", friends.contains(where: { $0.id == parts[1] }) {
            pickedFriends = [parts[1]]
        } else {
            groupID = groups.first?.id
        }
        // editedTitle/editedAsk flip on the first onChange; reset after setup.
        editedTitle = false
        editedAsk = false
    }

    private func start() {
        guard canStart else { return }
        let target: RoundTarget
        let members: [String]
        if let groupID {
            target = RoundTarget(kind: .group, id: groupID)
            members = []
        } else {
            let ids = Array(pickedFriends)
            target = RoundTarget(kind: .chat, id: RoundsCenter.chatID(for: ids + [GamesAccount.shared.userID ?? ""]))
            members = ids
        }
        starting = true
        failure = nil
        Task { @MainActor in
            do {
                let session = try await TogetherCenter.shared.start(kind: kind, title: title, ask: ask, target: target, members: members,
                                                                    bubbleStore: bubbleStore)
                Haptics.success()
                dismiss()
                onStarted(session.id)
            } catch {
                failure = TogetherCopy.couldNot(error.localizedDescription)
                starting = false
            }
        }
    }
}
