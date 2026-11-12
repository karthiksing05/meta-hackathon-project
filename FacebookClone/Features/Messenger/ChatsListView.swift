import SwiftUI

/// The Messenger inbox. Root of the Messenger full-screen cover; MainTabView wraps it in
/// `NavigationStack(path: $router.messengerPath)` with `.appDestinations()`.
struct ChatsListView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var searchText = ""
    @State private var filter: MessengerInboxFilter = .all
    @State private var myNote = ""
    @State private var isNoteSheetPresented = false
    @State private var isNewMessagePresented = false
    @State private var pendingDeletion: Conversation?

    var body: some View {
        List {
            SearchField(placeholder: "Search", text: $searchText)
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 6)
                .messengerListRow()

            if isSearching {
                searchResults
            } else {
                notesRow
                filterRow
                conversationRows
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(FBColor.surface)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollDismissesKeyboard(.immediately)
        .refreshable {
            try? await Task.sleep(nanoseconds: 700_000_000)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            header
        }
        .navigationTitle("Chats")
        .toolbar(.hidden, for: .navigationBar)
        .animation(.easeInOut(duration: 0.2), value: filter)
        .sheet(isPresented: $isNoteSheetPresented) {
            MessengerNoteSheet(note: $myNote)
        }
        .sheet(isPresented: $isNewMessagePresented) {
            MessengerNewMessageSheet { chat in
                pushAfterSheet(chat)
            }
        }
        .confirmationDialog(
            "Delete this entire conversation?",
            isPresented: isDeletePresented,
            titleVisibility: .visible,
            presenting: pendingDeletion
        ) { conversation in
            Button("Delete", role: .destructive) {
                withAnimation {
                    store.deleteConversation(conversation)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("Once you delete your copy of this conversation, it can't be undone.")
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 12) {
            CircleButton(symbol: "xmark", accessibilityLabel: "Close Messenger") {
                dismiss()
            }
            Text("Chats")
                .font(.fbLargeTitle)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            CircleButton(symbol: "square.and.pencil", accessibilityLabel: "New message") {
                Haptics.light()
                isNewMessagePresented = true
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .background(FBColor.surface)
    }

    // MARK: Notes and active friends

    private var notesRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 6) {
                MessengerNoteItem(
                    user: store.me,
                    note: myNote.isEmpty ? nil : myNote,
                    title: "Your note",
                    isMine: true
                ) {
                    isNoteSheetPresented = true
                }
                ForEach(store.onlineFriends) { friend in
                    MessengerNoteItem(
                        user: friend,
                        note: MessengerNotes.note(for: friend),
                        title: friend.firstName,
                        isMine: false
                    ) {
                        openChat(store.conversation(with: friend))
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
        }
        .messengerListRow()
    }

    // MARK: Filters

    private var filterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(MessengerInboxFilter.allCases) { option in
                    ChipView(title: option.title, isSelected: filter == option) {
                        Haptics.selection()
                        filter = option
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
        }
        .messengerListRow()
    }

    // MARK: Rows

    @ViewBuilder
    private var conversationRows: some View {
        let chats = store.messengerConversations(for: filter)
        if chats.isEmpty {
            emptyState
                .padding(.vertical, 40)
                .messengerListRow()
        } else {
            ForEach(chats) { conversation in
                chatRow(conversation)
            }
        }
    }

    private func chatRow(_ conversation: Conversation) -> some View {
        Button {
            openChat(conversation)
        } label: {
            MessengerChatRow(conversation: conversation)
        }
        .buttonStyle(MessengerRowButtonStyle())
        .messengerListRow()
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            trailingSwipeActions(conversation)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            leadingSwipeActions(conversation)
        }
        .contextMenu {
            contextActions(conversation)
        }
    }

    @ViewBuilder
    private func trailingSwipeActions(_ conversation: Conversation) -> some View {
        Button {
            pendingDeletion = conversation
        } label: {
            Label("Delete", systemImage: "trash.fill")
        }
        .tint(FBColor.notificationRed)

        Button {
            store.toggleMute(conversation)
        } label: {
            Label(conversation.isMuted ? "Unmute" : "Mute", systemImage: conversation.isMuted ? "bell.fill" : "bell.slash.fill")
        }
        .tint(FBColor.savedPurple)

        Button {
            withAnimation {
                store.toggleArchive(conversation)
            }
        } label: {
            Label(conversation.isArchived ? "Unarchive" : "Archive", systemImage: "archivebox.fill")
        }
        .tint(FBColor.secondaryText)
    }

    @ViewBuilder
    private func leadingSwipeActions(_ conversation: Conversation) -> some View {
        Button {
            withAnimation {
                store.togglePin(conversation)
            }
        } label: {
            Label(conversation.isPinned ? "Unpin" : "Pin", systemImage: conversation.isPinned ? "pin.slash.fill" : "pin.fill")
        }
        .tint(FBColor.brandBlue)

        if conversation.unreadCount > 0 {
            Button {
                store.markRead(conversation)
            } label: {
                Label("Read", systemImage: "envelope.open.fill")
            }
            .tint(FBColor.online)
        } else {
            Button {
                store.messengerMarkUnread(conversation)
            } label: {
                Label("Unread", systemImage: "envelope.badge.fill")
            }
            .tint(FBColor.online)
        }
    }

    @ViewBuilder
    private func contextActions(_ conversation: Conversation) -> some View {
        Button {
            withAnimation {
                store.togglePin(conversation)
            }
        } label: {
            Label(conversation.isPinned ? "Unpin" : "Pin", systemImage: conversation.isPinned ? "pin.slash" : "pin")
        }
        if conversation.unreadCount > 0 {
            Button {
                store.markRead(conversation)
            } label: {
                Label("Mark as read", systemImage: "envelope.open")
            }
        } else {
            Button {
                store.messengerMarkUnread(conversation)
            } label: {
                Label("Mark as unread", systemImage: "envelope.badge")
            }
        }
        Button {
            store.toggleMute(conversation)
        } label: {
            Label(conversation.isMuted ? "Unmute" : "Mute", systemImage: conversation.isMuted ? "bell" : "bell.slash")
        }
        Button {
            withAnimation {
                store.toggleArchive(conversation)
            }
        } label: {
            Label(conversation.isArchived ? "Unarchive" : "Archive", systemImage: "archivebox")
        }
        Divider()
        Button(role: .destructive) {
            pendingDeletion = conversation
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    // MARK: Search

    private var isSearching: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @ViewBuilder
    private var searchResults: some View {
        let chats = store.messengerSearchConversations(searchText)
        let people = store.messengerSearchPeople(searchText, excluding: chats)
        if chats.isEmpty && people.isEmpty {
            ContentUnavailableView.search(text: searchText)
                .padding(.vertical, 40)
                .messengerListRow()
        } else {
            if !chats.isEmpty {
                sectionTitle("Chats")
                ForEach(chats) { conversation in
                    chatRow(conversation)
                }
            }
            if !people.isEmpty {
                sectionTitle("More people")
                ForEach(people) { person in
                    personRow(person)
                }
            }
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.fbName)
            .foregroundStyle(FBColor.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 4)
            .messengerListRow()
    }

    private func personRow(_ person: User) -> some View {
        Button {
            openChat(store.conversation(with: person))
        } label: {
            HStack(spacing: 12) {
                AvatarView(user: person, size: FBAvatarSize.post, showsOnline: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(person.name)
                        .font(.fbBodyLarge)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    if person.isOnline {
                        Text("Active now")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(MessengerRowButtonStyle())
        .messengerListRow()
    }

    // MARK: Empty states

    @ViewBuilder
    private var emptyState: some View {
        switch filter {
        case .all:
            ContentUnavailableView {
                Label("No chats yet", systemImage: "bubble.left.and.bubble.right")
            } description: {
                Text("Start a conversation with a friend.")
            } actions: {
                Button("New message") {
                    isNewMessagePresented = true
                }
                .buttonStyle(.fb(.primary, expand: false))
            }
        case .unread:
            ContentUnavailableView(
                "No unread chats",
                systemImage: "checkmark.circle",
                description: Text("You're all caught up.")
            )
        case .groups:
            ContentUnavailableView(
                "No group chats",
                systemImage: "person.3",
                description: Text("Tap the pencil to start a group with friends.")
            )
        case .archived:
            ContentUnavailableView(
                "No archived chats",
                systemImage: "archivebox",
                description: Text("Chats you archive will appear here.")
            )
        }
    }

    // MARK: Actions

    private var isDeletePresented: Binding<Bool> {
        Binding(
            get: { pendingDeletion != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDeletion = nil
                }
            }
        )
    }

    private func openChat(_ conversation: Conversation) {
        router.messengerPath.append(Route.chat(conversation))
    }

    /// Waits for the new-message sheet to slide away, then pushes the chat.
    private func pushAfterSheet(_ conversation: Conversation) {
        isNewMessagePresented = false
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            router.messengerPath.append(Route.chat(conversation))
        }
    }
}

// MARK: - Chat row

/// One inbox row: avatar, name, last message preview, time and read state.
struct MessengerChatRow: View {
    let conversation: Conversation

    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(spacing: 12) {
            MessengerConversationAvatar(conversation: conversation, size: FBAvatarSize.row)
            VStack(alignment: .leading, spacing: 3) {
                titleLine
                previewLine
            }
            Spacer(minLength: 8)
            trailingIndicator
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var isUnread: Bool { conversation.unreadCount > 0 }

    private var titleLine: some View {
        HStack(spacing: 5) {
            Text(conversation.title)
                .font(isUnread ? .fbHeadline : .fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            if conversation.isPinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: FBIconSize.xs))
                    .foregroundStyle(FBColor.secondaryText)
                    .rotationEffect(.degrees(45))
                    .accessibilityLabel("Pinned")
            }
        }
    }

    private var previewLine: some View {
        HStack(spacing: 4) {
            if conversation.isTyping {
                Text("typing...")
                    .font(.fbButton)
                    .foregroundStyle(FBColor.accent)
            } else {
                Text(store.messengerPreview(for: conversation))
                    .font(isUnread ? .fbName : .fbBody)
                    .foregroundStyle(previewColor)
                    .lineLimit(1)
                if let last = conversation.lastMessage {
                    Text("· \(MessengerFormat.listTime(last.sentAt))")
                        .font(isUnread ? .fbName : .fbBody)
                        .foregroundStyle(previewColor)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            if conversation.isMuted {
                Image(systemName: "bell.slash.fill")
                    .font(.system(size: FBIconSize.xs))
                    .foregroundStyle(FBColor.tertiaryText)
                    .accessibilityLabel("Muted")
            }
        }
    }

    private var previewColor: Color {
        isUnread ? FBColor.primaryText : FBColor.secondaryText
    }

    @ViewBuilder
    private var trailingIndicator: some View {
        if isUnread {
            Circle()
                .fill(FBColor.messengerBlue)
                .frame(width: 12, height: 12)
                .accessibilityLabel("Unread")
        } else if let last = conversation.lastMessage, last.senderID == store.me.id, !last.isUnsent {
            deliveryIcon(for: last.status)
        }
    }

    @ViewBuilder
    private func deliveryIcon(for status: MessageStatus) -> some View {
        switch status {
        case .sending:
            Image(systemName: "circle")
                .font(.system(size: FBIconSize.medium))
                .foregroundStyle(FBColor.tertiaryText)
                .accessibilityLabel("Sending")
        case .sent:
            Image(systemName: "checkmark.circle")
                .font(.system(size: FBIconSize.medium))
                .foregroundStyle(FBColor.tertiaryText)
                .accessibilityLabel("Sent")
        case .delivered:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: FBIconSize.medium))
                .foregroundStyle(FBColor.tertiaryText)
                .accessibilityLabel("Delivered")
        case .seen:
            if let user = conversation.primaryUser {
                AvatarView(user: user, size: FBAvatarSize.micro)
                    .accessibilityLabel("Seen by \(user.firstName)")
            }
        }
    }
}

// MARK: - Notes row item

/// An avatar in the notes row with an optional thought bubble above it.
private struct MessengerNoteItem: View {
    let user: User
    let note: String?
    let title: String
    let isMine: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                ZStack(alignment: .top) {
                    AvatarView(user: user, size: FBAvatarSize.row, showsOnline: !isMine)
                        .padding(.top, 30)
                    bubble
                }
                .frame(width: 80, height: 94, alignment: .top)
                Text(title)
                    .font(.fbCaption)
                    .foregroundStyle(isMine ? FBColor.secondaryText : FBColor.primaryText)
                    .lineLimit(1)
            }
            .frame(width: 80)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(accessibilityText)
    }

    @ViewBuilder
    private var bubble: some View {
        if let note {
            MessengerThoughtBubble(text: note)
        } else if isMine {
            MessengerThoughtBubble(text: "Share a note", isPlaceholder: true)
        }
    }

    private var accessibilityText: String {
        if isMine { return note.map { "Your note: \($0)" } ?? "Share a note" }
        if let note { return "\(user.name), note: \(note)" }
        return "\(user.name), active now"
    }
}

/// A small rounded bubble with two trailing dots, like Messenger's notes.
struct MessengerThoughtBubble: View {
    let text: String
    var isPlaceholder: Bool = false
    var maxWidth: CGFloat = 80
    var fontSize: CGFloat = 11

    var body: some View {
        Text(text)
            .font(.system(size: fontSize, weight: isPlaceholder ? .regular : .medium))
            .foregroundStyle(isPlaceholder ? FBColor.secondaryText : FBColor.primaryText)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(FBColor.elevated, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                tail
            }
            .frame(maxWidth: maxWidth)
            .shadow(color: Color.black.opacity(0.14), radius: 3, y: 1)
    }

    private var tail: some View {
        ZStack(alignment: .topLeading) {
            Circle()
                .fill(FBColor.elevated)
                .frame(width: 8, height: 8)
            Circle()
                .fill(FBColor.elevated)
                .frame(width: 4, height: 4)
                .offset(x: -3, y: 9)
        }
        .offset(x: 12, y: 6)
    }
}

#Preview {
    NavigationStack {
        ChatsListView()
            .appDestinations()
    }
    .previewEnvironment()
}
