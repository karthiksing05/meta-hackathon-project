import Foundation
import Observation

struct Toast: Identifiable, Equatable {
    let id = UUID()
    var message: String
    var symbol: String?
}

struct SearchResults {
    var people: [User] = []
    var pages: [User] = []
    var groups: [FBGroup] = []
    var posts: [Post] = []
    var listings: [Listing] = []
    var events: [FBEvent] = []

    var isEmpty: Bool {
        people.isEmpty && pages.isEmpty && groups.isEmpty && posts.isEmpty && listings.isEmpty && events.isEmpty
    }
}

enum FeedFilter: String, CaseIterable, Identifiable {
    case all
    case favorites
    case friends
    case groups
    case pages

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .favorites: return "Favorites"
        case .friends: return "Friends"
        case .groups: return "Groups"
        case .pages: return "Pages"
        }
    }
}

/// Everything `MockDataFactory` preloads at launch.
struct SeedData {
    var me: User
    var people: [User]
    var pages: [User]
    var groups: [FBGroup]
    var events: [FBEvent]
    var posts: [Post]
    /// Older posts held back and handed out as the user scrolls (infinite feed).
    var feedBuffer: [Post]
    var reels: [Post]
    var watchVideos: [Post]
    var stories: [Story]
    var memories: [Post]
    var notifications: [AppNotification]
    var conversations: [Conversation]
    var listings: [Listing]
    var recentSearches: [String]
}

/// The single source of truth for the app. Front end only: everything is in memory,
/// seeded from `MockDataFactory`, and "server" activity (replies, reactions, new
/// notifications) is simulated with timers so the app feels alive.
///
/// Call it from the main thread (SwiftUI views and their actions).
@Observable
final class AppStore {
    // MARK: Session

    var isLoggedIn = true

    // MARK: Content

    var me: User
    /// Every person except the signed-in user.
    var people: [User]
    var pages: [User]
    var groups: [FBGroup]
    var events: [FBEvent]
    /// Home feed, newest first. Includes group and sponsored posts.
    var posts: [Post]
    var reels: [Post]
    /// Long-form videos for the Video tab.
    var watchVideos: [Post]
    /// Friends' stories.
    var stories: [Story]
    /// The signed-in user's story, once they post one.
    var myStory: Story? = nil
    /// "On this day" posts.
    var memories: [Post]
    var notifications: [AppNotification]
    var conversations: [Conversation]
    var listings: [Listing]
    var recentSearches: [String]
    var dismissedSuggestionIDs: Set<String> = []

    // MARK: Shared UI state

    var toast: Toast? = nil
    /// True for a moment at launch so the feed shows loading placeholders.
    var isFeedLoading = true
    var isRefreshingFeed = false
    var isLoadingMoreFeed = false
    /// Feed videos start muted. Unmuting one unmutes the rest, like the real app.
    var videosMuted = true
    /// The chat on screen right now. Replies there are not counted as unread.
    var openConversationID: String? = nil

    /// Set by the UI layer to warm the image cache for upcoming content.
    @ObservationIgnored var imagePrefetcher: ([URL]) -> Void = { _ in }

    @ObservationIgnored private var factory: MockDataFactory
    @ObservationIgnored private var feedBuffer: [Post]
    @ObservationIgnored private var pendingReplies: Set<String> = []
    @ObservationIgnored private var ambientTimer: Timer?

    private static let recentSearchesKey = "store.recentSearches"

    init(factory: MockDataFactory = MockDataFactory()) {
        let seed = factory.makeSeed()
        self.factory = factory
        self.me = seed.me
        self.people = seed.people
        self.pages = seed.pages
        self.groups = seed.groups
        self.events = seed.events
        self.posts = seed.posts
        self.reels = seed.reels
        self.watchVideos = seed.watchVideos
        self.stories = seed.stories
        self.memories = seed.memories
        self.notifications = seed.notifications
        self.conversations = seed.conversations
        self.listings = seed.listings
        self.feedBuffer = seed.feedBuffer
        self.recentSearches = UserDefaults.standard.stringArray(forKey: AppStore.recentSearchesKey) ?? seed.recentSearches

        after(1.2) { [weak self] in
            self?.isFeedLoading = false
        }
        startAmbientActivity()
    }

    // MARK: - Derived collections

    /// The home feed after snoozes and unfollows. Hidden posts stay so they can show "Undo".
    var feedPosts: [Post] {
        posts.filter { post in
            post.author.isMe || (!post.author.isSnoozed && post.author.isFollowing)
        }
    }

    func feedPosts(filter: FeedFilter) -> [Post] {
        switch filter {
        case .all:
            return feedPosts
        case .favorites:
            return feedPosts.filter { $0.author.isFavorite }
        case .friends:
            return feedPosts.filter { $0.author.isFriend && $0.group == nil }
        case .groups:
            return feedPosts.filter { $0.group != nil }
        case .pages:
            return feedPosts.filter { $0.author.isPage }
        }
    }

