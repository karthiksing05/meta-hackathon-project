import Foundation

/// The shared playable chat-card and Group-post API (docs/BUBBLES.md 7.1). Every feature that puts
/// a game in a chat or a Group goes through here: challenge, remix ("Send it back", share),
/// together (invites and contributions), nextline (quiz night), story (send your path), learn
/// (shared lesson) and groups-search ("Challenge the Group").
///
/// Owner: the "challenge" feature. feat/base ships a minimal working version (cards land in the
/// chat or the Group feed, and play the card's seed and length) so other features can build and
/// demo before challenge lands; challenge replaces the bodies, keeping these signatures.
@MainActor
enum BubbleSocialHub {
    /// Everyone you can send a card to: friends (1:1 chats), recent chats (group chats first),
    /// then your Groups, then your feed and story. Filter with `kinds`.
    static func targets(appStore: AppStore, kinds: Set<BubbleShareTarget.Kind> = [.friend, .chat, .group]) -> [BubbleShareTarget] {
        var out: [BubbleShareTarget] = []
        if kinds.contains(.chat) {
            let chats = appStore.conversations.filter { !$0.isArchived }.sorted { a, b in
                a.isGroup != b.isGroup ? a.isGroup : a.lastActivity > b.lastActivity
            }
            out += chats.prefix(8).map { BubbleShareTarget(kind: .chat, targetID: $0.id, title: $0.title) }
        }
        if kinds.contains(.friend) {
            out += appStore.friends.prefix(12).map { BubbleShareTarget(kind: .friend, targetID: $0.id, title: $0.name) }
        }
        if kinds.contains(.group) {
            out += appStore.myGroups.map { BubbleShareTarget(kind: .group, targetID: $0.id, title: $0.name) }
        }
        if kinds.contains(.feed) {
            out.append(BubbleShareTarget(kind: .feed, title: "Your feed"))
        }
        if kinds.contains(.story) {
            out.append(BubbleShareTarget(kind: .story, title: "Your story"))
        }
        return out
    }

    /// The Messenger chat a target means (friend → your 1:1 chat, started if needed).
    static func conversation(for target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore) -> Conversation? {
        switch target.kind {
        case .chat:
            return appStore.conversations.first { $0.id == target.targetID }
        case .friend:
            return appStore.conversation(with: appStore.user(id: target.targetID) ?? bubbleStore.resolvePerson(target.targetID))
        case .group, .feed, .story:
            return nil
        }
    }

    /// Sends a card from you. Chats get a message carrying the card; a Group or your feed gets a
    /// post carrying it. Returns false when the target can't take a card (story: use
    /// `BubbleSurfaceHooks.shareToStory`).
    @discardableResult
    static func send(_ card: BubbleChatCard, to target: BubbleShareTarget, note: String? = nil, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        switch target.kind {
        case .friend, .chat:
            guard let chat = conversation(for: target, appStore: appStore, bubbleStore: bubbleStore) else { return false }
            append(card, from: appStore.me.id, text: note, in: chat, appStore: appStore)
            return true
        case .group, .feed:
            let group = target.kind == .group ? appStore.group(id: target.targetID) : nil
            if target.kind == .group && group == nil { return false }
            let post = appStore.createPost(text: note ?? card.headline, audience: group == nil ? .friends : .everyone, group: group)
            post.bubbleID = card.bubbleID
            post.bubbleCard = card
            post.isUploading = false
            return true
        case .story:
            return false
        }
    }

    /// A card (or a reply to one) from someone else arrives in a chat: a friend's simulated
    /// score, a contribution, a rematch.
    static func receive(_ card: BubbleChatCard, from user: User, in conversation: Conversation, text: String? = nil, appStore: AppStore) {
        append(card, from: user.id, text: text, in: conversation, appStore: appStore)
        if appStore.conversations.first?.id != conversation.id {
            conversation.unreadCount += 1
        }
    }

    /// Changes a card wherever it is (every chat message and post carrying `cardID`), e.g.
    /// "3 of 5 played" or a winner line.
    static func update(cardID: String, appStore: AppStore, _ change: (inout BubbleChatCard) -> Void) {
        for chat in appStore.conversations {
            for index in chat.messages.indices where chat.messages[index].bubbleCard?.id == cardID {
                if var card = chat.messages[index].bubbleCard {
                    change(&card)
                    chat.messages[index].bubbleCard = card
                }
            }
        }
        for post in appStore.posts where post.bubbleCard?.id == cardID {
            if var card = post.bubbleCard {
                change(&card)
                post.bubbleCard = card
            }
        }
    }

    /// Plays a card: the card's seed and length, with its context, so the play is a fair
    /// head-to-head and stays verifiable.
    static func play(_ card: BubbleChatCard, router: Router, context: BubblePlayContext? = nil) {
        router.play(BubblePlayRequest(bubbleID: card.bubbleID, seed: card.seed, length: card.length, context: context))
    }

    // MARK: Helpers

    private static func append(_ card: BubbleChatCard, from senderID: String, text: String?, in chat: Conversation, appStore: AppStore) {
        var message = Message(senderID: senderID, text: text, status: senderID == appStore.me.id ? .sent : .seen)
        message.bubbleCard = card
        chat.messages.append(message)
        chat.isArchived = false
        if let index = appStore.conversations.firstIndex(where: { $0.id == chat.id }), index != 0 {
            appStore.conversations.remove(at: index)
            appStore.conversations.insert(chat, at: 0)
        }
    }
}
