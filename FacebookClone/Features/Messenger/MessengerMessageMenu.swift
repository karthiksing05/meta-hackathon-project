import SwiftUI

/// Long-press overlay: dims the chat, lifts the message, and shows the reaction bar
/// above it and the actions (Reply, Copy, Forward, Unsend) below it.
struct MessengerMessageMenu: View {
    let message: Message
    let isFromMe: Bool
    let themeColor: Color
    /// The signed-in user's current reaction, highlighted in the bar.
    let myReaction: String?
    let onReact: (String) -> Void
    let onReply: () -> Void
    let onCopy: () -> Void
    let onForward: () -> Void
    let onUnsend: () -> Void
    let onDismiss: () -> Void

    @State private var showsMore = false
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    onDismiss()
                }
                .accessibilityLabel("Close")
                .accessibilityAddTraits(.isButton)

            VStack(alignment: horizontalAlignment, spacing: 10) {
                reactionBar
                MessengerBubble(message: message, isFromMe: isFromMe, themeColor: themeColor, maxLines: 12)
                    .frame(maxWidth: MessengerStyle.maxBubbleWidth, alignment: frameAlignment)
                    .allowsHitTesting(false)
                actionList
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, alignment: frameAlignment)
            .scaleEffect(appeared ? 1 : 0.9, anchor: isFromMe ? .trailing : .leading)
            .opacity(appeared ? 1 : 0)
        }
        .onAppear {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.78)) {
                appeared = true
            }
        }
    }

    private var horizontalAlignment: HorizontalAlignment {
        isFromMe ? .trailing : .leading
    }

    private var frameAlignment: Alignment {
        isFromMe ? .trailing : .leading
    }

    // MARK: Reactions

    private var reactionBar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 2) {
                ForEach(MessengerStyle.reactions, id: \.self) { emoji in
                    reactionButton(emoji)
                }
                moreButton
            }
            if showsMore {
                HStack(spacing: 2) {
                    ForEach(MessengerStyle.moreReactions, id: \.self) { emoji in
                        reactionButton(emoji)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(FBColor.elevated, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: Color.black.opacity(0.18), radius: 12, y: 4)
    }

    private func reactionButton(_ emoji: String) -> some View {
        Button {
            onReact(emoji)
        } label: {
            Text(emoji)
                .font(.system(size: 26))
                .frame(width: 36, height: 36)
                .background {
                    if myReaction == emoji {
                        Circle().fill(FBColor.buttonGray)
                    }
                }
        }
        .buttonStyle(MessengerEmojiButtonStyle())
        .accessibilityLabel("React with \(emoji)")
        .accessibilityAddTraits(myReaction == emoji ? .isSelected : [])
    }

    private var moreButton: some View {
        Button {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                showsMore.toggle()
            }
        } label: {
            Image(systemName: showsMore ? "chevron.up" : "plus")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 32, height: 32)
                .background(FBColor.buttonGray, in: Circle())
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(showsMore ? "Fewer reactions" : "More reactions")
    }

    // MARK: Actions

    private var canCopy: Bool {
        message.text != nil || message.bigEmoji != nil
    }

    private var actionList: some View {
        VStack(spacing: 0) {
            actionRow("Reply", symbol: "arrowshape.turn.up.left", action: onReply)
            if canCopy {
                HairlineDivider()
                actionRow("Copy", symbol: "doc.on.doc", action: onCopy)
            }
            HairlineDivider()
            actionRow("Forward", symbol: "arrowshape.turn.up.right", action: onForward)
            if isFromMe {
                HairlineDivider()
                actionRow("Unsend", symbol: "trash", isDestructive: true, action: onUnsend)
            }
        }
        .frame(width: 230)
        .background(FBColor.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: Color.black.opacity(0.18), radius: 12, y: 4)
    }

    private func actionRow(_ title: String, symbol: String, isDestructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(.system(size: 16))
                Spacer(minLength: 8)
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .medium))
            }
            .foregroundStyle(isDestructive ? FBColor.notificationRed : FBColor.primaryText)
            .padding(.horizontal, 16)
            .frame(height: 46)
            .contentShape(Rectangle())
        }
        .buttonStyle(MessengerRowButtonStyle())
    }
}

/// Emoji grow while pressed, like the real reaction bar.
private struct MessengerEmojiButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 1.3 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - Reactions sheet

/// Who reacted to a message. Tap your own reaction to remove it.
struct MessengerReactionsSheet: View {
    let messageID: String
    let conversation: Conversation

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(entries) { entry in
                    row(for: entry)
                }
            }
            .listStyle(.plain)
            .overlay {
                if entries.isEmpty {
                    ContentUnavailableView("No reactions", systemImage: "face.smiling")
                }
            }
            .navigationTitle("Reactions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var message: Message? {
        conversation.messages.first { $0.id == messageID }
    }

    private var entries: [MessengerReactionEntry] {
        guard let message else { return [] }
        let meID = store.me.id
        return message.reactions
            .map { MessengerReactionEntry(userID: $0.key, emoji: $0.value) }
            .sorted { lhs, rhs in
                if (lhs.userID == meID) != (rhs.userID == meID) { return lhs.userID == meID }
                return lhs.userID < rhs.userID
            }
    }

    @ViewBuilder
    private func row(for entry: MessengerReactionEntry) -> some View {
        let isMine = entry.userID == store.me.id
        let user = store.user(id: entry.userID)
        Button {
            removeIfMine(entry)
        } label: {
            HStack(spacing: 12) {
                if let user {
                    AvatarView(user: user, size: 40)
                } else {
                    Circle()
                        .fill(FBColor.buttonGray)
                        .frame(width: 40, height: 40)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(isMine ? "You" : (user?.name ?? "Facebook user"))
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    if isMine {
                        Text("Tap to remove")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                Spacer(minLength: 8)
                Text(entry.emoji)
                    .font(.system(size: 26))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isMine)
    }

    private func removeIfMine(_ entry: MessengerReactionEntry) {
        guard entry.userID == store.me.id, let message else { return }
        store.react(to: message, with: nil, in: conversation)
        Haptics.light()
    }
}

struct MessengerReactionEntry: Identifiable, Hashable {
    let userID: String
    let emoji: String

    var id: String { userID }
}
