import Foundation

/// Builds the preloaded demo world: people, Pages, groups, a feed plus a preload
/// buffer for infinite scrolling, stories, reels, videos, chats, notifications,
/// Marketplace listings and events. Seeded, so every launch starts the same.
///
/// Images come from picsum.photos (scenery) and randomuser.me (portraits).
/// Videos are public sample streams. Without a network the UI falls back to
/// placeholders and initials.
final class MockDataFactory {
    let me: User
    private(set) var people: [User] = []
    private(set) var pages: [User] = []
    private(set) var groups: [FBGroup] = []

    private var rng: SeededGenerator
    private var postCounter = 0
    private var storyCounter = 0

    private enum PostKind {
        case text
        case background
        case photo
        case multiPhoto
        case video
        case link
        case shared
        case group
        case poll
        case page
        case sponsored
        case lifeEvent
        case profilePicture
    }

    init(seed: UInt64 = 20_261_112) {
        rng = SeededGenerator(seed: seed)
        me = User(
            id: "me",
            firstName: "Alex",
            lastName: "Rivera",
            avatarURL: MockDataFactory.portrait(female: false, index: 32),
            coverURL: MockDataFactory.photo("cover-me", 1200, 450),
            bio: "Designer by day, trail runner on weekends 🏃‍♂️ Coffee first ☕️",
            city: "San Francisco, California",
            hometown: "Austin, Texas",
            work: "Product Designer at Brightline Studio",
            school: "Westbrook University",
            relationship: "In a relationship",
            website: "alexrivera.design",
            joinedDate: MockDataFactory.fixedDate(year: 2012, month: 3, day: 14),
            birthdayMonth: 7,
            birthdayDay: 22,
            followerCount: 312,
            friendship: .me,
            isOnline: true
        )
    }

    // MARK: - Public API used by AppStore

    func makeSeed() -> SeedData {
        people = makePeople()
        pages = makePages()
        groups = makeGroups()
        me.friendCount = friends.count

        let events = makeEvents()
        let listings = makeListings(count: 64)
        let initialFeed = makeInitialFeed()
        let oldestInitial = initialFeed.last?.createdAt ?? Date()
        let myPosts = makeMyPosts()
        let buffer = (makePosts(count: 70, before: oldestInitial) + myPosts)
            .sorted { $0.createdAt > $1.createdAt }
        let memories = makeMemories()

        return SeedData(
            me: me,
            people: people,
            pages: pages,
            groups: groups,
            events: events,
            posts: initialFeed,
            feedBuffer: buffer,
            reels: makeReels(count: 14),
            watchVideos: makeWatchVideos(count: 12),
            stories: makeStories(),
            memories: memories,
            notifications: makeNotifications(myPosts: myPosts, events: events, listings: listings, memories: memories),
            conversations: makeConversations(),
            listings: listings,
            recentSearches: MockContent.recentSearches
        )
    }

    /// Random posts, each older than the one before, all older than `date`.
    func makePosts(count: Int, before date: Date) -> [Post] {
        var result: [Post] = []
        var cursor = date
        for _ in 0..<count {
            cursor = cursor.addingTimeInterval(-Double(randomInt(8...150)) * 60)
            result.append(makePost(kind: randomKind(), at: cursor))
        }
        return result
    }

    /// Posts from the last few minutes, for pull to refresh.
    func makeFreshPosts(count: Int) -> [Post] {
        var result: [Post] = []
        for offset in 0..<count {
            let seconds = Double(offset * 75 + randomInt(5...60))
            result.append(makePost(kind: randomKind(), at: Date().addingTimeInterval(-seconds)))
        }
        return result
    }

    /// Older comments, oldest first, all before `date`.
    func makeComments(count: Int, before date: Date) -> [Comment] {
        var result: [Comment] = []
        var cursor = date
        for _ in 0..<count {
            cursor = cursor.addingTimeInterval(-Double(randomInt(2...120)) * 60)
            result.insert(makeComment(at: cursor), at: 0)
        }
        return result
    }

    func randomCommentText() -> String { pickText(MockContent.comments) }
    func randomReplyText() -> String { pickText(MockContent.replies) }

    /// A plausible chat reply to `message`.
    func replyText(to message: String, from user: User) -> String {
        let lower = message.lowercased()
        if lower.contains("available") {
            return pickText(["Yes, it's still available!", "Yep, still have it 🙂", "It is! When would you like to pick it up?"])
        }
        if lower.contains("price") || lower.contains("negotiable") || lower.contains("lowest") {
            return pickText(["I could do a little less if you pick up today.", "Price is a bit flexible, what were you thinking?", "Sorry, the price is firm."])
        }
        if lower.contains("deliver") || lower.contains("pick up") || lower.contains("pickup") {
            return pickText(["Pickup only, sorry! I'm near downtown.", "I can drop it off this weekend if you're close by.", "Pickup would be easiest. Does tomorrow evening work?"])
        }
        if lower.contains("birthday") {
            return pickText(["Aww thank you so much!! 🥳", "Thank you!! ❤️", "You're the best, thanks!"])
        }
        if message == "[photo]" {
            return pickText(["Love this! 😍", "Haha where was this?", "Wow, great shot!", "Send me more of these 😄"])
        }
        if message.count <= 2 {
            return pickText(["😂", "❤️", "👍", "Haha", "😄", "🙌"])
        }
        if lower.contains("?") {
            return pickText(MockContent.questionReplies)
        }
        return pickText(MockContent.chatReplies)
    }

