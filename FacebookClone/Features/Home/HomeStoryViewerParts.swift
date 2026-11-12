import SwiftUI

/// The callbacks one story page needs. Grouped so the page's initializer stays small.
struct HomeStoryPageActions {
    var onDragChanged: (DragGesture.Value) -> Void
    var onDragEnded: (DragGesture.Value) -> Void
    var onOptions: () -> Void
    var onClose: () -> Void
    var onAuthor: () -> Void
    var onReply: () -> Void
    var onReact: (String) -> Void
    var onAddToStory: () -> Void
}

enum HomeStoryDragAxis {
    case horizontal
    case vertical
}

/// One author's page: the rounded story card (progress bars, header, content, caption)
/// with the reply / viewers footer underneath. Stateless; `StoryViewer` drives it.
struct HomeStoryPage: View {
    let story: Story
    let itemIndex: Int
    let progress: Double
    let chromeHidden: Bool
    let actions: HomeStoryPageActions

    private var item: StoryItem? {
        story.items.indices.contains(itemIndex) ? story.items[itemIndex] : nil
    }

    var body: some View {
        VStack(spacing: 10) {
            card
            footer
                .opacity(chromeHidden ? 0 : 1)
        }
        .padding(.top, 4)
        .padding(.bottom, 6)
    }

    // MARK: Card

    private var card: some View {
        ZStack(alignment: .top) {
            content
            LinearGradient(
                colors: [Color.black.opacity(0.55), Color.clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 120)
            .allowsHitTesting(false)
            header
                .opacity(chromeHidden ? 0 : 1)
        }
        .overlay(alignment: .bottom) {
            caption
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged(actions.onDragChanged)
                .onEnded(actions.onDragEnded)
        )
    }

    @ViewBuilder
    private var content: some View {
        if let item {
            HomeStoryContentView(content: item.content, textSize: 30, fitsLocalPhotos: true)
        } else {
            Color(white: 0.12)
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(Array(story.items.enumerated()), id: \.element.id) { index, _ in
                    HomeStoryProgressBar(fraction: fraction(for: index))
                }
            }
            .frame(height: 3)

            HStack(spacing: 4) {
                Button(action: actions.onAuthor) {
                    authorLabel
                }
                .buttonStyle(.plain)
                Spacer(minLength: 8)
                Button(action: actions.onOptions) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Story options")
                Button(action: actions.onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .shadow(color: Color.black.opacity(0.3), radius: 2, y: 1)
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
    }

    private var authorLabel: some View {
        HStack(spacing: 8) {
            AvatarView(user: story.author, size: 36)
            Text(story.author.isMe ? "Your story" : story.author.name)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
            if let item {
                Text(item.createdAt.fbShort)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.8))
                    .lineLimit(1)
            }
        }
    }

    @ViewBuilder
    private var caption: some View {
        if let text = item?.caption, !text.isEmpty {
            Text(text)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
                .opacity(chromeHidden ? 0 : 1)
                .allowsHitTesting(false)
        }
    }

    private func fraction(for index: Int) -> Double {
        if index < itemIndex { return 1 }
        if index == itemIndex { return progress }
        return 0
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        if story.author.isMe {
            HomeMyStoryFooter(viewerCount: item?.viewerCount ?? 0, onAddToStory: actions.onAddToStory)
        } else {
            HomeStoryReplyFooter(onReply: actions.onReply, onReact: actions.onReact)
        }
    }
}

/// One segment of the bar at the top of a story.
struct HomeStoryProgressBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.35))
                Capsule()
                    .fill(Color.white)
                    .frame(width: proxy.size.width * CGFloat(min(max(fraction, 0), 1)))
            }
        }
        .frame(height: 3)
        .accessibilityHidden(true)
    }
}

/// "Send message" field and quick reactions under someone else's story.
private struct HomeStoryReplyFooter: View {
    let onReply: () -> Void
    let onReact: (String) -> Void

    private let reactions = ["👍", "❤️", "😆", "😮", "😢", "😡"]

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onReply) {
                Text("Send message")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .lineLimit(1)
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .overlay {
                        Capsule().stroke(Color.white.opacity(0.6), lineWidth: 1)
                    }
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Send message")

            ForEach(reactions, id: \.self) { emoji in
                Button {
                    onReact(emoji)
                } label: {
                    Text(emoji)
                        .font(.system(size: 26))
                        .frame(width: 34, height: 40)
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("React with \(emoji)")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 44)
    }
}

/// Viewer count and "Add to story" under your own story.
private struct HomeMyStoryFooter: View {
    let viewerCount: Int
    let onAddToStory: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "eye.fill")
                Text(viewerText)
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .accessibilityElement(children: .combine)

            Spacer(minLength: 8)

            Button(action: onAddToStory) {
                HStack(spacing: 6) {
                    Image(systemName: "plus.circle.fill")
                    Text("Add to story")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 38)
                .background(Color.white.opacity(0.18), in: Capsule())
            }
            .buttonStyle(.pressable)
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
    }

    private var viewerText: String {
        viewerCount == 1 ? "1 viewer" : "\(viewerCount) viewers"
    }
}

// MARK: - Reply composer

/// Dimmed overlay with a focused reply field that sits on the keyboard.
struct HomeStoryReplyComposer: View {
    let recipient: User
    let onSend: (String) -> Void
    let onCancel: () -> Void

    @State private var text = ""
    @FocusState private var isFocused: Bool

    init(recipient: User, onSend: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.recipient = recipient
        self.onSend = onSend
        self.onCancel = onCancel
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .onTapGesture {
                    onCancel()
                }
            HStack(spacing: 8) {
                TextField("Reply to \(recipient.firstName)...", text: $text)
                    .font(.system(size: 16))
                    .foregroundStyle(.white)
                    .tint(.white)
                    .focused($isFocused)
                    .submitLabel(.send)
                    .onSubmit {
                        onSend(text)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(Color.white.opacity(0.14), in: Capsule())
                    .overlay {
                        Capsule().stroke(Color.white.opacity(0.5), lineWidth: 1)
                    }
                Button {
                    onSend(text)
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(canSend ? FBColor.accent : Color.white.opacity(0.4))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel("Send")
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
        .task {
            try? await Task.sleep(nanoseconds: 120_000_000)
            isFocused = true
        }
    }
}

// MARK: - Floating reactions

struct HomeFloatingReaction: Identifiable {
    let id = UUID()
    let emoji: String
    let drift: CGFloat
}

/// An emoji that floats up, grows and fades out.
struct HomeFloatingEmoji: View {
    let reaction: HomeFloatingReaction

    @State private var rise = false
    @State private var fade = false

    init(reaction: HomeFloatingReaction) {
        self.reaction = reaction
    }

    var body: some View {
        Text(reaction.emoji)
            .font(.system(size: 46))
            .scaleEffect(rise ? 1.35 : 0.5)
            .offset(x: rise ? reaction.drift : 0, y: rise ? -340 : 0)
            .opacity(fade ? 0 : 1)
            .onAppear {
                withAnimation(.easeOut(duration: 1.6)) {
                    rise = true
                }
                withAnimation(.easeIn(duration: 0.6).delay(1.0)) {
                    fade = true
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
