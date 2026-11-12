import SwiftUI
import PhotosUI

enum ProfileSection: String, CaseIterable, Identifiable {
    case posts = "Posts"
    case about = "About"
    case photos = "Photos"
    case reels = "Reels"
    case videos = "Videos"

    var id: String { rawValue }
}

struct ProfilePhotoRequest: Identifiable {
    let id = UUID()
    let media: [Media]
    let startIndex: Int
}

private struct ProfileNameOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 1000
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

/// A person's or Page's profile (pushed).
struct ProfileView: View {
    let user: User

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var section: ProfileSection = .posts
    @State private var photoRequest: ProfilePhotoRequest?
    @State private var storyToShow: Story?
    @State private var avatarItem: PhotosPickerItem?
    @State private var coverItem: PhotosPickerItem?
    @State private var showsNavTitle = false

    private let coverHeight: CGFloat = 220
    private let avatarOuter: CGFloat = 168

    private var sections: [ProfileSection] {
        user.isPage
            ? [.posts, .about, .photos, .reels, .videos]
            : [.posts, .about, .photos, .reels]
    }

    private var story: Story? { store.story(for: user) }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                headerBlock
                sectionChips
                ProfileGap()
                sectionContent
            }
        }
        .coordinateSpace(name: "profileScroll")
        .background(FBColor.background)
        .navigationTitle(showsNavTitle ? user.name : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    router.push(.search(""))
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .accessibilityLabel("Search")
            }
        }
        .onPreferenceChange(ProfileNameOffsetKey.self) { value in
            let shouldShow = value < 0
            if shouldShow != showsNavTitle {
                showsNavTitle = shouldShow
            }
        }
        .fullScreenCover(item: $photoRequest) { request in
            PhotoViewer(media: request.media, startIndex: request.startIndex)
        }
        .fullScreenCover(item: $storyToShow) { story in
            StoryViewer(stories: [story], startIndex: 0)
        }
        .onChange(of: avatarItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    store.updateProfilePicture(data)
                }
                avatarItem = nil
            }
        }
        .onChange(of: coverItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    store.updateCoverPhoto(data)
                }
                coverItem = nil
            }
        }
    }

    // MARK: Header

    private var headerBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            coverAndAvatar
            VStack(alignment: .leading, spacing: 10) {
                nameRow
                infoLine
                if !user.bio.isEmpty {
                    Text(user.bio)
                        .font(.fbBodyLarge)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ProfileActionButtons(user: user)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
        .background(FBColor.surface)
    }

    private var coverAndAvatar: some View {
        ZStack(alignment: .bottomLeading) {
            coverImage
            avatarView
                .offset(y: avatarOuter / 2)
                .padding(.leading, 12)
        }
        .padding(.bottom, avatarOuter / 2)
    }

    private var coverImage: some View {
        Button {
            photoRequest = ProfilePhotoRequest(
                media: [Media(url: user.coverURL, data: user.coverData, aspectRatio: 16.0 / 9.0)],
                startIndex: 0
            )
        } label: {
            RemoteImage(url: user.coverURL, data: user.coverData)
                .frame(maxWidth: .infinity)
                .frame(height: coverHeight)
                .clipped()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Cover photo")
        .overlay(alignment: .bottomTrailing) {
            if user.isMe {
                PhotosPicker(selection: $coverItem, matching: .images) {
                    ProfileCameraBadge(size: 36)
                }
                .padding(12)
                .accessibilityLabel("Edit cover photo")
            }
        }
    }

    private var avatarView: some View {
        ZStack(alignment: .bottomTrailing) {
            Button {
                if let story {
                    storyToShow = story
                } else {
                    photoRequest = ProfilePhotoRequest(
                        media: [Media(url: user.avatarURL, data: user.avatarData)],
                        startIndex: 0
                    )
                }
            } label: {
                avatarCircle
            }
            .buttonStyle(.plain)
            .accessibilityLabel(story == nil ? "Profile picture" : "View story")

            if user.isMe {
                PhotosPicker(selection: $avatarItem, matching: .images) {
                    ProfileCameraBadge(size: 40)
                }
                .padding(6)
                .accessibilityLabel("Edit profile picture")
            }
        }
    }

    private var avatarCircle: some View {
        let hasStory = story != nil
        let seen = story?.isSeen ?? false
        let ring: AvatarRing = hasStory ? .story(seen: seen) : .none
        let inner: CGFloat = hasStory ? 142 : 160
        return AvatarView(user: user, size: inner, ring: ring)
            .padding(4)
            .background(FBColor.surface, in: Circle())
    }

    private var nameRow: some View {
        HStack(spacing: 6) {
            Text(user.name)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            if user.isVerified {
                VerifiedBadge(size: 20)
            }
        }
        .background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: ProfileNameOffsetKey.self,
                    value: proxy.frame(in: .named("profileScroll")).maxY
                )
            }
        }
    }

    private var infoLine: some View {
        VStack(alignment: .leading, spacing: 6) {
            if user.isPage {
                Text("\(user.followerCount.withCommas) followers")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                if let category = user.category, !category.isEmpty {
                    Text(category)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                }
            } else {
                HStack(spacing: 8) {
                    Button {
                        router.push(.friendsList(user))
                    } label: {
                        Text("\(friendCountText) friends")
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    .buttonStyle(.plain)
                    AvatarStack(users: store.friends(of: user), size: 24, maxCount: 5)
                }
            }
        }
    }

    private var friendCountText: String {
        let count = user.isMe ? store.friends.count : user.friendCount
        return count.withCommas
    }

    // MARK: Sections

    private var sectionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(sections) { item in
                    ChipView(title: item.rawValue, isSelected: section == item) {
                        Haptics.selection()
                        withAnimation(.easeInOut(duration: 0.15)) {
                            section = item
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(FBColor.surface)
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch section {
        case .posts:
            ProfilePostsSection(user: user, onSeeAbout: { section = .about }, onOpenPhotos: openPhotos)
        case .about:
            ProfileAboutSection(user: user)
        case .photos:
            ProfilePhotosSection(user: user, onOpenPhotos: openPhotos)
        case .reels:
            ProfileReelsSection(user: user, videosOnly: false)
        case .videos:
            ProfileReelsSection(user: user, videosOnly: true)
        }
    }

    private func openPhotos(_ media: [Media], _ index: Int) {
        guard !media.isEmpty else { return }
        photoRequest = ProfilePhotoRequest(media: media, startIndex: min(max(index, 0), media.count - 1))
    }
}

/// An 8 pt gray gap between profile cards.
struct ProfileGap: View {
    var body: some View {
        Rectangle()
            .fill(FBColor.background)
            .frame(height: 8)
    }
}

struct ProfileCameraBadge: View {
    var size: CGFloat = 36

    var body: some View {
        Circle()
            .fill(FBColor.buttonGray)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: "camera.fill")
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
            }
            .overlay {
                Circle().stroke(FBColor.surface, lineWidth: 2)
            }
    }
}

#Preview {
    NavigationStack {
        ProfileView(user: AppStore().me)
    }
    .previewEnvironment()
}
