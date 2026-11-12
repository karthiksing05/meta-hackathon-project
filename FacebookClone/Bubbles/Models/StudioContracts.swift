import Foundation

// Contracts between the app and Muse Studio, the agentic harness that makes Bubbles.
// Foundation only: the macOS CLI (tools/bubble-studio) compiles this file too.

enum StudioMode: String, Codable, Sendable {
    /// A new Bubble from a request.
    case create
    /// Change an existing Bubble ("make it slower", "use our inside jokes"). Same id, version + 1.
    case edit
    /// Fork someone's Bubble into a new one, applying an operator.
    case remix
    /// A new Bubble that continues a chain as its next level.
    case nextLevel = "next_level"
    /// Today's Daily Bubble for a Group, from its opted-in posts.
    case daily
}

/// A piece of opted-in content Studio may use (synthetic in the demo).
struct StudioSource: Codable, Hashable, Sendable {
    var author: String
    var text: String

    init(author: String, text: String) {
        self.author = author
        self.text = text
    }
}

struct StudioRequest: Codable, Hashable, Sendable {
    var mode: StudioMode
    /// What the person typed.
    var prompt: String
    /// "everyone", "friends", "group:<id>" or "event:<id>".
    var scope: String
    /// Display name of the scope, e.g. "New in SF".
    var scopeName: String?
    /// First names of people in the scope (synthetic), for icebreaker content.
    var audienceNames: [String]
    /// Opted-in posts and intros Studio may read.
    var sources: [StudioSource]
    /// The Bubble being edited, remixed or continued.
    var base: BubbleManifest?
    /// A brief the creator already reviewed. When set, Studio uses it as-is.
    var brief: BubbleBrief?
    var formulaHint: BubbleFormula?
    var paletteHint: String?
    /// Daily: the day the Bubble is for, "yyyy-MM-dd".
    var date: String?
    var creatorName: String

    init(
        mode: StudioMode = .create,
        prompt: String,
        scope: String = "everyone",
        scopeName: String? = nil,
        audienceNames: [String] = [],
        sources: [StudioSource] = [],
        base: BubbleManifest? = nil,
        brief: BubbleBrief? = nil,
        formulaHint: BubbleFormula? = nil,
        paletteHint: String? = nil,
        date: String? = nil,
        creatorName: String = "Alex"
    ) {
        self.mode = mode
        self.prompt = prompt
        self.scope = scope
        self.scopeName = scopeName
        self.audienceNames = audienceNames
        self.sources = sources
        self.base = base
        self.brief = brief
        self.formulaHint = formulaHint
        self.paletteHint = paletteHint
        self.date = date
        self.creatorName = creatorName
    }
}

/// The steps Studio reports while it works. The UI shows them as the agent's timeline.
enum StudioStep: String, Codable, CaseIterable, Sendable {
    case understand
    case brief
    case compose
    case glue
    case content
    case validate
    case repair
    case playtest
    case cover
    case polish
    case done
    case failed

    var title: String {
        switch self {
        case .understand: return "Reading your request"
        case .brief: return "Writing the brief"
        case .compose: return "Picking concepts"
        case .glue: return "Writing custom code"
        case .content: return "Making content"
        case .validate: return "Checking the wiring"
        case .repair: return "Fixing problems"
        case .playtest: return "Playtesting"
        case .cover: return "Painting the cover"
        case .polish: return "Final touches"
        case .done: return "Ready to play"
        case .failed: return "Something went wrong"
        }
    }

    var symbol: String {
        switch self {
        case .understand: return "text.magnifyingglass"
        case .brief: return "doc.text"
        case .compose: return "square.stack.3d.up"
        case .glue: return "chevron.left.forwardslash.chevron.right"
        case .content: return "text.word.spacing"
        case .validate: return "checkmark.shield"
        case .repair: return "wrench.and.screwdriver"
        case .playtest: return "gamecontroller"
        case .cover: return "paintpalette"
        case .polish: return "sparkles"
        case .done: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle"
        }
    }
}

