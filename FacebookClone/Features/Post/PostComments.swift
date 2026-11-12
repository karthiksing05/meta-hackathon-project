import Observation
import SwiftUI

// MARK: - Sorting

enum PostCommentSort: String, CaseIterable, Identifiable {
    case relevant
    case newest
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .relevant: return "Most relevant"
        case .newest: return "Newest"
        case .all: return "All comments"
        }
    }

    /// Others' comments ranked by engagement (yours last), newest first, or oldest first.
    func sorted(_ comments: [Comment]) -> [Comment] {
        switch self {
        case .relevant:
            let ranked = comments.enumerated()
                .filter { !$0.element.author.isMe }
                .sorted { lhs, rhs in
                    let left = Self.score(lhs.element)
                    let right = Self.score(rhs.element)
                    if left != right {
                        return left > right
                    }
                    return lhs.offset < rhs.offset
                }
                .map { $0.element }
            return ranked + comments.filter { $0.author.isMe }
        case .newest:
            return comments.sorted { $0.createdAt > $1.createdAt }
        case .all:
            return comments.sorted { $0.createdAt < $1.createdAt }
        }
    }

    private static func score(_ comment: Comment) -> Int {
        comment.reactionCounts.values.reduce(0, +) + comment.replies.count * 2
    }
}

// MARK: - Shared state

/// State shared by a comments list and its composer (CommentsView and PostDetailView).
@Observable
final class PostCommentsModel {
    var sort: PostCommentSort = .relevant
    var draft = ""
    /// The top-level comment a reply goes under.
    var replyParent: Comment?
    /// Who is being answered: "Replying to Maria Lopez".
    var replyName: String?
    var editing: Comment?
    var expandedThreads: Set<String> = []
    /// Bump to focus the composer.
    var focusRequest = 0
    var pendingDelete: Comment?
    var isLoadingMore = false
    /// The comment whose reaction picker is open.
    var pickerCommentID: String?
    /// Display order, fixed when the sort changes so live updates don't reshuffle the list.
    private(set) var order: [String] = []

    func resort(_ comments: [Comment]) {
        order = sort.sorted(comments).map { $0.id }
    }

    /// Comments in display order. New ones go at the end (at the top for Newest).
    func ordered(_ comments: [Comment]) -> [Comment] {
        var lookup: [String: Comment] = [:]
        for comment in comments {
            lookup[comment.id] = comment
        }
        let known = Set(order)
        let fresh = comments.filter { !known.contains($0.id) }
        let existing = order.compactMap { lookup[$0] }
        if sort == .newest {
            return Array(fresh.reversed()) + existing
        }
        return existing + fresh
    }

    func startReply(to comment: Comment, in parent: Comment) {
        if editing != nil {
            draft = ""
        }
        editing = nil
        replyParent = parent
        replyName = comment.author.isMe ? "yourself" : comment.author.name
        expandedThreads.insert(parent.id)
        focusRequest += 1
    }

    func startEdit(_ comment: Comment) {
        replyParent = nil
        replyName = nil
        editing = comment
        draft = comment.text
        focusRequest += 1
    }

    /// Leaves reply or edit mode. Leaving edit mode also clears the draft.
    func cancelContext() {
        if editing != nil {
            draft = ""
        }
        editing = nil
        replyParent = nil
        replyName = nil
    }
}

// MARK: - Header

/// The reaction summary (opens the reactions list) and the "Most relevant ▾" sort menu.
struct PostCommentsHeader: View {
    let post: Post
    let model: PostCommentsModel
    var showsReactions: Bool = true
    var onReactions: () -> Void = {}

