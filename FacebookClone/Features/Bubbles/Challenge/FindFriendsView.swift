import SwiftUI

/// Find people on the games server by name or username (`GET /v1/users?q=`) and add them
/// (`PUT /v1/me/friends/{id}`). Adding someone offers a best of 5 with them.
struct FindFriendsView: View {
    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    @State private var query = ""
    @State private var results: [RemoteProfile] = []
    @State private var state: FeedLoadState = .idle
    @State private var adding: Set<String> = []
    @State private var added: Set<String> = []

    var body: some View {
        List {
            if trimmed.count < 2 {
                Section {
                    Text("Search by name or username to find friends, then challenge them to a best of 5.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            } else if state.isLoading && results.isEmpty {
                Section { LiveDataStateView(kind: .loading, title: "Searching…") }
            } else if let failure = state.failure {
                Section {
                    LiveDataStateView(kind: .failed(failure), title: "Couldn't search") { search() }
                }
            } else if results.isEmpty {
                Section {
                    Text("No one matches \u{201C}\(trimmed)\u{201D}.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            } else {
                Section {
                    ForEach(results) { row($0) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Find friends")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name or username")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .task(id: trimmed) {
            // Debounce typing a little before asking the server.
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            search()
        }
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private func row(_ profile: RemoteProfile) -> some View {
        let name = profile.displayName.isEmpty ? profile.username : profile.displayName
        let user = bubbleStore.person(id: profile.id, name: name, isFriend: profile.isFriend || added.contains(profile.id))
        let isFriend = profile.isFriend || added.contains(profile.id)
        return HStack(spacing: 12) {
            AvatarView(user: user, size: FBAvatarSize.post)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                Text("@\(profile.username)")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
            if isFriend {
                Label("Friends", systemImage: "checkmark")
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                Button {
                    add(profile, name: name)
                } label: {
                    if adding.contains(profile.id) { ProgressView() } else { Text("Add friend") }
                }
                .buttonStyle(.fb(.primary, expand: false, height: 32))
                .disabled(adding.contains(profile.id))
                .accessibilityLabel("Add \(name) as a friend")
            }
        }
        .padding(.vertical, 2)
    }

    private func search() {
        let q = trimmed
        guard q.count >= 2 else { results = []; state = .idle; return }
        state = .loading
        Task { @MainActor in
            do {
                let found = try await GamesAPIFactory.current.searchUsers(q)
                guard q == trimmed else { return }
                results = found
                state = .idle
            } catch {
                guard q == trimmed else { return }
                state = .failed(error.localizedDescription)
            }
        }
    }

    private func add(_ profile: RemoteProfile, name: String) {
        adding.insert(profile.id)
        Haptics.light()
        Task { @MainActor in
            do {
                try await GamesAPIFactory.current.setFriend(true, userID: profile.id)
                added.insert(profile.id)
                bubbleStore.person(id: profile.id, name: name, isFriend: true).friendship = .friends
                Haptics.success()
                NotificationCenter.default.post(name: .gamesFriendAdded, object: profile.id)
            } catch {
                appStore.showToast("Couldn't add \(name): \(error.localizedDescription)", symbol: "exclamationmark.circle")
            }
            adding.remove(profile.id)
        }
    }
}
