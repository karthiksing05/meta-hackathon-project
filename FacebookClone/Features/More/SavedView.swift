import SwiftUI

private enum MoreSavedFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case posts = "Posts"
    case videos = "Videos"
    case marketplace = "Marketplace"
    case collections = "Collections"

    var id: String { rawValue }
}

private enum MoreSavedEntry: Identifiable {
    case post(Post)
    case listing(Listing)

    var id: String {
        switch self {
        case .post(let post): return "post-\(post.id)"
        case .listing(let listing): return "listing-\(listing.id)"
        }
    }
}

struct SavedView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var filter: MoreSavedFilter = .all

    var body: some View {
        VStack(spacing: 0) {
            chips
            if filter == .collections {
                collectionsContent
            } else {
                itemsContent
            }
        }
        .background(FBColor.background)
        .navigationTitle("Saved")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(MoreSavedFilter.allCases) { item in
                    ChipView(title: item.rawValue, isSelected: filter == item) {
                        filter = item
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(FBColor.surface)
    }

    private var entries: [MoreSavedEntry] {
        let posts = store.savedPosts
        let listings = store.savedListings
        switch filter {
        case .all:
            return posts.map { MoreSavedEntry.post($0) } + listings.map { MoreSavedEntry.listing($0) }
        case .posts:
            return posts.filter { !$0.isVideo }.map { MoreSavedEntry.post($0) }
        case .videos:
            return posts.filter { $0.isVideo }.map { MoreSavedEntry.post($0) }
        case .marketplace:
            return listings.map { MoreSavedEntry.listing($0) }
        case .collections:
            return []
        }
    }

    @ViewBuilder
    private var itemsContent: some View {
        let items = entries
        if items.isEmpty {
            ContentUnavailableView(
                "Nothing saved yet",
                systemImage: "bookmark",
                description: Text("Save posts, videos and Marketplace items to find them again here.")
            )
            .frame(maxHeight: .infinity)
        } else {
            List {
                ForEach(items) { entry in
                    MoreSavedRow(entry: entry)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 8))
                        .listRowBackground(FBColor.surface)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                unsave(entry)
                            } label: {
                                Label("Unsave", systemImage: "bookmark.slash")
                            }
                        }
                }
            }
            .listStyle(.plain)
        }
    }

    private func unsave(_ entry: MoreSavedEntry) {
        switch entry {
        case .post(let post): store.toggleSave(post)
        case .listing(let listing): store.toggleSave(listing)
        }
    }

    // MARK: Collections

    private var collectionsContent: some View {
        ScrollView {
            VStack(spacing: 12) {
                let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
                LazyVGrid(columns: columns, spacing: 12) {
                    collectionCard(title: "For later", icon: "clock.fill", offset: 0)
                    collectionCard(title: "Recipes", icon: "fork.knife", offset: 1)
                    collectionCard(title: "Travel ideas", icon: "airplane", offset: 2)
                }
                Button {
                    store.showToast("Collections aren't available in this demo", symbol: "info.circle")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus")
                        Text("New collection")
                    }
                }
                .buttonStyle(.fb(.tinted, height: 40))
            }
            .padding(16)
        }
    }

    private func collectionCard(title: String, icon: String, offset: Int) -> some View {
        let posts = store.savedPosts
        let thumb: URL? = posts.isEmpty ? nil : posts[offset % posts.count].media.first?.url
        let count = posts.isEmpty ? 0 : max(1, (posts.count + 2 - offset) / 3)
        return VStack(alignment: .leading, spacing: 6) {
            ZStack {
                FBColor.inputBackground
                Image(systemName: icon)
                    .font(.system(size: 28))
                    .foregroundStyle(FBColor.secondaryText)
                RemoteImage(url: thumb, placeholder: .clear)
            }
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(title)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
            Text(count == 1 ? "1 item" : "\(count) items")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
    }
}

private struct MoreSavedRow: View {
    let entry: MoreSavedEntry
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        HStack(spacing: 12) {
            Button {
                open()
            } label: {
                HStack(spacing: 12) {
                    thumbnail
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            menu
        }
    }

    private var thumbnail: some View {
        ZStack {
            FBColor.inputBackground
            switch entry {
            case .post(let post):
                if let media = post.media.first {
                    RemoteImage(url: media.url, data: media.data, placeholder: .clear)
                } else {
                    RemoteImage(url: post.author.avatarURL, data: post.author.avatarData, placeholder: .clear)
                }
            case .listing(let listing):
                RemoteImage(url: listing.imageURLs.first, data: listing.imageData.first, placeholder: .clear)
            }
        }
        .frame(width: 72, height: 72)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var title: String {
        switch entry {
        case .post(let post):
            let source = post.text.isEmpty ? (post.sharedPost?.text ?? "") : post.text
            let line = source.split(separator: "\n").first.map(String.init) ?? ""
            if !line.isEmpty { return line }
            return post.isVideo ? "Video from \(post.author.name)" : "Post from \(post.author.name)"
        case .listing(let listing):
            return listing.title
        }
    }

    private var subtitle: String {
        switch entry {
        case .post(let post): return "Post from \(post.author.name) · Saved"
        case .listing(let listing): return "Marketplace · \(listing.priceText)"
        }
    }

    private func open() {
        switch entry {
        case .post(let post): router.push(.post(post))
        case .listing(let listing): router.push(.listing(listing))
        }
    }

    private var menu: some View {
        Menu {
            Button(role: .destructive) {
                switch entry {
                case .post(let post): store.toggleSave(post)
                case .listing(let listing): store.toggleSave(listing)
                }
            } label: {
                Label("Unsave", systemImage: "bookmark.slash")
            }
            ShareLink(item: title) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            Button {
                store.showToast("Added to collection", symbol: "folder.fill")
            } label: {
                Label("Add to collection", systemImage: "folder.badge.plus")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 36, height: 44)
        }
        .accessibilityLabel("More options")
    }
}
