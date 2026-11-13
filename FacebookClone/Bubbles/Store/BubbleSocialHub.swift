import Foundation

/// The shared playable chat-card and Group-post API (docs/BUBBLES.md 7.1). Every feature that puts
/// a game in a chat or a Group goes through here: challenge, remix ("Send it back", share),
/// together (invites and contributions), nextline (quiz night), story (send your path), learn
/// (shared lesson) and groups-search ("Challenge the Group").
///
/// Owner: the "challenge" feature. Challenge and session cards with no session yet start one
/// through `ChallengeCenter` (same seed for everyone, bot plays on short delays, live card
/// updates); every other kind is delivered as is.
@MainActor
enum BubbleSocialHub {
    /// Everyone you can send a card to: friends (1:1 chats), recent chats (group chats first),
    /// then your Groups, then your feed and story. Filter with `kinds`.
    static func targets(appStore: AppStore, kinds: Set<BubbleShareTarget.Kind> = [.friend, .chat, .group]) -> [BubbleShareTarget] {
        var out: [BubbleShareTarget] = []
        if kinds.contains(.friend) {
            // Friends from the New in SF world first (the demo's people), then everyone else.
            let castFriends = BubbleSocialCast.friendIDs.compactMap { appStore.user(id: $0) }.filter { $0.isFriend }
            let rest = appStore.friends.filter { friend in !castFriends.contains { $0.id == friend.id } }
            out += (castFriends + rest).prefix(12).map { BubbleShareTarget(kind: .friend, targetID: $0.id, title: $0.name) }
        }
        if kinds.contains(.chat) {
            // Group chats first (the shared ones from the demo world lead), then recent 1:1 chats.
            let live = appStore.conversations.filter { !$0.isArchived }
            let castIDs = BubbleSocialCast.chats.map(\.id)
            let groups = live.filter(\.isGroup).sorted { a, b in
                let ai = castIDs.firstIndex(of: a.id) ?? Int.max
                let bi = castIDs.firstIndex(of: b.id) ?? Int.max
                return ai != bi ? ai < bi : a.lastActivity > b.lastActivity
            }
            let oneToOne = live.filter { !$0.isGroup && !$0.participants.isEmpty }.sorted { $0.lastActivity > $1.lastActivity }
            out += (Array(groups.prefix(4)) + Array(oneToOne.prefix(6))).map { BubbleShareTarget(kind: .chat, targetID: $0.id, title: $0.title) }
        }
        if kinds.contains(.group) {
            out += appStore.myGroups.sorted { a, b in
                a.id == BubbleDemo.groupID ? true : (b.id == BubbleDemo.groupID ? false : a.name < b.name)
            }.map { BubbleShareTarget(kind: .group, targetID: $0.id, title: $0.name) }
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
    ///
    /// A `.challenge` or `.session` card with no `sessionID` starts one (docs/BUBBLES.md 7.2): a
    /// 1:1 chat or a friend gets a same-seed challenge; a group chat or a Group gets a shared
    /// session. The card's session id and live extras are filled in, and the other side's bot
    /// runs start on short delays.
    @discardableResult
    static func send(_ card: BubbleChatCard, to target: BubbleShareTarget, note: String? = nil, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        let startsChallenge = (card.kind == .challenge || card.kind == .session) && card.sessionID == nil
        switch target.kind {
        case .friend, .chat:
            guard let chat = conversation(for: target, appStore: appStore, bubbleStore: bubbleStore) else { return false }
            var card = card
            var start: (() -> Void)?
            if startsChallenge, let opened = ChallengeCenter.shared.open(card, to: target, chat: chat, group: nil) {
                card = opened.0
                start = opened.1
            }
            append(card, from: appStore.me.id, text: note, in: chat, appStore: appStore)
            start?()
            return true
        case .group, .feed:
            let group = target.kind == .group ? appStore.group(id: target.targetID) : nil
            if target.kind == .group && group == nil { return false }
            var card = card
            var start: (() -> Void)?
            if startsChallenge, let group, let opened = ChallengeCenter.shared.open(card, to: target, chat: nil, group: group) {
                card = opened.0
                start = opened.1
            }
            let post = appStore.createPost(text: note ?? card.headline, audience: group == nil ? .friends : .everyone, group: group)
            post.bubbleID = card.bubbleID
            post.bubbleCard = card
            post.isUploading = false
            start?()
            return true
        case .story:
            return false
        }
    }

    /// A card (or a reply to one) from someone else arrives in a chat: a friend's simulated
    /// score, a contribution, a rematch.
    static func receive(_ card: BubbleChatCard, from user: User, in conversation: Conversation, text: String? = nil, appStore: AppStore) {
        append(card, from: user.id, text: text, in: conversation, appStore: appStore)
        if appStore.openConversationID != conversation.id {
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
    /// Challenge and session cards fill in their own context (opponent, score to beat) when
    /// `context` is nil.
    ///
    /// Cards live in Messenger and in feature sheets, which MainTabView presents like the player.
    /// SwiftUI shows one of them at a time, so those close first and the player opens just after.
    static func play(_ card: BubbleChatCard, router: Router, context: BubblePlayContext? = nil) {
        let context = context ?? ChallengeCenter.shared.playContext(for: card)
        let request = BubblePlayRequest(bubbleID: card.bubbleID, seed: card.seed, length: card.length, context: context)
        var closed = false
        if router.isMessengerPresented { router.isMessengerPresented = false; closed = true }
        if router.bubbleSheet != nil { router.bubbleSheet = nil; closed = true }
        guard closed else {
            router.play(request)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { router.play(request) }
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