    /// A small live event (reaction, group post, new suggestion) for the ambient timer.
    func makeAmbientNotification(myPosts: [Post]) -> AppNotification? {
        switch randomInt(0...3) {
        case 0:
            guard let post = myPosts.first, let friend = pickElement(friends) else { return nil }
            let reaction = ReactionType.weightedRandom()
            post.reactionCounts[reaction, default: 0] += 1
            return AppNotification(
                kind: .reaction(reaction),
                actors: [friend],
                message: "reacted to your post.",
                postID: post.id,
                thumbnailURL: post.media.first?.url
            )
        case 1:
            guard let group = pickElement(groups.filter { $0.isMember }) else { return nil }
            let author = pickElement(group.memberSample) ?? randomFriend()
            group.unreadCount += 1
            return AppNotification(
                kind: .groupPost,
                actors: [author],
                message: "posted in \(group.name): \"\(snippet(pickText(MockContent.groupPosts)))\"",
                groupID: group.id,
                thumbnailURL: group.coverURL
            )
        case 2:
            guard let person = pickElement(people.filter { $0.friendship == .none }) else { return nil }
            return AppNotification(
                kind: .suggestion,
                actors: [person],
                message: "is someone you may know. You have \(person.mutualFriendCount) mutual friends.",
                userID: person.id
            )
        default:
            guard let page = pickElement(pages) else { return nil }
            return AppNotification(
                kind: .video,
                actors: [page],
                message: "shared a new video: \"\(snippet(pickText(MockContent.videoTitles)))\"",
                userID: page.id
            )
        }
    }

    /// A fresh story item (for friends who post a new story while the app is open).
    func makeStoryItem() -> StoryItem {
        storyCounter += 1
        return makeStoryItem(seed: "live-\(storyCounter)", minutesAgo: 0)
    }

    // MARK: - Images and videos

    static func photo(_ seed: String, _ width: Int, _ height: Int) -> URL? {
        URL(string: "https://picsum.photos/seed/\(seed)/\(width)/\(height)")
    }

    static func portrait(female: Bool, index: Int) -> URL? {
        URL(string: "https://randomuser.me/api/portraits/\(female ? "women" : "men")/\(index % 100).jpg")
    }

    /// Public sample videos (MP4 and HLS). The poster image shows if one fails to load.
    static let sampleVideos: [URL] = [
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        "https://www.w3schools.com/html/mov_bbb.mp4",
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
        "https://www.w3schools.com/html/movie.mp4",
        "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8",
    ].compactMap { URL(string: $0) }

    private static let fallbackURL = URL(fileURLWithPath: "/")

    private static func fixedDate(year: Int, month: Int, day: Int) -> Date {
        let components = DateComponents(year: year, month: month, day: day)
        return Calendar.current.date(from: components) ?? Date(timeIntervalSince1970: 1_330_000_000)
    }

    private static let themeColors: [UInt32] = [0x0A7CFF, 0x7646FF, 0xFF5CA1, 0x00B2FF, 0x0ACF83, 0xFA3C4C, 0x8C4FFF, 0xFF7E29]

    private static let bayAreaCities = [
        "San Francisco, CA", "Oakland, CA", "Berkeley, CA", "Daly City, CA", "San Mateo, CA",
        "Palo Alto, CA", "Sausalito, CA", "Alameda, CA", "Redwood City, CA", "San Rafael, CA",
    ]

    private static let linkIntros = [
        "This is worth a read 👇", "Interesting!", "Saw this and thought of you all.",
        "Wow. Didn't know this.", "Sharing because it's important.", "Bookmarking this one.", "",
    ]

    private static let shareIntros = [
        "😂😂😂", "This is so true", "Had to share this one", "Love this ❤️",
        "Who else needs this?", "Tag someone who does this", "",
    ]

    private static let groupChatNames = ["Weekend Hikers 🏔️", "Roommates 🏠", "Book Club 📚", "Family ❤️"]

    // MARK: - Random helpers (seeded)

    private var friends: [User] { people.filter { $0.friendship == .friends } }

    private func randomInt(_ range: ClosedRange<Int>) -> Int {
        Int.random(in: range, using: &rng)
    }

    private func randomDouble(_ range: ClosedRange<Double>) -> Double {
        Double.random(in: range, using: &rng)
    }

    private func chance(_ probability: Double) -> Bool {
        Double.random(in: 0..<1, using: &rng) < probability
    }

    private func pickText(_ options: [String]) -> String {
        options.randomElement(using: &rng) ?? ""
    }

    private func pickElement<T>(_ options: [T]) -> T? {
        options.randomElement(using: &rng)
    }

    private func pickSample<T>(_ options: [T], count: Int) -> [T] {
        Array(options.shuffled(using: &rng).prefix(max(0, count)))
    }

    private func randomFriend() -> User { pickElement(friends) ?? me }
    private func randomPage() -> User { pickElement(pages) ?? me }

    private func timeAgo(minutes: Int) -> Date { Date().addingTimeInterval(-Double(minutes) * 60) }
    private func timeAgo(hours: Int) -> Date { timeAgo(minutes: hours * 60) }
    private func timeAgo(days: Int) -> Date { timeAgo(minutes: days * 1_440) }

    private func snippet(_ text: String, limit: Int = 60) -> String {
        guard text.count > limit else { return text }
        return String(text.prefix(limit)).trimmingCharacters(in: .whitespaces) + "..."
    }

    // MARK: - People, Pages, groups

