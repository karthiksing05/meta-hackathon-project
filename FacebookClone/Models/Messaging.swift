import Foundation
import Observation

enum MessageStatus: String, Hashable {
    case sending
    case sent
    case delivered
    case seen
}

struct Message: Identifiable, Hashable {
    let id: String
    var senderID: String
    var text: String?
    var imageURL: URL?
    var imageData: Data?
    /// The conversation's quick emoji, sent large (👍 by default).
    var bigEmoji: String?
    var sentAt: Date
    /// User ID -> emoji.
    var reactions: [String: String]
    var replyToID: String?
    var status: MessageStatus
    var isUnsent: Bool
    /// Bubbles: a playable card (challenge, group-chat session, share…). Rendered by
    /// `BubbleChatCardView`; sent through `BubbleSocialHub` (docs/BUBBLES.md 7.1).
    var bubbleCard: BubbleChatCard? = nil

    init(
        id: String = UUID().uuidString,
        senderID: String,
        text: String? = nil,
        imageURL: URL? = nil,
        imageData: Data? = nil,
        bigEmoji: String? = nil,
        sentAt: Date = Date(),
        reactions: [String: String] = [:],
        replyToID: String? = nil,
        status: MessageStatus = .seen,
        isUnsent: Bool = false
    ) {
        self.id = id
        self.senderID = senderID
        self.text = text
        self.imageURL = imageURL
        self.imageData = imageData
        self.bigEmoji = bigEmoji
        self.sentAt = sentAt
        self.reactions = reactions
        self.replyToID = replyToID
        self.status = status
        self.isUnsent = isUnsent
    }

    var isImage: Bool { imageURL != nil || imageData != nil }

    /// One-line preview for the chat list.
    var previewText: String {
        if isUnsent { return "Unsent a message" }
        if let card = bubbleCard { return text ?? card.headline }
        if let text { return text }
        if isImage { return "Sent a photo" }
        if let bigEmoji { return bigEmoji }
        return ""
    }
}

@Observable
final class Conversation: Identifiable, Hashable {
    let id: String
    /// Everyone in the chat except the signed-in user.
    var participants: [User]
    var groupName: String?
    var messages: [Message]
    var isMuted: Bool
    var isPinned: Bool
    var isArchived: Bool
    var unreadCount: Int
    var isTyping: Bool
    /// Bubble color for outgoing messages.
    var themeHex: UInt32
    var quickEmoji: String

    init(
        id: String = UUID().uuidString,
        participants: [User],
        groupName: String? = nil,
        messages: [Message] = [],
        isMuted: Bool = false,
        isPinned: Bool = false,
        isArchived: Bool = false,
        unreadCount: Int = 0,
        themeHex: UInt32 = 0x0A7CFF,
        quickEmoji: String = "👍"
    ) {
        self.id = id
        self.participants = participants
        self.groupName = groupName
        self.messages = messages
        self.isMuted = isMuted
        self.isPinned = isPinned
        self.isArchived = isArchived
        self.unreadCount = unreadCount
        self.isTyping = false
        self.themeHex = themeHex
        self.quickEmoji = quickEmoji
    }

    var isGroup: Bool { participants.count > 1 }

    var title: String {
        if let groupName { return groupName }
        if participants.count == 1 { return participants[0].name }
        return participants.map { $0.firstName }.joined(separator: ", ")
    }

    var primaryUser: User? { participants.first }
    var lastMessage: Message? { messages.last }
    var lastActivity: Date { messages.last?.sentAt ?? .distantPast }

    static func == (lhs: Conversation, rhs: Conversation) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
