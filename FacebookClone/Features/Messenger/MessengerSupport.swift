import SwiftUI

// MARK: - Constants

/// Sizes and choices shared by the Messenger screens.
enum MessengerStyle {
    static let bubbleRadius: CGFloat = FBMetrics.radiusXL
    static let joinedRadius: CGFloat = FBMetrics.radiusXS
    static let maxBubbleWidth: CGFloat = 264
    static let avatarSize: CGFloat = 28
    static let photoWidth: CGFloat = 220
    static let photoHeight: CGFloat = 260
    /// Consecutive messages further apart than this get a timestamp separator.
    static let separatorGap: TimeInterval = 15 * 60

    /// The long-press reaction bar.
    static let reactions = ["❤️", "😆", "😮", "😢", "😡", "👍"]
    /// Shown after tapping "+" on the reaction bar.
    static let moreReactions = ["🔥", "🎉", "💯", "🙏", "👏", "🤣", "😍", "🥲"]
    /// Choices for a chat's quick emoji.
    static let quickEmojis = ["👍", "❤️", "😂", "🔥", "😮", "🙏", "🎉", "💯"]
    /// The emoji strip above the composer.
    static let composerEmojis = ["😀", "😂", "🥰", "😍", "😘", "😎", "🤔", "😅", "😭", "🙏", "👍", "👏", "🔥", "🎉", "❤️", "💯"]
}

/// A chat theme: the outgoing bubble color.
struct MessengerTheme: Identifiable, Hashable {
    let name: String
    let hex: UInt32

    var id: UInt32 { hex }
    var color: Color { Color(hex: hex) }

    static let all: [MessengerTheme] = [
        MessengerTheme(name: "Classic", hex: 0x0A7CFF),
        MessengerTheme(name: "Violet", hex: 0x7646FF),
        MessengerTheme(name: "Berry", hex: 0xD6249F),
        MessengerTheme(name: "Cherry", hex: 0xFA3C4C),
        MessengerTheme(name: "Citrus", hex: 0xFF7E29),
        MessengerTheme(name: "Honey", hex: 0xE0A100),
        MessengerTheme(name: "Leaf", hex: 0x20B152),
        MessengerTheme(name: "Teal", hex: 0x0BA5A0),
        MessengerTheme(name: "Midnight", hex: 0x26338C),
        MessengerTheme(name: "Graphite", hex: 0x5B5F66),
    ]

    static func name(for hex: UInt32) -> String {
        all.first { $0.hex == hex }?.name ?? "Custom"
    }
}

/// The filter chips under the inbox's search field.
enum MessengerInboxFilter: String, CaseIterable, Identifiable {
    case all
    case unread
    case groups
    case archived

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .unread: return "Unread"
        case .groups: return "Groups"
        case .archived: return "Archived"
        }
    }
}

/// Presents `PhotoViewer` for the photos of one chat.
struct MessengerPhotoRequest: Identifiable {
    let id = UUID()
    let media: [Media]
    let startIndex: Int
}

enum MessengerCallKind: String, Identifiable {
    case audio
    case video

    var id: String { rawValue }
}

// MARK: - Formatting