    private func makePeople() -> [User] {
        var result: [User] = []
        var usedNames = Set<String>()
        for index in 0..<56 {
            let female = index % 2 == 0
            let firstName = pickText(female ? MockContent.femaleFirstNames : MockContent.maleFirstNames)
            var lastName = pickText(MockContent.lastNames)
            var attempts = 0
            while usedNames.contains("\(firstName) \(lastName)") && attempts < 12 {
                lastName = pickText(MockContent.lastNames)
                attempts += 1
            }
            usedNames.insert("\(firstName) \(lastName)")

            let friendship: FriendshipStatus
            switch index {
            case 0..<34: friendship = .friends
            case 34..<41: friendship = .requestReceived
            default: friendship = .none
            }
            let hasJob = chance(0.8)
            let work = hasJob ? "\(pickText(MockContent.jobTitles)) at \(pickText(MockContent.employers))" : ""

            let user = User(
                id: "user-\(index)",
                firstName: firstName,
                lastName: lastName,
                avatarURL: MockDataFactory.portrait(female: female, index: (index * 7 + 3) % 100),
                coverURL: MockDataFactory.photo("cover-\(index)", 1200, 450),
                bio: chance(0.7) ? pickText(MockContent.bios) : "",
                city: pickText(MockContent.cities),
                hometown: pickText(MockContent.cities),
                work: work,
                school: chance(0.75) ? pickText(MockContent.schools) : "",
                relationship: pickText(MockContent.relationships),
                joinedDate: timeAgo(days: randomInt(400...5_200)),
                birthdayMonth: randomInt(1...12),
                birthdayDay: randomInt(1...28),
                friendCount: randomInt(120...1_800),
                followerCount: randomInt(0...400),
                mutualFriendCount: randomInt(1...48),
                friendship: friendship,
                requestDate: friendship == .requestReceived ? timeAgo(hours: randomInt(1...240)) : nil,
                isFavorite: index < 4,
                isOnline: friendship == .friends && chance(0.35),
                lastActive: timeAgo(minutes: randomInt(2...2_000)),
                isVerified: index == 5 || index == 17
            )
            result.append(user)
        }

        // Two friends have a birthday today and a few more in the coming weeks.
        let calendar = Calendar.current
        let today = calendar.dateComponents([.month, .day], from: Date())
        for index in [1, 9] where index < result.count {
            result[index].birthdayMonth = today.month ?? 1
            result[index].birthdayDay = today.day ?? 1
        }
        for (offset, index) in [3, 12, 20, 27, 31].enumerated() where index < result.count {
            if let upcoming = calendar.date(byAdding: .day, value: offset * 6 + 2, to: Date()) {
                let parts = calendar.dateComponents([.month, .day], from: upcoming)
                result[index].birthdayMonth = parts.month ?? 1
                result[index].birthdayDay = parts.day ?? 1
            }
        }
        return result
    }

    private func makePages() -> [User] {
        var result: [User] = []
        for (index, info) in MockContent.pages.enumerated() {
            let page = User(
                id: "page-\(index)",
                firstName: info.name,
                kind: .page,
                category: info.category,
                avatarURL: MockDataFactory.photo("page-avatar-\(index)", 300, 300),
                coverURL: MockDataFactory.photo("page-cover-\(index)", 1200, 450),
                bio: "\(info.category) · Sharing what we love with our community.",
                city: pickText(MockContent.cities),
                joinedDate: timeAgo(days: randomInt(800...4_000)),
                followerCount: randomInt(2_000...2_400_000),
                isFollowing: index % 3 != 2,
                isVerified: index % 4 == 0
            )
            result.append(page)
        }
        return result
    }

    private func makeGroups() -> [FBGroup] {
        var result: [FBGroup] = []
        for (index, info) in MockContent.groups.enumerated() {
            let isMember = index < 7
            let group = FBGroup(
                id: "group-\(index)",
                name: info.name,
                coverURL: MockDataFactory.photo("group-\(index)", 1200, 600),
                isPrivate: index % 3 == 1,
                memberCount: randomInt(800...240_000),
                isMember: isMember,
                isAdmin: index == 0,
                about: info.about,
                category: info.category,
                postsPerDay: randomInt(2...60),
                unreadCount: isMember ? randomInt(0...9) : 0,
                lastVisited: isMember ? timeAgo(hours: randomInt(2...96)) : nil,
                memberSample: pickSample(people, count: 12)
            )
            result.append(group)
        }
        return result
    }

    // MARK: - Posts

    private func makeInitialFeed() -> [Post] {
        let kinds: [PostKind] = [
            .photo, .multiPhoto, .background, .video, .group, .sponsored, .text, .shared,
            .page, .poll, .link, .lifeEvent, .multiPhoto, .profilePicture, .photo, .group,
        ]
        var result: [Post] = []
        var cursor = timeAgo(minutes: randomInt(3...12))
        for kind in kinds {
            result.append(makePost(kind: kind, at: cursor))
            cursor = cursor.addingTimeInterval(-Double(randomInt(10...120)) * 60)
        }
        result.append(contentsOf: makePosts(count: 10, before: cursor))
        return result
    }

    private func randomKind() -> PostKind {
        switch randomInt(0...99) {
        case 0..<14: return .text
        case 14..<22: return .background
        case 22..<42: return .photo
        case 42..<53: return .multiPhoto
        case 53..<59: return .video
        case 59..<65: return .link
        case 65..<69: return .shared
        case 69..<78: return .group
        case 78..<81: return .poll
        case 81..<88: return .page
        case 88..<93: return .sponsored
        case 93..<97: return .lifeEvent
        default: return .profilePicture
        }
    }

