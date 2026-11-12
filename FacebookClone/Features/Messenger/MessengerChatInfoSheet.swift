import SwiftUI

/// Chat details: profile, mute, theme, quick emoji, search, archive and delete.
/// Navigation side effects (opening a profile, popping the chat) are handed back to ChatView.
struct MessengerChatInfoSheet: View {
    let conversation: Conversation
    /// Asked to push this person's profile in the Messenger stack (after the sheet closes).
    var onOpenProfile: (User) -> Void = { _ in }
    var onSearch: () -> Void = {}
    var onArchive: () -> Void = {}
    var onDelete: () -> Void = {}

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var isDeleteConfirmationPresented = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    header
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }

                Section("Customization") {
                    themeTitleRow
                    themeGrid
                    quickEmojiTitleRow
                    quickEmojiPicker
                }

                if conversation.isGroup {
                    Section("Chat members") {
                        memberRows
                    }
                }

                Section("Notifications") {
                    Toggle(isOn: muteBinding) {
                        Label("Mute notifications", systemImage: "bell.slash")
                            .foregroundStyle(FBColor.primaryText)
                    }
                    .tint(FBColor.brandBlue)
                }

                Section("Privacy & support") {
                    Button {
                        onSearch()
                    } label: {
                        Label("Search in conversation", systemImage: "magnifyingglass")
                            .foregroundStyle(FBColor.primaryText)
                    }
                    Button {
                        onArchive()
                    } label: {
                        Label(conversation.isArchived ? "Unarchive chat" : "Archive chat", systemImage: "archivebox")
                            .foregroundStyle(FBColor.primaryText)
                    }
                    Button {
                        isDeleteConfirmationPresented = true
                    } label: {
                        Label("Delete chat", systemImage: "trash")
                            .foregroundStyle(FBColor.notificationRed)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .confirmationDialog(
                "Delete this chat?",
                isPresented: $isDeleteConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button("Delete chat", role: .destructive) {
                    onDelete()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently deletes your copy of the conversation.")
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Header

    private var profileUser: User? {
        conversation.isGroup ? nil : conversation.primaryUser
    }

    private var subtitle: String {
        if conversation.isGroup {
            return "Group chat · \(conversation.participants.count + 1) members"
        }
        return conversation.primaryUser?.activeStatusText ?? ""
    }

    private var header: some View {
        VStack(spacing: 10) {
            MessengerConversationAvatar(conversation: conversation, size: FBAvatarSize.request)
            Text(conversation.title)
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            HStack(spacing: 28) {
                if let user = profileUser {
                    quickAction("Profile", symbol: "person.fill") {
                        onOpenProfile(user)
                    }
                }
                quickAction(conversation.isMuted ? "Unmute" : "Mute", symbol: conversation.isMuted ? "bell.fill" : "bell.slash.fill") {
                    store.toggleMute(conversation)
                }
                quickAction("Search", symbol: "magnifyingglass") {
                    onSearch()
                }
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
    }

    private func quickAction(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 44, height: 44)
                    .background(FBColor.buttonGray, in: Circle())
                Text(title)
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.primaryText)
            }
            .frame(minWidth: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Customization

    private var themeTitleRow: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(conversation.themeColor)
                .frame(width: 24, height: 24)
            Text("Theme")
                .foregroundStyle(FBColor.primaryText)
            Spacer(minLength: 8)
            Text(MessengerTheme.name(for: conversation.themeHex))
                .foregroundStyle(FBColor.secondaryText)
        }
    }

    private var themeGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 12) {
            ForEach(MessengerTheme.all) { theme in
                themeSwatch(theme)
            }
        }
        .padding(.vertical, 6)
    }

    private func themeSwatch(_ theme: MessengerTheme) -> some View {
        let isSelected = conversation.themeHex == theme.hex
        return Button {
            Haptics.selection()
            withAnimation(.easeInOut(duration: 0.2)) {
                store.setTheme(theme.hex, for: conversation)
            }
        } label: {
            Circle()
                .fill(theme.color)
                .frame(width: 38, height: 38)
                .overlay {
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: FBIconSize.medium, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .padding(3)
                .overlay {
                    Circle()
                        .stroke(isSelected ? theme.color : Color.clear, lineWidth: 2)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(theme.name) theme")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var quickEmojiTitleRow: some View {
        HStack(spacing: 12) {
            Text(conversation.quickEmoji)
                .font(.system(size: 20)) // Display text
                .frame(width: 24)
            Text("Quick reaction")
                .foregroundStyle(FBColor.primaryText)
        }
    }

    private var quickEmojiPicker: some View {
        HStack(spacing: 0) {
            ForEach(MessengerStyle.quickEmojis, id: \.self) { emoji in
                quickEmojiButton(emoji)
            }
        }
        .padding(.vertical, 4)
    }

    private func quickEmojiButton(_ emoji: String) -> some View {
        let isSelected = conversation.quickEmoji == emoji
        return Button {
            Haptics.selection()
            store.setQuickEmoji(emoji, for: conversation)
        } label: {
            Text(emoji)
                .font(.system(size: 24)) // Display text
                .frame(width: 36, height: 36)
                .background {
                    if isSelected {
                        Circle().fill(FBColor.buttonGray)
                    }
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Quick reaction \(emoji)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: Members

    @ViewBuilder
    private var memberRows: some View {
        ForEach(conversation.participants) { member in
            Button {
                onOpenProfile(member)
            } label: {
                memberRow(member, subtitle: member.activeStatusText)
            }
            .buttonStyle(.plain)
        }
        memberRow(store.me, subtitle: "You")
    }

    private func memberRow(_ user: User, subtitle: String) -> some View {
        HStack(spacing: 12) {
            AvatarView(user: user, size: FBAvatarSize.post, showsOnline: !user.isMe)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.name)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 8)
            if !user.isMe {
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.tertiaryText)
            }
        }
        .contentShape(Rectangle())
    }

    // MARK: Bindings

    private var muteBinding: Binding<Bool> {
        Binding(
            get: { conversation.isMuted },
            set: { _ in store.toggleMute(conversation) }
        )
    }
}