enum MessengerFormat {
    /// Chat list time: "now", "5m", then `messengerShort` ("4:12 PM", "Mon", "Mar 3").
    static func listTime(_ date: Date) -> String {
        let seconds = Date().timeIntervalSince(date)
        if seconds < 60 { return "now" }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "\(minutes)m" }
        return date.messengerShort
    }

    /// Separator between messages: "TODAY AT 4:12 PM", "MON AT 9:00 AM", "MAR 3 AT 2:00 PM".
    static func separator(_ date: Date) -> String {
        let calendar = Calendar.current
        let time = date.timeOfDay
        let text: String
        if calendar.isDateInToday(date) {
            text = "Today at \(time)"
        } else if calendar.isDateInYesterday(date) {
            text = "Yesterday at \(time)"
        } else if Date().timeIntervalSince(date) < 6 * 86_400 {
            text = "\(DateFormatters.weekdayShort.string(from: date)) at \(time)"
        } else if calendar.isDate(date, equalTo: Date(), toGranularity: .year) {
            text = "\(DateFormatters.monthDay.string(from: date)) at \(time)"
        } else {
            text = "\(DateFormatters.monthDayYear.string(from: date)) at \(time)"
        }
        return text.uppercased()
    }

    /// 65 -> "01:05".
    static func callDuration(_ seconds: Int) -> String {
        String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

/// Notes shown in thought bubbles above some friends' avatars. Stable per person.
enum MessengerNotes {
    private static let samples = [
        "☕️ Coffee anyone?",
        "Gym, then tacos 🌮",
        "Road trip this weekend!",
        "Can't believe it's almost Friday",
        "📚 Study mode",
        "🎾 Tennis at 6?",
        "New playlist on repeat 🎧",
        "Sunset hunting 🌅",
        "Big news soon 👀",
        "Who's up for brunch?",
    ]

    static func note(for user: User) -> String? {
        let hash = SeededGenerator.stableHash(user.id + "-note")
        guard hash % 3 == 0 else { return nil }
        let index = Int((hash / 3) % UInt64(samples.count))
        return samples[index]
    }
}

// MARK: - Bubble shape

/// A rounded rectangle with its own radius per corner. Bubbles in a run use the small
/// radius on the side where they touch their neighbours.
struct MessengerBubbleShape: Shape {
    var topLeft: CGFloat
    var topRight: CGFloat
    var bottomLeft: CGFloat
    var bottomRight: CGFloat

    static func bubble(isFromMe: Bool, joinsPrevious: Bool, joinsNext: Bool) -> MessengerBubbleShape {
        let big = MessengerStyle.bubbleRadius
        let small = MessengerStyle.joinedRadius
        if isFromMe {
            return MessengerBubbleShape(
                topLeft: big,
                topRight: joinsPrevious ? small : big,
                bottomLeft: big,
                bottomRight: joinsNext ? small : big
            )
        }
        return MessengerBubbleShape(
            topLeft: joinsPrevious ? small : big,
            topRight: big,
            bottomLeft: joinsNext ? small : big,
            bottomRight: big
        )
    }

    func path(in rect: CGRect) -> Path {
        let limit = min(rect.width, rect.height) / 2
        let tl = min(topLeft, limit)
        let tr = min(topRight, limit)
        let bl = min(bottomLeft, limit)
        let br = min(bottomRight, limit)

        var path = Path()
        path.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - tr, y: rect.minY))
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.minY),
            tangent2End: CGPoint(x: rect.maxX, y: rect.minY + tr),
            radius: tr
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.maxX - br, y: rect.maxY),
            radius: br
        )
        path.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.minX, y: rect.maxY - bl),
            radius: bl
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.minY),
            tangent2End: CGPoint(x: rect.minX + tl, y: rect.minY),
            radius: tl
        )
        path.closeSubpath()
        return path
    }
}

// MARK: - Avatars

/// Two overlapping avatars for a group chat.
struct MessengerGroupAvatar: View {
    let users: [User]
    var size: CGFloat = FBAvatarSize.row

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.clear
            if users.count > 1 {
                AvatarView(user: users[1], size: innerSize)
            }
            if let first = users.first {
                AvatarView(user: first, size: innerSize)
                    .overlay {
                        Circle().stroke(FBColor.surface, lineWidth: max(1.5, size * 0.04))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(users.map { $0.firstName }.joined(separator: ", "))
    }

    private var innerSize: CGFloat { size * 0.7 }
}

/// The avatar for a chat: one person (with the green dot) or two overlapping group members.
struct MessengerConversationAvatar: View {
    let conversation: Conversation
    var size: CGFloat = FBAvatarSize.row
    var showsOnline: Bool = true

    var body: some View {
        if conversation.isGroup {
            MessengerGroupAvatar(users: conversation.participants, size: size)
                .overlay(alignment: .bottomTrailing) {
                    if showsOnline && conversation.participants.contains(where: { $0.isOnline }) {
                        Circle()
                            .fill(FBColor.online)
                            .frame(width: dotSize, height: dotSize)
                            .overlay {
                                Circle().stroke(FBColor.surface, lineWidth: max(2, size * 0.05))
                            }
                    }
                }
        } else if let user = conversation.primaryUser {
            AvatarView(user: user, size: size, showsOnline: showsOnline)
        } else {
            Circle()
                .fill(FBColor.buttonGray)
                .frame(width: size, height: size)
        }
    }

    private var dotSize: CGFloat { max(10, size * 0.26) }
}

// MARK: - Styles and helpers

/// A row that turns light gray while pressed.
struct MessengerRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? FBColor.inputBackground : Color.clear)
            .contentShape(Rectangle())
    }
}

extension View {
    /// Removes List row chrome so custom Messenger rows draw edge to edge.
    func messengerListRow(background: Color = FBColor.surface) -> some View {
        self
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(background)
    }
}

extension Conversation {
    /// Every photo in the chat, oldest first, for `PhotoViewer`.
    var messengerPhotoMedia: [Media] {
        messages
            .filter { $0.isImage && !$0.isUnsent }
            .map { Media(id: $0.id, kind: .photo, url: $0.imageURL, data: $0.imageData, aspectRatio: 0.85) }
    }
}

// MARK: - Message layout