    private func makePost(kind: PostKind, at date: Date) -> Post {
        let post: Post
        switch kind {
        case .text: post = makeTextPost(at: date)
        case .background: post = makeBackgroundPost(at: date)
        case .photo: post = makePhotoPost(at: date, count: 1)
        case .multiPhoto: post = makePhotoPost(at: date, count: randomInt(2...7))
        case .video: post = makeVideoPost(at: date)
        case .link: post = makeLinkPost(at: date)
        case .shared: post = makeSharedPost(at: date)
        case .group: post = makeGroupPost(at: date, withPoll: false)
        case .poll: post = makeGroupPost(at: date, withPoll: true)
        case .page: post = makePagePost(at: date)
        case .sponsored: post = makeSponsoredPost(at: date)
        case .lifeEvent: post = makeLifeEventPost(at: date)
        case .profilePicture: post = makeProfilePictureUpdate(at: date)
        }
        decorate(post)
        return post
    }

    private func nextID(_ prefix: String) -> String {
        postCounter += 1
        return "\(prefix)-\(postCounter)"
    }

    private func makeTextPost(at date: Date) -> Post {
        let author = randomFriend()
        let post = Post(
            id: nextID("text"),
            author: author,
            text: pickText(MockContent.statusUpdates),
            createdAt: date,
            audience: chance(0.6) ? .friends : .everyone
        )
        if chance(0.2) {
            post.feeling = pickElement(Feeling.all)
        }
        if chance(0.12) {
            post.taggedUsers = pickSample(friends.filter { $0 != author }, count: randomInt(1...3))
        }
        return post
    }

    private func makeBackgroundPost(at date: Date) -> Post {
        Post(
            id: nextID("bg"),
            author: randomFriend(),
            text: pickText(MockContent.backgroundTexts),
            backgroundIndex: randomInt(0...11),
            createdAt: date,
            audience: .friends
        )
    }

    private func makePhotoPost(at date: Date, count: Int) -> Post {
        let id = nextID("photo")
        let author = chance(0.85) ? randomFriend() : randomPage()
        let ratios: [Double] = [1, 4.0 / 3.0, 3.0 / 4.0, 16.0 / 9.0, 4.0 / 5.0]
        var media: [Media] = []
        for index in 0..<max(1, count) {
            let ratio = count == 1 ? (pickElement(ratios) ?? 1) : 1
            let height = Int(1080.0 / ratio)
            media.append(.photo(MockDataFactory.photo("\(id)-\(index)", 1080, height), aspectRatio: ratio))
        }
        let post = Post(
            id: id,
            author: author,
            text: chance(0.85) ? pickText(MockContent.photoCaptions) : "",
            media: media,
            location: chance(0.25) ? pickText(MockContent.places) : nil,
            createdAt: date,
            audience: chance(0.5) ? .everyone : .friends
        )
        if chance(0.15) {
            post.feeling = pickElement(Feeling.all)
        }
        if chance(0.1) {
            post.taggedUsers = pickSample(friends.filter { $0 != author }, count: randomInt(1...4))
        }
        return post
    }

    private func makeVideoPost(at date: Date) -> Post {
        let id = nextID("video")
        let video = Media.video(
            poster: MockDataFactory.photo(id, 1280, 720),
            url: pickElement(MockDataFactory.sampleVideos),
            aspectRatio: 16.0 / 9.0,
            duration: randomDouble(15...600)
        )
        return Post(
            id: id,
            author: chance(0.6) ? randomPage() : randomFriend(),
            text: pickText(MockContent.videoTitles),
            media: [video],
            createdAt: date,
            audience: .everyone
        )
    }

    private func makeLinkPost(at date: Date) -> Post {
        let id = nextID("link")
        let info = pickElement(MockContent.links) ?? (domain: "dailycosmos.com", title: "Read the full story", subtitle: "")
        let link = LinkPreview(
            url: URL(string: "https://\(info.domain)/articles/\(postCounter)") ?? MockDataFactory.fallbackURL,
            domain: info.domain,
            title: info.title,
            subtitle: info.subtitle,
            imageURL: MockDataFactory.photo(id, 1200, 630)
        )
        return Post(
            id: id,
            author: chance(0.5) ? randomPage() : randomFriend(),
            text: pickText(MockDataFactory.linkIntros),
            link: link,
            createdAt: date,
            audience: .everyone
        )
    }

    private func makeSharedPost(at date: Date) -> Post {
        let originalDate = date.addingTimeInterval(-Double(randomInt(2...72)) * 3_600)
        let original = chance(0.5) ? makePagePost(at: originalDate) : makePhotoPost(at: originalDate, count: 1)
        decorate(original)
        return Post(
            id: nextID("share"),
            author: randomFriend(),
            text: pickText(MockDataFactory.shareIntros),
            sharedPost: original,
            createdAt: date,
            audience: .friends
        )
    }

    private func makeGroupPost(at date: Date, withPoll: Bool) -> Post {
        let id = nextID("group")
        guard let group = pickElement(groups.filter { $0.isMember }) ?? pickElement(groups) else {
            return makeTextPost(at: date)
        }
        let author = pickElement(group.memberSample) ?? randomFriend()
        if withPoll, let info = pickElement(MockContent.polls) {
            let options = info.options.map { PollOption(title: $0, votes: randomInt(0...140)) }
            return Post(id: id, author: author, group: group, text: info.question, poll: Poll(options: options), createdAt: date, audience: .everyone)
        }
        var media: [Media] = []
        if chance(0.45) {
            media = [.photo(MockDataFactory.photo(id, 1080, 1080))]
        }
        return Post(id: id, author: author, group: group, text: pickText(MockContent.groupPosts), media: media, createdAt: date, audience: .everyone)
    }

