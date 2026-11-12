import SwiftUI

// MARK: - New message

/// "New message": pick one friend for a chat or several for a group.
struct MessengerNewMessageSheet: View {
    /// Called with the chat to open. The sheet dismisses itself first.
    var onStart: (Conversation) -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var selected: [User] = []
    @State private var groupName = ""
    @FocusState private var isQueryFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                toField
                if selected.count >= 2 {
                    HairlineDivider()
                    groupNameField
                }
                HairlineDivider()
                friendList
            }
            .background(FBColor.surface)
            .navigationTitle("New message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Chat") {
                        start()
                    }
                    .fontWeight(.semibold)
                    .disabled(selected.isEmpty)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: selected.count)
            .task {
                try? await Task.sleep(nanoseconds: 400_000_000)
                isQueryFocused = true
            }
        }
        .presentationDragIndicator(.visible)
    }

    // MARK: Fields

    private var toField: some View {
        HStack(spacing: 8) {
            Text("To:")
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.secondaryText)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(selected) { user in
                        selectedChip(user)
                    }
                    TextField(queryPlaceholder, text: $query)
                        .font(.fbBodyLarge)
                        .focused($isQueryFocused)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .frame(minWidth: 140)
                }
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 50)
    }

    private func selectedChip(_ user: User) -> some View {
        Button {
            toggle(user)
        } label: {
            HStack(spacing: 4) {
                Text(user.firstName)
                    .font(.fbMeta.weight(.semibold))
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(FBColor.accent)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(FBColor.tintedBlueBackground, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(user.name)")
    }

    private var groupNameField: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.3.fill")
                .font(.system(size: 15))
                .foregroundStyle(FBColor.secondaryText)
            TextField("Group name (optional)", text: $groupName)
                .font(.fbBodyLarge)
                .submitLabel(.done)
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    private var queryPlaceholder: String {
        selected.isEmpty ? "Search" : "Add more people"
    }

    // MARK: Friends

    private var filteredFriends: [User] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = store.friends.filter { friend in
            term.isEmpty || friend.name.localizedCaseInsensitiveContains(term)
        }
        return matches.sorted { lhs, rhs in
            if lhs.isOnline != rhs.isOnline { return lhs.isOnline }
            return lhs.name < rhs.name
        }
    }

    private var friendList: some View {
        List {
            Section {
                ForEach(filteredFriends) { friend in
                    Button {
                        toggle(friend)
                    } label: {
                        friendRow(friend)
                    }
                    .buttonStyle(MessengerRowButtonStyle())
                    .messengerListRow()
                }
            } header: {
                Text(query.isEmpty ? "Suggested" : "Results")
                    .font(.fbName)
                    .foregroundStyle(FBColor.secondaryText)
                    .textCase(nil)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollDismissesKeyboard(.immediately)
        .overlay {
            if filteredFriends.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
    }

    private func friendRow(_ friend: User) -> some View {
        let isSelected = selected.contains(friend)
        return HStack(spacing: 12) {
            AvatarView(user: friend, size: 44, showsOnline: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.name)
                    .font(.system(size: 16))
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                if friend.isOnline {
                    Text("Active now")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 22))
                .foregroundStyle(isSelected ? FBColor.messengerBlue : FBColor.divider)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 7)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: Actions

    private func toggle(_ user: User) {
        Haptics.selection()
        if let index = selected.firstIndex(of: user) {
            selected.remove(at: index)
        } else {
            selected.append(user)
            query = ""
        }
    }

    private func start() {
        guard !selected.isEmpty else { return }
        let name: String? = selected.count >= 2 ? groupName : nil
        let chat = store.startGroupChat(with: selected, name: name)
        Haptics.light()
        dismiss()
        onStart(chat)
    }
}

// MARK: - Note

/// Writes the 60-character note shown above your avatar in the inbox.
struct MessengerNoteSheet: View {
    @Binding var note: String

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft = ""
    @FocusState private var isFocused: Bool

    private let limit = 60

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                preview
                TextField("Share a thought...", text: $draft, axis: .vertical)
                    .font(.fbBodyLarge)
                    .lineLimit(1...3)
                    .multilineTextAlignment(.center)
                    .focused($isFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text("\(draft.count)/\(limit)")
                    .font(.fbCaption)
                    .monospacedDigit()
                    .foregroundStyle(draft.count >= limit ? FBColor.notificationRed : FBColor.secondaryText)
                Text("Friends can see your note for 24 hours.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                if !note.isEmpty {
                    Button("Delete note", role: .destructive) {
                        note = ""
                        store.showToast("Note deleted", symbol: "trash")
                        dismiss()
                    }
                    .font(.fbButton)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .navigationTitle("New note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Share") {
                        share()
                    }
                    .fontWeight(.semibold)
                    .disabled(trimmedDraft.isEmpty)
                }
            }
            .onAppear {
                draft = note
                isFocused = true
            }
            .onChange(of: draft) { _, newValue in
                if newValue.count > limit {
                    draft = String(newValue.prefix(limit))
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var preview: some View {
        ZStack(alignment: .top) {
            AvatarView(user: store.me, size: 88)
                .padding(.top, 46)
            MessengerThoughtBubble(
                text: trimmedDraft.isEmpty ? "Share a thought..." : trimmedDraft,
                isPlaceholder: trimmedDraft.isEmpty,
                maxWidth: 200,
                fontSize: 14
            )
        }
        .frame(height: 140, alignment: .top)
        .padding(.top, 8)
        .animation(.easeOut(duration: 0.15), value: trimmedDraft)
    }

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func share() {
        let text = trimmedDraft
        guard !text.isEmpty else { return }
        note = text
        Haptics.success()
        store.showToast("Note shared", symbol: "text.bubble.fill")
        dismiss()
    }
}
