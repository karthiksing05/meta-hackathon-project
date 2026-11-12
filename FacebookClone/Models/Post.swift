import Foundation
import Observation

enum Audience: String, CaseIterable, Identifiable, Hashable {
    case everyone
    case friends
    case friendsExcept
    case onlyMe

    var id: String { rawValue }

    var title: String {
        switch self {
        case .everyone: return "Public"
        case .friends: return "Friends"
        case .friendsExcept: return "Friends except..."
        case .onlyMe: return "Only me"
        }
    }

    var subtitle: String {
        switch self {
        case .everyone: return "Anyone on or off Facebook"
        case .friends: return "Your friends on Facebook"
        case .friendsExcept: return "Don't show to some friends"
        case .onlyMe: return "Only you can see this"
        }
    }

    /// SF Symbol name.
    var symbol: String {
        switch self {
        case .everyone: return "globe.americas.fill"
        case .friends: return "person.2.fill"
        case .friendsExcept: return "person.fill.badge.minus"
        case .onlyMe: return "lock.fill"
        }
    }
}

struct Feeling: Identifiable, Hashable {
    let emoji: String
    let name: String

    var id: String { name }

    static let all: [Feeling] = [
        Feeling(emoji: "😊", name: "happy"),
        Feeling(emoji: "🥰", name: "loved"),
        Feeling(emoji: "😍", name: "in love"),
        Feeling(emoji: "🤩", name: "excited"),
        Feeling(emoji: "🥳", name: "festive"),
        Feeling(emoji: "😎", name: "cool"),
        Feeling(emoji: "😌", name: "relaxed"),
        Feeling(emoji: "🙏", name: "thankful"),
        Feeling(emoji: "😇", name: "blessed"),
        Feeling(emoji: "🤗", name: "grateful"),
        Feeling(emoji: "💪", name: "motivated"),
        Feeling(emoji: "😤", name: "determined"),
        Feeling(emoji: "🤔", name: "curious"),
        Feeling(emoji: "😋", name: "hungry"),
        Feeling(emoji: "😂", name: "amused"),
        Feeling(emoji: "😴", name: "sleepy"),
        Feeling(emoji: "🥺", name: "emotional"),
        Feeling(emoji: "😢", name: "sad"),
        Feeling(emoji: "🤒", name: "sick"),
        Feeling(emoji: "😡", name: "angry"),
        Feeling(emoji: "😮‍💨", name: "exhausted"),
        Feeling(emoji: "🤓", name: "nerdy"),
        Feeling(emoji: "🫶", name: "proud"),
        Feeling(emoji: "😏", name: "confident"),
    ]
}

enum MediaKind: String, Hashable {
    case photo
    case video
}

struct Media: Identifiable, Hashable {
    let id: String
    var kind: MediaKind
    /// Photo URL, or the poster frame for a video.
    var url: URL?
    var videoURL: URL?
    /// A photo picked from the user's library.
    var data: Data?
    /// Width divided by height.
    var aspectRatio: Double
    /// Video length in seconds.
    var duration: TimeInterval?

    init(
        id: String = UUID().uuidString,
        kind: MediaKind = .photo,
        url: URL? = nil,
        videoURL: URL? = nil,
        data: Data? = nil,
        aspectRatio: Double = 1,
        duration: TimeInterval? = nil
    ) {
        self.id = id
        self.kind = kind
        self.url = url
        self.videoURL = videoURL
        self.data = data
        self.aspectRatio = aspectRatio
        self.duration = duration
    }

    static func photo(_ url: URL?, aspectRatio: Double = 1) -> Media {
        Media(kind: .photo, url: url, aspectRatio: aspectRatio)
    }

    static func localPhoto(_ data: Data, aspectRatio: Double = 1) -> Media {
        Media(kind: .photo, data: data, aspectRatio: aspectRatio)
    }

    static func video(poster: URL?, url: URL?, aspectRatio: Double = 16.0 / 9.0, duration: TimeInterval) -> Media {
        Media(kind: .video, url: poster, videoURL: url, aspectRatio: aspectRatio, duration: duration)
    }
}

struct LinkPreview: Hashable {
    var url: URL
    var domain: String
    var title: String
    var subtitle: String
    var imageURL: URL?
}

struct PollOption: Identifiable, Hashable {
    let id: String
    var title: String
    /// Votes from other people. The signed-in user's vote is tracked by `Poll.myVoteID`.
    var votes: Int

    init(id: String = UUID().uuidString, title: String, votes: Int = 0) {
        self.id = id
        self.title = title
        self.votes = votes
    }
}

struct Poll: Hashable {
    var options: [PollOption]
    var myVoteID: String?

    func votes(for option: PollOption) -> Int {
        option.votes + (myVoteID == option.id ? 1 : 0)
    }

    var totalVotes: Int {
        options.reduce(0) { $0 + votes(for: $1) }
    }

    func fraction(for option: PollOption) -> Double {
        let total = totalVotes
        guard total > 0 else { return 0 }
        return Double(votes(for: option)) / Double(total)
    }
}

struct LifeEvent: Hashable {
    var title: String
    var subtitle: String?
    /// SF Symbol name.
    var symbol: String
}

