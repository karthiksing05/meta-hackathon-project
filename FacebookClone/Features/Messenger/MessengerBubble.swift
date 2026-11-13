import SwiftUI

// MARK: - Search marks

/// How a message looks while "Search in conversation" is active.
enum MessengerSearchMark {
    case unmarked
    case dimmed
    case match
    case current
}

struct MessengerSearchContext {
    var term: String = ""
    /// Matching message IDs, oldest first.
    var matchIDs: [String] = []
    var currentID: String? = nil

    var isActive: Bool { !term.isEmpty }

    func mark(for message: Message) -> MessengerSearchMark {
        guard isActive else { return .unmarked }
        if message.id == currentID { return .current }
        if matchIDs.contains(message.id) { return .match }
        return .dimmed
    }
}

enum MessengerTextHighlighter {
    /// Bolds and underlines the first match of `term` in `string`.
    static func text(_ string: String, term: String) -> Text {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let range = string.range(of: trimmed, options: [.caseInsensitive, .diacriticInsensitive]) else {
            return Text(string)
        }
        let before = String(string[string.startIndex..<range.lowerBound])
        let match = String(string[range])
        let after = String(string[range.upperBound...])
        return Text(before) + Text(match).bold().underline() + Text(after)
    }
}

// MARK: - Message row

/// One message in the chat: optional timestamp, sender name, reply quote, the bubble with
/// avatar and reactions, and the delivery status under the last outgoing message.
struct MessengerMessageRow: View {
    let row: MessengerRowModel
    let conversation: Conversation
    var showsStatus: Bool = false
    var searchMark: MessengerSearchMark = .unmarked
    var searchTerm: String = ""
    var onLongPress: () -> Void = {}
    var onReply: () -> Void = {}
    var onOpenPhoto: () -> Void = {}
    var onShowReactions: () -> Void = {}

    @Environment(AppStore.self) private var store
    @State private var dragOffset: CGFloat = 0
    @State private var showsTime = false

    private static let replyThreshold: CGFloat = 56

    var body: some View {
        VStack(spacing: 0) {
            if row.showsTimestamp {
                timestamp
            } else if showsTime {
                tappedTime
            }
            if showsSenderName {
                senderName
            }
            if let quoted = row.quoted {
                quote(quoted)
            }
            bubbleLine
            if showsStatus {
                statusLine
            }
        }
        .padding(.top, topSpacing)
        .padding(.bottom, hasReactions ? 16 : 0)
        .opacity(searchMark == .dimmed ? 0.3 : 1)
    }

    // MARK: Layout values

    private var hasReactions: Bool {
        !row.message.reactions.isEmpty && !row.message.isUnsent
    }

    private var topSpacing: CGFloat {
        if row.showsTimestamp { return 0 }
        return row.joinsPrevious ? 2 : 10
    }

    private var showsSenderName: Bool {
        conversation.isGroup && !row.isFromMe && !row.joinsPrevious
    }

    /// Leading space before incoming bubbles: row padding + avatar column + spacing.
    private var incomingInset: CGFloat {
        12 + MessengerStyle.avatarSize + 8
    }

    private var bubbleAlignment: Alignment {
        row.isFromMe ? .trailing : .leading
    }

    // MARK: Pieces

    private var timestamp: some View {
        Text(MessengerFormat.separator(row.message.sentAt))
            .font(.fbCaptionEmphasized)
            .foregroundStyle(FBColor.secondaryText)
            .frame(maxWidth: .infinity)
            .padding(.top, 16)
            .padding(.bottom, 8)
    }

    private var tappedTime: some View {
        Text(row.message.sentAt.timeOfDay)
            .font(.fbMicroEmphasized)
            .foregroundStyle(FBColor.secondaryText)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
            .padding(.bottom, 2)
            .transition(.opacity)
    }

    private var senderName: some View {
        Text(row.sender?.firstName ?? "")
            .font(.fbCaption)
            .foregroundStyle(FBColor.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, incomingInset + 12)
            .padding(.bottom, 2)
    }

    private func quote(_ quoted: Message) -> some View {
        MessengerReplyQuote(quoted: quoted, caption: quoteCaption, isFromMe: row.isFromMe)
            .padding(.leading, row.isFromMe ? 56 : incomingInset)
            .padding(.trailing, row.isFromMe ? 12 : 40)
            .frame(maxWidth: .infinity, alignment: bubbleAlignment)
            .padding(.bottom, 2)
    }

    private var quoteCaption: String {
        let replier = row.isFromMe ? "You" : (row.sender?.firstName ?? "Someone")
        guard let quoted = row.quoted else { return "\(replier) replied" }
        if quoted.senderID == row.message.senderID {
            return row.isFromMe ? "You replied to yourself" : "\(replier) replied to themself"
        }
        if quoted.senderID == store.me.id {
            return "\(replier) replied to you"
        }
        let target = row.quotedSender?.firstName ?? "a message"
        return "\(replier) replied to \(target)"
    }