/// One update from Studio. The final `.done` event carries the manifest (and cover, if any).
struct StudioEvent: Identifiable, Sendable {
    let id: UUID
    var step: StudioStep
    /// Short line for the timeline, e.g. "Picked 9 concepts".
    var title: String
    var detail: String?
    /// The Muse model that did this step, e.g. "muse-wonder-1.0".
    var model: String?
    /// Seconds since the run started.
    var elapsed: TimeInterval
    var brief: BubbleBrief?
    var concepts: [String]?
    var manifest: BubbleManifest?
    /// Cover art (WebP or PNG data).
    var coverImage: Data?
    var issues: [String]?
    /// True when the offline composer did this step instead of Muse.
    var isOffline: Bool
    /// `next_level` only, on the `.done` event: the base Bubble's manifest with its chain link set
    /// (chain id, index and `next` pointing at the new level). Swap it in with
    /// `BubbleStore.update(_:to:)` (or replace the manifest) so both levels form one Bubble Chain.
    var baseUpdate: BubbleManifest? = nil
    /// Daily Bubbles: the opted-in sources Muse actually used, e.g. `["Maya", "Diego"]`
    /// (the step that read them, and `.done`).
    var sourcesUsed: [String]? = nil

    init(
        id: UUID = UUID(),
        step: StudioStep,
        title: String,
        detail: String? = nil,
        model: String? = nil,
        elapsed: TimeInterval = 0,
        brief: BubbleBrief? = nil,
        concepts: [String]? = nil,
        manifest: BubbleManifest? = nil,
        coverImage: Data? = nil,
        issues: [String]? = nil,
        isOffline: Bool = false
    ) {
        self.id = id
        self.step = step
        self.title = title
        self.detail = detail
        self.model = model
        self.elapsed = elapsed
        self.brief = brief
        self.concepts = concepts
        self.manifest = manifest
        self.coverImage = coverImage
        self.issues = issues
        self.isOffline = isOffline
    }
}

/// Muse Studio: turns requests into Bubbles. Implemented in `Bubbles/Studio`.
protocol BubbleStudioService: AnyObject {
    /// True when a Muse key is configured. Without one, Studio uses its offline composer.
    var isMuseConnected: Bool { get }

    /// Fast first pass: how Muse reads the request. Shown to the creator to edit.
    func draftBrief(_ request: StudioRequest) async throws -> BubbleBrief

    /// Runs the whole pipeline. The stream ends with a `.done` event carrying the manifest,
    /// or throws / emits `.failed`.
    func compose(_ request: StudioRequest) -> AsyncThrowingStream<StudioEvent, Error>
}

/// Muse API settings. Loaded from the gitignored `MuseConfig.json` in the app bundle (written by
/// `scripts/sync-muse-config.sh` from `.env`), or from the `MUSE_API_KEY` environment variable.
struct MuseConfig: Codable, Hashable, Sendable {
    var apiKey: String
    var baseURL: String
    var plannerModel: String
    var fastModel: String
    var imageModel: String
    var visionModel: String

    static let defaultBaseURL = "https://api.meta.ai/v1"

    init(
        apiKey: String,
        baseURL: String = MuseConfig.defaultBaseURL,
        plannerModel: String = "muse-wonder-1.0",
        fastModel: String = "muse-ember-1.0",
        imageModel: String = "muse-image-1.0",
        visionModel: String = "muse-spark-1.3"
    ) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.plannerModel = plannerModel
        self.fastModel = fastModel
        self.imageModel = imageModel
        self.visionModel = visionModel
    }

    enum CodingKeys: String, CodingKey {
        case apiKey = "api_key"
        case baseURL = "base_url"
        case plannerModel = "planner_model"
        case fastModel = "fast_model"
        case imageModel = "image_model"
        case visionModel = "vision_model"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        apiKey = try c.decode(String.self, forKey: .apiKey)
        baseURL = try c.decodeIfPresent(String.self, forKey: .baseURL) ?? MuseConfig.defaultBaseURL
        plannerModel = try c.decodeIfPresent(String.self, forKey: .plannerModel) ?? "muse-wonder-1.0"
        fastModel = try c.decodeIfPresent(String.self, forKey: .fastModel) ?? "muse-ember-1.0"
        imageModel = try c.decodeIfPresent(String.self, forKey: .imageModel) ?? "muse-image-1.0"
        visionModel = try c.decodeIfPresent(String.self, forKey: .visionModel) ?? "muse-spark-1.3"
    }

    /// `MuseConfig.json` in the bundle first, then the `MUSE_API_KEY` environment variable.
    static func load(bundle: Bundle = .main) -> MuseConfig? {
        if let url = bundle.url(forResource: "MuseConfig", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let config = try? JSONDecoder().decode(MuseConfig.self, from: data),
           !config.apiKey.isEmpty {
            return config
        }
        if let key = ProcessInfo.processInfo.environment["MUSE_API_KEY"], !key.isEmpty {
            return MuseConfig(apiKey: key)
        }
        return nil
    }
}