/// One message plus how it sits among its neighbours.
struct MessengerRowModel: Identifiable {
    let message: Message
    let sender: User?
    let isFromMe: Bool
    /// Same sender as the message above, with no timestamp in between.
    let joinsPrevious: Bool
    /// Same sender as the message below, with no timestamp in between.
    let joinsNext: Bool
    /// Draws a timestamp separator above the message.
    let showsTimestamp: Bool
    /// The message this one replies to.
    let quoted: Message?
    let quotedSender: User?

    var id: String { message.id }

    /// Incoming runs show the sender's avatar next to their last bubble only.
    var showsAvatar: Bool { !isFromMe && !joinsNext }
}

// MARK: - Store helpers

extension AppStore {
    /// The person who sent `message`, looked up among the chat's participants first.
    func messengerSender(of message: Message, in conversation: Conversation) -> User? {
        if message.senderID == me.id { return me }
        if let participant = conversation.participants.first(where: { $0.id == message.senderID }) {
            return participant
        }
        return user(id: message.senderID)
    }

    /// Chat list preview: "You: See you soon", "Maria: Haha" (groups), "Maria sent a photo".
    func messengerPreview(for conversation: Conversation) -> String {
        guard let last = conversation.lastMessage else {
            if conversation.isGroup { return "You created this group" }
            let name = conversation.primaryUser?.firstName ?? "your friend"
            return "Say hi to \(name)!"
        }
        let isMine = last.senderID == me.id
        let name = isMine ? "You" : (messengerSender(of: last, in: conversation)?.firstName ?? "Someone")
        if last.isUnsent { return "\(name) unsent a message" }
        if last.isImage { return "\(name) sent a photo" }
        if isMine { return "You: \(last.previewText)" }
        if conversation.isGroup { return "\(name): \(last.previewText)" }
        return last.previewText
    }

    func messengerConversations(for filter: MessengerInboxFilter) -> [Conversation] {
        switch filter {
        case .all:
            return inboxConversations
        case .unread:
            return inboxConversations.filter { $0.unreadCount > 0 }
        case .groups:
            return inboxConversations.filter { $0.isGroup }
        case .archived:
            return archivedConversations.sorted { $0.lastActivity > $1.lastActivity }
        }
    }

    /// Chats whose title or members match `query`, archived ones included.
    func messengerSearchConversations(_ query: String) -> [Conversation] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return [] }
        return (inboxConversations + archivedConversations).filter { conversation in
            if conversation.title.localizedCaseInsensitiveContains(term) { return true }
            return conversation.participants.contains { $0.name.localizedCaseInsensitiveContains(term) }
        }
    }

    /// Friends matching `query` who are not already listed as a one-to-one chat.
    func messengerSearchPeople(_ query: String, excluding chats: [Conversation]) -> [User] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return [] }
        let covered = Set(chats.filter { !$0.isGroup }.compactMap { $0.primaryUser?.id })
        return friends
            .filter { $0.name.localizedCaseInsensitiveContains(term) && !covered.contains($0.id) }
            .sorted { $0.name < $1.name }
    }

    func messengerMarkUnread(_ conversation: Conversation) {
        conversation.unreadCount = max(conversation.unreadCount, 1)
    }

    /// Groups the chat's messages into runs and decides where separators, avatars and joins go.
    func messengerRows(for conversation: Conversation) -> [MessengerRowModel] {
        let messages = conversation.messages
        let byID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var rows: [MessengerRowModel] = []
        rows.reserveCapacity(messages.count)

        for index in messages.indices {
            let message = messages[index]
            let previous: Message? = index > 0 ? messages[index - 1] : nil
            let next: Message? = index + 1 < messages.count ? messages[index + 1] : nil

            var gapBefore = true
            if let previous {
                gapBefore = message.sentAt.timeIntervalSince(previous.sentAt) > MessengerStyle.separatorGap
            }
            var gapAfter = true
            if let next {
                gapAfter = next.sentAt.timeIntervalSince(message.sentAt) > MessengerStyle.separatorGap
            }

            let sameAsPrevious = previous?.senderID == message.senderID
            let sameAsNext = next?.senderID == message.senderID
            let joinsPrevious = !gapBefore && sameAsPrevious && message.replyToID == nil
            let joinsNext = !gapAfter && sameAsNext && next?.replyToID == nil

            var quoted: Message? = nil
            if let replyID = message.replyToID {
                quoted = byID[replyID]
            }
            var quotedSender: User? = nil
            if let quoted {
                quotedSender = messengerSender(of: quoted, in: conversation)
            }

            rows.append(MessengerRowModel(
                message: message,
                sender: messengerSender(of: message, in: conversation),
                isFromMe: message.senderID == me.id,
                joinsPrevious: joinsPrevious,
                joinsNext: joinsNext,
                showsTimestamp: gapBefore,
                quoted: quoted,
                quotedSender: quotedSender
            ))
        }
        return rows
    }
}