    private var bubbleLine: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if row.isFromMe {
                Spacer(minLength: 56)
            } else {
                avatarColumn
            }
            decoratedBubble
                .frame(maxWidth: MessengerStyle.maxBubbleWidth, alignment: bubbleAlignment)
            if !row.isFromMe {
                Spacer(minLength: 40)
            }
        }
        .padding(.horizontal, 12)
        .offset(x: dragOffset)
        .background(alignment: row.isFromMe ? .trailing : .leading) {
            replyIcon
        }
        .simultaneousGesture(swipeGesture)
    }

    @ViewBuilder
    private var avatarColumn: some View {
        if row.showsAvatar, let sender = row.sender {
            AvatarView(user: sender, size: MessengerStyle.avatarSize)
        } else {
            Color.clear
                .frame(width: MessengerStyle.avatarSize, height: 1)
        }
    }

    private var decoratedBubble: some View {
        MessengerBubble(
            message: row.message,
            isFromMe: row.isFromMe,
            themeColor: conversation.themeColor,
            joinsPrevious: row.joinsPrevious,
            joinsNext: row.joinsNext,
            senderName: row.sender?.firstName ?? "",
            searchTerm: searchTerm,
            isCurrentMatch: searchMark == .current
        )
        .overlay(alignment: row.isFromMe ? .bottomLeading : .bottomTrailing) {
            reactionCapsule
        }
        .contentShape(Rectangle())
        .onTapGesture {
            handleTap()
        }
        .onLongPressGesture(minimumDuration: 0.35) {
            onLongPress()
        }
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Reply") {
            onReply()
        }
        .accessibilityAction(named: "React or more options") {
            onLongPress()
        }
    }

    @ViewBuilder
    private var reactionCapsule: some View {
        if hasReactions {
            Button(action: onShowReactions) {
                MessengerReactionCapsule(reactions: row.message.reactions)
            }
            .buttonStyle(.plain)
            .offset(x: row.isFromMe ? 6 : -6, y: 16)
            .accessibilityLabel("See reactions")
        }
    }

    private var statusLine: some View {
        HStack {
            Spacer(minLength: 0)
            MessengerMessageStatusView(status: row.message.status, seenBy: seenUsers)
        }
        .padding(.horizontal, 12)
        .padding(.top, 3)
    }

    private var seenUsers: [User] {
        if conversation.isGroup {
            return Array(conversation.participants.prefix(3))
        }
        if let user = conversation.primaryUser {
            return [user]
        }
        return []
    }

    // MARK: Swipe to reply

    @ViewBuilder
    private var replyIcon: some View {
        if dragOffset != 0 {
            Image(systemName: "arrowshape.turn.up.left.fill")
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 30, height: 30)
                .background(FBColor.buttonGray, in: Circle())
                .opacity(replyIconOpacity)
                .padding(.horizontal, 16)
        }
    }

    private var replyIconOpacity: Double {
        min(1, Double(abs(dragOffset)) / Double(Self.replyThreshold))
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                handleDragChange(value.translation)
            }
            .onEnded { _ in
                handleDragEnd()
            }
    }

    private func handleDragChange(_ translation: CGSize) {
        guard !row.message.isUnsent, abs(translation.width) > abs(translation.height) else { return }
        let directed = row.isFromMe ? min(0, translation.width) : max(0, translation.width)
        let clamped = max(-90, min(90, directed))
        let wasPastThreshold = abs(dragOffset) >= Self.replyThreshold
        dragOffset = clamped
        if !wasPastThreshold && abs(clamped) >= Self.replyThreshold {
            Haptics.light()
        }
    }

    private func handleDragEnd() {
        if abs(dragOffset) >= Self.replyThreshold {
            onReply()
        }
        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
            dragOffset = 0
        }
    }

    private func handleTap() {
        if row.message.isImage && !row.message.isUnsent {
            onOpenPhoto()
        } else {
            withAnimation(.easeOut(duration: 0.15)) {
                showsTime.toggle()
            }
        }
    }
}

// MARK: - Bubble

/// The bubble itself: text, big emoji, photo, or "unsent". Callers cap the width with
/// `.frame(maxWidth: MessengerStyle.maxBubbleWidth, alignment:)` so the bubble keeps hugging its text.
struct MessengerBubble: View {
    let message: Message
    let isFromMe: Bool
    let themeColor: Color
    var joinsPrevious: Bool = false
    var joinsNext: Bool = false
    /// First name of the sender, for "Maria unsent a message".
    var senderName: String = ""
    var searchTerm: String = ""
    var isCurrentMatch: Bool = false
    /// Caps long texts (the long-press preview uses this).
    var maxLines: Int? = nil

