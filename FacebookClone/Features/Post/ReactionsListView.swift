import SwiftUI

/// Someone in the reactions list and the reaction shown on their avatar.
struct PostReactorEntry: Identifiable {
    let user: User
    let type: ReactionType

    var id: String { user.id }
}

/// Spreads people over a post's reaction counts so the list roughly matches the numbers.
/// The signed-in user comes first, then `post.reactors`, then friends and other people.
enum PostReactorAssignment {
    static func make(post: Post, store: AppStore, capPerType: Int) -> [PostReactorEntry] {
        var entries: [PostReactorEntry] = []
        if let mine = post.myReaction {
            entries.append(PostReactorEntry(user: store.me, type: mine))
        }
        let pool = uniquePool(post: post, store: store)
        let types = ReactionType.allCases
            .filter { (post.reactionCounts[$0] ?? 0) > 0 }
            .sorted { (post.reactionCounts[$0] ?? 0) > (post.reactionCounts[$1] ?? 0) }
        var remaining = types.map { min(post.reactionCounts[$0] ?? 0, capPerType) }
        var cursor = 0
        var progressed = true
        // Round-robin, so every reaction type gets people and "All" mixes them.
        while cursor < pool.count && progressed {
            progressed = false
            for (index, type) in types.enumerated() where remaining[index] > 0 && cursor < pool.count {
                entries.append(PostReactorEntry(user: pool[cursor], type: type))
                remaining[index] -= 1
                cursor += 1
                progressed = true
            }
        }
        return entries
    }

    private static func uniquePool(post: Post, store: AppStore) -> [User] {
        var seen: Set<String> = [store.me.id]
        var pool: [User] = []
        for user in post.reactors + store.friends + store.people where !seen.contains(user.id) {
            seen.insert(user.id)
            pool.append(user)
        }
        return pool
    }
}

/// Who reacted: an "All N" tab, then one tab per reaction type present. Rows open profiles
/// inside the sheet and offer Add friend, Confirm, Follow or Message.
struct ReactionsListView: View {
    let post: Post
    /// Push the chat inside this sheet instead of opening the Messenger cover. Use it when the
    /// list is itself shown over another sheet, where the app-wide cover can't present.
    var opensChatInPlace: Bool = false

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var path = NavigationPath()
    @State private var selected: ReactionType?

    private static let rowCap = 50

    var body: some View {
        NavigationStack(path: $path) {
            content
                .toolbar(.hidden, for: .navigationBar)
                .appDestinations()
        }
        .environment(\.postPush, { route in
            path.append(route)
        })
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var content: some View {
        let entries = PostReactorAssignment.make(post: post, store: store, capPerType: Self.rowCap)
        let rows = visibleRows(from: entries)
        return VStack(spacing: 0) {
            tabs
            HairlineDivider()
            list(rows)
        }
        .background(FBColor.surface)
    }

    // MARK: Tabs

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                tab(nil)
                ForEach(presentTypes) { type in
                    tab(type)
                }
            }
            .padding(.horizontal, 8)
        }
        .padding(.top, 18)
    }

    private func tab(_ type: ReactionType?) -> some View {
        let isSelected = selected == type
        return Button {
            Haptics.selection()
            withAnimation(.easeInOut(duration: 0.2)) {
                selected = type
            }
        } label: {
            VStack(spacing: 8) {
                HStack(spacing: 5) {
                    if let type {
                        ReactionBadge(type: type, size: 20, showsBorder: false)
                        Text(count(for: type).fbCompact)
                    } else {
                        Text("All \(post.totalReactions.fbCompact)")
                    }
                }
                .font(.fbButton)
                .foregroundStyle(isSelected ? tabColor(type) : FBColor.secondaryText)
                .padding(.horizontal, 10)
                Rectangle()
                    .fill(isSelected ? tabColor(type) : Color.clear)
                    .frame(height: 3)
            }
            .fixedSize(horizontal: true, vertical: false)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tabLabel(type))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var presentTypes: [ReactionType] {
        ReactionType.allCases
            .filter { count(for: $0) > 0 }
            .sorted { count(for: $0) > count(for: $1) }
    }

    private func count(for type: ReactionType) -> Int {
        (post.reactionCounts[type] ?? 0) + (post.myReaction == type ? 1 : 0)
    }

    private func tabColor(_ type: ReactionType?) -> Color {
        type?.color ?? FBColor.accent
    }

    private func tabLabel(_ type: ReactionType?) -> String {
        guard let type else { return "All, \(post.totalReactions)" }
        return "\(type.title), \(count(for: type))"
    }

    // MARK: List

    private func visibleRows(from entries: [PostReactorEntry]) -> [PostReactorEntry] {
        guard let selected else {
            return Array(entries.prefix(Self.rowCap))
        }
        return Array(entries.filter { $0.type == selected }.prefix(Self.rowCap))
    }

    private func list(_ rows: [PostReactorEntry]) -> some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(rows) { entry in
                    PostReactorRow(entry: entry) { user in
                        message(user)
                    }
                }
                let more = remainingCount(shown: rows.count)
                if more > 0 {
                    Text("And \(more.withCommas) more")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
            }
            .padding(.vertical, 8)
        }
    }

    private func remainingCount(shown: Int) -> Int {
        let total = selected.map { count(for: $0) } ?? post.totalReactions
        return max(0, total - shown)
    }

    /// Messenger is an app-wide cover, so close this sheet first.
    private func message(_ user: User) {
        let chat = store.conversation(with: user)
        if opensChatInPlace {
            path.append(Route.chat(chat))
            return
        }
        dismiss()
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            router.openChat(chat)
        }
    }
}