    private func makePagePost(at date: Date) -> Post {
        let id = nextID("page")
        var media: [Media] = []
        if chance(0.8) {
            media = [.photo(MockDataFactory.photo(id, 1080, 1350), aspectRatio: 4.0 / 5.0)]
        }
        return Post(id: id, author: randomPage(), text: pickText(MockContent.pagePosts), media: media, createdAt: date, audience: .everyone)
    }

    /// Sponsored posts: one photo plus a link whose domain and title feed the CTA strip.
    private func makeSponsoredPost(at date: Date) -> Post {
        let id = nextID("ad")
        guard let ad = pickElement(MockContent.sponsoredAds) else { return makePagePost(at: date) }
        let link = LinkPreview(
            url: URL(string: "https://\(ad.domain)") ?? MockDataFactory.fallbackURL,
            domain: ad.domain,
            title: ad.headline,
            subtitle: "",
            imageURL: nil
        )
        return Post(
            id: id,
            author: randomPage(),
            text: ad.text,
            media: [.photo(MockDataFactory.photo(id, 1080, 1080))],
            link: link,
            createdAt: date,
            audience: .everyone,
            isSponsored: true,
            sponsorCTA: ad.cta
        )
    }

    private func makeLifeEventPost(at date: Date) -> Post {
        let id = nextID("life")
        let info = pickElement(MockContent.lifeEvents) ?? (title: "Started a new job", symbol: "briefcase.fill")
        var media: [Media] = []
        if chance(0.5) {
            media = [.photo(MockDataFactory.photo(id, 1080, 720), aspectRatio: 1.5)]
        }
        return Post(
            id: id,
            author: randomFriend(),
            text: chance(0.5) ? pickText(MockContent.statusUpdates) : "",
            media: media,
            lifeEvent: LifeEvent(title: info.title, subtitle: DateFormatters.monthYear.string(from: date), symbol: info.symbol),
            createdAt: date,
            audience: .friends
        )
    }

    private func makeProfilePictureUpdate(at date: Date) -> Post {
        let author = randomFriend()
        return Post(
            id: nextID("avatar"),
            author: author,
            media: [.photo(author.avatarURL, aspectRatio: 1)],
            activityText: "updated their profile picture.",
            createdAt: date,
            audience: .everyone
        )
    }

    /// Adds reactions, comments, shares and views. Most posts get a little engagement, a few go big.
    private func decorate(_ post: Post) {
        let popularity = pow(randomDouble(0...1), 2.4)
        let base: Double = (post.author.isPage || post.isSponsored) ? 6_000 : 900
        let total = Int(popularity * base) + randomInt(0...12)
        post.reactionCounts = makeReactionCounts(total: total)
        post.reactors = pickSample(friends, count: 5)
        let loaded = total == 0 ? 0 : min(randomInt(0...5), total)
        post.comments = makeComments(count: loaded, after: post.createdAt)
        post.hiddenCommentCount = chance(0.4) ? randomInt(0...(total / 8 + 1)) : 0
        post.shareCount = chance(0.5) ? randomInt(0...(total / 10 + 1)) : 0
        if post.isVideo {
            post.viewCount = total * randomInt(8...40) + randomInt(100...4_000)
        }
        if chance(0.06) {
            post.myReaction = pickElement(ReactionType.allCases)
        }
        if chance(0.04) {
            post.isSaved = true
        }
    }

    private func makeReactionCounts(total: Int) -> [ReactionType: Int] {
        guard total > 0 else { return [:] }
        var counts: [ReactionType: Int] = [:]
        let like = Int(Double(total) * randomDouble(0.45...0.75))
        let love = Int(Double(total - like) * randomDouble(0.4...0.8))
        counts[.like] = like
        counts[.love] = love
        var remaining = total - like - love
        for type in [ReactionType.care, .haha, .wow, .sad] where remaining > 0 {
            let share = randomInt(0...remaining)
            counts[type] = share
            remaining -= share
        }
        if remaining > 0 {
            counts[.haha, default: 0] += remaining
        }
        return counts.filter { $0.value > 0 }
    }

    private func makeComments(count: Int, after start: Date) -> [Comment] {
        guard count > 0 else { return [] }
        let span = max(Date().timeIntervalSince(start), 60)
        var times: [Date] = []
        for _ in 0..<count {
            times.append(start.addingTimeInterval(randomDouble(0...1) * span))
        }
        return times.sorted().map { makeComment(at: $0) }
    }

    private func makeComment(at date: Date) -> Comment {
        let comment = Comment(
            author: pickElement(people) ?? me,
            text: pickText(MockContent.comments),
            createdAt: date,
            reactionCounts: chance(0.6) ? [.like: randomInt(1...40)] : [:]
        )
        if chance(0.3) {
            var replies: [Comment] = []
            for index in 0..<randomInt(1...3) {
                let replyDate = min(date.addingTimeInterval(Double(index + 1) * 420), Date())
                replies.append(Comment(
                    author: pickElement(people) ?? me,
                    text: pickText(MockContent.replies),
                    createdAt: replyDate,
                    reactionCounts: chance(0.4) ? [.like: randomInt(1...9)] : [:]
                ))
            }
            comment.replies = replies
        }
        return comment
    }

