import SwiftUI
import UIKit

/// One conversation. Pushed with `Route.chat(conversation)` inside the Messenger cover.
struct ChatView: View {
    let conversation: Conversation

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var draft = ""
    @State private var replyingTo: Message?
    @State private var menuTarget: Message?
    @State private var unsendCandidate: Message?
    @State private var reactionDetail: Message?
    @State private var callKind: MessengerCallKind?
    @State private var photoRequest: MessengerPhotoRequest?
    @State private var isInfoPresented = false
    @State private var isSearching = false
    @State private var searchText = ""
    /// 0 is the newest match; counting up goes back in time.
    @State private var searchIndex = 0
    @FocusState private var isComposerFocused: Bool

    private let bottomID = "messenger-chat-bottom"

    var body: some View {
        chatContent
            .navigationBarTitleDisplayMode(.inline)
            .toolbarRole(.editor)
            .toolbar {
                toolbarContent
            }
            .toolbarBackground(FBColor.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .tint(conversation.themeColor)
            .fullScreenCover(item: $callKind) { kind in
                MessengerCallView(conversation: conversation, isVideo: kind == .video)
            }
            .fullScreenCover(item: $photoRequest) { request in
                PhotoViewer(media: request.media, startIndex: request.startIndex)
            }
            .sheet(isPresented: $isInfoPresented) {
                infoSheet
            }
            .sheet(item: $reactionDetail) { message in
                MessengerReactionsSheet(messageID: message.id, conversation: conversation)
            }
            .confirmationDialog(
                "Unsend message?",
                isPresented: isUnsendPresented,
                titleVisibility: .visible,
                presenting: unsendCandidate
            ) { message in
                Button("Unsend for everyone", role: .destructive) {
                    unsend(message)
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("This message will be unsent for everyone in the chat. Others may have already seen it.")
            }
            .onAppear {
                store.openConversationID = conversation.id
                store.markRead(conversation)
            }
            .onDisappear {
                if store.openConversationID == conversation.id {
                    store.openConversationID = nil
                }
            }
            .onChange(of: conversation.messages.count) {
                store.markRead(conversation)
            }
            .onChange(of: searchText) {
                searchIndex = 0
            }
    }

    private var chatContent: some View {
        messageList
            .safeAreaInset(edge: .top, spacing: 0) {
                if isSearching {
                    searchBar
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                MessengerComposer(
                    conversation: conversation,
                    draft: $draft,
                    replyingTo: $replyingTo,
                    isFocused: $isComposerFocused,
                    onSend: { sendDraft() }
                )
            }
            .background(FBColor.surface)
            .overlay {
                menuOverlay
            }
    }

    // MARK: Messages

    private var messageList: some View {
        let rows = store.messengerRows(for: conversation)
        let search = searchContext
        let statusID = statusMessageID
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    MessengerChatIntro(conversation: conversation)
                    ForEach(rows) { row in
                        messageRow(row, search: search, showsStatus: row.id == statusID)
                            .id(row.id)
                    }
                    if conversation.isTyping {
                        typingRow
                    }
                    Color.clear
                        .frame(height: 8)
                        .id(bottomID)
                }
                .animation(.easeOut(duration: 0.2), value: conversation.isTyping)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                jumpToBottom(proxy)
            }
            .onChange(of: conversation.messages.count) {
                scrollToBottom(proxy)
            }
            .onChange(of: conversation.isTyping) {
                scrollToBottom(proxy)
            }
            .onChange(of: isComposerFocused) { _, isFocused in
                if isFocused {
                    scrollToBottom(proxy, delay: 300_000_000)
                }
            }
            .onChange(of: search.currentID) { _, newID in
                guard let newID else { return }
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(newID, anchor: .center)
                }
            }
        }
    }

    private func messageRow(_ row: MessengerRowModel, search: MessengerSearchContext, showsStatus: Bool) -> some View {
        MessengerMessageRow(
            row: row,
            conversation: conversation,
            showsStatus: showsStatus,
            searchMark: search.mark(for: row.message),
            searchTerm: search.term,
            onLongPress: { openMenu(for: row.message) },
            onReply: { startReply(to: row.message) },
            onOpenPhoto: { openPhoto(row.message) },
            onShowReactions: { reactionDetail = row.message }
        )
    }

    private var typingRow: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if let user = conversation.primaryUser {
                AvatarView(user: user, size: MessengerStyle.avatarSize)
            }
            MessengerTypingIndicator()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .transition(.opacity.combined(with: .scale(scale: 0.85, anchor: .bottomLeading)))
    }

    /// The last message, when it is mine, shows Sending / Sent / Delivered / seen avatar.
    private var statusMessageID: String? {
        guard let last = conversation.messages.last,
              last.senderID == store.me.id,
              !last.isUnsent else { return nil }
        return last.id
    }

    private func jumpToBottom(_ proxy: ScrollViewProxy) {
        proxy.scrollTo(bottomID, anchor: .bottom)
        Task {
            try? await Task.sleep(nanoseconds: 60_000_000)
            proxy.scrollTo(bottomID, anchor: .bottom)
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, delay: UInt64 = 0) {
        Task {
            if delay > 0 {
                try? await Task.sleep(nanoseconds: delay)
            }
            withAnimation(.easeOut(duration: 0.25)) {
                proxy.scrollTo(bottomID, anchor: .bottom)
            }
        }
    }

    // MARK: Search in conversation

    private var searchContext: MessengerSearchContext {
        let term = isSearching ? searchText.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        guard !term.isEmpty else { return MessengerSearchContext() }
        let matches = conversation.messages.compactMap { message -> String? in
            guard !message.isUnsent,
                  let text = message.text,
                  text.localizedCaseInsensitiveContains(term) else { return nil }
            return message.id
        }
        var current: String? = nil
        if !matches.isEmpty {
            let index = min(max(searchIndex, 0), matches.count - 1)
            current = matches[matches.count - 1 - index]
        }
        return MessengerSearchContext(term: term, matchIDs: matches, currentID: current)
    }

    private var searchBar: some View {
        let count = searchContext.matchIDs.count
        return MessengerConversationSearchBar(
            text: $searchText,
            matchCount: count,
            position: min(searchIndex, max(count - 1, 0)),
            onOlder: { moveSearch(by: 1) },
            onNewer: { moveSearch(by: -1) },
            onCancel: { endSearch() }
        )
    }

    private func moveSearch(by delta: Int) {
        let count = searchContext.matchIDs.count
        guard count > 0 else { return }
        searchIndex = (searchIndex + delta + count) % count
        Haptics.selection()
    }

    private func endSearch() {
        withAnimation(.easeOut(duration: 0.2)) {
            isSearching = false
        }
        searchText = ""
        searchIndex = 0
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                isInfoPresented = true
            } label: {
                MessengerChatHeader(conversation: conversation)
            }
            .buttonStyle(.plain)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            toolbarIcon("phone.fill", label: "Audio call") {
                startCall(.audio)
            }
            toolbarIcon("video.fill", label: "Video call") {
                startCall(.video)
            }
            toolbarIcon("info.circle.fill", label: "Chat info") {
                isInfoPresented = true
            }
        }
    }

    private func toolbarIcon(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(conversation.themeColor)
        }
        .accessibilityLabel(label)
    }

    private func startCall(_ kind: MessengerCallKind) {
        isComposerFocused = false
        Haptics.light()
        callKind = kind
    }

    // MARK: Info sheet

    private var infoSheet: some View {
        MessengerChatInfoSheet(
            conversation: conversation,
            onOpenProfile: { user in openProfileFromInfo(user) },
            onSearch: { beginSearchFromInfo() },
            onArchive: { archiveFromInfo() },
            onDelete: { deleteFromInfo() }
        )
    }

    private func openProfileFromInfo(_ user: User) {
        isInfoPresented = false
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            router.messengerPath.append(Route.profile(user))
        }
    }

    private func beginSearchFromInfo() {
        isInfoPresented = false
        Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            searchText = ""
            searchIndex = 0
            withAnimation(.easeOut(duration: 0.2)) {
                isSearching = true
            }
        }
    }

    private func archiveFromInfo() {
        let willArchive = !conversation.isArchived
        isInfoPresented = false
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            store.toggleArchive(conversation)
            if willArchive {
                dismiss()
            }
        }
    }

    private func deleteFromInfo() {
        isInfoPresented = false
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            dismiss()
            store.deleteConversation(conversation)
        }
    }

    // MARK: Composer

    private func sendDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        store.send(text, in: conversation, replyingTo: replyingTo)
        draft = ""
        replyingTo = nil
        Haptics.light()
    }

    private func startReply(to message: Message) {
        guard !message.isUnsent else { return }
        Haptics.light()
        replyingTo = message
        isComposerFocused = true
    }

    // MARK: Long-press menu

    @ViewBuilder
    private var menuOverlay: some View {
        if let target = menuTarget {
            MessengerMessageMenu(
                message: target,
                isFromMe: target.senderID == store.me.id,
                themeColor: conversation.themeColor,
                myReaction: target.reactions[store.me.id],
                onReact: { emoji in react(to: target, with: emoji) },
                onReply: {
                    closeMenu()
                    startReply(to: target)
                },
                onCopy: { copy(target) },
                onForward: { forward(target) },
                onUnsend: {
                    closeMenu()
                    unsendCandidate = target
                },
                onDismiss: { closeMenu() }
            )
            .transition(.opacity)
        }
    }

    private func openMenu(for message: Message) {
        guard !message.isUnsent else { return }
        isComposerFocused = false
        Haptics.medium()
        withAnimation(.easeOut(duration: 0.18)) {
            menuTarget = message
        }
    }

    private func closeMenu() {
        withAnimation(.easeOut(duration: 0.15)) {
            menuTarget = nil
        }
    }

    private func react(to message: Message, with emoji: String) {
        store.react(to: message, with: emoji, in: conversation)
        Haptics.light()
        closeMenu()
    }

    private func copy(_ message: Message) {
        UIPasteboard.general.string = message.text ?? message.bigEmoji ?? ""
        closeMenu()
        store.showToast("Copied", symbol: "doc.on.doc.fill")
    }

    private func forward(_ message: Message) {
        closeMenu()
        store.showToast("Message forwarded", symbol: "arrowshape.turn.up.right.fill")
    }

    private var isUnsendPresented: Binding<Bool> {
        Binding(
            get: { unsendCandidate != nil },
            set: { isPresented in
                if !isPresented {
                    unsendCandidate = nil
                }
            }
        )
    }

    private func unsend(_ message: Message) {
        withAnimation(.easeOut(duration: 0.2)) {
            store.unsend(message, in: conversation)
        }
        if replyingTo?.id == message.id {
            replyingTo = nil
        }
        Haptics.light()
    }

    // MARK: Photos

    private func openPhoto(_ message: Message) {
        let media = conversation.messengerPhotoMedia
        guard !media.isEmpty else { return }
        let index = media.firstIndex { $0.id == message.id } ?? 0
        isComposerFocused = false
        photoRequest = MessengerPhotoRequest(media: media, startIndex: index)
    }
}