    var friends: [User] { people.filter { $0.friendship == .friends } }

    var friendRequests: [User] {
        people
            .filter { $0.friendship == .requestReceived }
            .sorted { ($0.requestDate ?? .distantPast) > ($1.requestDate ?? .distantPast) }
    }

    var sentRequests: [User] { people.filter { $0.friendship == .requestSent } }

    /// People you may know: not friends yet and not dismissed.
    var suggestions: [User] {
        people.filter { person in
            (person.friendship == .none || person.friendship == .requestSent)
                && !dismissedSuggestionIDs.contains(person.id)
        }
    }

    var onlineFriends: [User] { friends.filter { $0.isOnline } }
    var favorites: [User] { (friends + pages).filter { $0.isFavorite } }
    var followedPages: [User] { pages.filter { $0.isFollowing } }
    var birthdaysToday: [User] { friends.filter { $0.hasBirthdayToday } }

    /// Friends with a birthday in the next 60 days (not today), soonest first.
    var upcomingBirthdays: [User] {
        let pairs: [(User, Int)] = friends.compactMap { friend in
            guard let days = daysUntilBirthday(of: friend), days > 0, days <= 60 else { return nil }
            return (friend, days)
        }
        return pairs.sorted { $0.1 < $1.1 }.map { $0.0 }
    }

    var unreadNotificationCount: Int { notifications.filter { !$0.isRead }.count }

    /// Notifications from the last 24 hours.
    var newNotifications: [AppNotification] {
        notifications.filter { Date().timeIntervalSince($0.createdAt) < 86_400 }
    }

    var earlierNotifications: [AppNotification] {
        notifications.filter { Date().timeIntervalSince($0.createdAt) >= 86_400 }
    }

    /// Chats with unread messages (the badge on the Messenger button).
    var unreadChatsCount: Int {
        conversations.filter { $0.unreadCount > 0 && !$0.isArchived }.count
    }

    /// The Messenger inbox: pinned first, then most recent.
    var inboxConversations: [Conversation] {
        conversations
            .filter { !$0.isArchived }
            .sorted { lhs, rhs in
                if lhs.isPinned != rhs.isPinned { return lhs.isPinned }
                return lhs.lastActivity > rhs.lastActivity
            }
    }

    var archivedConversations: [Conversation] { conversations.filter { $0.isArchived } }

    var savedPosts: [Post] {
        (posts + reels + watchVideos + memories).filter { $0.isSaved }
    }

    var savedListings: [Listing] { listings.filter { $0.isSaved } }
    var myListings: [Listing] { listings.filter { $0.isMine } }
    var myGroups: [FBGroup] { groups.filter { $0.isMember } }
    var suggestedGroups: [FBGroup] { groups.filter { !$0.isMember } }

    var upcomingEvents: [FBEvent] {
        let cutoff = Date().addingTimeInterval(-6 * 3600)
        return events.filter { $0.startDate > cutoff }.sorted { $0.startDate < $1.startDate }
    }

    /// Unseen stories first, newest first within each group.
    var storiesForTray: [Story] {
        stories.sorted { lhs, rhs in
            if lhs.isSeen != rhs.isSeen { return !lhs.isSeen }
            return lhs.latestDate > rhs.latestDate
        }
    }

    // MARK: - Lookups

    func user(id: String) -> User? {
        if id == me.id { return me }
        return people.first { $0.id == id } ?? pages.first { $0.id == id }
    }

    func post(id: String) -> Post? {
        (posts + reels + watchVideos + memories + feedBuffer).first { $0.id == id }
    }

    func group(id: String) -> FBGroup? { groups.first { $0.id == id } }
    func event(id: String) -> FBEvent? { events.first { $0.id == id } }
    func listing(id: String) -> Listing? { listings.first { $0.id == id } }

    func story(for user: User) -> Story? {
        if user.isMe { return myStory }
        return stories.first { $0.author.id == user.id }
    }

