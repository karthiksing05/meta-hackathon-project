import SwiftUI

/// One long-form video in the Video tab: header, caption, player, reaction summary and
/// the Like / Comment / Share bar.
struct VideoFeedCard: View {
    let post: Post
    let isCurrent: Bool
    let isPlaying: Bool
    let isLive: Bool
    let autoplayEnabled: Bool
    let tracker: VideoPlaybackTracker
    let onPlay: () -> Void
    let onOpenFullScreen: (Double) -> Void
    let onComment: () -> Void
    let onShare: () -> Void
    let onHide: () -> Void

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if !post.text.isEmpty {
                VideoCaptionText(text: post.text)
                    .padding(.horizontal, FBMetrics.gutter)
                    .padding(.bottom, 10)
            }
            if let media = post.media.first {
                VideoInlinePlayer(
                    post: post,
                    media: media,
                    isCurrent: isCurrent,
                    isPlaying: isPlaying,
                    isLive: isLive,
                    showsPlayButton: !autoplayEnabled && !isPlaying,
                    onPlay: onPlay,
                    onOpenFullScreen: onOpenFullScreen
                )
                .background {
                    VideoFrameReporter(id: post.id, tracker: tracker)
                }
            }
            statsRow
            HairlineDivider()
                .padding(.horizontal, FBMetrics.gutter)
            actionBar
        }
        .background(FBColor.surface)
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            Button {
                router.push(.profile(post.author))
            } label: {
                AvatarView(user: post.author, size: FBAvatarSize.post)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                nameLine
                metaLine
            }

            Spacer(minLength: 8)
            optionsMenu
        }
        .padding(.leading, FBMetrics.gutter)
        .padding(.trailing, 4)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var nameLine: some View {
        HStack(spacing: 4) {
            Button {
                router.push(.profile(post.author))
            } label: {
                NameWithBadge(user: post.author)
            }
            .buttonStyle(.plain)

            if showsFollowButton {
                Text("·")
                    .font(.fbName)
                    .foregroundStyle(FBColor.secondaryText)
                Button {
                    Haptics.light()
                    store.follow(post.author)
                } label: {
                    Text("Follow")
                        .font(.fbName)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Follow \(post.author.name)")
            }
        }
    }

    private var showsFollowButton: Bool {
        let author = post.author
        return !author.isMe && !author.isFriend && !author.isFollowing
    }

    private var metaLine: some View {
        HStack(spacing: 4) {
            if isLive {
                Text("Live now")
                    .fontWeight(.semibold)
                    .foregroundStyle(FBColor.liveRed)
            } else {
                Text(post.createdAt.fbShort)
            }
            Text("·")
            Image(systemName: post.audience.symbol)
                .font(.system(size: FBIconSize.xs))
                .accessibilityLabel(post.audience.title)
        }
        .font(.fbMeta)
        .foregroundStyle(FBColor.secondaryText)
    }

    private var saveTitle: String { post.isSaved ? "Unsave video" : "Save video" }
    private var saveSymbol: String { post.isSaved ? "bookmark.slash" : "bookmark" }

    private var optionsMenu: some View {
        Menu {
            Button {
                store.toggleSave(post)
            } label: {
                Label(saveTitle, systemImage: saveSymbol)
            }
            Button {
                onHide()
            } label: {
                Label("Hide video", systemImage: "eye.slash")
            }
            Button {
                VideoLinks.copy(post, store: store)
            } label: {
                Label("Copy link", systemImage: "link")
            }
            Divider()
            Button(role: .destructive) {
                store.showToast("Thanks for letting us know", symbol: "flag.fill")
            } label: {
                Label("Report video", systemImage: "flag")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: FBIconSize.regular, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("More options for this video")
    }

    // MARK: Stats

    private var hasStats: Bool {
        post.totalReactions > 0 || post.totalComments > 0 || post.shareCount > 0 || post.viewCount > 0
    }

    @ViewBuilder
    private var statsRow: some View {
        if hasStats {
            HStack(spacing: 6) {
                if post.totalReactions > 0 {
                    ReactionBadgeStack(types: post.topReactions)
                    Text(post.reactionSummary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(countsText)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
            .font(.fbMeta)
            .foregroundStyle(FBColor.secondaryText)
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 10)
        } else {
            Color.clear.frame(height: 8)
        }
    }

    /// "54 comments · 12 shares · 3.4K views".
    private var countsText: String {
        var parts: [String] = []
        let comments = post.totalComments
        if comments > 0 {
            parts.append("\(comments.fbCompact) \(comments == 1 ? "comment" : "comments")")
        }
        let shares = post.shareCount
        if shares > 0 {
            parts.append("\(shares.fbCompact) \(shares == 1 ? "share" : "shares")")
        }
        if post.viewCount > 0 {
            parts.append("\(post.viewCount.fbCompact) views")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: Actions

    private var actionBar: some View {
        HStack(spacing: 0) {
            likeButton
            VideoActionButton(symbol: "bubble.right", title: "Comment", action: onComment)
            VideoActionButton(symbol: "arrowshape.turn.up.right", title: "Share", action: onShare)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    private var likeButton: some View {
        Button {
            Haptics.light()
            store.toggleLike(post)
        } label: {
            likeLabel
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu { reactionMenu }
        .accessibilityLabel(post.myReaction?.title ?? "Like")
        .accessibilityHint("Touch and hold to choose a reaction")
    }

    @ViewBuilder
    private var likeLabel: some View {
        if let reaction = post.myReaction {
            HStack(spacing: 6) {
                if reaction == .like {
                    Image(systemName: "hand.thumbsup.fill")
                        .font(.system(size: FBIconSize.regular, weight: .semibold))
                } else {
                    Text(reaction.emoji)
                        .font(.system(size: FBIconSize.regular))
                }
                Text(reaction.title)
                    .font(.fbButton)
            }
            .foregroundStyle(reaction.color)
        } else {
            HStack(spacing: 6) {
                Image(systemName: "hand.thumbsup")
                    .font(.system(size: FBIconSize.regular))
                Text("Like")
                    .font(.fbButton)
            }
            .foregroundStyle(FBColor.secondaryText)
        }
    }

    @ViewBuilder
    private var reactionMenu: some View {
        ForEach(ReactionType.allCases) { reaction in
            Button {
                Haptics.light()
                store.setReaction(reaction, on: post)
            } label: {
                Text("\(reaction.emoji)  \(reaction.title)")
            }
        }
        if post.myReaction != nil {
            Divider()
            Button(role: .destructive) {
                store.setReaction(nil, on: post)
            } label: {
                Label("Remove reaction", systemImage: "xmark.circle")
            }
        }
    }
}

// MARK: - Pieces

private struct VideoActionButton: View {
    let symbol: String
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.regular))
                Text(title)
                    .font(.fbButton)
            }
            .foregroundStyle(FBColor.secondaryText)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

/// Post text, collapsed to a short preview with "See more".
private struct VideoCaptionText: View {
    let text: String

    @State private var isExpanded = false
    private let collapsedLimit = 110

    private var isLong: Bool {
        text.count > collapsedLimit || text.filter { $0 == "\n" }.count > 1
    }

    var body: some View {
        Group {
            if isExpanded || !isLong {
                Text(text)
            } else {
                collapsedText
            }
        }
        .font(.fbBody)
        .foregroundStyle(FBColor.primaryText)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture {
            guard isLong else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                isExpanded.toggle()
            }
        }
    }

    private var collapsedText: Text {
        let preview: Text = Text(collapsedPrefix)
        let more: Text = Text("See more")
            .fontWeight(.semibold)
            .foregroundStyle(FBColor.secondaryText)
        return preview + Text("… ") + more
    }

    private var collapsedPrefix: String {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let firstLines = lines.prefix(2).joined(separator: "\n")
        let clipped = String(firstLines.prefix(collapsedLimit))
        return clipped.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
