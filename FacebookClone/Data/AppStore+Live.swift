import Foundation
import UIKit

/// Where the Home feed, Reels, Stories and Messenger come from right now.
enum FacebookSource: Equatable {
    /// The built-in mock world (`FB_API=mock`, previews, or before the first server reply).
    case mock
    /// The server (`/v1/fb/*`).
    case live
    /// The server couldn't be reached, so the mock world stays on screen.
    case offline
}

/// Bookkeeping for the live surfaces. Not observed: screens read the store's collections.
final class FacebookLiveState {
    /// The feed came from the server, so paging and writes go there too.
    var feedIsLive = false
    var messengerIsLive = false
    var postCursor: String?
    var isLoadingMore = false
    /// Ids of posts the server knows (its own and the ones we published), so a refresh adds only new ones.
    var serverPostIDs: Set<String> = []
    /// Local chat id -> server thread id (a server chat keeps its id; a chat started here gets one on first send).
    var threadIDs: [String: String] = [:]
    /// People the server knows (Personas and accounts), so a new chat with them can live on the server.
    var serverPeople: Set<String> = []
    /// The signed-in account's server id: its posts and messages are "me" in the app.
    var accountID: String?
    var started = false
    /// Server message ids already in a chat (loaded, merged, or the server's copy of one sent here),
    /// so polling never adds a message twice.
    var knownMessageIDs: Set<String> = []
    /// Messages sent from this phone that the server has confirmed (by the send or by a poll).
    var confirmedLocalIDs: Set<String> = []
    /// Game cards sent from this phone: local message id -> the game id sent to the server, so the
    /// server's copy of a card pairs with the one already on screen.
    var cardGameIDs: [String: String] = [:]
    /// Polls the server for new messages while the app is in front.
    var messengerPoll: Task<Void, Never>?
    var isRefreshingThreads = false
    var isLoadingMessenger = false
}

// MARK: - Loading

extension AppStore {
    /// Loads posts, reels and stories (no sign-in needed), then Messenger once the account is signed in.
    /// Any failure keeps the mock world and shows one quiet toast. Called once from `init`.
    func startLiveFacebook() {
        guard FacebookDataMode.current == .live, !live.started else { return }
        live.started = true
        Task { @MainActor [weak self] in
            await self?.loadLiveContent()
            await self?.loadLiveMessenger()
            self?.startMessengerPolling()
        }
    }

    @MainActor
    private func loadLiveContent() async {
        let api = FacebookAPILive.shared
        do {
            async let page = api.posts(limit: 20)
            async let reelPage = api.reels(limit: 30)
            async let trays = api.stories()
            let (feed, reelItems, storyGroups) = try await (page, reelPage, trays)
            applyLivePosts(feed)
            applyLiveReels(reelItems.items)
            applyLiveStories(storyGroups)
            facebookSource = .live
        } catch {
            fellBackToMock(error)
        }
    }

