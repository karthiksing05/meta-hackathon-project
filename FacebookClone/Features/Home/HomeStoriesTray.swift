import SwiftUI

/// The horizontal stories row under the composer: "Create story", your story, then friends'.
struct HomeStoriesTray: View {
    /// Called with the stories to page through and the one to start at.
    var onOpenStory: ([Story], Int) -> Void

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 8) {
                HomeCreateStoryCard(me: store.me) {
                    Haptics.light()
                    router.openCreateStory()
                }
                if store.isFeedLoading {
                    ForEach(0..<4, id: \.self) { _ in
                        HomeStorySkeletonCard()
                    }
                } else {
                    storyCards
                }
            }
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 10)
        }
        .frame(height: HomeTrayMetrics.cardSize.height + 20)
        .background(FBColor.surface)
    }

    @ViewBuilder
    private var storyCards: some View {
        let tray = store.storiesForTray
        if let mine = store.myStory, !mine.items.isEmpty {
            HomeStoryCard(story: mine, title: "Your story") {
                onOpenStory([mine] + tray, 0)
            }
        }
        ForEach(Array(tray.enumerated()), id: \.element.id) { index, story in
            HomeStoryCard(story: story, title: story.author.name) {
                onOpenStory(tray, index)
            }
        }
    }
}

// MARK: - Cards

private enum HomeTrayMetrics {
    static let cardSize = CGSize(width: 112, height: 200)
}

/// Your profile photo on top, a white strip with a blue "+" and "Create story" below.
private struct HomeCreateStoryCard: View {
    let me: User
    let action: () -> Void

    private let size = HomeTrayMetrics.cardSize
    private let photoHeight: CGFloat = 140
    private let plusSize: CGFloat = 34

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                photo
                    .frame(width: size.width, height: photoHeight)
                    .clipped()
                ZStack(alignment: .bottom) {
                    FBColor.surface
                    Text("Create story")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                        .padding(.bottom, 12)
                }
                .frame(width: size.width, height: size.height - photoHeight)
            }
            .overlay(alignment: .top) {
                plusBadge
                    .offset(y: photoHeight - plusSize / 2)
            }
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                    .stroke(FBColor.divider, lineWidth: 0.5)
            }
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Create story")
    }

    private var photo: some View {
        ZStack {
            AvatarView.color(for: me.id)
            Text(me.initials)
                .font(.system(size: 40, weight: .semibold)) // Display text
                .foregroundStyle(.white)
            RemoteImage(url: me.avatarURL, data: me.avatarData, placeholder: .clear)
        }
    }

    private var plusBadge: some View {
        Image(systemName: "plus")
            .font(.system(size: FBIconSize.regular, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: plusSize, height: plusSize)
            .background(FBColor.brandBlue, in: Circle())
            .overlay {
                Circle().stroke(FBColor.surface, lineWidth: 3)
            }
    }
}

/// A friend's (or your) story: preview, avatar with ring, name at the bottom.
private struct HomeStoryCard: View {
    let story: Story
    let title: String
    let action: () -> Void

    private let size = HomeTrayMetrics.cardSize

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topLeading) {
                preview
                    .frame(width: size.width, height: size.height)
                LinearGradient(
                    colors: [Color.black.opacity(0.3), Color.clear, Color.clear, Color.black.opacity(0.65)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                AvatarView(user: story.author, size: FBAvatarSize.story, ring: .story(seen: story.isSeen))
                    .padding(8)
                Text(title)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .shadow(color: Color.black.opacity(0.45), radius: 2, y: 1)
                    .padding(8)
                    .frame(width: size.width, height: size.height, alignment: .bottomLeading)
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        story.author.isMe ? "Your story" : "\(story.author.name)'s story"
    }

    @ViewBuilder
    private var preview: some View {
        if let item = story.previewItem {
            HomeStoryContentView(content: item.content, textSize: 15)
        } else {
            Rectangle().fill(FBColor.skeleton)
        }
    }
}

private struct HomeStorySkeletonCard: View {
    var body: some View {
        RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
            .fill(FBColor.skeleton)
            .frame(width: HomeTrayMetrics.cardSize.width, height: HomeTrayMetrics.cardSize.height)
            .overlay(alignment: .topLeading) {
                Circle()
                    .fill(FBColor.surface.opacity(0.7))
                    .frame(width: 36, height: 36)
                    .padding(8)
            }
            .overlay(alignment: .bottomLeading) {
                Capsule()
                    .fill(FBColor.surface.opacity(0.7))
                    .frame(width: 64, height: 10)
                    .padding(10)
            }
            .shimmering()
            .accessibilityLabel("Loading")
    }
}

// MARK: - Story content (shared with the viewer and the creator)

/// Draws one story item: a photo, a picked photo or text on a gradient. Fills its frame.
struct HomeStoryContentView: View {
    let content: StoryContent
    var textSize: CGFloat = 30
    /// Picked photos are shown whole over a blurred copy instead of cropped.
    var fitsLocalPhotos: Bool = false

    var body: some View {
        switch content {
        case .photo(let url):
            RemoteImage(url: url, contentMode: .fill)
        case .localPhoto(let data):
            if fitsLocalPhotos {
                ZStack {
                    Color.black
                    RemoteImage(url: nil, data: data, contentMode: .fill, placeholder: .clear)
                        .blur(radius: 28)
                        .opacity(0.7)
                    RemoteImage(url: nil, data: data, contentMode: .fit, placeholder: .clear)
                }
                .clipped()
            } else {
                RemoteImage(url: nil, data: data, contentMode: .fill)
            }
        case .text(let text, let backgroundIndex):
            HomeTextStoryCanvas(text: text, backgroundIndex: backgroundIndex, fontSize: textSize)
        }
    }
}

/// Big centered text on one of the `PostBackground` gradients.
struct HomeTextStoryCanvas: View {
    let text: String
    let backgroundIndex: Int
    var fontSize: CGFloat = 30

    var body: some View {
        let palette = PostBackground.preset(backgroundIndex)
        ZStack {
            palette.gradient
            Text(text)
                .font(.system(size: fontSize, weight: .bold))
                .foregroundStyle(palette.textColor)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.4)
                .padding(fontSize * 0.6)
        }
    }
}