    private func makeMyPosts() -> [Post] {
        var result: [Post] = []
        var cursor = timeAgo(days: 2)
        for index in 0..<6 {
            cursor = cursor.addingTimeInterval(-Double(randomInt(2...12)) * 86_400)
            let post: Post
            if index % 2 == 0 {
                post = Post(
                    id: "mine-\(index)",
                    author: me,
                    text: pickText(MockContent.photoCaptions),
                    media: [.photo(MockDataFactory.photo("mine-\(index)", 1080, 1080))],
                    location: chance(0.5) ? pickText(MockContent.places) : nil,
                    createdAt: cursor,
                    audience: .friends
                )
            } else {
                post = Post(id: "mine-\(index)", author: me, text: pickText(MockContent.statusUpdates), createdAt: cursor, audience: .everyone)
            }
            decorate(post)
            result.append(post)
        }
        return result
    }

    private func makeMemories() -> [Post] {
        var result: [Post] = []
        for years in [1, 3, 6] {
            let createdAt = Calendar.current.date(byAdding: .year, value: -years, to: Date()) ?? Date()
            let post = Post(
                id: "memory-\(years)",
                author: me,
                text: pickText(MockContent.photoCaptions),
                media: [.photo(MockDataFactory.photo("memory-\(years)", 1080, 1080))],
                createdAt: createdAt,
                audience: .friends,
                memoryYearsAgo: years
            )
            decorate(post)
            result.append(post)
        }
        return result
    }

    // MARK: - Reels, videos, stories

    private func makeReels(count: Int) -> [Post] {
        var result: [Post] = []
        let videos = MockDataFactory.sampleVideos
        for index in 0..<count {
            let author = index % 3 == 0 ? randomPage() : (pickElement(people) ?? me)
            let clip = Media.video(
                poster: MockDataFactory.photo("reel-\(index)", 720, 1280),
                url: videos.isEmpty ? nil : videos[index % videos.count],
                aspectRatio: 9.0 / 16.0,
                duration: randomDouble(8...45)
            )
            let reel = Post(
                id: "reel-\(index)",
                author: author,
                text: pickText(MockContent.reelCaptions),
                media: [clip],
                createdAt: timeAgo(hours: randomInt(1...120)),
                audience: .everyone,
                isReel: true,
                audioTitle: chance(0.5) ? pickText(MockContent.audioTitles) : "Original audio · \(author.name)"
            )
            decorate(reel)
            reel.viewCount = randomInt(2_000...4_000_000)
            result.append(reel)
        }
        return result
    }

    private func makeWatchVideos(count: Int) -> [Post] {
        var result: [Post] = []
        let videos = MockDataFactory.sampleVideos
        for index in 0..<count {
            let clip = Media.video(
                poster: MockDataFactory.photo("watch-\(index)", 1280, 720),
                url: videos.isEmpty ? nil : videos[(index + 2) % videos.count],
                aspectRatio: 16.0 / 9.0,
                duration: randomDouble(30...1_500)
            )
            let video = Post(
                id: "watch-\(index)",
                author: index % 2 == 0 ? randomPage() : randomFriend(),
                text: pickText(MockContent.videoTitles),
                media: [clip],
                createdAt: timeAgo(hours: randomInt(2...200)),
                audience: .everyone
            )
            decorate(video)
            video.viewCount = randomInt(5_000...9_000_000)
            result.append(video)
        }
        return result
    }

    private func makeStories() -> [Story] {
        let authors = pickSample(friends, count: 14) + Array(pages.prefix(2))
        var result: [Story] = []
        for (index, author) in authors.enumerated() {
            var items: [StoryItem] = []
            var minutes = randomInt(10...1_200)
            for itemIndex in 0..<randomInt(1...4) {
                items.append(makeStoryItem(seed: "s\(index)-\(itemIndex)", minutesAgo: minutes))
                minutes = max(1, minutes - randomInt(5...120))
            }
            let story = Story(id: "story-\(index)", author: author, items: items)
            if index >= 11 {
                story.seenItemIDs = Set(items.map { $0.id })
            }
            result.append(story)
        }
        return result
    }

    private func makeStoryItem(seed: String, minutesAgo: Int) -> StoryItem {
        let content: StoryContent
        if chance(0.2) {
            content = .text(pickText(MockContent.backgroundTexts), backgroundIndex: randomInt(0...11))
        } else {
            content = .photo(MockDataFactory.photo("story-\(seed)", 720, 1280))
        }
        return StoryItem(
            id: "item-\(seed)",
            content: content,
            createdAt: timeAgo(minutes: minutesAgo),
            duration: 5,
            caption: chance(0.3) ? pickText(MockContent.storyCaptions) : nil,
            viewerCount: randomInt(3...140)
        )
    }

    // MARK: - Events and listings

