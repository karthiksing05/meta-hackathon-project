import SwiftUI

/// The share sheet: "Share now" with a message and audience, "Send in Messenger" to one or
/// more friends, and rows for your story, a group, Copy link and the system share sheet.
struct ShareSheetView: View {
    let post: Post

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var message = ""
    @State private var audience: Audience = .friends
    @State private var search = ""
    @State private var selectedIDs: Set<String> = []
    @State private var note = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    composer
                    HairlineDivider()
                    messengerSection
                    HairlineDivider()
                    shareToSection
                }
                .padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(FBColor.surface)
            .toolbar(.hidden, for: .navigationBar)
        }
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 24)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Share now

    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                AvatarView(user: store.me, size: FBAvatarSize.post)
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.me.name)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    audienceMenu
                }
                Spacer(minLength: 0)
            }
            TextField("Say something about this...", text: $message, axis: .vertical)
                .font(.fbBodyLarge)
                .lineLimit(2...6)
            HStack {
                Spacer()
                Button("Share now", action: shareNow)
                    .buttonStyle(.fb(.primary, expand: false))
            }
        }
        .padding(16)
        .padding(.top, 8)
    }

    private var audienceMenu: some View {
        Menu {
            Picker("Audience", selection: $audience) {
                ForEach(Audience.allCases) { option in
                    Label(option.title, systemImage: option.symbol)
                        .tag(option)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text("Feed")
                Text("·")
                Image(systemName: audience.symbol)
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                Text(audience.title)
                Image(systemName: "chevron.down")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
            }
            .font(.fbCaptionEmphasized)
            .foregroundStyle(FBColor.primaryText)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
        }
        .accessibilityLabel("Audience, \(audience.title)")
    }

    // MARK: Messenger

    private var messengerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Send in Messenger")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .padding(.horizontal, 16)
            SearchField(placeholder: "Search for people", text: $search)
                .padding(.horizontal, 16)
            if filteredFriends.isEmpty {
                Text("No results for \"\(search)\"")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(filteredFriends) { friend in
                            friendCell(friend)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 2)
                }
            }
            if !selectedIDs.isEmpty {
                sendBar
            }
        }
        .padding(.vertical, 14)
        .animation(.easeOut(duration: 0.2), value: selectedIDs)
    }

    private var filteredFriends: [User] {
        let term = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let online = store.friends.filter { $0.isOnline }
        let offline = store.friends.filter { !$0.isOnline }
        let ordered = online + offline
        guard !term.isEmpty else { return Array(ordered.prefix(30)) }
        return ordered.filter { $0.name.lowercased().contains(term) }
    }

    private func friendCell(_ friend: User) -> some View {
        let isSelected = selectedIDs.contains(friend.id)
        return Button {
            Haptics.selection()
            if isSelected {
                selectedIDs.remove(friend.id)
            } else {
                selectedIDs.insert(friend.id)
            }
        } label: {
            VStack(spacing: 6) {
                AvatarView(user: friend, size: FBAvatarSize.row, showsOnline: !isSelected)
                    .overlay(alignment: .bottomTrailing) {
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, FBColor.brandBlue)
                                .font(.system(size: FBIconSize.large))
                                .background(Circle().fill(FBColor.surface).padding(-2))
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .scaleEffect(isSelected ? 0.94 : 1)
                Text(friend.firstName)
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                    .frame(width: 64)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(friend.name)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var sendBar: some View {
        HStack(spacing: 8) {
            TextField("Write a message...", text: $note)
                .font(.fbBody)
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(FBColor.inputBackground, in: Capsule())
            Button(action: sendInMessenger) {
                Text(sendTitle)
            }
            .buttonStyle(.fb(.primary, expand: false))
        }
        .padding(.horizontal, 16)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var sendTitle: String {
        selectedIDs.count == 1 ? "Send" : "Send (\(selectedIDs.count))"
    }

    // MARK: Share to

    private var shareToSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Share to")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 4)
            Button(action: shareToStory) {
                PostShareRow(symbol: "plus.rectangle.on.rectangle", title: "Share to your story")
            }
            .buttonStyle(.plain)
            NavigationLink {
                PostShareGroupPicker(post: post) {
                    dismiss()
                }
            } label: {
                PostShareRow(symbol: "person.3.fill", title: "Share to a group", showsChevron: true)
            }
            .buttonStyle(.plain)
            Button {
                store.postCopyLink(post)
            } label: {
                PostShareRow(symbol: "link", title: "Copy link")
            }
            .buttonStyle(.plain)
            if let url = store.postShareURL(for: post) {
                ShareLink(item: url) {
                    PostShareRow(symbol: "square.and.arrow.up", title: "More options")
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Actions

    private func shareNow() {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        store.share(post, message: text, audience: audience)
        Haptics.success()
        dismiss()
    }

    private func sendInMessenger() {
        let recipients = store.friends.filter { selectedIDs.contains($0.id) }
        guard !recipients.isEmpty else { return }
        store.send(post, to: recipients, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
        Haptics.success()
        dismiss()
    }

    private func shareToStory() {
        let original = post.sharedPost ?? post
        let text = original.text.isEmpty ? "Shared a post by \(original.author.name)" : String(original.text.prefix(220))
        store.addStory(.text(text, backgroundIndex: 2))
        Haptics.success()
        dismiss()
    }
}

/// One "Share to" row: a gray icon circle and a title.
private struct PostShareRow: View {
    let symbol: String
    let title: String
    var showsChevron = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.regular, weight: .semibold))
                .foregroundStyle(FBColor.primaryText)
                .frame(width: 40, height: 40)
                .background(FBColor.buttonGray, in: Circle())
            Text(title)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
            Spacer(minLength: 8)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.tertiaryText)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

/// "Share to a group": the groups you're in. Picking one posts the share there.
struct PostShareGroupPicker: View {
    let post: Post
    var onDone: () -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        List {
            if store.myGroups.isEmpty {
                ContentUnavailableView(
                    "No groups yet",
                    systemImage: "person.3",
                    description: Text("Groups you join show up here.")
                )
                .listRowSeparator(.hidden)
            }
            ForEach(store.myGroups) { group in
                Button {
                    share(to: group)
                } label: {
                    row(group)
                }
                .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .navigationTitle("Share to a group")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ group: FBGroup) -> some View {
        HStack(spacing: 12) {
            RemoteImage(url: group.coverURL)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(group.name)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text("\(group.privacyText) · \(group.memberCount.fbCompact) members")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    private func share(to group: FBGroup) {
        store.createPost(text: "", group: group, sharedPost: post.sharedPost ?? post)
        store.showToast("Shared to \(group.name)", symbol: "person.3.fill")
        Haptics.success()
        onDone()
    }
}