    /// Timeline posts by (or written on the profile of) `user`, newest first.
    func posts(by user: User) -> [Post] {
        let all = posts + feedBuffer + watchVideos + reels
        var seen = Set<String>()
        return all
            .filter { post in
                guard post.group == nil else { return false }
                return post.author.id == user.id || post.timelineOwner?.id == user.id
            }
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func posts(in group: FBGroup) -> [Post] {
        (posts + feedBuffer)
            .filter { $0.group?.id == group.id }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func reels(by user: User) -> [Post] {
        reels.filter { $0.author.id == user.id }
    }

    /// Every photo `user` has posted, newest first.
    func photos(of user: User) -> [Media] {
        posts(by: user).filter { $0.author.id == user.id }.flatMap { $0.photos }
    }

    /// A stable list of `user`'s friends. Your own list is real; other people's are sampled.
    func friends(of user: User) -> [User] {
        if user.isMe { return friends }
        var generator = SeededGenerator(seed: SeededGenerator.stableHash(user.id))
        var pool = people.filter { $0.id != user.id && !$0.isPage }
        if user.isFriend { pool.append(me) }
        let count = min(pool.count, max(6, min(user.friendCount, 30)))
        return Array(pool.shuffled(using: &generator).prefix(count))
    }

    func mutualFriends(with user: User) -> [User] {
        guard !user.isMe else { return [] }
        let theirs = Set(friends(of: user).map { $0.id })
        return friends.filter { theirs.contains($0.id) }
    }

    func daysUntilBirthday(of user: User) -> Int? {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let components = DateComponents(month: user.birthdayMonth, day: user.birthdayDay)
        if calendar.component(.month, from: today) == user.birthdayMonth,
           calendar.component(.day, from: today) == user.birthdayDay {
            return 0
        }
        guard let next = calendar.nextDate(after: today, matching: components, matchingPolicy: .nextTimePreservingSmallerComponents) else {
            return nil
        }
        return calendar.dateComponents([.day], from: today, to: next).day
    }

    // MARK: - Feed

    /// Pull to refresh: waits like a network call, then adds a few fresh posts on top.
    @MainActor
    func refreshFeed() async {
        isRefreshingFeed = true
        try? await Task.sleep(nanoseconds: 1_200_000_000)
        let fresh = factory.makeFreshPosts(count: Int.random(in: 2...4))
        posts.insert(contentsOf: fresh, at: 0)
        imagePrefetcher(fresh.flatMap { $0.imageURLs })
        isRefreshingFeed = false
    }

    /// Call from each post's `onAppear`. Near the end of the feed it appends the next page
    /// from the preload buffer and prefetches the images of the page after that.
    func loadMoreFeedIfNeeded(currentPost post: Post) {
        let feed = feedPosts
        guard !isLoadingMoreFeed,
              let index = feed.firstIndex(where: { $0.id == post.id }),
              index >= feed.count - 4 else { return }
        isLoadingMoreFeed = true
        if feedBuffer.count < 16 {
            let oldest = (posts + feedBuffer).map { $0.createdAt }.min() ?? Date()
            feedBuffer.append(contentsOf: factory.makePosts(count: 30, before: oldest))
        }
        let pageSize = min(8, feedBuffer.count)
        let page = Array(feedBuffer.prefix(pageSize))
        feedBuffer.removeFirst(pageSize)
        imagePrefetcher(page.flatMap { $0.imageURLs })
        after(0.8) { [weak self] in
            guard let self else { return }
            self.posts.append(contentsOf: page)
            self.isLoadingMoreFeed = false
            self.imagePrefetcher(self.feedBuffer.prefix(8).flatMap { $0.imageURLs })
        }
    }

    // MARK: - Reactions and comments

    func setReaction(_ reaction: ReactionType?, on post: Post) {
        post.myReaction = reaction
    }

    /// Tap on "Like": likes, or removes whatever reaction is set.
    func toggleLike(_ post: Post) {
        post.myReaction = post.myReaction == nil ? .like : nil
    }

    func setReaction(_ reaction: ReactionType?, on comment: Comment) {
        comment.myReaction = reaction
    }

    func toggleLike(_ comment: Comment) {
        comment.myReaction = comment.myReaction == nil ? .like : nil
    }

    /// Adds a comment (or a reply when `parent` is set). Friends may like or answer it a bit later.
    @discardableResult
    func addComment(_ text: String, to post: Post, replyingTo parent: Comment? = nil, imageURL: URL? = nil) -> Comment {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let comment = Comment(author: me, text: trimmed, imageURL: imageURL, createdAt: Date())
        if let parent {
            parent.replies.append(comment)
        } else {
            post.comments.append(comment)
        }
        simulateCommentEngagement(comment, on: post, parent: parent)
        return comment
    }

    func editComment(_ comment: Comment, text: String) {
        comment.text = text
        comment.isEdited = true
    }

    func deleteComment(_ comment: Comment, from post: Post) {
        if let index = post.comments.firstIndex(where: { $0.id == comment.id }) {
            post.comments.remove(at: index)
            return
        }
        for parent in post.comments {
            if let index = parent.replies.firstIndex(where: { $0.id == comment.id }) {
                parent.replies.remove(at: index)
                return
            }
        }
    }

    /// Reveals a few of the comments counted in `hiddenCommentCount` ("View more comments").
    func loadMoreComments(for post: Post) {
        guard post.hiddenCommentCount > 0 else { return }
        let count = min(post.hiddenCommentCount, Int.random(in: 3...6))
        let older = factory.makeComments(count: count, before: post.comments.first?.createdAt ?? Date())
        post.comments.insert(contentsOf: older, at: 0)
        post.hiddenCommentCount -= count
    }

    // MARK: - Post actions

    func toggleSave(_ post: Post) {
        post.isSaved.toggle()
        showToast(post.isSaved ? "Saved to your items" : "Removed from saved items", symbol: post.isSaved ? "bookmark.fill" : "bookmark.slash")
    }

    func hide(_ post: Post) { post.isHidden = true }
    func unhide(_ post: Post) { post.isHidden = false }

    func report(_ post: Post) {
        post.isHidden = true
        showToast("Thanks for letting us know", symbol: "flag.fill")
    }

    func delete(_ post: Post) {
        posts.removeAll { $0.id == post.id }
        reels.removeAll { $0.id == post.id }
        watchVideos.removeAll { $0.id == post.id }
        showToast("Post deleted", symbol: "trash")
    }

    func toggleNotifications(for post: Post) {
        post.notificationsOn.toggle()
        showToast(post.notificationsOn ? "Notifications turned on for this post" : "Notifications turned off for this post", symbol: post.notificationsOn ? "bell.fill" : "bell.slash")
    }

    func vote(_ option: PollOption, in post: Post) {
        guard var poll = post.poll else { return }
        poll.myVoteID = poll.myVoteID == option.id ? nil : option.id
        post.poll = poll
    }

    func updatePost(_ post: Post, text: String, audience: Audience? = nil) {
        post.text = text
        post.isEdited = true
        if let audience {
            post.audience = audience
        }
        showToast("Post updated", symbol: "checkmark.circle.fill")
    }

    /// Creates a post at the top of the feed with a short simulated upload, then
    /// lets friends react and comment over the next few seconds.
    @discardableResult
    func createPost(
        text: String,
        media: [Media] = [],
        audience: Audience = .friends,
        feeling: Feeling? = nil,
        location: String? = nil,
        taggedUsers: [User] = [],
        backgroundIndex: Int? = nil,
        poll: Poll? = nil,
        group: FBGroup? = nil,
        timelineOwner: User? = nil,
        sharedPost: Post? = nil,
        activityText: String? = nil
    ) -> Post {
        let post = Post(
            author: me,
            group: group,
            timelineOwner: timelineOwner,
            text: text,
            backgroundIndex: backgroundIndex,
            media: media,
            sharedPost: sharedPost,
            poll: poll,
            feeling: feeling,
            location: location,
            taggedUsers: taggedUsers,
            activityText: activityText,
            createdAt: Date(),
            audience: group == nil ? audience : .everyone
        )
        post.isUploading = true
        posts.insert(post, at: 0)
        simulateUpload(post)
        return post
    }

    /// "Share now". Returns the new post that wraps the original.
    @discardableResult
    func share(_ post: Post, message: String = "", audience: Audience = .friends) -> Post {
        let original = post.sharedPost ?? post
        original.shareCount += 1
        let shared = Post(author: me, text: message, sharedPost: original, createdAt: Date(), audience: audience)
        posts.insert(shared, at: 0)
        showToast("Shared to your feed", symbol: "arrowshape.turn.up.right.fill")
        return shared
    }

    /// "Send in Messenger".
    func send(_ post: Post, to users: [User], note: String = "") {
        let preview = post.text.isEmpty ? "a post" : "\"\(String(post.text.prefix(60)))\""
        for user in users {
            let chat = conversation(with: user)
            if !note.isEmpty {
                send(note, in: chat)
            }
            send("Shared \(post.author.name)'s post: \(preview)", in: chat)
        }
        post.shareCount += users.count
        showToast(users.count == 1 ? "Sent to \(users[0].firstName)" : "Sent to \(users.count) people", symbol: "paperplane.fill")
    }

    func snooze(_ user: User) {
        user.isSnoozed = true
        showToast("You won't see posts from \(user.firstName) for 30 days", symbol: "clock.fill")
    }

    func unsnooze(_ user: User) { user.isSnoozed = false }

    func unfollow(_ user: User) {
        user.isFollowing = false
        showToast("You unfollowed \(user.name)", symbol: "person.fill.xmark")
    }

    func follow(_ user: User) {
        user.isFollowing = true
        if user.isPage {
            user.followerCount += 1
        }
        showToast("You're now following \(user.name)", symbol: "checkmark.circle.fill")
    }

    func toggleFavorite(_ user: User) {
        user.isFavorite.toggle()
        showToast(user.isFavorite ? "Added \(user.name) to Favorites" : "Removed \(user.name) from Favorites", symbol: user.isFavorite ? "star.fill" : "star.slash")
    }

    // MARK: - Stories

    func markSeen(_ item: StoryItem, in story: Story) {
        story.seenItemIDs.insert(item.id)
    }

    @discardableResult
    func addStory(_ content: StoryContent, caption: String? = nil) -> Story {
        let item = StoryItem(content: content, createdAt: Date(), caption: caption)
        let story: Story
        if let existing = myStory {
            existing.items.append(item)
            existing.seenItemIDs.insert(item.id)
            story = existing
        } else {
            story = Story(author: me, items: [item], seenItemIDs: [item.id])
            myStory = story
        }
        showToast("Your story was shared", symbol: "checkmark.circle.fill")
        simulateStoryViews(item.id)
        return story
    }

    func deleteStoryItem(_ item: StoryItem) {
        guard let story = myStory else { return }
        story.items.removeAll { $0.id == item.id }
        if story.items.isEmpty {
            myStory = nil
        }
        showToast("Story deleted", symbol: "trash")
    }

    func replyToStory(_ story: Story, text: String) {
        let chat = conversation(with: story.author)
        send(text, in: chat)
        showToast("Reply sent to \(story.author.firstName)", symbol: "paperplane.fill")
    }

    func reactToStory(_ story: Story, emoji: String) {
        let chat = conversation(with: story.author)
        deliver(Message(senderID: me.id, bigEmoji: emoji, status: .sending), in: chat)
    }

    // MARK: - Friends

    func confirmRequest(from user: User) {
        user.friendship = .friends
        user.requestDate = nil
        me.friendCount += 1
        user.friendCount += 1
        for notification in notifications where notification.kind == .friendRequest && notification.actors.first?.id == user.id {
            notification.requestAction = .confirmed
            notification.isRead = true
        }
    }

    func deleteRequest(from user: User) {
        user.friendship = .none
        user.requestDate = nil
        dismissedSuggestionIDs.insert(user.id)
        for notification in notifications where notification.kind == .friendRequest && notification.actors.first?.id == user.id {
            notification.requestAction = .deleted
            notification.isRead = true
        }
    }

    /// Sends a request. About half the time the other person accepts a few seconds later.
    func sendRequest(to user: User) {
        user.friendship = .requestSent
        user.requestDate = Date()
        guard Bool.random() else { return }
        after(Double.random(in: 8...16)) { [weak self] in
            guard let self, user.friendship == .requestSent else { return }
            user.friendship = .friends
            user.requestDate = nil
            self.me.friendCount += 1
            self.pushNotification(AppNotification(kind: .friendAccepted, actors: [user], message: "accepted your friend request.", userID: user.id))
        }
    }

    func cancelRequest(to user: User) {
        user.friendship = .none
        user.requestDate = nil
    }

    func unfriend(_ user: User) {
        guard user.friendship == .friends else { return }
        user.friendship = .none
        user.isFavorite = false
        me.friendCount = max(0, me.friendCount - 1)
        showToast("You unfriended \(user.name)", symbol: "person.fill.xmark")
    }

    func dismissSuggestion(_ user: User) {
        dismissedSuggestionIDs.insert(user.id)
    }

    // MARK: - Notifications

    func markRead(_ notification: AppNotification) {
        notification.isRead = true
    }

    func markAllNotificationsRead() {
        for notification in notifications {
            notification.isRead = true
        }
    }

    func removeNotification(_ notification: AppNotification) {
        notifications.removeAll { $0.id == notification.id }
    }

    /// "Turn off notifications like this": removes every notification of the same kind.
    func turnOffNotifications(like notification: AppNotification) {
        let kind = notification.kind
        notifications.removeAll { $0.kind == kind }
        showToast("You won't get notifications like this", symbol: "bell.slash.fill")
    }

    private func pushNotification(_ notification: AppNotification) {
        notifications.insert(notification, at: 0)
    }

    // MARK: - Messenger

    /// Finds the one-to-one chat with `user`, or starts one.
    func conversation(with user: User) -> Conversation {
        if let existing = conversations.first(where: { !$0.isGroup && $0.participants.first?.id == user.id }) {
            return existing
        }
        let chat = Conversation(participants: [user])
        conversations.insert(chat, at: 0)
        return chat
    }

    @discardableResult
    func startGroupChat(with users: [User], name: String? = nil) -> Conversation {
        if users.count == 1 {
            return conversation(with: users[0])
        }
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let chat = Conversation(participants: users, groupName: trimmed.isEmpty ? nil : trimmed)
        conversations.insert(chat, at: 0)
        return chat
    }

    /// Sends a text. The other person "sees" it and types a reply a few seconds later.
    func send(_ text: String, in conversation: Conversation, replyingTo reply: Message? = nil) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        deliver(Message(senderID: me.id, text: trimmed, replyToID: reply?.id, status: .sending), in: conversation)
    }

    func sendImage(_ data: Data, in conversation: Conversation) {
        deliver(Message(senderID: me.id, imageData: data, status: .sending), in: conversation)
    }

    /// Sends the chat's quick emoji (👍 by default) as a big emoji.
    func sendQuickEmoji(in conversation: Conversation) {
        deliver(Message(senderID: me.id, bigEmoji: conversation.quickEmoji, status: .sending), in: conversation)
    }

    /// Sets the signed-in user's reaction. Passing the current emoji again (or nil) removes it.
    func react(to message: Message, with emoji: String?, in conversation: Conversation) {
        guard let index = conversation.messages.firstIndex(where: { $0.id == message.id }) else { return }
        if let emoji, conversation.messages[index].reactions[me.id] != emoji {
            conversation.messages[index].reactions[me.id] = emoji
        } else {
            conversation.messages[index].reactions[me.id] = nil
        }
    }

    func unsend(_ message: Message, in conversation: Conversation) {
        guard let index = conversation.messages.firstIndex(where: { $0.id == message.id }) else { return }
        conversation.messages[index].isUnsent = true
        conversation.messages[index].text = nil
        conversation.messages[index].imageURL = nil
        conversation.messages[index].imageData = nil
        conversation.messages[index].bigEmoji = nil
        conversation.messages[index].reactions = [:]
    }

    func markRead(_ conversation: Conversation) {
        conversation.unreadCount = 0
    }

    func toggleMute(_ conversation: Conversation) {
        conversation.isMuted.toggle()
        showToast(conversation.isMuted ? "Notifications muted" : "Notifications unmuted", symbol: conversation.isMuted ? "bell.slash.fill" : "bell.fill")
    }

    func togglePin(_ conversation: Conversation) {
        conversation.isPinned.toggle()
    }

    func toggleArchive(_ conversation: Conversation) {
        conversation.isArchived.toggle()
        showToast(conversation.isArchived ? "Chat archived" : "Chat unarchived", symbol: "archivebox.fill")
    }

    func deleteConversation(_ conversation: Conversation) {
        conversations.removeAll { $0.id == conversation.id }
        showToast("Chat deleted", symbol: "trash")
    }

    func setTheme(_ hex: UInt32, for conversation: Conversation) {
        conversation.themeHex = hex
    }

    func setQuickEmoji(_ emoji: String, for conversation: Conversation) {
        conversation.quickEmoji = emoji
    }

    // MARK: - Marketplace

    func toggleSave(_ listing: Listing) {
        listing.isSaved.toggle()
        showToast(listing.isSaved ? "Saved to Marketplace" : "Removed from saved", symbol: listing.isSaved ? "bookmark.fill" : "bookmark.slash")
    }

    @discardableResult
    func createListing(
        title: String,
        price: Int,
        category: ListingCategory,
        condition: ItemCondition,
        details: String,
        imageData: [Data],
        city: String
    ) -> Listing {
        let listing = Listing(
            title: title,
            price: price,
            category: category,
            condition: condition,
            details: details,
            imageData: imageData,
            seller: me,
            city: city.isEmpty ? me.city : city,
            latitude: 37.7749,
            longitude: -122.4194,
            distanceMiles: 0,
            createdAt: Date(),
            isMine: true
        )
        listings.insert(listing, at: 0)
        showToast("Your listing is published", symbol: "checkmark.circle.fill")
        return listing
    }

    func toggleSold(_ listing: Listing) {
        listing.isSold.toggle()
        showToast(listing.isSold ? "Marked as sold" : "Marked as available", symbol: "tag.fill")
    }

    func deleteListing(_ listing: Listing) {
        listings.removeAll { $0.id == listing.id }
        showToast("Listing deleted", symbol: "trash")
    }

    /// Opens (or creates) the chat with the seller and sends `text`.
    @discardableResult
    func messageSeller(about listing: Listing, text: String) -> Conversation {
        let chat = conversation(with: listing.seller)
        send(text, in: chat)
        return chat
    }

    func listings(in category: ListingCategory) -> [Listing] {
        listings.filter { $0.category == category && !$0.isMine }
    }

    // MARK: - Groups and events

    func toggleMembership(_ group: FBGroup) {
        group.isMember.toggle()
        group.memberCount += group.isMember ? 1 : -1
        if group.isMember {
            group.lastVisited = Date()
        }
        showToast(group.isMember ? "You joined \(group.name)" : "You left \(group.name)", symbol: group.isMember ? "person.3.fill" : "rectangle.portrait.and.arrow.right")
    }

    /// Choosing the current response again clears it.
    func respond(to event: FBEvent, with response: EventResponse?) {
        let previous = event.response
        if previous == .going { event.goingCount -= 1 }
        if previous == .interested { event.interestedCount -= 1 }
        let updated: EventResponse? = previous == response ? nil : response
        event.response = updated
        if updated == .going { event.goingCount += 1 }
        if updated == .interested { event.interestedCount += 1 }
    }

    // MARK: - Search

    func search(_ query: String) -> SearchResults {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !term.isEmpty else { return SearchResults() }
        var results = SearchResults()
        results.people = ([me] + people)
            .filter { $0.name.lowercased().contains(term) }
            .sorted { lhs, rhs in
                if lhs.isFriend != rhs.isFriend { return lhs.isFriend }
                return lhs.name < rhs.name
            }
        results.pages = pages.filter {
            $0.name.lowercased().contains(term) || ($0.category ?? "").lowercased().contains(term)
        }
        results.groups = groups.filter {
            $0.name.lowercased().contains(term) || $0.category.lowercased().contains(term)
        }
        results.posts = (posts + watchVideos).filter { $0.text.lowercased().contains(term) }
        results.listings = listings.filter {
            $0.title.lowercased().contains(term) || $0.category.title.lowercased().contains(term)
        }
        results.events = events.filter { $0.title.lowercased().contains(term) }
        return results
    }

    func addRecentSearch(_ term: String) {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        recentSearches.removeAll { $0.caseInsensitiveCompare(trimmed) == .orderedSame }
        recentSearches.insert(trimmed, at: 0)
        if recentSearches.count > 15 {
            recentSearches = Array(recentSearches.prefix(15))
        }
        persistRecentSearches()
    }

    func removeRecentSearch(_ term: String) {
        recentSearches.removeAll { $0 == term }
        persistRecentSearches()
    }

    func clearRecentSearches() {
        recentSearches.removeAll()
        persistRecentSearches()
    }

    private func persistRecentSearches() {
        UserDefaults.standard.set(recentSearches, forKey: AppStore.recentSearchesKey)
    }

    // MARK: - Profile

    func updateProfile(
        firstName: String,
        lastName: String,
        bio: String,
        city: String,
        hometown: String,
        work: String,
        school: String,
        relationship: String,
        website: String?
    ) {
        me.firstName = firstName
        me.lastName = lastName
        me.bio = bio
        me.city = city
        me.hometown = hometown
        me.work = work
        me.school = school
        me.relationship = relationship
        me.website = website
        showToast("Profile updated", symbol: "checkmark.circle.fill")
    }

    /// Sets a picked photo as the profile picture and posts "updated their profile picture".
    func updateProfilePicture(_ data: Data) {
        me.avatarData = data
        createPost(text: "", media: [.localPhoto(data)], audience: .everyone, activityText: "updated their profile picture.")
    }

    func updateCoverPhoto(_ data: Data) {
        me.coverData = data
        createPost(text: "", media: [.localPhoto(data, aspectRatio: 16.0 / 9.0)], audience: .everyone, activityText: "updated their cover photo.")
    }

    // MARK: - Session and toasts

    func logOut() {
        isLoggedIn = false
    }

    func logIn() {
        isLoggedIn = true
    }

    func showToast(_ message: String, symbol: String? = nil) {
        let toast = Toast(message: message, symbol: symbol)
        self.toast = toast
        after(2.6) { [weak self] in
            guard let self, self.toast?.id == toast.id else { return }
            self.toast = nil
        }
    }

    // MARK: - Simulated activity

    private func after(_ delay: Double, _ work: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func simulateUpload(_ post: Post) {
        for step in 1...10 {
            after(Double(step) * 0.12) {
                post.uploadProgress = Double(step) / 10
            }
        }
        after(1.35) { [weak self] in
            post.isUploading = false
            self?.simulateEngagement(for: post)
        }
    }

    /// Friends react to and comment on a new post over the next several seconds.
    private func simulateEngagement(for post: Post) {
        let reactors = Array(friends.shuffled().prefix(Int.random(in: 3...7)))
        for (offset, friend) in reactors.enumerated() {
            let delay = Double(offset) * 2.4 + Double.random(in: 2.0...4.0)
            after(delay) { [weak self] in
                guard let self, self.posts.contains(where: { $0.id == post.id }) else { return }
                let reaction = ReactionType.weightedRandom()
                post.reactionCounts[reaction, default: 0] += 1
                if !post.reactors.contains(friend) {
                    post.reactors.insert(friend, at: 0)
                }
                self.pushNotification(AppNotification(
                    kind: .reaction(reaction),
                    actors: [friend],
                    message: "reacted to your post.",
                    postID: post.id,
                    thumbnailURL: post.media.first?.url
                ))
            }
        }
        guard let commenter = friends.randomElement() else { return }
        after(Double.random(in: 7...12)) { [weak self] in
            guard let self, self.posts.contains(where: { $0.id == post.id }) else { return }
            let comment = Comment(author: commenter, text: self.factory.randomCommentText(), createdAt: Date())
            post.comments.append(comment)
            self.pushNotification(AppNotification(
                kind: .comment,
                actors: [commenter],
                message: "commented on your post: \"\(comment.text)\"",
                postID: post.id
            ))
        }
    }

    private func simulateCommentEngagement(_ comment: Comment, on post: Post, parent: Comment?) {
        after(Double.random(in: 3...6)) {
            comment.reactionCounts[.like, default: 0] += 1
        }
        let author = parent?.author ?? post.author
        guard !author.isMe, !author.isPage, Int.random(in: 0..<3) == 0 else { return }
        after(Double.random(in: 6...10)) { [weak self] in
            guard let self else { return }
            let reply = Comment(author: author, text: self.factory.randomReplyText(), createdAt: Date())
            if let parent {
                parent.replies.append(reply)
            } else {
                comment.replies.append(reply)
            }
            self.pushNotification(AppNotification(
                kind: .reply,
                actors: [author],
                message: "replied to your comment: \"\(reply.text)\"",
                postID: post.id
            ))
        }
    }

    private func simulateStoryViews(_ itemID: String) {
        for step in 1...4 {
            after(Double(step) * 3) { [weak self] in
                guard let story = self?.myStory,
                      let index = story.items.firstIndex(where: { $0.id == itemID }) else { return }
                story.items[index].viewerCount += Int.random(in: 1...4)
            }
        }
    }

    /// Records the message, walks it through sending -> sent -> delivered, then simulates a reply.
    private func deliver(_ message: Message, in conversation: Conversation) {
        conversation.messages.append(message)
        conversation.isArchived = false
        bringToTop(conversation)
        let messageID = message.id
        after(0.35) { [weak self] in
            self?.setStatus(.sent, for: messageID, in: conversation)
        }
        after(0.9) { [weak self] in
            self?.setStatus(.delivered, for: messageID, in: conversation)
        }
        scheduleReply(in: conversation, to: message)
    }

    private func setStatus(_ status: MessageStatus, for messageID: String, in conversation: Conversation) {
        guard let index = conversation.messages.firstIndex(where: { $0.id == messageID }) else { return }
        conversation.messages[index].status = status
    }

    private func scheduleReply(in conversation: Conversation, to message: Message) {
        guard let partner = conversation.participants.first,
              !pendingReplies.contains(conversation.id) else { return }
        pendingReplies.insert(conversation.id)
        let prompt = message.text ?? (message.isImage ? "[photo]" : (message.bigEmoji ?? ""))
        let seenDelay = Double.random(in: 1.4...2.2)
        let typingTime = Double.random(in: 1.4...3.2)
        after(seenDelay) { [weak self] in
            guard let self else { return }
            for index in conversation.messages.indices where conversation.messages[index].senderID == self.me.id {
                conversation.messages[index].status = .seen
            }
            conversation.isTyping = true
        }
        after(seenDelay + typingTime) { [weak self] in
            guard let self else { return }
            conversation.isTyping = false
            self.pendingReplies.remove(conversation.id)
            let sender = conversation.participants.randomElement() ?? partner
            let reply = Message(senderID: sender.id, text: self.factory.replyText(to: prompt, from: sender), sentAt: Date())
            conversation.messages.append(reply)
            if self.openConversationID != conversation.id {
                conversation.unreadCount += 1
            }
            self.bringToTop(conversation)
        }
    }

    private func bringToTop(_ conversation: Conversation) {
        guard let index = conversations.firstIndex(where: { $0.id == conversation.id }), index != 0 else { return }
        conversations.remove(at: index)
        conversations.insert(conversation, at: 0)
    }

    /// Every ~40 seconds something small happens: a friend comes online, a new
    /// notification arrives, or someone posts a story.
    private func startAmbientActivity() {
        let timer = Timer(timeInterval: 40, repeats: true) { [weak self] _ in
            self?.ambientTick()
        }
        RunLoop.main.add(timer, forMode: .common)
        ambientTimer = timer
    }

    private func ambientTick() {
        guard isLoggedIn else { return }
        switch Int.random(in: 0..<5) {
        case 0:
            if let friend = friends.randomElement() {
                friend.isOnline.toggle()
                friend.lastActive = Date()
            }
        case 1:
            if let notification = factory.makeAmbientNotification(myPosts: posts(by: me)) {
                pushNotification(notification)
            }
        case 2:
            if let story = stories.filter({ $0.isSeen }).randomElement() {
                story.items.append(factory.makeStoryItem())
            }
        default:
            break
        }
    }
}
