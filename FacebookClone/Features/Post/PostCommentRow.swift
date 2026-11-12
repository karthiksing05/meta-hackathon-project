import SwiftUI
import UIKit

/// One comment: avatar, gray bubble (bold name + text), optional photo, the
/// "2h  Like  Reply  Edited" row, and a reaction pill overlapping the bubble's corner.
///
/// Tap Like to like; hold it for the reaction picker. Long-press the bubble for
/// Reply, React, Copy, and (for your own comments) Edit and Delete.
struct PostCommentRow: View {
    let comment: Comment
    /// The top-level comment this row belongs to (itself for top-level comments).
    let parent: Comment
    let post: Post
    let model: PostCommentsModel
    var avatarSize: CGFloat = 32

    @Environment(AppStore.self) private var store

    private static let pickerItemSize: CGFloat = 32

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            NavigationLink(value: Route.profile(comment.author)) {
                AvatarView(user: comment.author, size: avatarSize)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(comment.author.name), profile")

            VStack(alignment: .leading, spacing: 4) {
                bubble
                if let imageURL = comment.imageURL {
                    RemoteImage(url: imageURL)
                        .frame(width: 180, height: 140)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                }
                metaRow
                    .padding(.top, comment.totalReactions > 0 ? 4 : 0)
                    .overlay(alignment: .topLeading) {
                        picker
                    }
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Bubble

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 2) {
            NavigationLink(value: Route.profile(comment.author)) {
                nameLine
            }
            .buttonStyle(.plain)
            if !comment.text.isEmpty {
                Text(PostRichText.make(comment.text, linked: false))
                    .font(.fbBody)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
        .overlay(alignment: .bottomTrailing) {
            reactionPill
                .offset(x: 10, y: 10)
        }
        .contentShape(RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
        .contextMenu {
            contextMenuItems
        }
    }

    private var nameLine: some View {
        HStack(spacing: 4) {
            Text(comment.author.name)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            if comment.author.isVerified {
                VerifiedBadge(size: 11)
            }
            if comment.author.id == post.author.id {
                Text("Author")
                    .font(.fbMicroEmphasized)
                    .foregroundStyle(FBColor.accent)
            }
        }
    }

    @ViewBuilder
    private var reactionPill: some View {
        let total = comment.totalReactions
        if total > 0 {
            HStack(spacing: 2) {
                ReactionBadgeStack(types: comment.topReactions, size: 16)
                if total > 1 {
                    Text(total.fbCompact)
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(.trailing, 2)
                }
            }
            .padding(2)
            .background(FBColor.surface, in: Capsule())
            .shadow(color: .black.opacity(0.15), radius: 1.5, y: 0.5)
            .transition(.scale.combined(with: .opacity))
            .accessibilityLabel("\(total) reactions")
        }
    }

    // MARK: Meta row

    private var metaRow: some View {
        HStack(spacing: 16) {
            TimelineView(.everyMinute) { _ in
                Text(comment.createdAt.fbShort)
            }
            likeLabel
                .gesture(likeGesture)
            Button {
                model.startReply(to: comment, in: parent)
            } label: {
                Text("Reply")
                    .fontWeight(.semibold)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if comment.isEdited {
                Text("Edited")
            }
        }
        .font(.fbCaption)
        .foregroundStyle(FBColor.secondaryText)
        .padding(.leading, 12)
    }

    private var likeLabel: some View {
        Text(comment.myReaction?.title ?? "Like")
            .fontWeight(.semibold)
            .foregroundStyle(comment.myReaction?.color ?? FBColor.secondaryText)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
            .accessibilityAddTraits(.isButton)
            .accessibilityAction {
                toggleLike()
            }
    }

    private var likeGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.35)
            .onEnded { _ in
                openPicker()
            }
            .exclusively(before: TapGesture().onEnded { toggleLike() })
    }

    // MARK: Reaction picker

    private var isPickerOpen: Bool {
        model.pickerCommentID == comment.id
    }

    @ViewBuilder
    private var picker: some View {
        if isPickerOpen {
            PostReactionPicker(itemSize: Self.pickerItemSize) { reaction in
                choose(reaction)
            }
            .offset(x: 0, y: -(PostReactionPicker.height(itemSize: Self.pickerItemSize) + 4))
            .transition(.scale(scale: 0.5, anchor: .bottomLeading).combined(with: .opacity))
        }
    }

    private func toggleLike() {
        if isPickerOpen {
            closePicker()
            return
        }
        let isLiking = comment.myReaction == nil
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            store.toggleLike(comment)
        }
        if isLiking {
            Haptics.light()
        } else {
            Haptics.soft()
        }
    }

    private func openPicker() {
        Haptics.medium()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.72)) {
            model.pickerCommentID = comment.id
        }
        let id = comment.id
        Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if model.pickerCommentID == id {
                closePicker()
            }
        }
    }

    private func choose(_ reaction: ReactionType) {
        Haptics.light()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            store.setReaction(reaction, on: comment)
        }
        closePicker()
    }

    private func closePicker() {
        withAnimation(.easeOut(duration: 0.18)) {
            model.pickerCommentID = nil
        }
    }

    // MARK: Context menu

    @ViewBuilder
    private var contextMenuItems: some View {
        Button {
            model.startReply(to: comment, in: parent)
        } label: {
            Label("Reply", systemImage: "arrowshape.turn.up.left")
        }
        Menu {
            ForEach(ReactionType.allCases) { reaction in
                Button("\(reaction.emoji)  \(reaction.title)") {
                    store.setReaction(reaction, on: comment)
                }
            }
            if comment.myReaction != nil {
                Button("Remove reaction", role: .destructive) {
                    store.setReaction(nil, on: comment)
                }
            }
        } label: {
            Label("React", systemImage: "face.smiling")
        }
        Button {
            UIPasteboard.general.string = comment.text
            store.showToast("Copied to clipboard", symbol: "doc.on.doc")
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }
        if comment.author.isMe {
            Button {
                model.startEdit(comment)
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            Button(role: .destructive) {
                model.pendingDelete = comment
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}
