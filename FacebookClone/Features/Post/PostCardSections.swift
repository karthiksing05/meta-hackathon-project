import SwiftUI

// MARK: - Upload state

/// "Posting..." with a thin blue progress bar while a new post uploads.
struct PostUploadBar: View {
    let post: Post

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Posting...")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            Capsule()
                .fill(FBColor.buttonGray)
                .frame(height: 3)
                .overlay(alignment: .leading) {
                    GeometryReader { proxy in
                        Capsule()
                            .fill(FBColor.brandBlue)
                            .frame(width: proxy.size.width * progress)
                    }
                }
                .animation(.linear(duration: 0.12), value: post.uploadProgress)
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.top, 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Posting, \(Int(progress * 100)) percent")
    }

    private var progress: CGFloat {
        CGFloat(min(max(post.uploadProgress, 0), 1))
    }
}

// MARK: - Hidden state

/// Stands in for a hidden post: Undo, plus Snooze and Hide all follow-ups.
struct PostHiddenView: View {
    let post: Post

    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "eye.slash")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hidden")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("You'll see fewer posts like this.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 8)
                Button("Undo") {
                    Haptics.light()
                    withAnimation(.easeInOut(duration: 0.25)) {
                        store.unhide(post)
                    }
                }
                .buttonStyle(.fb(.secondary, expand: false, height: 32))
            }
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 12)

            HairlineDivider(leadingInset: 52)
            row(
                symbol: "clock",
                title: "Snooze \(post.author.firstName) for 30 days",
                subtitle: "Temporarily stop seeing posts."
            ) {
                store.snooze(post.author)
            }
            HairlineDivider(leadingInset: 52)
            row(
                symbol: "person.badge.minus",
                title: "Hide all from \(post.author.name)",
                subtitle: post.author.isPage ? "Stop seeing posts from this Page." : "Stop seeing posts but stay friends."
            ) {
                store.unfollow(post.author)
            }
        }
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private func row(symbol: String, title: String, subtitle: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            withAnimation(.easeInOut(duration: 0.25)) {
                action()
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.regular))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Counts row

/// Reaction icons and summary on the left; comment, share and view counts on the right.
struct PostCountsRow: View {
    let post: Post
    var onReactions: () -> Void
    var onComments: () -> Void

    @AppStorage(SettingsKey.showReactionCounts) private var showReactionCounts = true

    var body: some View {
        if isVisible {
            HStack(spacing: 8) {
                if post.totalReactions > 0 {
                    reactionsButton
                }
                Spacer(minLength: 8)
                trailingCounts
                    .layoutPriority(1)
            }
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 10)
            .animation(.easeOut(duration: 0.2), value: post.totalReactions)
        }
    }

    private var isVisible: Bool {
        post.totalReactions > 0 || post.totalComments > 0 || post.shareCount > 0 || viewCount > 0
    }

    private var viewCount: Int {
        post.isVideo ? post.viewCount : 0
    }

    private var reactionsButton: some View {
        Button(action: onReactions) {
            HStack(spacing: 6) {
                ReactionBadgeStack(types: post.topReactions)
                if showReactionCounts {
                    Text(post.reactionSummary)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                        .contentTransition(.numericText())
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(showReactionCounts ? post.reactionSummary : "Reactions")
        .accessibilityHint("Shows who reacted")
    }

    private var trailingCounts: some View {
        HStack(spacing: 4) {
            if post.totalComments > 0 {
                Button(action: onComments) {
                    Text(countText(post.totalComments, noun: "comment"))
                        .contentTransition(.numericText())
                }
                .buttonStyle(.plain)
            }
            if post.shareCount > 0 {
                if post.totalComments > 0 {
                    Text("·")
                }
                Text(countText(post.shareCount, noun: "share"))
            }
            if viewCount > 0 {
                if post.totalComments > 0 || post.shareCount > 0 {
                    Text("·")
                }
                Text(countText(viewCount, noun: "view"))
            }
        }
        .font(.fbMeta)
        .foregroundStyle(FBColor.secondaryText)
        .lineLimit(1)
    }

    private func countText(_ count: Int, noun: String) -> String {
        "\(count.fbCompact) \(noun)\(count == 1 ? "" : "s")"
    }
}

// MARK: - Comment preview

/// A single comment under the action bar, with "View N more comments" above it.
struct PostCommentPreview: View {
    let post: Post
    var onOpen: () -> Void

    var body: some View {
        if let comment = featuredComment {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 8) {
                    if remainingCount > 0 {
                        Text(moreText)
                            .font(.fbName)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    HStack(alignment: .top, spacing: 8) {
                        AvatarView(user: comment.author, size: FBAvatarSize.reply)
                        bubble(for: comment)
                        Spacer(minLength: 24)
                    }
                }
                .padding(.horizontal, FBMetrics.gutter)
                .padding(.top, 2)
                .padding(.bottom, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens comments")
        }
    }

    private func bubble(for comment: Comment) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(comment.author.name)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.primaryText)
            Text(comment.text.isEmpty ? "Sent a photo" : comment.text)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
    }

    /// The most-reacted comment, like "Most relevant".
    private var featuredComment: Comment? {
        post.comments.max { $0.totalReactions < $1.totalReactions }
    }

    private var remainingCount: Int {
        max(0, post.totalComments - 1)
    }

    private var moreText: String {
        let noun = remainingCount == 1 ? "comment" : "comments"
        return "View \(remainingCount.withCommas) more \(noun)"
    }
}
