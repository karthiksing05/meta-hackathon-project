import SwiftUI

/// Comments for a post, as sheet content. It has its own navigation stack, so tapping a
/// name pushes the profile inside the sheet. The composer is pinned to the bottom.
struct CommentsView: View {
    let post: Post
    /// Focus the composer when the sheet opens (the action bar's Comment button).
    var autoFocus: Bool = true

    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            PostCommentsScreen(post: post, autoFocus: autoFocus)
                .appDestinations()
        }
        .environment(\.postPush, { route in
            path.append(route)
        })
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 84)
        }
        .presentationDragIndicator(.visible)
    }
}

/// The root of the comments sheet: reactions summary, sort menu, threads and composer.
private struct PostCommentsScreen: View {
    let post: Post
    let autoFocus: Bool

    @State private var model = PostCommentsModel()
    @State private var showsReactions = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    PostCommentsHeader(post: post, model: model) {
                        showsReactions = true
                    }
                    .padding(.horizontal, FBMetrics.gutter)
                    .padding(.top, 20)
                    PostCommentsList(post: post, model: model)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                PostCommentComposer(post: post, model: model, autoFocus: autoFocus) { comment in
                    scroll(to: comment, proxy: proxy)
                }
            }
        }
        .background(FBColor.surface)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showsReactions) {
            ReactionsListView(post: post, opensChatInPlace: true)
        }
    }

    private func scroll(to comment: Comment, proxy: ScrollViewProxy) {
        Task {
            try? await Task.sleep(nanoseconds: 150_000_000)
            withAnimation(.easeOut(duration: 0.3)) {
                proxy.scrollTo(comment.id, anchor: .center)
            }
        }
    }
}

/// The pushed post screen: the whole post (no truncation), every comment inline and the
/// same pinned composer.
struct PostDetailView: View {
    let post: Post

    @State private var model = PostCommentsModel()

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    PostCard(post: post, style: .detail) {
                        model.focusRequest += 1
                    }
                    HairlineDivider()
                    PostCommentsHeader(post: post, model: model, showsReactions: false)
                        .padding(.horizontal, FBMetrics.gutter)
                        .padding(.top, 12)
                    PostCommentsList(post: post, model: model)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                PostCommentComposer(post: post, model: model, autoFocus: false) { comment in
                    scroll(to: comment, proxy: proxy)
                }
            }
        }
        .background(FBColor.surface)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var title: String {
        post.author.isMe ? "Your post" : "\(post.author.firstName)'s post"
    }

    private func scroll(to comment: Comment, proxy: ScrollViewProxy) {
        Task {
            try? await Task.sleep(nanoseconds: 150_000_000)
            withAnimation(.easeOut(duration: 0.3)) {
                proxy.scrollTo(comment.id, anchor: .center)
            }
        }
    }
}

/// "Write a comment..." pinned to the bottom: my avatar, a growing field, camera / GIF /
/// emoji buttons, send, and a "Replying to <name> ×" (or "Editing comment") banner.
struct PostCommentComposer: View {
    let post: Post
    let model: PostCommentsModel
    var autoFocus: Bool = false
    var onSent: (Comment) -> Void = { _ in }

    @Environment(AppStore.self) private var store
    @FocusState private var isFocused: Bool

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            HairlineDivider()
            if let banner = bannerText {
                bannerRow(banner)
            }
            HStack(alignment: .bottom, spacing: 8) {
                AvatarView(user: store.me, size: 32)
                    .padding(.bottom, 3)
                field(text: $model.draft)
                sendButton
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(FBColor.surface)
        .animation(.easeOut(duration: 0.2), value: bannerText)
        .onChange(of: model.focusRequest) {
            isFocused = true
        }
        .task {
            guard autoFocus else { return }
            try? await Task.sleep(nanoseconds: 450_000_000)
            isFocused = true
        }
    }

    // MARK: Pieces

    private func bannerRow(_ text: String) -> some View {
        HStack(spacing: 8) {
            Text(text)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button {
                model.cancelContext()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(cancelLabel)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.top, 4)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func field(text: Binding<String>) -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField(placeholder, text: text, axis: .vertical)
                .font(.fbBody)
                .lineLimit(1...5)
                .focused($isFocused)
                .padding(.vertical, 9)
            if text.wrappedValue.isEmpty {
                accessoryButtons
                    .padding(.bottom, 9)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var accessoryButtons: some View {
        HStack(spacing: 14) {
            accessoryButton(label: "Add photo") {
                Image(systemName: "camera")
                    .font(.system(size: 17))
            }
            accessoryButton(label: "Add GIF") {
                Text("GIF")
                    .font(.system(size: 9, weight: .heavy))
                    .padding(.horizontal, 3)
                    .padding(.vertical, 2)
                    .overlay {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .stroke(FBColor.secondaryText, lineWidth: 1.4)
                    }
            }
            accessoryButton(label: "Add emoji") {
                Image(systemName: "face.smiling")
                    .font(.system(size: 17))
            }
        }
        .foregroundStyle(FBColor.secondaryText)
    }

    private func accessoryButton<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        let icon = content()
        return Button {
            store.showToast("Not available in this demo", symbol: "info.circle")
        } label: {
            icon
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var sendButton: some View {
        Button(action: send) {
            Image(systemName: "paperplane.fill")
                .font(.system(size: 20))
                .foregroundStyle(canSend ? FBColor.accent : FBColor.tertiaryText)
                .frame(width: 36, height: 38)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .accessibilityLabel(sendLabel)
    }

    // MARK: State

    private var bannerText: String? {
        if model.editing != nil {
            return "Editing comment"
        }
        if let name = model.replyName {
            return "Replying to \(name)"
        }
        return nil
    }

    private var placeholder: String {
        if model.editing != nil {
            return "Edit your comment..."
        }
        if let name = model.replyName {
            return "Reply to \(name)..."
        }
        return "Write a comment..."
    }

    private var cancelLabel: String {
        model.editing != nil ? "Cancel editing" : "Cancel reply"
    }

    private var sendLabel: String {
        model.editing != nil ? "Save comment" : "Send comment"
    }

    private var canSend: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Actions

    private func send() {
        let text = model.draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Haptics.light()
        if let editing = model.editing {
            store.editComment(editing, text: text)
            model.cancelContext()
            return
        }
        let parent = model.replyParent
        let comment = store.addComment(text, to: post, replyingTo: parent)
        if let parent {
            model.expandedThreads.insert(parent.id)
        }
        model.draft = ""
        model.cancelContext()
        onSent(comment)
    }
}