    var body: some View {
        content
            .overlay {
                if isCurrentMatch {
                    shape.stroke(FBColor.feelingYellow, lineWidth: 3)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if message.isUnsent {
            unsentBubble
        } else if let card = message.bubbleCard {
            BubbleChatCardView(card: card, placement: .chat(messageID: message.id, isFromMe: isFromMe))
        } else if let emoji = message.bigEmoji {
            Text(emoji)
                .font(.system(size: 44)) // Display text
                .padding(.vertical, 2)
                .accessibilityLabel(emoji)
        } else if message.isImage {
            photo
        } else {
            textBubble
        }
    }

    private var shape: MessengerBubbleShape {
        MessengerBubbleShape.bubble(isFromMe: isFromMe, joinsPrevious: joinsPrevious, joinsNext: joinsNext)
    }

    private var bubbleColor: Color {
        isFromMe ? themeColor : FBColor.incomingBubble
    }

    private var textColor: Color {
        isFromMe ? Color.white : FBColor.primaryText
    }

    private var textBubble: some View {
        MessengerTextHighlighter.text(message.text ?? "", term: searchTerm)
            .font(.fbBodyLarge)
            .foregroundStyle(textColor)
            .lineLimit(maxLines)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(bubbleColor, in: shape)
    }

    private var photo: some View {
        RemoteImage(url: message.imageURL, data: message.imageData)
            .frame(width: MessengerStyle.photoWidth, height: MessengerStyle.photoHeight)
            .clipShape(shape)
            .overlay {
                shape.stroke(Color.black.opacity(0.06), lineWidth: 0.5)
            }
            .accessibilityLabel("Photo")
    }

    private var unsentBubble: some View {
        Text(unsentText)
            .font(.fbBody.italic())
            .foregroundStyle(FBColor.secondaryText)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .overlay {
                shape.stroke(FBColor.divider, lineWidth: 1)
            }
    }

    private var unsentText: String {
        if isFromMe { return "You unsent a message" }
        let name = senderName.isEmpty ? "Someone" : senderName
        return "\(name) unsent a message"
    }
}

// MARK: - Decorations

/// The small reaction pill that overlaps a bubble's bottom corner.
struct MessengerReactionCapsule: View {
    /// User ID -> emoji.
    let reactions: [String: String]

    var body: some View {
        HStack(spacing: 1) {
            ForEach(topEmojis, id: \.self) { emoji in
                Text(emoji)
                    .font(.fbMeta)
            }
            if reactions.count > 1 {
                Text("\(reactions.count)")
                    .font(.fbMicroEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.leading, 2)
            }
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(FBColor.elevated, in: Capsule())
        .overlay {
            Capsule().stroke(FBColor.surface, lineWidth: 1.5)
        }
        .shadow(color: Color.black.opacity(0.12), radius: 2, y: 1)
    }

    private var topEmojis: [String] {
        var counts: [String: Int] = [:]
        for emoji in reactions.values {
            counts[emoji, default: 0] += 1
        }
        let sorted = counts.sorted { lhs, rhs in
            if lhs.value != rhs.value { return lhs.value > rhs.value }
            return lhs.key < rhs.key
        }
        return sorted.prefix(3).map { $0.key }
    }
}

/// "You replied to Maria" plus a faded copy of the quoted message.
struct MessengerReplyQuote: View {
    let quoted: Message
    let caption: String
    let isFromMe: Bool

    var body: some View {
        VStack(alignment: isFromMe ? .trailing : .leading, spacing: 3) {
            Label(caption, systemImage: "arrowshape.turn.up.left.fill")
                .font(.fbMicro)
                .foregroundStyle(FBColor.secondaryText)
                .lineLimit(1)
            Text(previewText)
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .lineLimit(2)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(FBColor.incomingBubble.opacity(0.65), in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
                .frame(maxWidth: 230, alignment: isFromMe ? .trailing : .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var previewText: String {
        if quoted.isUnsent { return "Message unsent" }
        if let text = quoted.text { return text }
        if quoted.isImage { return "Photo" }
        return quoted.bigEmoji ?? ""
    }
}

/// "Sending…", "Sent", "Delivered", or the recipients' tiny avatars once seen.
struct MessengerMessageStatusView: View {
    let status: MessageStatus
    let seenBy: [User]

    var body: some View {
        switch status {
        case .sending:
            label("Sending…")
        case .sent:
            label("Sent")
        case .delivered:
            label("Delivered")
        case .seen:
            HStack(spacing: -3) {
                ForEach(seenBy) { user in
                    AvatarView(user: user, size: FBAvatarSize.micro)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Seen")
        }
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .font(.fbMicro)
            .foregroundStyle(FBColor.secondaryText)
    }
}

/// Three bouncing dots in an incoming bubble.
struct MessengerTypingIndicator: View {
    var body: some View {
        TimelineView(.animation) { context in
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(FBColor.secondaryText)
                        .frame(width: 7, height: 7)
                        .offset(y: Self.lift(for: index, at: context.date))
                        .opacity(Self.brightness(for: index, at: context.date))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(FBColor.incomingBubble, in: RoundedRectangle(cornerRadius: MessengerStyle.bubbleRadius, style: .continuous))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Typing")
    }

    private static func wave(for index: Int, at date: Date) -> Double {
        let phase = date.timeIntervalSinceReferenceDate * 7.0 - Double(index) * 0.9
        return max(0, sin(phase))
    }

    private static func lift(for index: Int, at date: Date) -> CGFloat {
        CGFloat(-4.0 * wave(for: index, at: date))
    }

    private static func brightness(for index: Int, at date: Date) -> Double {
        0.45 + 0.55 * wave(for: index, at: date)
    }
}
