import SwiftUI

/// How much of a post `PostCard` shows.
enum PostCardStyle {
    /// Feed: long text collapses behind "See more" and comments open in a sheet.
    case feed
    /// The pushed post screen: full text, no comment preview.
    case detail
}

/// The sheets a post card can show. One `.sheet(item:)` drives them all.
enum PostCardSheet: Identifiable {
    case comments(focus: Bool)
    case share
    case reactions
    case options
    case audience

    var id: String {
        switch self {
        case .comments(let focus): return focus ? "comments.focus" : "comments"
        case .share: return "share"
        case .reactions: return "reactions"
        case .options: return "options"
        case .audience: return "audience"
        }
    }
}

/// Opens the photo viewer at `index`.
struct PostViewerRequest: Identifiable {
    let id = UUID()
    let index: Int
}

/// One feed post, full width, no outer separator. Callers put `FeedSeparator()` between cards.
struct PostCard: View {
    let post: Post
    var style: PostCardStyle = .feed
    /// Screens with their own composer (post detail) pass this instead of opening the comments sheet.
    var onCommentTap: (() -> Void)? = nil

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.postPush) private var postPush
    @Environment(\.dismiss) private var dismiss

    @State private var activeSheet: PostCardSheet?
    @State private var pendingOption: PostOption?
    @State private var viewerRequest: PostViewerRequest?
    @State private var isPickerOpen = false
    @State private var confirmDelete = false
    @State private var confirmReport = false

    var body: some View {
        Group {
            if post.isHidden && !post.author.isMe {
                PostHiddenView(post: post)
                    .transition(.opacity)
            } else {
                card
                    .transition(.opacity)
            }
        }
        // Keeps the floating reaction picker above neighbouring cards.
        .zIndex(isPickerOpen ? 10 : 0)
    }

    // MARK: Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if post.isUploading {
                PostUploadBar(post: post)
            }
            PostHeaderView(
                post: post,
                showsHide: style == .feed && !post.author.isMe,
                onOptions: { activeSheet = .options },
                onHide: { hidePost() }
            )
            content
            PostCountsRow(
                post: post,
                onReactions: { activeSheet = .reactions },
                onComments: { openComments(focus: false) }
            )
            HairlineDivider()
                .padding(.horizontal, FBMetrics.gutter)
            PostActionBar(
                post: post,
                isPickerOpen: $isPickerOpen,
                onComment: { openComments(focus: true) },
                onShare: { activeSheet = .share }
            )
            if style == .feed {
                PostCommentPreview(post: post) {
                    openComments(focus: false)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .environment(\.openURL, OpenURLAction { url in
            guard let route = store.postRoute(for: url, in: post) else { return .systemAction }
            navigate(route)
            return .handled
        })
        .sheet(item: $activeSheet, onDismiss: runPendingOption) { sheet in
            sheetContent(sheet)
        }
        .fullScreenCover(item: $viewerRequest) { request in
            PhotoViewer(media: post.media, startIndex: request.index, post: post)
        }
        .confirmationDialog("Delete post?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: deletePost)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to delete this post? If you only need to change something, you can edit it instead.")
        }
        .confirmationDialog("Report post?", isPresented: $confirmReport, titleVisibility: .visible) {
            Button("Report post", role: .destructive) {
                withAnimation(.easeInOut(duration: 0.25)) {
                    store.report(post)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("We won't let \(post.author.firstName) know who reported this.")
        }
    }

    @ViewBuilder
    private var content: some View {
        if post.showsBackground {
            PostBackgroundText(text: post.text, backgroundIndex: post.backgroundIndex ?? 0)
        } else {
            if !post.text.isEmpty {
                PostTextView(
                    text: post.text,
                    startsExpanded: style == .detail,
                    font: isShortTextOnly ? Font.title3 : Font.fbBody
                )
                .padding(.horizontal, FBMetrics.gutter)
                .padding(.bottom, hasAttachments ? 10 : 6)
            }
            attachments
        }
    }

    @ViewBuilder
    private var attachments: some View {
        if !post.media.isEmpty {
            PostMediaGrid(post: post, media: post.media, isSuspended: isMediaSuspended) { index in
                viewerRequest = PostViewerRequest(index: index)
            }
        }
        if let lifeEvent = post.lifeEvent {
            PostLifeEventView(event: lifeEvent)
        }
        if post.isSponsored {
            PostSponsoredStrip(post: post)
        } else if let link = post.link {
            PostLinkPreviewCard(link: link)
        }
        if let poll = post.poll {
            PostPollView(post: post, poll: poll)
        }
        if let bubbleID = post.bubbleID {
            BubblePostAttachment(post: post, bubbleID: bubbleID)
        }
        if let shared = post.sharedPost {
            PostSharedPostView(post: shared)
                .padding(.horizontal, FBMetrics.gutter)
                .padding(.bottom, 4)
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: PostCardSheet) -> some View {
        switch sheet {
        case .comments(let focus):
            CommentsView(post: post, autoFocus: focus)
        case .share:
            ShareSheetView(post: post)
        case .reactions:
            ReactionsListView(post: post)
        case .options:
            PostOptionsSheet(post: post) { option in
                pendingOption = option
                activeSheet = nil
            }
        case .audience:
            PostAudiencePicker(selection: post.audience) { audience in
                store.updatePost(post, text: post.text, audience: audience)
            }
        }
    }

    // MARK: State

    private var hasAttachments: Bool {
        !post.media.isEmpty || post.link != nil || post.sharedPost != nil || post.poll != nil || post.lifeEvent != nil || post.bubbleID != nil
    }

    /// Short text-only posts use a larger font, like the real feed.
    private var isShortTextOnly: Bool {
        post.text.count <= 85 && !hasAttachments && !post.text.contains("\n")
    }

    /// Videos pause while one of this card's sheets or the photo viewer is up.
    private var isMediaSuspended: Bool {
        activeSheet != nil || viewerRequest != nil
    }

    // MARK: Actions

    private func openComments(focus: Bool) {
        if let onCommentTap {
            onCommentTap()
        } else {
            activeSheet = .comments(focus: focus)
        }
    }

    private func navigate(_ route: Route) {
        if let postPush {
            postPush(route)
        } else {
            router.push(route)
        }
    }

    private func hidePost() {
        Haptics.light()
        withAnimation(.easeInOut(duration: 0.25)) {
            store.hide(post)
        }
    }

    private func deletePost() {
        withAnimation(.easeInOut(duration: 0.25)) {
            store.delete(post)
        }
        if style == .detail {
            dismiss()
        }
    }

    /// Options run after their sheet is fully dismissed, so they can route or present.
    private func runPendingOption() {
        guard let option = pendingOption else { return }
        pendingOption = nil
        switch option {
        case .save:
            store.toggleSave(post)
        case .notifications:
            store.toggleNotifications(for: post)
        case .favorite:
            store.toggleFavorite(post.author)
        case .hide:
            hidePost()
        case .snooze:
            store.snooze(post.author)
        case .unfollow:
            store.unfollow(post.author)
        case .copyLink:
            store.postCopyLink(post)
        case .report:
            confirmReport = true
        case .edit:
            router.composePost(CreatePostRequest(editingPost: post))
        case .editAudience:
            activeSheet = .audience
        case .delete:
            confirmDelete = true
        case .whyAd:
            store.showToast("\(post.author.name) wants to reach people like you, based on your activity on Facebook", symbol: "info.circle")
        case .whyPost:
            store.showToast(post.postWhyShownReason, symbol: "info.circle")
        }
    }
}

extension Post {
    /// The answer to "Why am I seeing this post?", most specific reason first.
    var postWhyShownReason: String {
        if let group {
            return "You're seeing this because you're a member of \(group.name)"
        }
        if author.isFavorite {
            return "You're seeing this because \(author.name) is in your Favorites"
        }
        if author.isPage {
            return "You're seeing this because you follow \(author.name)"
        }
        if author.isFriend {
            return "You're seeing this because you're friends with \(author.name)"
        }
        return "You're seeing this because it's popular with people like you"
    }
}

#Preview {
    NavigationStack {
        PostCardPreviewFeed()
            .appDestinations()
    }
    .previewEnvironment()
}

private struct PostCardPreviewFeed: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(store.feedPosts.prefix(8)) { post in
                    PostCard(post: post)
                    FeedSeparator()
                }
            }
        }
        .background(FBColor.background)
    }
}
