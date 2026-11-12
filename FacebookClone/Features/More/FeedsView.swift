import SwiftUI

struct FeedsView: View {
    @Environment(AppStore.self) private var store

    @State private var filter: FeedFilter = .all
    @State private var showManage = false

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                chips
                feed
            }
        }
        .background(FBColor.background)
        .navigationTitle("Feeds")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Manage") { showManage = true }
            }
        }
        .sheet(isPresented: $showManage) {
            MoreFeedsManageSheet()
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(FeedFilter.allCases) { item in
                    ChipView(title: item.title, isSelected: filter == item) {
                        filter = item
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(FBColor.surface)
    }

    @ViewBuilder
    private var feed: some View {
        let posts = store.feedPosts(filter: filter)
        if posts.isEmpty {
            ContentUnavailableView(
                "Nothing here yet",
                systemImage: filter == .favorites ? "star" : "newspaper",
                description: Text(emptyMessage)
            )
            .padding(.top, 50)
        } else {
            FeedSeparator()
            ForEach(posts) { post in
                PostCard(post: post)
                FeedSeparator()
            }
        }
    }

    private var emptyMessage: String {
        switch filter {
        case .favorites: return "Add people and Pages to Favorites to see their posts here."
        case .groups: return "Join groups to see their posts here."
        case .pages: return "Follow Pages to see their posts here."
        case .friends: return "Posts from your friends will show up here."
        case .all: return "Posts from your friends, groups and Pages will show up here."
        }
    }
}

private struct MoreFeedsManageSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private var candidates: [User] {
        (store.friends + store.pages).filter { !$0.isFavorite }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Favorites") {
                    if store.favorites.isEmpty {
                        Text("Add people and Pages to Favorites to see their posts here.")
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    ForEach(store.favorites) { user in
                        row(user)
                    }
                }
                Section("Add favorites") {
                    ForEach(candidates) { user in
                        row(user)
                    }
                }
            }
            .navigationTitle("Manage Favorites")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private func row(_ user: User) -> some View {
        HStack(spacing: 12) {
            AvatarView(user: user, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                NameWithBadge(user: user)
                Text(user.isPage ? (user.category ?? "Page") : "Friend")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer()
            Button {
                Haptics.selection()
                store.toggleFavorite(user)
            } label: {
                Image(systemName: user.isFavorite ? "star.fill" : "star")
                    .font(.system(size: 20))
                    .foregroundStyle(user.isFavorite ? FBColor.feelingYellow : FBColor.secondaryText)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(user.isFavorite ? "Remove from Favorites" : "Add to Favorites")
        }
    }
}