    private func makeEvents() -> [FBEvent] {
        var result: [FBEvent] = []
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        for (index, info) in MockContent.events.enumerated() {
            let day = calendar.date(byAdding: .day, value: index * 2 + 1, to: today) ?? today
            let start = day.addingTimeInterval(Double(randomInt(9...20)) * 3_600)
            let isOnline = index % 6 == 5
            let event = FBEvent(
                id: "event-\(index)",
                title: info.title,
                coverURL: MockDataFactory.photo("event-\(index)", 1200, 630),
                startDate: start,
                endDate: start.addingTimeInterval(Double(randomInt(2...5)) * 3_600),
                locationName: isOnline ? "Online" : info.location,
                address: isOnline ? "" : info.location,
                latitude: 37.7749 + randomDouble(-0.06...0.06),
                longitude: -122.4194 + randomDouble(-0.06...0.06),
                isOnline: isOnline,
                hostName: pickElement(pages)?.name ?? "Community Events",
                details: info.details,
                category: info.category,
                goingCount: randomInt(4...900),
                interestedCount: randomInt(20...5_000),
                response: index == 1 ? .going : (index == 3 ? .interested : nil),
                friendsGoing: pickSample(friends, count: randomInt(0...5)),
                isPrivate: index % 5 == 4
            )
            result.append(event)
        }
        return result
    }

    private func makeListings(count: Int) -> [Listing] {
        let items = MockContent.marketplaceItems
        guard !items.isEmpty else { return [] }
        var result: [Listing] = []
        for index in 0..<count {
            let item = items[index % items.count]
            let raw = item.maxPrice <= item.minPrice ? item.minPrice : randomInt(item.minPrice...item.maxPrice)
            let price = raw >= 100 ? (raw / 5) * 5 : raw
            let hasPriceDrop = chance(0.15) && price > 20
            let distance = (randomDouble(0.4...38) * 10).rounded() / 10
            var urls: [URL] = []
            for photoIndex in 0..<randomInt(1...5) {
                if let url = MockDataFactory.photo("item-\(index)-\(photoIndex)", 900, 900) {
                    urls.append(url)
                }
            }
            let listing = Listing(
                id: "listing-\(index)",
                title: item.title,
                price: price,
                originalPrice: hasPriceDrop ? price + max(5, price / 5) : nil,
                category: item.category,
                condition: pickElement(ItemCondition.allCases) ?? .good,
                details: item.details,
                imageURLs: urls,
                seller: pickElement(people) ?? me,
                city: pickText(MockDataFactory.bayAreaCities),
                latitude: 37.7749 + randomDouble(-0.25...0.25),
                longitude: -122.4194 + randomDouble(-0.25...0.25),
                distanceMiles: distance,
                createdAt: timeAgo(minutes: randomInt(5...20_000)),
                isSaved: chance(0.08),
                isSold: chance(0.05),
                isPending: chance(0.04),
                viewCount: randomInt(3...800)
            )
            result.append(listing)
        }
        return result
    }

    // MARK: - Notifications and chats

    private func makeNotifications(myPosts: [Post], events: [FBEvent], listings: [Listing], memories: [Post]) -> [AppNotification] {
        var result: [AppNotification] = []

        for (index, user) in people.filter({ $0.friendship == .requestReceived }).prefix(3).enumerated() {
            result.append(AppNotification(
                kind: .friendRequest,
                actors: [user],
                message: "sent you a friend request.",
                createdAt: user.requestDate ?? timeAgo(hours: index + 1),
                userID: user.id
            ))
        }

        for (index, post) in myPosts.enumerated() {
            let actors = pickSample(friends, count: 2)
            if !actors.isEmpty {
                result.append(AppNotification(
                    kind: .reaction(post.topReactions.first ?? .like),
                    actors: actors,
                    extraActorCount: max(0, post.totalReactions - actors.count),
                    message: post.text.isEmpty ? "reacted to your photo." : "reacted to your post: \"\(snippet(post.text, limit: 50))\"",
                    createdAt: min(post.createdAt.addingTimeInterval(3_600), Date()),
                    isRead: index > 0,
                    postID: post.id,
                    thumbnailURL: post.media.first?.url
                ))
            }
            if let comment = post.comments.last {
                result.append(AppNotification(
                    kind: .comment,
                    actors: [comment.author],
                    message: "commented on your post: \"\(snippet(comment.text, limit: 50))\"",
                    createdAt: comment.createdAt,
                    isRead: index > 1,
                    postID: post.id
                ))
            }
        }

        let morning = Calendar.current.startOfDay(for: Date()).addingTimeInterval(8 * 3_600)
        let birthdayTime = min(morning, Date())
        for user in friends where user.hasBirthdayToday {
            result.append(AppNotification(
                kind: .birthday,
                actors: [user],
                message: "has a birthday today. Help them have a great day!",
                createdAt: birthdayTime,
                userID: user.id
            ))
        }

        for group in groups.filter({ $0.isMember }).prefix(4) {
            let author = pickElement(group.memberSample) ?? randomFriend()
            result.append(AppNotification(
                kind: .groupPost,
                actors: [author],
                message: "posted in \(group.name): \"\(snippet(pickText(MockContent.groupPosts), limit: 50))\"",
                createdAt: timeAgo(minutes: randomInt(20...3_000)),
                isRead: chance(0.5),
                groupID: group.id,
                thumbnailURL: group.coverURL
            ))
        }

        if let group = groups.first(where: { !$0.isMember }), let friend = pickElement(friends) {
            result.append(AppNotification(
                kind: .groupInvite,
                actors: [friend],
                message: "invited you to join \(group.name).",
                createdAt: timeAgo(hours: randomInt(5...40)),
                groupID: group.id,
                thumbnailURL: group.coverURL
            ))
        }

        if let event = events.first {
            result.append(AppNotification(
                kind: .event,
                actors: Array(event.friendsGoing.prefix(1)),
                message: "\(event.friendsGoing.isEmpty ? "Reminder:" : "is going to") \(event.title) on \(event.startDate.eventStyle).",
                createdAt: timeAgo(hours: randomInt(1...20)),
                isRead: true,
                eventID: event.id,
                thumbnailURL: event.coverURL
            ))
        }

        if let memory = memories.first {
            result.append(AppNotification(
                kind: .memory,
                message: "You have memories to look back on today.",
                createdAt: birthdayTime,
                postID: memory.id,
                thumbnailURL: memory.media.first?.url
            ))
        }

        if let listing = listings.first(where: { !$0.isMine && $0.originalPrice != nil }) ?? listings.first {
            result.append(AppNotification(
                kind: .marketplace,
                message: "Price drop: \(listing.title) is now \(listing.priceText).",
                createdAt: timeAgo(hours: randomInt(3...30)),
                listingID: listing.id,
                thumbnailURL: listing.coverURL
            ))
        }

        for _ in 0..<2 {
            guard let friend = pickElement(friends), let post = myPosts.randomElement(using: &rng) else { continue }
            result.append(AppNotification(
                kind: .mention,
                actors: [friend],
                message: "mentioned you in a comment: \"\(snippet(pickText(MockContent.comments), limit: 50))\"",
                createdAt: timeAgo(days: randomInt(1...5)),
                isRead: true,
                postID: post.id
            ))
        }

        for friend in pickSample(friends, count: 2) {
            result.append(AppNotification(
                kind: .friendAccepted,
                actors: [friend],
                message: "accepted your friend request.",
                createdAt: timeAgo(days: randomInt(2...9)),
                isRead: true,
                userID: friend.id
            ))
        }

        if let page = pickElement(pages), let friend = pickElement(friends) {
            result.append(AppNotification(
                kind: .pageInvite,
                actors: [friend],
                message: "invited you to follow \(page.name).",
                createdAt: timeAgo(days: randomInt(1...6)),
                isRead: true,
                userID: page.id
            ))
        }

        if let friend = pickElement(friends) {
            result.append(AppNotification(
                kind: .live,
                actors: [friend],
                message: "was live: \"\(snippet(pickText(MockContent.videoTitles), limit: 50))\"",
                createdAt: timeAgo(hours: randomInt(26...60)),
                isRead: true,
                userID: friend.id
            ))
        }

        return result.sorted { $0.createdAt > $1.createdAt }
    }