// MARK: - Header

/// Avatar with the online dot, the chat's name and its status line, shown in the navigation bar.
private struct MessengerChatHeader: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 8) {
            MessengerConversationAvatar(conversation: conversation, size: 36)
            VStack(alignment: .leading, spacing: 0) {
                Text(conversation.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(statusText)
                    .font(.system(size: 12))
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            .frame(maxWidth: 150, alignment: .leading)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows chat info")
    }

    private var statusText: String {
        if conversation.isGroup {
            return "\(conversation.participants.count + 1) members"
        }
        return conversation.primaryUser?.activeStatusText ?? ""
    }
}

// MARK: - Intro

/// The profile summary at the very top of a conversation's history.
private struct MessengerChatIntro: View {
    let conversation: Conversation

    var body: some View {
        VStack(spacing: 6) {
            MessengerConversationAvatar(conversation: conversation, size: 84, showsOnline: false)
                .padding(.bottom, 4)
            Text(conversation.title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .multilineTextAlignment(.center)
            }
            if let user = profileUser {
                NavigationLink(value: Route.profile(user)) {
                    Text("View profile")
                }
                .buttonStyle(.fb(.secondary, expand: false, height: 32))
                .padding(.top, 6)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
    }

    private var profileUser: User? {
        conversation.isGroup ? nil : conversation.primaryUser
    }

    private var subtitle: String {
        if conversation.isGroup {
            return "\(conversation.participants.count + 1) members"
        }
        guard let user = conversation.primaryUser else { return "" }
        if user.isPage {
            return user.category ?? "Page"
        }
        var lines: [String] = []
        if user.isFriend {
            lines.append("You're friends on Facebook")
        }
        if !user.city.isEmpty {
            lines.append("Lives in \(user.city)")
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Search bar

private struct MessengerConversationSearchBar: View {
    @Binding var text: String
    let matchCount: Int
    /// 0-based, counted from the newest match.
    let position: Int
    let onOlder: () -> Void
    let onNewer: () -> Void
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            SearchField(placeholder: "Search in conversation", text: $text, autoFocus: true)
            if !trimmed.isEmpty {
                Text(countText)
                    .font(.fbMeta)
                    .monospacedDigit()
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize()
                arrowButton("chevron.up", label: "Older match", action: onOlder)
                arrowButton("chevron.down", label: "Newer match", action: onNewer)
            }
            Button("Cancel", action: onCancel)
                .font(.fbBody)
                .fixedSize()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(FBColor.surface)
        .overlay(alignment: .bottom) {
            HairlineDivider()
        }
    }

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var countText: String {
        matchCount == 0 ? "No results" : "\(position + 1) of \(matchCount)"
    }

    private func arrowButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 28, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(matchCount < 2 ? FBColor.tertiaryText : FBColor.primaryText)
        .disabled(matchCount < 2)
        .accessibilityLabel(label)
    }
}