    /// Loads the signed-in account's chats. At launch it waits (up to a minute) for the sign-in and
    /// reports a failure; later (a log in, or another account) it runs from the poll and stays quiet.
    @MainActor
    private func loadLiveMessenger(atLaunch: Bool = true) async {
        // One load at a time (the launch load and a refresh can overlap).
        guard !live.isLoadingMessenger else { return }
        live.isLoadingMessenger = true
        defer { live.isLoadingMessenger = false }
        for _ in 0..<(atLaunch ? 60 : 0) {
            if GamesAccount.shared.state == .signedIn { break }
            if case .failed = GamesAccount.shared.state { return }
            if GamesAccount.shared.state == .signedOut { return }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
        guard GamesAccount.shared.state == .signedIn else { return }
        let accountID = GamesAccount.shared.userID
        if live.accountID != accountID {
            // Another account: none of the last one's messages count as seen here.
            live.knownMessageIDs = []
            live.confirmedLocalIDs = []
            live.cardGameIDs = [:]
            live.threadIDs = [:]
        }
        live.accountID = accountID
        await applyLiveIdentity()
        do {
            let threads = try await FacebookAPILive.shared.threads(messages: 30)
            applyLiveThreads(threads)
            live.messengerIsLive = true
        } catch {
            if atLaunch { fellBackToMock(error) }
        }
    }

    /// The signed-in account becomes "me" (name and cartoon avatar), unless it is this phone's guest
    /// account, which keeps the demo identity. The account's server friends join `people` as friends.
    /// Best effort: on any failure the mock identity and friends stay.
    @MainActor
    private func applyLiveIdentity() async {
        guard let accountID = live.accountID else { return }
        let friendProfiles = (try? await GamesAPILive.shared.friends()) ?? []
        let ids = [accountID] + friendProfiles.map(\.id)
        guard let found = try? await FacebookAPILive.shared.people(ids: ids) else { return }
        if let mine = found.first(where: { $0.id == accountID }), !GamesAccount.shared.isGuest {
            me.firstName = mine.firstName
            me.lastName = mine.lastName ?? ""
            if let avatar = PersonAvatarURL.displayable(mine.avatarUrl) { me.avatarURL = avatar }
            if let bio = mine.bio, !bio.isEmpty { me.bio = bio }
        }
        for person in found where person.id != accountID {
            let user = liveUser(person)
            if !user.isPage { user.friendship = .friends }
        }
        me.friendCount = friends.count
    }

    @MainActor
    private func fellBackToMock(_ error: Error) {
        guard facebookSource != .offline else { return }
        if facebookSource == .mock { facebookSource = .offline }
        print("[facebook-live] using the built-in world: \(error.localizedDescription)")
        showToast("Offline: showing saved posts and chats", symbol: "icloud.slash")
    }

    // MARK: Mapping

    /// The app's `User` for a server person: the signed-in user, someone already in the store
    /// (refreshed with the server's details), or a new person added to `people` / `pages`.
    func liveUser(_ remote: RemoteFBPerson) -> User {
        if remote.isMe == true || remote.id == live.accountID { return me }
        live.serverPeople.insert(remote.id)
        let avatar = PersonAvatarURL.displayable(remote.avatarUrl)
        if let existing = user(id: remote.id) {
            if let avatar { existing.avatarURL = avatar }
            if let cover = remote.coverUrl.flatMap(URL.init(string:)) { existing.coverURL = cover }
            return existing
        }
        let isPage = remote.kind == "page"
        let seed = Int(SeededGenerator.stableHash(remote.id) % 100_000)
        let user = User(
            id: remote.id,
            firstName: remote.firstName,
            lastName: remote.lastName ?? "",
            kind: isPage ? .page : .person,
            category: remote.category,
            avatarURL: avatar,
            coverURL: remote.coverUrl.flatMap(URL.init(string:)),
            bio: remote.bio ?? "",
            city: remote.city ?? "",
            work: remote.work ?? "",
            friendCount: isPage ? 0 : 120 + seed % 400,
            followerCount: isPage ? 1_200 + seed % 30_000 : 0,
            friendship: isPage ? .none : .friends,
            isFollowing: true,
            isOnline: seed % 3 == 0,
            lastActive: Date().addingTimeInterval(-Double(seed % 600) * 60),
            isVerified: remote.verified ?? false
        )
        if isPage { pages.append(user) } else { people.append(user) }
        return user
    }

    private func liveMedia(_ m: RemoteFBMedia) -> Media {
        let url = m.url.flatMap(URL.init(string:))
        if m.kind == "video" {
            return .video(poster: url, url: m.videoUrl.flatMap(URL.init(string:)), aspectRatio: m.aspect ?? 9.0 / 16.0, duration: m.duration ?? 15)
        }
        return .photo(url, aspectRatio: m.aspect ?? 1)
    }

    func livePost(_ r: RemoteFBPost) -> Post {
        var counts: [ReactionType: Int] = [:]
        for (key, n) in r.reactions ?? [:] {
            if let type = ReactionType(rawValue: key) { counts[type, default: 0] += n }
        }
        let comments = (r.comments ?? []).map { Comment(id: $0.id, author: liveUser($0.author), text: $0.text, createdAt: $0.createdAt) }
        let post = Post(
            id: r.id,
            author: liveUser(r.author),
            group: r.groupId.flatMap { group(id: $0) },
            text: r.text,
            backgroundIndex: r.background.map { $0 % max(PostBackground.presets.count, 1) },
            media: (r.media ?? []).map(liveMedia),
            poll: r.poll.map { Poll(options: $0.map { PollOption(id: $0.id, title: $0.title, votes: $0.votes) }) },
            feeling: r.feeling.flatMap { name in Feeling.all.first { $0.name == name } },
            location: r.location,
            lifeEvent: r.lifeEvent.map { LifeEvent(title: $0, subtitle: nil, symbol: "briefcase.fill") },
            createdAt: r.createdAt,
            audience: .everyone,
            isSponsored: r.sponsored ?? false,
            sponsorCTA: (r.sponsored ?? false) ? "Learn more" : nil,
            isReel: r.kind == "reel",
            audioTitle: r.audio,
            reactionCounts: counts,
            myReaction: r.myReaction.flatMap(ReactionType.init(rawValue:)),
            reactors: Array(comments.map(\.author).filter { !$0.isMe }.prefix(1)),
            comments: comments,
            shareCount: r.shares ?? 0,
            viewCount: r.views ?? 0
        )
        post.allowsBubbles = r.allowsGames ?? false
        if let gameID = r.gameId, !gameID.isEmpty { post.bubbleID = gameID }
        live.serverPostIDs.insert(r.id)
        return post
    }

    /// The server's first page replaces the mock feed. Game posts made on this phone stay.
    @MainActor
    private func applyLivePosts(_ page: RemoteFBPostPage) {
        let fresh = page.items.map(livePost)
        let kept = posts.filter { $0.bubbleID != nil || $0.bubbleCard != nil || $0.isUploading }
        posts = (fresh + kept).sorted { $0.createdAt > $1.createdAt }
        feedBuffer = []
        live.postCursor = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
        live.feedIsLive = true
        imagePrefetcher(fresh.flatMap(\.imageURLs))
    }

    @MainActor
    private func applyLiveReels(_ items: [RemoteFBPost]) {
        let fresh = items.map(livePost)
        reels = fresh + reels.filter { $0.bubbleID != nil }
    }

    @MainActor
    private func applyLiveStories(_ groups: [RemoteFBStoryGroup]) {
        var tray: [Story] = []
        for g in groups {
            let author = liveUser(g.author)
            let items = g.items.map { item -> StoryItem in
                let content: StoryContent
                if let text = item.text, item.media == nil {
                    content = .text(text, backgroundIndex: (item.background ?? 0) % max(PostBackground.presets.count, 1))
                } else {
                    content = .photo(item.media?.url.flatMap(URL.init(string:)))
                }
                return StoryItem(id: item.id, content: content, createdAt: item.createdAt, duration: 5,
                                 caption: (item.caption?.isEmpty ?? true) ? nil : item.caption,
                                 viewerCount: 3 + Int(SeededGenerator.stableHash(item.id) % 120))
            }
            guard !items.isEmpty else { continue }
            if author.isMe {
                myStory = Story(id: "story-me", author: me, items: items, seenItemIDs: Set(items.map(\.id)))
            } else {
                tray.append(Story(id: "story-\(author.id)", author: author, items: items))
            }
        }
        stories = tray
    }

    private func liveMessage(_ m: RemoteFBMessage) -> Message {
        let sender = m.senderId == live.accountID ? me.id : m.senderId
        if let gameID = m.gameId, !gameID.isEmpty {
            // A Curio shared or challenged into the chat: the same playable card the sender sees. The card
            // view loads the game (`BubbleStore.loadGame`), and Play opens it.
            let isChallenge = m.kind == "challenge"
            let headline = m.text.flatMap { $0.isEmpty ? nil : $0 }
                ?? (isChallenge ? (m.score.map { "Beat my \($0.withCommas)" } ?? "Can you beat me?") : "Play this with me")
            let card = BubbleChatCard(id: m.id, kind: isChallenge ? .challenge : .share, bubbleID: gameID,
                                      fromUserID: sender, headline: headline, score: isChallenge ? m.score : nil)
            var message = Message(id: m.id, senderID: sender, sentAt: m.sentAt, status: .seen)
            message.bubbleCard = card
            return message
        }
        return Message(id: m.id, senderID: sender, text: m.text, imageURL: m.imageUrl.flatMap(URL.init(string:)),
                       bigEmoji: m.emoji, sentAt: m.sentAt, status: .seen)
    }

    /// A game card on this phone the server doesn't have (yet): not sent, refused, or a chat that
    /// isn't on the server (mock people). Those stay when the server's chats load.
    private func isLocalOnlyCard(_ message: Message) -> Bool {
        message.bubbleCard != nil && !live.knownMessageIDs.contains(message.id) && !live.confirmedLocalIDs.contains(message.id)
    }

    /// A chat for a server thread, with the given messages.
    @MainActor
    private func liveConversation(for t: RemoteFBThread, messages: [RemoteFBMessage]) -> Conversation {
        let theme = t.theme.flatMap { UInt32($0, radix: 16) } ?? 0x0A7CFF
        live.threadIDs[t.id] = t.id
        live.knownMessageIDs.formUnion(messages.map(\.id))
        return Conversation(
            id: t.id,
            participants: t.members.map(liveUser),
            groupName: t.name,
            messages: messages.map(liveMessage),
            unreadCount: t.unread,
            themeHex: theme,
            quickEmoji: t.emoji ?? "👍"
        )
    }

    /// Server chats replace the mock ones. Game cards now live on the server like any message; cards
    /// only this phone has (a chat with mock people, or a send the server refused) stay, and so do
    /// chats holding them. A chat already on screen keeps its object (screens hold on to it) and
    /// takes the server's messages.
    @MainActor
    private func applyLiveThreads(_ threads: [RemoteFBThread]) {
        let fresh = threads.map { t -> Conversation in
            let messages = t.messages ?? []
            guard let existing = conversations.first(where: { $0.id == t.id }) else {
                return liveConversation(for: t, messages: messages)
            }
            live.threadIDs[t.id] = t.id
            let localCards = existing.messages.filter(isLocalOnlyCard)
            live.knownMessageIDs.formUnion(messages.map(\.id))
            existing.messages = (messages.map(liveMessage) + localCards).sorted { $0.sentAt < $1.sentAt }
            existing.unreadCount = openConversationID == t.id ? 0 : t.unread
            return existing
        }
        let freshIDs = Set(fresh.map(\.id))
        let kept = conversations.filter { chat in !freshIDs.contains(chat.id) && chat.messages.contains(where: isLocalOnlyCard) }
        conversations = (fresh + kept).sorted { $0.lastActivity > $1.lastActivity }
    }

    // MARK: Messenger: messages from other phones

    /// Checks the server for new messages while the app is in front: every 2 s with a chat open,
    /// every 5 s otherwise, and right away when the app comes back to the foreground. Started once.
    @MainActor
    private func startMessengerPolling() {
        guard live.messengerPoll == nil else { return }
        live.messengerPoll = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                let chatOpen = self?.openConversationID != nil
                try? await Task.sleep(nanoseconds: chatOpen ? 2_000_000_000 : 5_000_000_000)
                guard let self, !Task.isCancelled else { return }
                guard UIApplication.shared.applicationState == .active else { continue }
                await self.refreshLiveThreads()
            }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.refreshLiveThreads() }
        }
    }

    /// Pulls the latest messages and merges them in: new chats appear, new messages land at the end
    /// of their chat, and nothing already on screen (including messages sent from this phone) is
    /// added twice. After a log in or a switch of account it loads that account's chats first.
    /// Returns false when Messenger can't be live (mock mode, or nobody signed in).
    @MainActor
    @discardableResult
    func refreshLiveThreads() async -> Bool {
        guard FacebookDataMode.current == .live, GamesAccount.shared.state == .signedIn else { return false }
        guard !live.isRefreshingThreads else { return true }
        live.isRefreshingThreads = true
        defer { live.isRefreshingThreads = false }
        if !live.messengerIsLive || live.accountID != GamesAccount.shared.userID {
            await loadLiveMessenger(atLaunch: false)
            return live.messengerIsLive
        }
        guard let threads = try? await FacebookAPILive.shared.threads(messages: 20) else { return true }
        // A Persona's reply is stored a few seconds ahead; the send shows it after a typing pause.
        let now = Date().addingTimeInterval(1)
        for t in threads {
            let incoming = (t.messages ?? [])
                .filter { !live.knownMessageIDs.contains($0.id) && $0.sentAt <= now }
                .sorted { $0.sentAt < $1.sentAt }
            if let chat = conversations.first(where: { $0.id == t.id || live.threadIDs[$0.id] == t.id }) {
                mergeLive(incoming, into: chat, serverUnread: t.unread)
            } else if !incoming.isEmpty {
                let chat = liveConversation(for: t, messages: incoming)
                if openConversationID == chat.id { chat.unreadCount = 0 }
                conversations.insert(chat, at: 0)
            }
        }
        return true
    }

    /// Adds a chat's new server messages, pairing my own with the copy this phone already shows.
    @MainActor
    private func mergeLive(_ incoming: [RemoteFBMessage], into chat: Conversation, serverUnread: Int) {
        var changed = false
        var fromOthers = 0
        for m in incoming {
            live.knownMessageIDs.insert(m.id)
            if chat.messages.contains(where: { $0.id == m.id }) { continue }
            if m.senderId == live.accountID, adoptEcho(of: m, in: chat) { continue }
            chat.messages.append(liveMessage(m))
            changed = true
            if m.senderId != live.accountID { fromOthers += 1 }
        }
        guard changed else { return }
        chat.isArchived = false
        if fromOthers > 0 {
            chat.isTyping = false
            if openConversationID == chat.id {
                liveMarkRead(chat)
            } else {
                chat.unreadCount = max(serverUnread, chat.unreadCount + fromOthers)
            }
        }
        if let index = conversations.firstIndex(where: { $0.id == chat.id }), index != 0 {
            conversations.remove(at: index)
            conversations.insert(chat, at: 0)
        }
    }

    /// A message of mine the server has and this phone shows under its own id (the poll arrived
    /// before the send finished): mark the local one confirmed instead of adding a second copy.
    /// Game cards pair by game id, text by text and emoji.
    @MainActor
    private func adoptEcho(of m: RemoteFBMessage, in chat: Conversation) -> Bool {
        let gameID = m.gameId.flatMap { $0.isEmpty ? nil : $0 }
        guard let local = chat.messages.first(where: { local in
            guard local.senderID == me.id, !local.isImage,
                  !live.confirmedLocalIDs.contains(local.id), !live.knownMessageIDs.contains(local.id) else { return false }
            if let gameID {
                guard let card = local.bubbleCard else { return false }
                return live.cardGameIDs[local.id] == gameID || card.bubbleID == gameID
            }
            return local.bubbleCard == nil && local.text == m.text && local.bigEmoji == m.emoji
        }) else { return false }
        live.confirmedLocalIDs.insert(local.id)
        return true
    }

    // MARK: Feed paging and refresh

    /// Live replacement for the buffer paging. Returns false when the feed isn't live.
    func loadMoreLiveIfNeeded(currentPost post: Post) -> Bool {
        guard live.feedIsLive else { return false }
        let feed = feedPosts
        guard !live.isLoadingMore, let cursor = live.postCursor,
              let index = feed.firstIndex(where: { $0.id == post.id }), index >= feed.count - 4 else { return true }
        live.isLoadingMore = true
        isLoadingMoreFeed = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.live.isLoadingMore = false; self.isLoadingMoreFeed = false }
            guard let page = try? await FacebookAPILive.shared.posts(cursor: cursor, limit: 20) else { return }
            let known = Set(self.posts.map(\.id))
            let next = page.items.filter { !known.contains($0.id) }.map(self.livePost)
            self.posts.append(contentsOf: next)
            self.live.postCursor = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
            self.imagePrefetcher(next.flatMap(\.imageURLs))
        }
        return true
    }

    /// Pull to refresh on the live feed: new server posts go on top. Returns false when not live.
    @MainActor
    func refreshLiveFeed() async -> Bool {
        guard live.feedIsLive else { return false }
        isRefreshingFeed = true
        defer { isRefreshingFeed = false }
        guard let page = try? await FacebookAPILive.shared.posts(limit: 20) else {
            showToast("Couldn't refresh. Check your connection.", symbol: "icloud.slash")
            return true
        }
        let known = Set(posts.map(\.id)).union(live.serverPostIDs)
        let fresh = page.items.filter { !known.contains($0.id) }.map(livePost)
        posts.insert(contentsOf: fresh, at: 0)
        imagePrefetcher(fresh.flatMap(\.imageURLs))
        return true
    }

    // MARK: Writes (best effort: the screen already shows the change)

    func liveReact(_ post: Post) {
        guard live.feedIsLive, live.serverPostIDs.contains(post.id) else { return }
        let type = post.myReaction?.rawValue
        Task { try? await FacebookAPILive.shared.setReaction(type, postID: post.id) }
    }

    func liveComment(_ comment: Comment, on post: Post, isReply: Bool) {
        guard live.feedIsLive, !isReply, !comment.text.isEmpty, live.serverPostIDs.contains(post.id) else { return }
        Task { _ = try? await FacebookAPILive.shared.comment(comment.text, postID: post.id) }
    }

    /// Publishes a text post (photos picked on the phone stay local: there is no upload route yet).
    func livePublish(_ post: Post) {
        guard live.feedIsLive, post.media.isEmpty, post.sharedPost == nil, post.poll == nil,
              !post.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let text = post.text, groupID = post.group?.id, background = post.backgroundIndex
        let feeling = post.feeling?.name, location = post.location
        Task { @MainActor [weak self] in
            // Read here, not above: a game post gets its game right after `createPost` returns.
            let gameID = post.bubbleID
            // A guest (this phone's device account) keeps game posts on this phone's feed, like
            // its profile, which keeps the demo identity and saves nothing to the server.
            if gameID != nil, GamesAccount.shared.isGuest { return }
            guard let made = try? await FacebookAPILive.shared.createPost(
                text: text, groupID: groupID, background: background, feeling: feeling, location: location,
                gameID: gameID) else { return }
            self?.live.serverPostIDs.insert(made.id)
        }
    }

    func liveStory(_ item: StoryItem) {
        guard live.feedIsLive, case .text(let text, let background) = item.content else { return }
        let caption = item.caption
        Task { _ = try? await FacebookAPILive.shared.createTextStory(text, background: background, caption: caption) }
    }

    /// Sends a message on the server when the chat lives there (or can: everyone in it is known to the
    /// server). The demo person's answer arrives after a typing pause. Returns false to let the mock
    /// reply run instead.
    func sendLive(_ message: Message, in conversation: Conversation) -> Bool {
        guard live.messengerIsLive, message.bubbleCard == nil, !message.isImage else { return false }
        let threadID = live.threadIDs[conversation.id]
        let members = conversation.participants.map(\.id)
        guard threadID != nil || (!members.isEmpty && members.allSatisfy { live.serverPeople.contains($0) }) else { return false }
        let text = message.text, emoji = message.bigEmoji, localID = message.id
        let groupName = conversation.groupName
        Task { @MainActor [weak self] in
            guard let self else { return }
            let api = FacebookAPILive.shared
            do {
                var id = threadID
                if id == nil {
                    id = try await api.createThread(memberIDs: members, name: groupName).id
                    self.live.threadIDs[conversation.id] = id
                }
                guard let id else { return }
                let sent = try await api.sendMessage(threadID: id, text: text, emoji: emoji)
                // The server's copies are already on screen: this message, and the reply shown below.
                self.live.knownMessageIDs.insert(sent.message.id)
                self.live.confirmedLocalIDs.insert(localID)
                if let reply = sent.reply { self.live.knownMessageIDs.insert(reply.id) }
                if let index = conversation.messages.firstIndex(where: { $0.id == localID }) {
                    conversation.messages[index].status = .delivered
                }
                guard let reply = sent.reply, !conversation.messages.contains(where: { $0.id == reply.id }) else { return }
                try? await Task.sleep(nanoseconds: 900_000_000)
                for index in conversation.messages.indices where conversation.messages[index].senderID == self.me.id {
                    conversation.messages[index].status = .seen
                }
                conversation.isTyping = true
                try? await Task.sleep(nanoseconds: 1_800_000_000)
                conversation.isTyping = false
                var answer = self.liveMessage(reply)
                answer.sentAt = Date()
                conversation.messages.append(answer)
                if self.openConversationID != conversation.id { conversation.unreadCount += 1 }
                if let index = self.conversations.firstIndex(where: { $0.id == conversation.id }), index != 0 {
                    self.conversations.remove(at: index)
                    self.conversations.insert(conversation, at: 0)
                }
            } catch {
                if let index = conversation.messages.firstIndex(where: { $0.id == localID }) {
                    conversation.messages[index].status = .sent
                }
                self.showToast("Message not sent. Check your connection.", symbol: "exclamationmark.circle")
            }
        }
        return true
    }

    /// The server's name for a card sent into a chat: "share" or "challenge". Nil for cards that stay on
    /// this phone (co-making, quiz nights, story paths, lessons, and challenge results, which belong to
    /// this phone's challenge).
    static func serverCardKind(_ card: BubbleChatCard) -> String? {
        switch card.kind {
        case .share, .remix: return "share"
        case .challenge, .session: return card.challengeRole == "result" ? nil : "challenge"
        case .contribution, .gameNight, .storyPath, .lesson: return nil
        }
    }

    /// Sends a game card (a Curio shared or challenged into the chat) to the server, so it reaches the
    /// other people's phones. Same chat rules as `sendLive`. If the server can't take it (mock mode, a
    /// chat with mock people, or a game it doesn't have), the card stays on this phone only.
    /// Returns false when the card stays local.
    @MainActor
    @discardableResult
    func sendLiveCard(_ message: Message, gameID: String, in conversation: Conversation) -> Bool {
        guard live.messengerIsLive, let card = message.bubbleCard, let kind = Self.serverCardKind(card),
              !gameID.isEmpty else { return false }
        let threadID = live.threadIDs[conversation.id]
        let members = conversation.participants.map(\.id)
        guard threadID != nil || (!members.isEmpty && members.allSatisfy { live.serverPeople.contains($0) }) else { return false }
        let localID = message.id, groupName = conversation.groupName
        let score = kind == "challenge" ? card.score : nil
        live.cardGameIDs[localID] = gameID
        Task { @MainActor [weak self] in
            guard let self else { return }
            let api = FacebookAPILive.shared
            do {
                var id = threadID
                if id == nil {
                    id = try await api.createThread(memberIDs: members, name: groupName).id
                    self.live.threadIDs[conversation.id] = id
                }
                guard let id else { return }
                let sent = try await api.sendMessage(threadID: id, text: card.headline, emoji: nil, gameID: gameID, kind: kind, score: score)
                // The server's copy is the card already on screen. A Persona's reply arrives with the next poll.
                self.live.knownMessageIDs.insert(sent.message.id)
                self.live.confirmedLocalIDs.insert(localID)
                if conversation.messages.contains(where: { $0.id == sent.message.id }) {
                    // A poll already added the server's copy (sent by slug, stored by id): keep that one.
                    conversation.messages.removeAll { $0.id == localID }
                } else if let index = conversation.messages.firstIndex(where: { $0.id == localID }) {
                    conversation.messages[index].status = .delivered
                }
            } catch {
                // The card stays here (on this phone only), as it did before cards reached the server.
                print("[facebook-live] game card kept on this phone: \(error.localizedDescription)")
            }
        }
        return true
    }

    func liveMarkRead(_ conversation: Conversation) {
        guard live.messengerIsLive, let id = live.threadIDs[conversation.id] else { return }
        Task { try? await FacebookAPILive.shared.markRead(threadID: id) }
    }
}