    private func makeConversations() -> [Conversation] {
        var result: [Conversation] = []
        let partners = pickSample(friends, count: 14)
        for (index, friend) in partners.enumerated() {
            let lastTime = timeAgo(minutes: index * index * 37 + randomInt(1...25))
            let isUnread = index < 4
            let messages = makeMessages(with: [friend], endingAt: lastTime, count: randomInt(4...16), lastIsIncoming: isUnread || chance(0.5))
            let chat = Conversation(
                id: "chat-\(index)",
                participants: [friend],
                messages: messages,
                isMuted: index == 7,
                isPinned: index == 2,
                unreadCount: isUnread ? randomInt(1...3) : 0,
                themeHex: MockDataFactory.themeColors[index % MockDataFactory.themeColors.count],
                quickEmoji: index % 5 == 3 ? "❤️" : "👍"
            )
            result.append(chat)
        }

        for (index, name) in MockDataFactory.groupChatNames.enumerated() {
            let members = pickSample(friends, count: randomInt(3...5))
            guard members.count >= 2 else { continue }
            let lastTime = timeAgo(minutes: index * 190 + randomInt(15...90))
            let chat = Conversation(
                id: "group-chat-\(index)",
                participants: members,
                groupName: name,
                messages: makeMessages(with: members, endingAt: lastTime, count: randomInt(6...18), lastIsIncoming: true),
                unreadCount: index == 0 ? randomInt(2...6) : 0,
                themeHex: MockDataFactory.themeColors[(index + 3) % MockDataFactory.themeColors.count]
            )
            result.append(chat)
        }

        return result.sorted { $0.lastActivity > $1.lastActivity }
    }

    private func makeMessages(with participants: [User], endingAt end: Date, count: Int, lastIsIncoming: Bool) -> [Message] {
        var gaps: [Double] = []
        for _ in 0..<count {
            gaps.append(Double(randomInt(1...95)) * 60)
        }
        var times: [Date] = []
        var cursor = end
        for gap in gaps {
            times.insert(cursor, at: 0)
            cursor = cursor.addingTimeInterval(-gap)
        }

        var messages: [Message] = []
        for (index, time) in times.enumerated() {
            let isLast = index == times.count - 1
            let fromMe = isLast ? !lastIsIncoming : chance(0.45)
            let sender = fromMe ? me : (pickElement(participants) ?? me)
            var message = Message(senderID: sender.id, sentAt: time, status: .seen)
            let roll = randomInt(0...99)
            if roll < 6 {
                message.imageURL = MockDataFactory.photo("chat-\(postCounter)-\(index)", 800, 800)
            } else if roll < 10 {
                message.bigEmoji = "👍"
            } else if index == 0 && !fromMe {
                message.text = pickText(MockContent.chatOpeners)
            } else {
                message.text = pickText(MockContent.chatReplies)
            }
            if chance(0.12), let reactor = fromMe ? participants.first : Optional(me) {
                message.reactions = [reactor.id: pickText(["❤️", "😆", "👍", "😮"])]
            }
            if fromMe && isLast {
                message.status = chance(0.5) ? .seen : .delivered
            }
            messages.append(message)
        }
        postCounter += 1
        return messages
    }
}
