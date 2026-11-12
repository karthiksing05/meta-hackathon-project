import SwiftUI

enum ProfilePhotoTab: String, CaseIterable, Identifiable {
    case ofUser
    case byUser
    case albums
    var id: String { rawValue }
}

/// The "Photos" tab: chips plus a 3-column grid, or mock albums.
struct ProfilePhotosSection: View {
    let user: User
    let onOpenPhotos: ([Media], Int) -> Void

    @Environment(AppStore.self) private var store

    @State private var tab: ProfilePhotoTab = .ofUser

    private var photos: [Media] { store.photos(of: user) }

    private func title(for tab: ProfilePhotoTab) -> String {
        switch tab {
        case .ofUser: return user.isMe ? "Photos of you" : "Photos of \(user.firstName)"
        case .byUser: return user.isMe ? "Your photos" : "\(user.firstName)'s photos"
        case .albums: return "Albums"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                ForEach(ProfilePhotoTab.allCases) { item in
                    ChipView(title: title(for: item), isSelected: tab == item) {
                        withAnimation(.easeInOut(duration: 0.15)) { tab = item }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(FBColor.surface)

            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if photos.isEmpty {
            ContentUnavailableView(
                "No photos yet",
                systemImage: "photo.on.rectangle",
                description: Text("Photos will show up here.")
            )
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity)
            .background(FBColor.surface)
        } else if tab == .albums {
            albumsGrid
        } else {
            photoGrid(tab == .byUser ? Array(photos.reversed()) : photos)
        }
    }

    private func photoGrid(_ items: [Media]) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)
        return LazyVGrid(columns: columns, spacing: 2) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, media in
                Button {
                    onOpenPhotos(items, index)
                } label: {
                    RemoteImage(url: media.url, data: media.data)
                        .aspectRatio(1, contentMode: .fit)
                        .clipped()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Photo \(index + 1)")
            }
        }
        .padding(.top, 2)
        .background(FBColor.surface)
    }

    private struct Album: Identifiable {
        let id: String
        let name: String
        let items: [Media]
    }

    private var albums: [Album] {
        let all = photos
        guard !all.isEmpty else { return [] }
        var result: [Album] = []
        let third = max(1, all.count / 3)
        result.append(Album(id: "timeline", name: "Timeline photos", items: all))
        result.append(Album(id: "profile", name: "Profile pictures", items: Array(all.prefix(third))))
        result.append(Album(id: "mobile", name: "Mobile uploads", items: Array(all.suffix(max(1, all.count - third)))))
        result.append(Album(id: "cover", name: "Cover photos", items: Array(all.prefix(min(2, all.count)))))
        return result
    }

    private var albumsGrid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 2)
        return LazyVGrid(columns: columns, spacing: 16) {
            ForEach(albums) { album in
                Button {
                    onOpenPhotos(album.items, 0)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        RemoteImage(url: album.items.first?.url, data: album.items.first?.data)
                            .aspectRatio(1, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        Text(album.name)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text("\(album.items.count) items")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                .buttonStyle(.pressable)
            }
        }
        .padding(16)
        .background(FBColor.surface)
    }
}

/// The "Reels" (and Pages' "Videos") tab: a grid of 9:16 posters with play counts.
struct ProfileReelsSection: View {
    let user: User
    let videosOnly: Bool

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    private var items: [Post] {
        if videosOnly {
            return store.posts(by: user).filter { $0.isVideo }
        }
        return store.reels(by: user)
    }

    var body: some View {
        let list = items
        if list.isEmpty {
            ContentUnavailableView(
                videosOnly ? "No videos yet" : "No reels yet",
                systemImage: "play.rectangle",
                description: Text(videosOnly ? "Videos will show up here." : "Reels will show up here.")
            )
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity)
            .background(FBColor.surface)
        } else {
            grid(list)
        }
    }

    private func grid(_ list: [Post]) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)
        return LazyVGrid(columns: columns, spacing: 2) {
            ForEach(list) { post in
                Button {
                    router.openReels(startingAt: post)
                } label: {
                    poster(for: post)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Play reel, \(post.viewCount.fbCompact) plays")
            }
        }
        .padding(.top, 2)
        .background(FBColor.surface)
    }

    private func poster(for post: Post) -> some View {
        RemoteImage(url: post.media.first?.url, data: post.media.first?.data)
            .aspectRatio(9.0 / 16.0, contentMode: .fit)
            .clipped()
            .overlay(alignment: .bottomLeading) {
                HStack(spacing: 3) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11))
                    Text(post.viewCount.fbCompact)
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.5), radius: 2)
                .padding(8)
            }
    }
}