/// A person who reacted: avatar with their reaction, name, mutual friends and a button.
struct PostReactorRow: View {
    let entry: PostReactorEntry
    var onMessage: (User) -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.profile(entry.user)) {
                HStack(spacing: 12) {
                    AvatarView(user: entry.user, size: FBAvatarSize.compact)
                        .overlay(alignment: .bottomTrailing) {
                            ReactionBadge(type: entry.type, size: 18)
                                .offset(x: 3, y: 3)
                        }
                    VStack(alignment: .leading, spacing: 2) {
                        NameWithBadge(user: entry.user)
                        if let subtitle {
                            Text(subtitle)
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            actionButton
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private var subtitle: String? {
        let user = entry.user
        if user.isMe {
            return nil
        }
        if user.isPage {
            return user.category
        }
        let mutual = user.mutualFriendCount
        guard mutual > 0 else { return nil }
        return "\(mutual) mutual \(mutual == 1 ? "friend" : "friends")"
    }

    @ViewBuilder
    private var actionButton: some View {
        let user = entry.user
        if user.isMe {
            EmptyView()
        } else if user.isPage {
            Button(followTitle(user)) {
                guard !user.isFollowing else { return }
                Haptics.light()
                store.follow(user)
            }
            .buttonStyle(.fb(user.isFollowing ? .secondary : .tinted, expand: false, height: 32))
        } else {
            friendButton(for: user)
        }
    }

    private func followTitle(_ user: User) -> String {
        user.isFollowing ? "Following" : "Follow"
    }

    @ViewBuilder
    private func friendButton(for user: User) -> some View {
        switch user.friendship {
        case .friends:
            Button {
                onMessage(user)
            } label: {
                HStack(spacing: 6) {
                    MessengerGlyph(size: 15, color: FBColor.primaryText)
                    Text("Message")
                }
            }
            .buttonStyle(.fb(.secondary, expand: false, height: 32))
        case .requestSent:
            Button("Cancel") {
                Haptics.light()
                store.cancelRequest(to: user)
            }
            .buttonStyle(.fb(.secondary, expand: false, height: 32))
        case .requestReceived:
            Button("Confirm") {
                Haptics.light()
                store.confirmRequest(from: user)
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
        case .none, .me:
            Button {
                Haptics.light()
                store.sendRequest(to: user)
            } label: {
                Label("Add friend", systemImage: "person.fill.badge.plus")
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 32))
        }
    }
}
