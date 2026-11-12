import Foundation
import Observation

/// Who a Bubble Board compares you with.
enum BubbleBoardScope: String, CaseIterable, Identifiable, Hashable {
    case group
    case friends
    case everyone

    var id: String { rawValue }

    var title: String {
        switch self {
        case .group: return "Group"
        case .friends: return "Friends"
        case .everyone: return "Everyone"
        }
    }
}

/// One finished run on a Bubble Board.
struct BubbleScore: Identifiable, Hashable {
    let id: String
    let user: User
    var score: Int
    var achievedAt: Date
    /// "yyyy-MM-dd" for Daily Bubbles, so boards reset each day.
    var day: String?
    /// The run, for Bursts and ghost replays.
    var replay: BubbleInputLog?
    var share: BubbleShareArtifact?
    /// True once the replay was re-simulated headless and reached exactly this score
    /// (`BubbleJSRuntime.verify`, docs/BUBBLES.md 4.8). Bubble Boards mark these runs.
    var isVerified: Bool

    init(
        id: String = UUID().uuidString,
        user: User,
        score: Int,
        achievedAt: Date = Date(),
        day: String? = nil,
        replay: BubbleInputLog? = nil,
        share: BubbleShareArtifact? = nil,
        isVerified: Bool = false
    ) {
        self.id = id
        self.user = user
        self.score = score
        self.achievedAt = achievedAt
        self.day = day
        self.replay = replay
        self.share = share
        self.isVerified = isVerified
    }
}

/// A playable mini-game in the app: its manifest plus who made it, where it lives and how it's doing.
@Observable
final class Bubble: Identifiable, Hashable {
    let id: String
    var manifest: BubbleManifest
    let creator: User
    /// The Group it was made for (Daily Bubbles and Group games).
    var group: FBGroup?
    /// The Event it was made for (icebreakers).
    var event: FBEvent?
    var createdAt: Date
    /// Muse Image cover art (WebP or PNG). Nil draws the Glow placeholder.
    var coverImageData: Data?
    var playCount: Int
    var likeCount: Int
    var isLiked: Bool
    var isSaved: Bool
    /// How many people saved it. Saves are the likes (docs/BUBBLES.md 7.10): show this where likes
    /// would be. Seeds set it with `_seed.save_count`; `toggleSave` keeps it in step.
    var saveCount: Int
    /// Everyone's runs, best first is not guaranteed; use `BubbleStore.leaderboard`.
    var scores: [BubbleScore]
    /// The run shown as a Burst before you take over.
    var featuredRun: BubbleScore?
    /// Earlier versions, oldest first. Edits keep history.
    var history: [BubbleManifest]

    init(
        manifest: BubbleManifest,
        creator: User,
        group: FBGroup? = nil,
        event: FBEvent? = nil,
        createdAt: Date = Date(),
        coverImageData: Data? = nil,
        playCount: Int = 0,
        likeCount: Int = 0,
        isLiked: Bool = false,
        isSaved: Bool = false,
        saveCount: Int = 0,
        scores: [BubbleScore] = [],
        featuredRun: BubbleScore? = nil,
        history: [BubbleManifest] = []
    ) {
        self.id = manifest.id
        self.manifest = manifest
        self.creator = creator
        self.group = group
        self.event = event
        self.createdAt = createdAt
        self.coverImageData = coverImageData
        self.playCount = playCount
        self.likeCount = likeCount
        self.isLiked = isLiked
        self.isSaved = isSaved
        self.saveCount = saveCount
        self.scores = scores
        self.featuredRun = featuredRun
        self.history = history
    }

    var title: String { manifest.title }
    var rule: String { manifest.oneLineRule }
    var formula: BubbleFormula { manifest.formula }
    var paletteID: String { manifest.style.palette }
    /// The colors this Bubble really uses, custom colors included (LOOKS.md). Use for anything
    /// Bubble-specific: accents, backgrounds behind posters.
    var palette: BubblePalette { BubbleGlow.palette(for: manifest.style) }
    var emoji: String { manifest.style.emoji ?? "🫧" }
    var isDaily: Bool { manifest.structure.isDaily }
    var isIcebreaker: Bool { manifest.structure.eventID != nil }
    var chainID: String? { manifest.chain?.id }
    var levelIndex: Int? { manifest.chain?.index }
    var isMadeWithMuse: Bool { manifest.structure.setter == "ai" || manifest.studio != nil }
    /// The chip next to the formula: Adventure, Quiz night, Learn, or none (`.play`).
    var category: BubbleCategory { formula.category }

    static func == (lhs: Bubble, rhs: Bubble) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