    @AppStorage(SettingsKey.showReactionCounts) private var showReactionCounts = true

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showsReactions && post.totalReactions > 0 {
                reactionsButton
            }
            sortMenu
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var reactionsButton: some View {
        Button(action: onReactions) {
            HStack(spacing: 6) {
                ReactionBadgeStack(types: post.topReactions, size: 20)
                if showReactionCounts {
                    Text(post.reactionSummary)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Shows who reacted")
    }

    private var sortMenu: some View {
        Menu {
            ForEach(PostCommentSort.allCases) { sort in
                Button {
                    Haptics.selection()
                    model.sort = sort
                } label: {
                    if model.sort == sort {
                        Label(sort.title, systemImage: "checkmark")
                    } else {
                        Text(sort.title)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(model.sort.title)
                    .font(.fbName)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(FBColor.primaryText)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Sort comments, \(model.sort.title)")
    }
}

// MARK: - List

/// Threaded comments with "View previous comments", live updates and delete confirmation.
struct PostCommentsList: View {
    let post: Post
    let model: PostCommentsModel

    @Environment(AppStore.self) private var store

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            if post.hiddenCommentCount > 0 {
                previousButton
            }
            if post.comments.isEmpty && post.hiddenCommentCount == 0 {
                emptyState
            }
            ForEach(model.ordered(post.comments)) { comment in
                PostCommentThread(comment: comment, post: post, model: model)
                    .id(comment.id)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.vertical, 12)
        .animation(.easeOut(duration: 0.25), value: post.comments.count)
        .onAppear {
            model.resort(post.comments)
        }
        .onChange(of: model.sort) {
            model.resort(post.comments)
        }
        .confirmationDialog(
            "Delete comment?",
            isPresented: deleteBinding,
            titleVisibility: .visible,
            presenting: model.pendingDelete
        ) { comment in
            Button("Delete", role: .destructive) {
                delete(comment)
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("Are you sure you want to delete this comment?")
        }
    }

    private var previousButton: some View {
        Button(action: loadPrevious) {
            HStack(spacing: 8) {
                Text("View previous comments")
                    .font(.fbName)
                    .foregroundStyle(FBColor.secondaryText)
                if model.isLoadingMore {
                    ProgressView()
                        .controlSize(.small)
                }
                Spacer(minLength: 8)
                Text("\(post.comments.count) of \(post.comments.count + post.hiddenCommentCount)")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.tertiaryText)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.isLoadingMore)
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "No comments yet",
            systemImage: "bubble.left.and.bubble.right",
            description: Text("Be the first to comment.")
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private var deleteBinding: Binding<Bool> {
        Binding(
            get: { model.pendingDelete != nil },
            set: { isPresented in
                if !isPresented {
                    model.pendingDelete = nil
                }
            }
        )
    }

    private func loadPrevious() {
        guard !model.isLoadingMore else { return }
        model.isLoadingMore = true
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            withAnimation(.easeOut(duration: 0.25)) {
                store.loadMoreComments(for: post)
            }
            model.resort(post.comments)
            model.isLoadingMore = false
        }
    }

    private func delete(_ comment: Comment) {
        if model.editing?.id == comment.id {
            model.cancelContext()
        }
        withAnimation(.easeOut(duration: 0.2)) {
            store.deleteComment(comment, from: post)
        }
        Haptics.light()
    }
}

// MARK: - Thread

/// A top-level comment and its replies. Long threads collapse behind "View N replies".
struct PostCommentThread: View {
    let comment: Comment
    let post: Post
    let model: PostCommentsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PostCommentRow(comment: comment, parent: comment, post: post, model: model)
            replies
        }
    }

    @ViewBuilder
    private var replies: some View {
        let all = comment.replies
        if all.count > 2 && !model.expandedThreads.contains(comment.id) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    _ = model.expandedThreads.insert(comment.id)
                }
            } label: {
                HStack(spacing: 6) {
                    if let first = all.first {
                        AvatarView(user: first.author, size: 20)
                    }
                    Text("View \(all.count) replies")
                        .font(.fbName)
                        .foregroundStyle(FBColor.secondaryText)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 40)
        } else {
            ForEach(all) { reply in
                PostCommentRow(comment: reply, parent: comment, post: post, model: model, avatarSize: 24)
                    .padding(.leading, 40)
                    .id(reply.id)
            }
        }
    }
}