@Observable
final class Post: Identifiable, Hashable {
    let id: String
    let author: User
    /// Set when the post was made inside a group.
    var group: FBGroup?
    /// Set when the post was written on someone else's profile (for example birthday wishes).
    var timelineOwner: User?
    var text: String
    /// Index into `PostBackground.presets` for short, text-only posts.
    var backgroundIndex: Int?
    var media: [Media]
    var link: LinkPreview?
    var sharedPost: Post?
    var poll: Poll?
    var feeling: Feeling?
    var location: String?
    var taggedUsers: [User]
    /// Header suffix such as "updated their profile picture."
    var activityText: String?
    var lifeEvent: LifeEvent?
    var createdAt: Date
    var audience: Audience
    var isSponsored: Bool
    /// Call to action for sponsored posts, e.g. "Shop now".
    var sponsorCTA: String?
    var isReel: Bool
    /// Reels: "Original audio" or a song name.
    var audioTitle: String?
    /// Reactions from other people. The signed-in user's reaction lives in `myReaction`.
    var reactionCounts: [ReactionType: Int]
    var myReaction: ReactionType?
    /// A sample of people who reacted, used for "Maria Lopez and 23 others".
    var reactors: [User]
    var comments: [Comment]
    /// Comments that exist but are not loaded ("View 12 more comments").
    var hiddenCommentCount: Int
    var shareCount: Int
    var viewCount: Int
    var isSaved: Bool
    var isHidden: Bool
    var isEdited: Bool
    var notificationsOn: Bool
    var isUploading: Bool
    /// 0...1 while `isUploading` is true.
    var uploadProgress: Double
    /// Memories: how many years ago this was first posted.
    var memoryYearsAgo: Int?
    /// Bubbles: the Bubble this post carries (a floated Bubble, a shared result, or a Burst reel).
    var bubbleID: String? = nil
    /// Bubbles: the run to play as a Burst before the viewer takes over.
    var bubbleReplay: BubbleInputLog? = nil
    /// Bubbles: the author opted this post in as material for their Group's Daily Bubble.
    var allowsBubbles: Bool = false

    init(
        id: String = UUID().uuidString,
        author: User,
        group: FBGroup? = nil,
        timelineOwner: User? = nil,
        text: String = "",
        backgroundIndex: Int? = nil,
        media: [Media] = [],
        link: LinkPreview? = nil,
        sharedPost: Post? = nil,
        poll: Poll? = nil,
        feeling: Feeling? = nil,
        location: String? = nil,
        taggedUsers: [User] = [],
        activityText: String? = nil,
        lifeEvent: LifeEvent? = nil,
        createdAt: Date = Date(),
        audience: Audience = .everyone,
        isSponsored: Bool = false,
        sponsorCTA: String? = nil,
        isReel: Bool = false,
        audioTitle: String? = nil,
        reactionCounts: [ReactionType: Int] = [:],
        myReaction: ReactionType? = nil,
        reactors: [User] = [],
        comments: [Comment] = [],
        hiddenCommentCount: Int = 0,
        shareCount: Int = 0,
        viewCount: Int = 0,
        isSaved: Bool = false,
        notificationsOn: Bool = false,
        memoryYearsAgo: Int? = nil
    ) {
        self.id = id
        self.author = author
        self.group = group
        self.timelineOwner = timelineOwner
        self.text = text
        self.backgroundIndex = backgroundIndex
        self.media = media
        self.link = link
        self.sharedPost = sharedPost
        self.poll = poll
        self.feeling = feeling
        self.location = location
        self.taggedUsers = taggedUsers
        self.activityText = activityText
        self.lifeEvent = lifeEvent
        self.createdAt = createdAt
        self.audience = audience
        self.isSponsored = isSponsored
        self.sponsorCTA = sponsorCTA
        self.isReel = isReel
        self.audioTitle = audioTitle
        self.reactionCounts = reactionCounts
        self.myReaction = myReaction
        self.reactors = reactors
        self.comments = comments
        self.hiddenCommentCount = hiddenCommentCount
        self.shareCount = shareCount
        self.viewCount = viewCount
        self.isSaved = isSaved
        self.isHidden = false
        self.isEdited = false
        self.notificationsOn = notificationsOn
        self.isUploading = false
        self.uploadProgress = 0
        self.memoryYearsAgo = memoryYearsAgo
    }

    var totalReactions: Int { ReactionMath.total(reactionCounts, mine: myReaction) }

    /// Up to three reaction types, most popular first.
    var topReactions: [ReactionType] { ReactionMath.top(reactionCounts, mine: myReaction) }

    /// Top-level comments, their replies, and comments that are not loaded yet.
    var totalComments: Int {
        comments.reduce(0) { $0 + 1 + $1.replies.count } + hiddenCommentCount
    }

    var isVideo: Bool { media.first?.kind == .video }

    var photos: [Media] { media.filter { $0.kind == .photo } }

    /// True for short text-only posts shown on a colored background.
    var showsBackground: Bool {
        backgroundIndex != nil && media.isEmpty && link == nil && sharedPost == nil && poll == nil
    }

    /// Every remote image this post shows, for prefetching.
    var imageURLs: [URL] {
        var urls = media.compactMap { $0.url }
        if let image = link?.imageURL { urls.append(image) }
        if let avatar = author.avatarURL { urls.append(avatar) }
        if let shared = sharedPost { urls.append(contentsOf: shared.media.compactMap { $0.url }) }
        return urls
    }

    /// "You and 1.2K others", "Maria Lopez and 23 others", or just the count.
    var reactionSummary: String {
        let total = totalReactions
        guard total > 0 else { return "" }
        if myReaction != nil {
            let others = total - 1
            if others == 0 { return "You" }
            return "You and \(others.fbCompact) \(others == 1 ? "other" : "others")"
        }
        if let first = reactors.first {
            let others = total - 1
            if others == 0 { return first.name }
            return "\(first.name) and \(others.fbCompact) \(others == 1 ? "other" : "others")"
        }
        return total.fbCompact
    }

    static func == (lhs: Post, rhs: Post) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
