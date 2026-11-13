import Foundation
import Observation
import SwiftUI

// MARK: - Flow types

/// The five steps of Muse Studio: describe it, read the brief, watch Muse build it, try it, share it.
enum StudioStage: Int, CaseIterable, Identifiable, Comparable {
    case ask
    case brief
    case compose
    case tryIt
    case float

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .ask: return "Describe"
        case .brief: return "Brief"
        case .compose: return "Build"
        case .tryIt: return "Try it"
        case .float: return "Share"
        }
    }

    static func < (lhs: StudioStage, rhs: StudioStage) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// Who a Bubble is for. Maps to `StudioRequest.scope`.
enum StudioAudience: Hashable {
    case everyone
    case friends
    case group(String)
    case event(String)

    var kind: StudioAudienceKind {
        switch self {
        case .everyone: return .everyone
        case .friends: return .friends
        case .group: return .group
        case .event: return .event
        }
    }

    var scope: String {
        switch self {
        case .everyone: return "everyone"
        case .friends: return "friends"
        case .group(let id): return "group:\(id)"
        case .event(let id): return "event:\(id)"
        }
    }
}

enum StudioAudienceKind: String, CaseIterable, Identifiable {
    case everyone
    case friends
    case group
    case event

    var id: String { rawValue }

    var title: String {
        switch self {
        case .everyone: return "Everyone"
        case .friends: return "Friends"
        case .group: return "A group"
        case .event: return "An event"
        }
    }

    var symbol: String {
        switch self {
        case .everyone: return "globe.americas.fill"
        case .friends: return "person.2.fill"
        case .group: return "person.3.fill"
        case .event: return "calendar"
        }
    }
}

/// Where a finished Bubble floats to.
enum StudioDestination: Hashable {
    case feed
    case group(String)
    case event(String)
}

/// What the current compose run makes.
enum StudioComposeKind: Equatable {
    /// The first version (create, remix, next level from a launch, daily).
    case create
    /// "Tweak it": edit the current level.
    case tweak
    /// "Make level 2": a new level after the current one.
    case nextLevel
}

/// An opted-in post Muse may read, with the creator's include switch.
struct StudioSourceItem: Identifiable {
    let post: Post
    var isIncluded: Bool

    var id: String { post.id }
}

/// One finished level: what Muse made, plus the cover.
struct StudioResult: Identifiable, Equatable {
    var manifest: BubbleManifest
    var cover: Data?
    var isOffline: Bool
    /// Seconds Muse took.
    var duration: TimeInterval?
    /// Muse models that worked on it.
    var models: [String]
    /// The Bubble being edited (saved with `update`, not published).
    var isExisting: Bool
    /// First names of the people whose opted-in posts Muse used (Daily and Group Bubbles).
    var sourcesUsed: [String] = []

    var id: String { manifest.id }
}

/// A friendly compose failure.
struct StudioFailure: Equatable {
    var message: String
    var detail: String?
}

// MARK: - Model

/// Muse Studio's state: the request, the brief, the live compose timeline, the levels Muse made
/// and where they float. Views read and mutate it. New games are made on the server
/// (`GameGenerator`, `/v1/generate`); the app calls no Muse model itself.
@MainActor
@Observable
final class StudioModel {
    let launch: StudioLaunch

    @ObservationIgnored private(set) var bubbleStore: BubbleStore?
    @ObservationIgnored private(set) var appStore: AppStore?
    @ObservationIgnored private var composeTask: Task<Void, Never>?
    @ObservationIgnored private var briefTask: Task<Void, Never>?
    @ObservationIgnored private var advanceTask: Task<Void, Never>?

    var isReady = false
    var stage: StudioStage = .ask
    /// +1 going forward, -1 going back (for the step transition).
    var direction = 1
    /// The server makes every game with Muse, so the Brief always shows the Muse model.
    let isMuseConnected = true

    /// The Bubble being edited, remixed or continued.
    var baseBubble: Bubble?
    /// The library sound the new game plays behind it ("Use this sound"); a remix keeps the
    /// original's sound unless this names another (the server's rule).
    var sound: RemoteGameSound?

    // Ask
    var prompt = ""
    var audience: StudioAudience = .everyone
    var formulaHint: BubbleFormula?
    /// The look the person picked; nil means Muse picks. Sent as `StudioRequest.paletteHint`.
    var lookHint: StudioLook?
    /// Photos and video the person added, uploaded as they're picked (`media`, `mediaNote`,
    /// `mediaRestyle` on the plan and the build).
    let media = StudioMediaModel()

    // Collaboration (docs/BUBBLES.md 7)
    /// Co-makers, contributions, about-me answers, own story, lesson notes. From the launch;
    /// features' Studio entries may set it.
    var social: StudioSocialContext?
    /// The length picked in Customize; nil lets Muse pick. Owner: length.
    var length: BubbleLength?
    /// Tuning knobs picked in Customize, by knob id. Owner: length.
    var tuning: [String: JSONValue]?

    // Brief
    var brief: BubbleBrief?
    /// The sound set picked on the brief ("soft", "bright", "dreamy"); nil lets Muse pick. Sent to
    /// Muse in the brief's notes.
    var soundHint: String?
    /// True when Muse builds this one from scratch on the microgame engine
    /// (`StudioMicrogameBridge`) instead of a ready formula. Set when the brief arrives; the
    /// Brief step can switch it.
    var buildsMicrogame = false
    var isDraftingBrief = false
    /// Set when Muse couldn't draft the brief and Studio filled in the basics.
    var briefNote: String?
    var sources: [StudioSourceItem] = []
    /// How the game works, agreed with Muse before the build and changed on Try
    /// (docs/BUBBLES.md 7.13). New games only (`usesAnatomy`).
    let anatomyThread = StudioAnatomyThread()

    // Compose
    var composeKind: StudioComposeKind = .create
    var events: [StudioEvent] = []
    var concepts: [String] = []
    var isComposing = false
    var composeStartedAt: Date?
    var composeEndedAt: Date?
    var lastEventAt: Date?
    var failure: StudioFailure?
    var draftManifest: BubbleManifest?
    var draftCover: Data?
    var sawOfflineEvent = false
    /// The latest `sourcesUsed` the service reported in this run.
    var sourcesUsed: [String]?
    /// A chain link for the base Bubble from a `next_level` run (`StudioEvent.baseUpdate`),
    /// applied when the new level floats.
    var pendingBaseChain: BubbleChainLink?
    @ObservationIgnored var lastRequest: StudioRequest?
    /// True while (or after) the current run makes a game from scratch (always on the server).
    var runIsMicrogame = false
    /// Real playtest reports from the microgame composer, by the event that carried them.
    var playtestReports: [UUID: StudioPlaytest.Report] = [:]
    /// True while (or after) the current run is made on the server (`StudioGenerateBridge`).
    var runIsServer = false
    /// Set while a server job waits for a free slot; nil once it runs (or on the device).
    var generationWait: StudioGenerateBridge.Wait?
    /// True while a new game's build holds its request for the anatomy Muse is still drafting
    /// (at most `anatomyGrace`), so the build follows it.
    var isWaitingForAnatomy = false
    /// Where the Build step's progress bar is: the phase the latest step started, and when.
    @ObservationIgnored var buildPhase = StudioBuildPhase.idle
    /// True while the keyboard is up on the Build step: a finished build waits on its Play button
    /// instead of jumping to Try mid-answer.
    var holdsAutoAdvance = false
    /// What each finished run did, by game id, for "How Muse made it" (saved on share).
    @ObservationIgnored var makeRecords: [String: MakeRecord] = [:]
    /// The new look a "Tweak it" run asked for (Try it's look menu).
    @ObservationIgnored private var runLookChange: StudioLook?
    /// True while the run is the quick change made from anatomy edits during the first build.
    @ObservationIgnored var pendingChangeRun = false
    /// Set when the run changes a game the server has (a tweak, a new look, the next level, a
    /// remix): `POST /v1/generate {baseGameId, ...}`. Nil for a new game.
    @ObservationIgnored private var runRevision: GameRevision?
    /// What the Plan step agreed (`spec`, `answers`), for the next new game; the build takes it.
    @ObservationIgnored var pendingPlan: StudioPlanHandoff?
    /// The agreed plan this run sends to `/v1/generate` (kept for Try again).
    @ObservationIgnored private var runPlan: StudioPlanHandoff?
    /// Games the server made in this session, still drafts: the level's app id to the id the
    /// server knows it by (the manifest id it sent, linked to its server id). Shared ones are
    /// published (`publishDrafts`); the rest are deleted when Studio is discarded.
    @ObservationIgnored private(set) var drafts: [String: String] = [:]

    // Try it
    var levels: [StudioResult] = []
    var selectedLevel = 0
    var tweakText = ""
    /// Focus "Tweak it" when the Try step appears (edit mode).
    var focusTweak = false

    // Share
    var destination: StudioDestination = .feed
    var caption = ""
    /// True while sharing is in progress (publish, challenges, record), until the game page opens.
    var isPopping = false
    /// Friends to challenge (or send it to) when sharing, by user id, in pick order.
    var challengeIDs: [String] = []
    @ObservationIgnored var didPickDefaultFriendsFlag = false

    init(launch: StudioLaunch) {
        self.launch = launch
    }

    // MARK: Setup

    /// Connects the stores and applies the launch (prefill, mode, base Bubble). Call once.
    func attach(bubbleStore: BubbleStore, appStore: AppStore) {
        guard !isReady else { return }
        self.bubbleStore = bubbleStore
        self.appStore = appStore

        baseBubble = launch.baseBubbleID.flatMap { bubbleStore.bubble(id: $0) }
        prompt = launch.prompt
        sound = launch.sound
        social = launch.social
        length = launch.length
        audience = initialAudience()
        destination = defaultDestination(for: audience)
        refreshSources()

        if mode == .edit, let base = baseBubble {
            levels = [StudioResult(
                manifest: base.manifest,
                cover: base.coverImageData,
                isOffline: base.manifest.studio?.offline ?? false,
                duration: base.manifest.studio?.durationSec,
                models: base.manifest.studio?.models ?? [],
                isExisting: true
            )]
            stage = .tryIt
            focusTweak = true
        }
        loadSavedAnatomy()
        #if DEBUG
        if let demo = DebugLaunch.value("FB_STUDIO_MEDIA_DEMO") { media.debugFill(demo) }
        #endif
        isReady = true
        Task { @MainActor in _ = await bubbleStore.loadMyGroups() }
    }

    /// The launch mode, downgraded to `.create` when its base Bubble is missing.
    var mode: StudioMode {
        switch launch.mode {
        case .edit, .remix, .nextLevel:
            return baseBubble == nil ? .create : launch.mode
        case .create, .daily:
            return launch.mode
        }
    }

    private func initialAudience() -> StudioAudience {
        guard let appStore else { return .everyone }
        if let id = launch.groupID, gameGroup(id) != nil { return .group(id) }
        if let id = launch.eventID, appStore.event(id: id) != nil { return .event(id) }
        if let structure = baseBubble?.manifest.structure {
            if let id = structure.groupID, gameGroup(id) != nil { return .group(id) }
            if let id = structure.eventID, appStore.event(id: id) != nil { return .event(id) }
            if structure.scope == "friends" { return .friends }
        }
        if mode == .daily, let group = defaultGroup { return .group(group.id) }
        return .everyone
    }

    func defaultDestination(for audience: StudioAudience) -> StudioDestination {
        switch audience {
        case .everyone, .friends: return .feed
        case .group(let id): return .group(id)
        case .event(let id): return .event(id)
        }
    }

    // MARK: Lookups

    var me: User? { appStore?.me }

    /// Groups I'm in on the games server (a game made for one is stored with its id).
    var myGroups: [FBGroup] {
        guard let bubbleStore else { return [] }
        return bubbleStore.serverGroups.values.filter(\.isMember).sorted { $0.name < $1.name }
    }

    /// A Group by id: one from the games server, else the app's own.
    func gameGroup(_ id: String) -> FBGroup? {
        bubbleStore?.serverGroups[id] ?? appStore?.group(id: id)
    }

    /// Events I'm going to or interested in first, then other upcoming ones.
    var myEvents: [FBEvent] {
        guard let appStore else { return [] }
        let now = Date().addingTimeInterval(-6 * 3_600)
        return appStore.events
            .filter { $0.startDate > now }
            .sorted { lhs, rhs in
                let l = lhs.response == nil ? 1 : 0
                let r = rhs.response == nil ? 1 : 0
                return l == r ? lhs.startDate < rhs.startDate : l < r
            }
            .prefix(8)
            .map { $0 }
    }

    var defaultGroup: FBGroup? {
        if let id = launch.groupID, let group = gameGroup(id) { return group }
        return myGroups.first
    }

    var defaultEvent: FBEvent? {
        if let id = launch.eventID, let event = appStore?.event(id: id) { return event }
        return myEvents.first
    }

    var audienceGroup: FBGroup? {
        if case .group(let id) = audience { return gameGroup(id) }
        return nil
    }

    var audienceEvent: FBEvent? {
        if case .event(let id) = audience { return appStore?.event(id: id) }
        return nil
    }

    func name(of audience: StudioAudience) -> String {
        switch audience {
        case .everyone: return "Everyone"
        case .friends: return "Friends"
        case .group(let id): return gameGroup(id)?.name ?? "Your group"
        case .event(let id): return appStore?.event(id: id).map(StudioModel.shortTitle(of:)) ?? "Your event"
        }
    }

    var audienceName: String { name(of: audience) }

    /// "the newcomers' picnic" style name for an event, for copy.
    nonisolated static func shortTitle(of event: FBEvent) -> String {
        event.title
    }

    /// Phrase for "for …" in Muse's voice.
    var audiencePhrase: String {
        switch audience {
        case .everyone: return "for everyone"
        case .friends: return "for your friends"
        case .group: return "for \(audienceName)"
        case .event:
            return "for \(audienceName)"
        }
    }

    var audienceFirstNames: [String] {
        switch audience {
        case .group:
            return Array((audienceGroup?.memberSample ?? []).map(\.firstName).prefix(16))
        case .event:
            return Array((audienceEvent?.friendsGoing ?? []).map(\.firstName).prefix(16))
        case .friends:
            return Array((appStore?.people ?? []).filter(\.isFriend).map(\.firstName).prefix(16))
        case .everyone:
            return []
        }
    }

    // MARK: Copy by mode

    var baseTitle: String { baseBubble?.title ?? "your \(ProductName.singular)" }

    var heroTitle: String {
        switch mode {
        case .create: return "Make \(ProductName.withArticle)"
        case .edit: return "Edit \(baseTitle)"
        case .remix: return "Remix \(baseTitle)"
        case .nextLevel: return "Level \((baseBubble?.levelIndex ?? 1) + 1) of \(baseTitle)"
        case .daily: return "Today's Daily \(ProductName.singular)"
        }
    }

    var heroSubtitle: String {
        switch mode {
        case .create, .edit:
            return "Describe a game and Muse makes it in a few minutes."
        case .remix:
            let owner = baseBubble.map { $0.creator.isMe ? "your" : "\($0.creator.firstName)'s" } ?? "the"
            return "Tell Muse what to change. Your remix links back to \(owner) original."
        case .nextLevel:
            return "Muse keeps the feel and turns it up a notch. Add anything you want to change."
        case .daily:
            return "Muse builds it from \(audienceName)'s opted-in posts. Everyone in the group gets the same one today."
        }
    }

    var topBarSubtitle: String {
        switch mode {
        case .create: return levels.count > 1 ? "\(levels.count) levels" : "New \(ProductName.singular)"
        case .edit: return "Editing \(baseTitle)"
        case .remix: return "Remix of \(baseTitle)"
        case .nextLevel: return "Level \((baseBubble?.levelIndex ?? 1) + 1) of \(baseTitle)"
        case .daily: return "Daily \(ProductName.singular) · \(audienceName)"
        }
    }

    var promptPlaceholder: String {
        switch mode {
        case .remix: return "What should change?"
        case .nextLevel: return "What's new in level \((baseBubble?.levelIndex ?? 1) + 1)?"
        default: return "Describe a game…"
        }
    }

    /// Used when the prompt is optional and left empty.
    var defaultPrompt: String {
        switch mode {
        case .remix: return "Remix \(baseTitle) with a fresh twist"
        case .nextLevel: return "Level \((baseBubble?.levelIndex ?? 1) + 1) of \(baseTitle): same feel, a little harder"
        case .daily: return "Today's Daily \(ProductName.singular) for \(audienceName)"
        default: return ""
        }
    }

    var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

    var effectivePrompt: String { trimmedPrompt.isEmpty ? defaultPrompt : trimmedPrompt }

    var canContinueFromAsk: Bool { !effectivePrompt.isEmpty && !isDraftingBrief }

    /// Example requests for the launch context.
    var examples: [String] {
        switch mode {
        case .remix:
            return ["Make it about Ocean Beach", "Twice as fast", "Use our group's inside jokes"]
        case .nextLevel:
            return ["Faster, with more fog", "Add a twist at the end", "Same idea, bigger hills"]
        case .daily:
            return ["A daily word game for \(audienceName)", "Guess the neighborhood from three clues", "Match each intro to a newcomer"]
        case .create, .edit:
            break
        }
        switch audience {
        case .group:
            return ["A daily word game for \(audienceName)", "Guess who wrote each intro", "Sort SF neighborhoods by vibe"]
        case .event:
            let first = "Icebreaker for \(audienceName)"
            return [first, "Match fun facts to who's coming", "A quick game for the picnic blanket"]
        case .everyone, .friends:
            return [
                "A chill game about SF hills for my running club",
                "Catch cable cars before they roll away",
                "Guess the SF neighborhood from three clues",
            ]
        }
    }

    nonisolated static let surprises = [
        "Dodge the fog rolling over Twin Peaks",
        "Sort taquerias, bakeries and coffee spots by neighborhood",
        "Stack picnic snacks without tipping the blanket",
        "Catch the right shell before the tide comes in at Ocean Beach",
        "A cozy guessing game about my first week in SF",
        "Merge little clouds into one giant Dolores Park cloud",
    ]

    var showsAudiencePicker: Bool { mode == .create || mode == .remix }
    var showsFormulaPicker: Bool { mode == .create || mode == .daily }
    /// Next levels keep their chain's look (LOOKS.md), so they don't offer the picker.
    var showsLookPicker: Bool { mode != .nextLevel }

    /// Sources show for Daily Bubbles and Group games.
    var showsSources: Bool { mode == .daily || audience.kind == .group }

    // MARK: Audience

    func selectAudienceKind(_ kind: StudioAudienceKind) {
        switch kind {
        case .everyone: setAudience(.everyone)
        case .friends: setAudience(.friends)
        case .group:
            if case .group = audience { return }
            if let group = defaultGroup { setAudience(.group(group.id)) }
        case .event:
            if case .event = audience { return }
            if let event = defaultEvent { setAudience(.event(event.id)) }
        }
    }

    func setAudience(_ newValue: StudioAudience) {
        guard newValue != audience else { return }
        audience = newValue
        destination = defaultDestination(for: newValue)
        brief?.audience = newValue.scope
        refreshSources()
    }

    // MARK: Sources

    func refreshSources() {
        guard let appStore, let group = audienceGroup else {
            sources = []
            return
        }
        let previous = Dictionary(uniqueKeysWithValues: sources.map { ($0.id, $0.isIncluded) })
        sources = appStore.posts(in: group)
            .filter { $0.allowsBubbles && !$0.text.isEmpty }
            .map { StudioSourceItem(post: $0, isIncluded: previous[$0.id] ?? true) }
    }

    var includedSources: [StudioSource] {
        guard showsSources else { return [] }
        return sources.filter(\.isIncluded).map { StudioSource(author: $0.post.author.firstName, text: $0.post.text) }
    }

    // MARK: Requests

    /// `look` goes to Muse as `paletteHint` (a look id such as "paper"); nil lets Muse pick.
    func makeRequest(mode requestMode: StudioMode, prompt: String, base: BubbleManifest?, brief: BubbleBrief?, look: StudioLook?) -> StudioRequest {
        StudioRequest(
            mode: requestMode,
            prompt: prompt,
            scope: audience.scope,
            scopeName: audience == .everyone || audience == .friends ? nil : audienceName,
            audienceNames: audienceFirstNames,
            sources: includedSources,
            base: base,
            brief: brief,
            formulaHint: formulaHint,
            paletteHint: look?.rawValue,
            date: requestMode == .daily ? BubbleStore.dayKey(Date()) : nil,
            creatorName: me?.firstName ?? "Alex",
            length: length,
            tuning: tuning,
            social: socialContext(for: requestMode)
        )
    }

    /// `social`, plus the base Bubble's creator for remixes (the "Remix of … by …" credit).
    private func socialContext(for requestMode: StudioMode) -> StudioSocialContext? {
        var context = social
        if requestMode == .remix, let base = baseBubble {
            var filled = context ?? StudioSocialContext()
            if filled.baseCreatorID == nil {
                filled.baseCreatorID = base.creator.id
                filled.baseCreatorName = base.creator.isMe ? nil : base.creator.firstName
            }
            context = filled
        }
        return context
    }

    // MARK: Ask → Brief

    /// Shows the brief, drafted from what the person typed. The server reads it with Muse when
    /// it makes the game; the app asks no model for it.
    func draftBrief() {
        guard canContinueFromAsk else { return }
        briefTask?.cancel()
        isDraftingBrief = false
        briefNote = nil
        // New games show the server's plan first (StudioPlanGate), which drafts it with Muse; the
        // anatomy is drafted only if the Brief step shows instead, so Muse isn't asked twice.
        if mode != .create { draftAnatomyIfNeeded() }
        brief = normalized(localBrief())
        buildsMicrogame = suggestsMicrogame
        go(to: .brief)
    }

    private func localBrief() -> BubbleBrief {
        BubbleBrief(
            intent: effectivePrompt,
            audience: audience.scope,
            mood: ["playful"],
            energy: "medium",
            competition: "light",
            occasion: mode == .daily ? "daily" : (audience.kind == .event ? "icebreaker" : nil)
        )
    }

    private func normalized(_ draft: BubbleBrief) -> BubbleBrief {
        var brief = draft
        if brief.intent.trimmingCharacters(in: .whitespaces).isEmpty { brief.intent = effectivePrompt }
        brief.audience = audience.scope
        brief.energy = brief.energy.lowercased()
        brief.competition = brief.competition.lowercased()
        var seen = Set<String>()
        brief.mood = brief.mood
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
        if mode == .daily, brief.occasion == nil { brief.occasion = "daily" }
        if audience.kind == .event, brief.occasion == nil { brief.occasion = "icebreaker" }
        return brief
    }

    // MARK: Brief editing

    nonisolated static let moodSuggestions = ["cozy", "playful", "chill", "calm", "nostalgic", "funny", "silly", "dreamy", "competitive", "wholesome", "hype", "spooky"]
    nonisolated static let energyOptions = ["low", "medium", "high"]
    nonisolated static let competitionOptions = ["none", "light", "friendly", "fierce"]
    nonisolated static let occasionOptions: [String?] = [nil, "daily", "icebreaker", "weekend"]

    nonisolated static func title(forEnergy value: String) -> String {
        switch value {
        case "low": return "Low"
        case "medium": return "Medium"
        case "high": return "High"
        default: return capitalizedFirst(value)
        }
    }

    nonisolated static func title(forCompetition value: String) -> String {
        switch value {
        case "none": return "Just for fun"
        case "light": return "Light"
        case "friendly": return "Friendly"
        case "fierce": return "Fierce"
        default: return capitalizedFirst(value)
        }
    }

    nonisolated static func title(forOccasion value: String?) -> String {
        guard let value else { return "Anytime" }
        switch value {
        case "daily": return "Daily"
        case "icebreaker": return "Icebreaker"
        case "weekend": return "Weekend"
        default: return capitalizedFirst(value)
        }
    }

    func addMood(_ raw: String) {
        let mood = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !mood.isEmpty, brief?.mood.contains(mood) == false else { return }
        brief?.mood.append(mood)
    }

    func removeMood(_ mood: String) {
        brief?.mood.removeAll { $0 == mood }
    }

    /// "I read this as calm and a little nostalgic, for New in SF."
    var museReading: String {
        guard let brief else { return "" }
        let moods = brief.mood.prefix(3).map { $0 }
        let moodText: String
        switch moods.count {
        case 0: moodText = "fun and easy to pick up"
        case 1: moodText = moods[0]
        case 2: moodText = "\(moods[0]) and a little \(moods[1])"
        default: moodText = "\(moods[0]), \(moods[1]) and \(moods[2])"
        }
        return "I read this as \(moodText), \(audiencePhrase)."
    }

    /// "Easygoing pace, friendly competition, a new one every day."
    var musePlan: String {
        guard let brief else { return "" }
        let pace: String
        switch brief.energy {
        case "low": pace = "An easygoing pace"
        case "high": pace = "Fast and lively"
        default: pace = "A steady pace"
        }
        let competition: String
        switch brief.competition {
        case "none": competition = "no pressure to win"
        case "fierce": competition = "fierce competition"
        case "friendly": competition = "friendly competition"
        default: competition = "light competition"
        }
        var parts = [pace, competition]
        switch brief.occasion {
        case "daily": parts.append("a new one every day")
        case "icebreaker": parts.append("made for meeting people")
        case "weekend": parts.append("for a slow weekend")
        default: break
        }
        return parts.joined(separator: ", ") + "."
    }

    // MARK: Compose

    /// Starts Muse. `.create` uses the reviewed brief; `.tweak` and `.nextLevel` build on the
    /// current level. `newLook` redraws the current level in another look (a tweak).
    /// `text` replaces `tweakText` for a tweak (the "Change the game" thread's mapped change), and
    /// `anatomy` is the agreed anatomy with that change in it.
    ///
    /// Everything but a brand-new game is a change to a game the server has (`runRevision`): the
    /// server makes a new game from it, and the Build step shows that job's steps.
    func startCompose(_ kind: StudioComposeKind, newLook: StudioLook? = nil, text tweak: String? = nil, anatomy: String? = nil) {
        // A second tap while the step animates away would restart Muse from scratch.
        guard !isComposing else { return }
        let request: StudioRequest
        let revision: GameRevision?
        switch kind {
        case .create:
            request = makeRequest(mode: mode == .edit ? .create : mode, prompt: effectivePrompt, base: baseBubble?.manifest, brief: briefForRun, look: lookHint)
            revision = launchRevision(for: request).map { var r = $0; r.sound = sound; return r }
        case .tweak:
            guard let current = currentResult else { return }
            let text = (tweak ?? tweakText).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            request = makeRequest(mode: .edit, prompt: text, base: current.manifest, brief: nil, look: newLook)
            // A new look goes as `look` alone; the server words the change itself.
            revision = GameRevision(baseGameID: serverGameID(of: current), change: newLook == nil ? text : nil,
                                    look: newLook.map(Self.lookChange), anatomy: newLook == nil ? anatomy : nil)
        case .nextLevel:
            guard let current = currentResult else { return }
            let number = (current.manifest.chain?.index ?? max(selectedLevel + 1, 1)) + 1
            let text = tweakText.trimmingCharacters(in: .whitespacesAndNewlines)
            let prompt = text.isEmpty ? "Level \(number) of \(current.manifest.title): same feel, a little harder" : text
            // Next levels keep the chain's look (LOOKS.md).
            request = makeRequest(mode: .nextLevel, prompt: prompt, base: current.manifest, brief: nil, look: StudioLook(id: current.manifest.style.look))
            revision = GameRevision(baseGameID: serverGameID(of: current), change: text.isEmpty ? nil : text, nextLevel: true)
        }
        runLookChange = kind == .tweak ? newLook : nil
        runRevision = revision
        if kind == .create {
            runPlan = revision == nil ? pendingPlan : nil
            pendingPlan = nil
        } else {
            runPlan = nil
        }
        run(request, kind: kind)
    }

    /// The change a remix, next-level or edit launch asks the server for; nil for a new game.
    private func launchRevision(for request: StudioRequest) -> GameRevision? {
        guard let base = baseBubble else { return nil }
        let words = microgameRequestText(request)
        switch mode {
        case .remix:
            // A remix shows its base's anatomy on the Brief step and may change it there; edits
            // and next levels already follow their base's anatomy, so only the words go.
            return GameRevision(baseGameID: base.serverID, change: words, brief: briefForRun, anatomy: agreedAnatomyText)
        case .nextLevel:
            return GameRevision(baseGameID: base.serverID, change: trimmedPrompt.isEmpty ? nil : words, nextLevel: true)
        case .edit:
            return GameRevision(baseGameID: base.serverID, change: words)
        case .create, .daily:
            return nil
        }
    }

    /// The server game a Studio level is: the Bubble being edited, or the game the server made in
    /// this session (its app id, which the client linked to the server id).
    private func serverGameID(of result: StudioResult) -> String {
        if result.isExisting, let base = baseBubble { return base.serverID }
        return result.manifest.id
    }

    /// The `look` sent for a new look: "paper cutout: crafty, warm and tactile".
    nonisolated static func lookChange(_ look: StudioLook) -> String {
        "\(look.title.lowercased()): \(look.feel.lowercased())"
    }

    /// The Sound card's free-text change ("make the music calmer"), as a tweak of the current level.
    func askSoundChange(_ wish: String) {
        let text = wish.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        startCompose(.tweak, text: "Change only the game's sound (sound set, volume, music or single moments), nothing else: \(text)")
    }

    /// "Tweak it" with a new look: Muse redraws the current level in `look`.
    func changeLook(to look: StudioLook) {
        guard !isComposing, let current = currentResult, StudioLook(id: current.manifest.style.look) != look else { return }
        tweakText = look.tweakPrompt
        startCompose(.tweak, newLook: look)
    }

    /// The brief's look line: the person's pick, a chain's look, or Muse picks.
    var briefLook: (look: StudioLook?, title: String, detail: String) {
        if let lookHint {
            return (lookHint, lookHint.title, lookHint.feel)
        }
        if mode == .remix || mode == .nextLevel, let base = baseBubble {
            let look = StudioLook(id: base.manifest.style.look) ?? .glow
            return (look, look.title, mode == .nextLevel ? "Same look as \(base.title)" : "Muse keeps the look of \(base.title)")
        }
        return (nil, "Muse picks", "A look to match the idea and mood")
    }

    /// Retries the last run.
    func retry() {
        guard let request = lastRequest else { return }
        run(request, kind: composeKind)
    }

    private func run(_ request: StudioRequest, kind: StudioComposeKind) {
        composeTask?.cancel()
        advanceTask?.cancel()
        lastRequest = request
        composeKind = kind
        events = []
        concepts = []
        failure = nil
        draftManifest = nil
        draftCover = nil
        sourcesUsed = nil
        sawOfflineEvent = false
        playtestReports = [:]
        generationWait = nil
        runIsServer = false
        isComposing = true
        composeStartedAt = Date()
        lastEventAt = composeStartedAt
        composeEndedAt = nil
        buildPhase = .start(at: composeStartedAt ?? Date())
        // A new game waits a moment for the anatomy Muse is still drafting (or rereading), so the
        // build follows it; everything else starts right away.
        let waitsForAnatomy = kind == .create && runRevision == nil && usesAnatomy && anatomyThread.isWorking
        isWaitingForAnatomy = waitsForAnatomy
        runIsMicrogame = true
        go(to: .compose)

        composeTask = Task { [weak self] in
            if waitsForAnatomy {
                await self?.waitForAnatomy()
            }
            guard let stream = self?.startStream(for: request, kind: kind), !Task.isCancelled else { return }
            do {
                for try await event in stream {
                    guard let self, !Task.isCancelled else { return }
                    self.receive(event)
                    if event.step == .done || event.step == .failed { return }
                }
                guard let self, !Task.isCancelled else { return }
                if self.isComposing {
                    self.fail(StudioFailure(message: "Muse stopped before your \(ProductName.singular) was ready.", detail: nil))
                }
            } catch is CancellationError {
                return
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.fail(StudioModel.failure(for: error))
            }
        }
    }

    /// The run's server stream, once any anatomy wait is over. Nil (after failing the run) when
    /// there is nothing to build, or when the run was stopped while it waited.
    private func startStream(for request: StudioRequest, kind: StudioComposeKind) -> AsyncThrowingStream<StudioEvent, Error>? {
        guard !Task.isCancelled, isComposing else { return nil }
        isWaitingForAnatomy = false
        if kind == .create { anatomyThread.markBuildStarted() }
        guard let stream = serverStream(for: request, kind: kind) else {
            // Every run is a new game or a change to one on the server; nothing else can build.
            runIsMicrogame = false
            fail(StudioFailure(message: LiveDataCopy.revise, detail: nil))
            return nil
        }
        return stream
    }

    /// How long a new game's build waits for the anatomy draft before it goes without it.
    nonisolated static let anatomyGrace: TimeInterval = 12

    private func waitForAnatomy() async {
        let deadline = Date().addingTimeInterval(Self.anatomyGrace)
        while anatomyThread.isWorking, Date() < deadline, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private func receive(_ event: StudioEvent) {
        buildPhase = buildPhase.next(for: event, progress: buildProgress(at: Date()), at: Date())
        withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) {
            events.append(event)
            lastEventAt = Date()
            if let new = event.concepts {
                for concept in new where !concepts.contains(concept) {
                    concepts.append(concept)
                }
            }
            if let manifest = event.manifest { draftManifest = manifest }
            if let cover = event.coverImage { draftCover = cover }
            if let used = event.sourcesUsed { sourcesUsed = used }
            if event.isOffline { sawOfflineEvent = true }
        }
        if let updated = event.brief, composeKind == .create {
            brief = updated
        }
        switch event.step {
        case .done:
            finish(with: event)
        case .failed:
            fail(StudioFailure(message: event.detail ?? "Muse couldn't finish this one.", detail: nil))
        default:
            // No tap per step while minimized (the person is elsewhere in the app).
            if !GameBuildTracker.shared.isMinimized(self) { Haptics.soft() }
        }
    }

    private func finish(with event: StudioEvent) {
        guard let made = event.manifest ?? draftManifest else {
            fail(StudioFailure(message: "Muse finished without a game. Try again?", detail: nil))
            return
        }
        applyBaseUpdate(event.baseUpdate)
        let manifest = fixedUp(made)
        if runIsServer { drafts[manifest.id] = made.id }
        let models = Self.models(in: events, manifest: manifest)
        let result = StudioResult(
            manifest: manifest,
            cover: event.coverImage ?? draftCover,
            isOffline: sawOfflineEvent || (manifest.studio?.offline ?? false),
            duration: event.elapsed > 0 ? event.elapsed : composeStartedAt.map { Date().timeIntervalSince($0) },
            models: models,
            isExisting: false,
            sourcesUsed: event.sourcesUsed ?? sourcesUsed ?? []
        )
        makeRecords[manifest.id] = MakeRecord.build(
            gameID: manifest.id,
            events: events,
            reports: playtestReports,
            isMicrogame: runIsMicrogame || manifest.formula == .microgame,
            concepts: concepts.isEmpty ? manifest.conceptIDs : concepts,
            models: models,
            seconds: result.duration,
            isOffline: result.isOffline,
            sourcesUsed: result.sourcesUsed
        )
        switch composeKind {
        case .create:
            levels = [result]
            selectedLevel = 0
        case .tweak:
            guard levels.indices.contains(selectedLevel) else { levels = [result]; break }
            var updated = result
            // The server made a new game from the change, so it is shared as a new game, even when
            // the level was the Bubble being edited.
            updated.isExisting = false
            // A new look needs a new cover; otherwise keep the old one if Muse didn't paint.
            if updated.cover == nil && runLookChange == nil { updated.cover = levels[selectedLevel].cover }
            levels[selectedLevel] = updated
            tweakText = ""
        case .nextLevel:
            levels.append(result)
            selectedLevel = levels.count - 1
            tweakText = ""
        }
        isComposing = false
        composeEndedAt = Date()
        // A quick change from the Build step's anatomy edits is now in the game.
        if composeKind == .tweak, pendingChangeRun { anatomyThread.acceptAsBuilt() }
        pendingChangeRun = false
        // Formula and microgame runs both end here.
        // Minimized: the dock gives its own gentle haptic instead of the ready sound.
        if !GameBuildTracker.shared.isMinimized(self) { GameSound.play(.ready, haptic: true) }
        advanceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_300_000_000)
            // Mid-answer on the Build step: the Play button waits for them instead.
            guard let self, !Task.isCancelled, self.stage == .compose, !self.isComposing, self.failure == nil,
                  !self.holdsAutoAdvance else { return }
            self.go(to: .tryIt)
        }
    }

    /// `next_level` runs return the previous level with its chain link set. Keep the service's
    /// chain id and index so both levels form one Bubble Chain.
    private func applyBaseUpdate(_ update: BubbleManifest?) {
        guard let update, let chain = update.chain else { return }
        if let index = levels.firstIndex(where: { $0.id == update.id }) {
            levels[index].manifest.chain = chain
        } else if baseBubble?.id == update.id {
            pendingBaseChain = chain
        }
    }

    private func fail(_ failure: StudioFailure) {
        isComposing = false
        composeEndedAt = Date()
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            self.failure = failure
        }
        Haptics.warning()
    }

    /// Stops Muse and goes back to where the run started. A job already on the server is cancelled
    /// (`DELETE /v1/generate/{id}`, when the stream ends).
    func cancelCompose() {
        composeTask?.cancel()
        composeTask = nil
        advanceTask?.cancel()
        isComposing = false
        isWaitingForAnatomy = false
        pendingChangeRun = false
        generationWait = nil
        failure = nil
        if composeKind == .create {
            go(to: brief == nil ? .ask : .brief, direction: -1)
        } else {
            go(to: .tryIt, direction: -1)
        }
    }

    /// A new game's build failed: back to Describe with the idea as typed, to reword it.
    func editIdea() {
        composeTask?.cancel()
        composeTask = nil
        advanceTask?.cancel()
        isComposing = false
        isWaitingForAnatomy = false
        generationWait = nil
        failure = nil
        go(to: .ask, direction: -1)
    }

    /// Stops any work (closing Studio).
    func stopAll() {
        composeTask?.cancel()
        briefTask?.cancel()
        advanceTask?.cancel()
        anatomyThread.cancel()
        // A cancelled draft never clears this, which left "Next" stuck on "Muse is reading".
        isDraftingBrief = false
    }

    // MARK: Compose progress (header bubble)

    nonisolated static let progressSteps: [StudioStep] = [.understand, .brief, .compose, .glue, .content, .validate, .repair, .playtest, .cover, .polish]

    /// How far Muse has got, 0...1, by the furthest step reached.
    var reachedProgress: Double {
        if !isComposing && failure == nil && !events.isEmpty { return 1 }
        let furthest = events.compactMap { Self.progressSteps.firstIndex(of: $0.step) }.max() ?? -1
        return Double(furthest + 1) / Double(Self.progressSteps.count + 1)
    }

    var currentEvent: StudioEvent? { events.last }

    var isFinished: Bool { !isComposing && failure == nil && events.last?.step == .done }

    // MARK: Fix-ups

    /// Keeps ids, versions, lineage and chains sensible whatever the service returns.
    private func fixedUp(_ made: BubbleManifest) -> BubbleManifest {
        var manifest = made
        switch composeKind {
        case .create:
            if mode == .remix, let base = baseBubble?.manifest {
                if manifest.id == base.id || bubbleStore?.bubble(id: manifest.id) != nil {
                    manifest.id = Self.newID(from: manifest.title)
                    manifest.version = 1
                }
                if manifest.lineage.remixOf == nil { manifest.lineage.remixOf = base.id }
                if manifest.lineage.parent == nil { manifest.lineage.parent = base.id }
                if !manifest.lineage.operators.contains("remix") { manifest.lineage.operators.append("remix") }
                if manifest.title == base.title { manifest.title = "\(base.title) remix" }
            } else if mode == .nextLevel, let base = baseBubble?.manifest {
                manifest = asNextLevel(manifest, after: base)
            } else if bubbleStore?.bubble(id: manifest.id) != nil {
                manifest.id = Self.newID(from: manifest.title)
            }
        case .tweak:
            if let current = currentResult?.manifest {
                // The id stays the server's: the change is a new game there, and scores and saves
                // go to it by this id.
                if manifest.version <= current.version { manifest.version = current.version + 1 }
                if manifest.chain == nil { manifest.chain = current.chain }
                if manifest.lineage.parent == nil { manifest.lineage = current.lineage }
            }
        case .nextLevel:
            if let current = currentResult?.manifest {
                manifest = asNextLevel(manifest, after: current)
            }
        }
        if mode == .daily {
            manifest.structure.cadence = "daily"
            manifest.structure.scope = audience.scope
        }
        applyLookFallback(&manifest)
        return manifest
    }

    /// Looks (LOOKS.md): keeps the look the person picked, and a chain's look, even when the
    /// composer leaves the default ("glow") or ignores a look change.
    private func applyLookFallback(_ manifest: inout BubbleManifest) {
        let made = StudioLook(id: manifest.style.look) ?? .glow
        // A style with no look fields at all came from a composer that doesn't do looks yet.
        let isBare = made == .glow && manifest.style.colors == nil && manifest.style.font == nil && manifest.style.motif == nil
        switch composeKind {
        case .create:
            if let lookHint, lookHint != .glow, made == .glow {
                manifest.style = lookHint.applied(to: manifest.style)
            } else if lookHint == nil, isBare, mode == .remix || mode == .nextLevel, let base = baseBubble?.manifest.style,
                      StudioLook(id: base.look) ?? .glow != .glow {
                inheritLook(base, into: &manifest.style)
            }
        case .tweak:
            let before = currentResult?.manifest.style
            let beforeLook = before.flatMap { StudioLook(id: $0.look) } ?? .glow
            if let change = runLookChange {
                // The composer kept the old look or dropped looks altogether: redraw it here.
                if change != made, made == beforeLook || isBare {
                    manifest.style = change.applied(to: manifest.style)
                }
            } else if isBare, beforeLook != .glow, let before {
                // Edits keep the look unless they ask to change it.
                inheritLook(before, into: &manifest.style)
            }
        case .nextLevel:
            if isBare, let previous = currentResult?.manifest.style, StudioLook(id: previous.look) ?? .glow != .glow {
                inheritLook(previous, into: &manifest.style)
            }
        }
        // Composers that only know palettes may echo the look hint back as the palette id.
        if StudioLook(id: manifest.style.palette) != nil {
            manifest.style.palette = manifest.style.colors == nil ? BubbleGlow.lilacHaze.id : "custom"
        }
    }

    private func inheritLook(_ source: BubbleStyle, into style: inout BubbleStyle) {
        style.look = source.look
        style.palette = source.palette
        style.colors = source.colors
        style.font = source.font ?? style.font
        style.motif = source.motif ?? style.motif
    }

    private func asNextLevel(_ made: BubbleManifest, after previous: BubbleManifest) -> BubbleManifest {
        var manifest = made
        let taken = Set(levels.map(\.id))
        if manifest.id == previous.id || taken.contains(manifest.id) || bubbleStore?.bubble(id: manifest.id) != nil {
            manifest.id = Self.newID(from: manifest.title)
            manifest.version = 1
        }
        let index = (previous.chain?.index ?? 1) + 1
        manifest.chain = BubbleChainLink(
            id: manifest.chain?.id ?? previous.chain?.id ?? "chain-\(previous.id)",
            index: index,
            title: previous.chain?.title ?? previous.title,
            prev: previous.id,
            next: nil
        )
        if manifest.lineage.parent == nil { manifest.lineage.parent = previous.id }
        if !manifest.lineage.operators.contains("next-level") { manifest.lineage.operators.append("next-level") }
        if manifest.title == previous.title { manifest.title = "\(previous.title) \(index)" }
        return manifest
    }

    nonisolated static func newID(from title: String) -> String {
        let slug = title.lowercased()
            .map { $0.isLetter || $0.isNumber ? $0 : "-" }
            .reduce(into: "") { result, char in
                if char == "-" && (result.isEmpty || result.hasSuffix("-")) { return }
                result.append(char)
            }
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        let suffix = UUID().uuidString.prefix(6).lowercased()
        return slug.isEmpty ? "studio-\(suffix)" : "\(slug.prefix(32))-\(suffix)"
    }

    nonisolated static func models(in events: [StudioEvent], manifest: BubbleManifest) -> [String] {
        var seen: [String] = []
        for model in events.compactMap(\.model) + (manifest.studio?.models ?? []) where !seen.contains(model) {
            seen.append(model)
        }
        return seen
    }

    nonisolated static func failure(for error: Error) -> StudioFailure {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
                return StudioFailure(message: "Muse couldn't be reached. Check your connection and try again.", detail: nil)
            case .timedOut:
                return StudioFailure(message: "Muse took too long to answer. Try again in a moment.", detail: nil)
            default:
                break
            }
        }
        let text = error.localizedDescription
        return StudioFailure(
            message: "Something interrupted Muse while it was making your \(ProductName.singular). Your brief is saved.",
            detail: text.count <= 140 ? text : nil
        )
    }

    // MARK: Try it

    var currentResult: StudioResult? {
        levels.indices.contains(selectedLevel) ? levels[selectedLevel] : nil
    }

    /// The level after the selected one: "Make level 2".
    var levelButtonNumber: Int {
        guard let current = currentResult else { return 2 }
        return (current.manifest.chain?.index ?? (selectedLevel + 1)) + 1
    }

    var canMakeNextLevel: Bool { selectedLevel == levels.count - 1 }

    func updateTitle(_ title: String) {
        guard levels.indices.contains(selectedLevel) else { return }
        levels[selectedLevel].manifest.title = title
    }

    func updateRule(_ rule: String) {
        guard levels.indices.contains(selectedLevel) else { return }
        levels[selectedLevel].manifest.oneLineRule = rule
    }

    /// Swaps the selected level's game for an edited copy (the Sounds section's set, music and
    /// loudness changes, or a Muse sound tweak). Keeps the level's id, so it keeps its place, cover
    /// and make record.
    func replaceManifest(_ manifest: BubbleManifest) {
        guard levels.indices.contains(selectedLevel) else { return }
        var updated = manifest
        updated.id = levels[selectedLevel].manifest.id
        levels[selectedLevel].manifest = updated
    }

    /// A transient Bubble for cover and card views (not in the store).
    func previewBubble(for result: StudioResult) -> Bubble {
        Bubble(manifest: result.manifest, creator: me ?? User(firstName: "You", friendship: .me), coverImageData: result.cover)
    }

    var backdropPalette: BubblePalette? {
        switch stage {
        case .ask, .brief:
            return nil
        case .compose:
            return draftManifest.map { BubbleGlow.palette(for: $0.style) }
        case .tryIt, .float:
            return currentResult.map { BubbleGlow.palette(for: $0.manifest.style) }
        }
    }

    // MARK: Navigation

    func go(to newStage: StudioStage, direction: Int? = nil) {
        self.direction = direction ?? (newStage >= stage ? 1 : -1)
        withAnimation(.spring(response: 0.45, dampingFraction: 0.9)) {
            stage = newStage
        }
    }

    /// The back button's target, if the current step has one.
    var backTarget: StudioStage? {
        switch stage {
        case .ask: return nil
        case .brief: return .ask
        case .compose: return nil
        case .tryIt: return mode == .edit ? nil : (brief == nil ? nil : .brief)
        case .float: return .tryIt
        }
    }

    func goBack() {
        guard let target = backTarget else { return }
        if stage == .tryIt {
            // Going back to the brief keeps the levels until a new run replaces them.
            go(to: target, direction: -1)
            return
        }
        go(to: target, direction: -1)
    }

    /// True when closing would lose work.
    var hasUnsavedWork: Bool {
        if isPopping { return false }
        if isComposing || brief != nil { return true }
        if !trimmedPrompt.isEmpty && trimmedPrompt != launch.prompt { return true }
        if !media.items.isEmpty { return true }
        if levels.contains(where: { !$0.isExisting }) { return true }
        let base = baseBubble?.manifest
        return levels.contains { $0.isExisting && $0.manifest != base }
    }

    // MARK: Float

    var isEditMode: Bool { mode == .edit }

    var destinationGroup: FBGroup? {
        if case .group(let id) = destination { return gameGroup(id) }
        return nil
    }

    var destinationEvent: FBEvent? {
        if case .event(let id) = destination { return appStore?.event(id: id) }
        return nil
    }

    var destinationName: String {
        switch destination {
        case .feed: return "your feed"
        case .group: return destinationGroup?.name ?? "your group"
        case .event: return destinationEvent.map(StudioModel.shortTitle(of:)) ?? "your event"
        }
    }

    var floatButtonTitle: String {
        isEditMode && levels.count == 1 ? "Save changes" : "Share"
    }

    /// Publishes (or saves) what Muse made. Returns the Bubble to open and the toast to show.
    func commitFloat() -> (bubbleID: String, toast: String)? {
        guard let bubbleStore, let appStore, !levels.isEmpty else { return nil }
        let newLevels = levels.filter { !$0.isExisting }
        var openID: String?
        var toast = ""

        var continuing = baseBubble
        if let existing = levels.first(where: \.isExisting), let base = baseBubble {
            if existing.manifest != base.manifest || existing.cover != base.coverImageData {
                var manifest = existing.manifest
                if manifest.version <= base.manifest.version { manifest.version = base.manifest.version + 1 }
                bubbleStore.update(base, to: manifest, cover: existing.cover)
            }
            openID = base.id
            toast = "Changes saved"
            continuing = base
        } else if mode != .nextLevel {
            continuing = nil
        }

        guard !newLevels.isEmpty else {
            return openID.map { ($0, toast) }
        }

        let isDaily = mode == .daily
        let group = isEditMode ? baseBubble?.group : destinationGroup
        let event = isEditMode ? baseBubble?.event : destinationEvent
        var manifests = newLevels.map(\.manifest)
        if !isEditMode {
            for index in manifests.indices {
                if let group { manifests[index].structure.scope = "group:\(group.id)" }
                if let event { manifests[index].structure.scope = "event:\(event.id)" }
            }
        }
        if let continuing, let chain = pendingBaseChain, continuing.manifest.chain == nil || continuing.manifest.chain?.id == chain.id {
            continuing.manifest.chain = chain
        }
        let published = bubbleStore.publishFromStudio(
            manifests,
            covers: newLevels.map(\.cover),
            group: group,
            event: event,
            continuing: continuing,
            dailyFor: isDaily ? group : nil
        )
        guard let first = published.first else { return openID.map { ($0, toast) } }
        if openID == nil { openID = first.id }

        if postsToFeedOrGroup {
            let message = caption.trimmingCharacters(in: .whitespacesAndNewlines)
            BubbleSurfaceHooks.float(
                first,
                result: nil,
                to: group,
                message: message.isEmpty ? defaultCaption(for: first) : message,
                appStore: appStore,
                bubbleStore: bubbleStore
            )
        }

        let sentTo = isEditMode ? [] : sendToFriends(first, appStore: appStore, bubbleStore: bubbleStore)
        saveMakeRecords(for: published, sentTo: sentTo)
        publishDrafts(newLevels.map(\.manifest.id))

        if isEditMode, !levels.contains(where: \.isExisting) {
            toast = "Saved as a new version of \(baseTitle)"
        } else if isEditMode {
            toast = published.count == 1 ? "Changes saved with a new level" : "Changes saved with \(published.count) new levels"
        } else if isDaily, let group {
            toast = "Today's Daily \(ProductName.singular) is live in \(group.name)"
        } else if published.count > 1 {
            toast = "Shared \(published.count) levels to \(destinationName)"
        } else {
            toast = "Shared to \(destinationName)"
        }
        if !sentTo.isEmpty {
            toast += " · Sent to \(sentTo.count == 1 ? sentTo[0].name : "\(sentTo.count) friends")"
        }
        return openID.map { ($0, toast) }
    }

    /// Lists the shared levels on the server: Studio makes every game as a draft
    /// (`POST /v1/creations/{id}/publish`). Tries twice; a level that still fails stays a draft,
    /// playable by link, and the person hears so.
    private func publishDrafts(_ levelIDs: [String]) {
        let ids = levelIDs.compactMap { drafts.removeValue(forKey: $0) }
        guard !ids.isEmpty else { return }
        let generator = GameGeneratorFactory.current
        let appStore = appStore
        Task { @MainActor in
            var failed = 0
            for id in ids {
                do {
                    try await generator.publish(gameID: id)
                } catch {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    do { try await generator.publish(gameID: id) } catch { failed += 1 }
                }
            }
            if failed > 0 {
                appStore?.showToast("Couldn't put it in the feed yet. Friends can still play it from your share.", symbol: "exclamationmark.triangle")
            }
        }
    }

    /// Studio was discarded: deletes the drafts this session made (best effort), so dropped
    /// builds and tweaks don't pile up in the person's games.
    func discardDrafts() {
        let ids = Array(drafts.values)
        drafts = [:]
        // Nothing was built from the media: drop it on the server too. (A game deletes its own.)
        if ids.isEmpty { media.discardAll() }
        guard !ids.isEmpty else { return }
        let generator = GameGeneratorFactory.current
        Task.detached {
            for id in ids { await generator.discard(gameID: id) }
        }
    }

    /// Floats to the feed or a Group make a post; Event icebreakers live on the Event.
    private var postsToFeedOrGroup: Bool {
        if isEditMode { return false }
        if case .event = destination { return false }
        return true
    }

    func defaultCaption(for bubble: Bubble) -> String {
        if mode == .daily { return "Today's Daily \(ProductName.singular) is here. Play now!" }
        if mode == .nextLevel { return "Level \(bubble.levelIndex ?? 2) of \(baseTitle) is out. Play now!" }
        if mode == .remix { return "I remixed \(baseTitle). Play it!" }
        return "I made a new \(ProductName.singular) with Muse. Play it!"
    }
}

private extension StudioModel {
    /// "nostalgic" → "Nostalgic".
    nonisolated static func capitalizedFirst(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }
}

// MARK: - Microgames (docs/BUBBLES.md 7.12)

extension StudioModel {
    /// Whether this Studio can build a microgame at all: real Muse is configured, and it's a new
    /// game (edits, remixes and levels of formula games stay on their formula).
    var canBuildMicrogame: Bool {
        mode == .create || mode == .daily
    }

    /// The default for `buildsMicrogame` when the brief arrives. The server makes every new game
    /// from scratch, so it's on whenever this is a new game.
    var suggestsMicrogame: Bool { canBuildMicrogame }

    /// Kept for the Brief step. Ready formulas were made on the device, which is gone, so a new
    /// game is always made from scratch on the server.
    func setBuildsMicrogame(_ value: Bool) {
        buildsMicrogame = canBuildMicrogame
    }

    /// The brief as sent to Muse: the reviewed brief, plus the sound and length picked on it.
    var briefForRun: BubbleBrief? {
        guard var brief else { return nil }
        var notes: [String] = []
        if let existing = brief.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !existing.isEmpty { notes.append(existing) }
        if let soundHint { notes.append("Sounds: \(soundHint).") }
        if let length { notes.append("Length: \(length.label).") }
        // The agreed anatomy goes in the job's own `anatomy` field, not in the notes.
        brief.notes = notes.isEmpty ? nil : notes.joined(separator: " ")
        return brief
    }

    /// The server's stream for this run (`GameGenerator`, `/v1/generate`): a new game, or a change
    /// to one (`runRevision`). Nil only when there's nothing to build.
    func serverStream(for request: StudioRequest, kind: StudioComposeKind) -> AsyncThrowingStream<StudioEvent, Error>? {
        let onReport: @MainActor (UUID, StudioPlaytest.Report) -> Void = { [weak self] id, report in
            self?.playtestReports[id] = report
        }
        let onWait: @MainActor (StudioGenerateBridge.Wait?) -> Void = { [weak self] wait in self?.generationWait = wait }
        if let revision = runRevision {
            runIsServer = true
            return StudioGenerateBridge.revise(with: GameBuildTracker.shared.generator(for: self), revision: revision, onReport: onReport, onWait: onWait)
        }
        guard kind == .create, canBuildMicrogame else { return nil }
        let brief = request.brief ?? briefForRun ?? BubbleBrief(intent: request.prompt, audience: request.scope)
        // The server takes up to 2,000 characters of request; the agreed anatomy goes in its own
        // `anatomy` field (up to 16 KB), and the server adds it to what Muse reads.
        let words = microgameRequestText(request)
        let text = String(String.UnicodeScalarView(words.unicodeScalars.prefix(Self.maxRequestCharacters)))
        runIsServer = true
        // A draft until the person shares it, so builds they drop never reach the feed.
        return StudioGenerateBridge.compose(with: GameBuildTracker.shared.generator(for: self), request: text, brief: brief,
                                            anatomy: agreedAnatomyText, draft: true, sound: sound,
                                            extras: newGameExtras, onReport: onReport, onWait: onWait)
    }

    /// A new game's `groupId`, `spec` and `answers` (`NewGameExtras`): the Group or Event it's for,
    /// and what the Plan step agreed.
    var newGameExtras: NewGameExtras {
        NewGameExtras(groupID: serverAudienceGroupID, spec: runPlan?.spec,
                      answers: Dictionary((runPlan?.answers ?? []).map { ($0.slot, $0.value) }) { _, last in last },
                      media: media.input)
    }

    /// The server Group (or Event) the game is for, when I'm a member of it there: the server makes
    /// the game for it (its Games tab and board) and gives Muse its name and people. Groups only
    /// the app knows are left out, so a build never fails on a Group the server doesn't have.
    var serverAudienceGroupID: String? {
        let id: String
        switch audience {
        case .group(let group): id = group
        case .event(let event): id = event
        case .everyone, .friends: return nil
        }
        guard let group = bubbleStore?.serverGroups[id], group.isMember else { return nil }
        return group.id
    }

    /// `POST /v1/generate` takes a request of 1 to 2,000 characters.
    nonisolated static let maxRequestCharacters = 2_000

    /// The request as Muse reads it for a microgame: what the person typed, plus who it's for. The
    /// agreed anatomy travels apart, in the job's `anatomy` field.
    private func microgameRequestText(_ request: StudioRequest) -> String {
        var text = request.prompt
        let names = request.audienceNames.prefix(6)
        if let scope = request.scopeName {
            text += names.isEmpty ? " (for \(scope))" : " (for \(scope): \(names.joined(separator: ", ")))"
        } else if audience == .friends, !names.isEmpty {
            text += " (for my friends \(names.joined(separator: ", ")))"
        }
        return text
    }

    /// Microgames can't be redrawn in a Studio look; their art comes from the game itself.
    var currentResultTakesLooks: Bool {
        currentResult.map { $0.manifest.formula != .microgame } ?? true
    }
}

// MARK: - Share: people

extension StudioModel {
    /// Friends you can send the game to from the Share step (Messenger's friends).
    var friendChoices: [User] {
        guard let appStore else { return [] }
        let targets = BubbleSocialHub.targets(appStore: appStore, kinds: [.friend])
        return Array(targets.compactMap { appStore.user(id: $0.targetID) }.prefix(12))
    }

    /// Picks three friends the first time the Share step shows, so "Challenge Maya, Leo and
    /// Priya" is one tap. People in the audience Group or Event come first.
    func pickDefaultFriendsIfNeeded() {
        guard !didPickDefaultFriendsFlag, !isEditMode else { return }
        didPickDefaultFriendsFlag = true
        let choices = friendChoices
        let audienceIDs = Set((audienceGroup?.memberSample ?? []).map(\.id) + (audienceEvent?.friendsGoing ?? []).map(\.id))
        let ordered = choices.filter { audienceIDs.contains($0.id) } + choices.filter { !audienceIDs.contains($0.id) }
        challengeIDs = Array(ordered.prefix(3).map(\.id))
    }

    func toggleFriend(_ id: String) {
        if let index = challengeIDs.firstIndex(of: id) {
            challengeIDs.remove(at: index)
        } else {
            challengeIDs.append(id)
        }
    }

    var challengedPeople: [User] {
        challengeIDs.compactMap { id in appStore?.user(id: id) }
    }

    /// Microgames go out as a "play with me" share card; other games as a same-seed challenge.
    var sendsChallenge: Bool {
        levels.first.map { $0.manifest.formula != .microgame } ?? true
    }

    /// The headline friends see on the chat card.
    func cardHeadline(for title: String) -> String {
        sendsChallenge ? ChallengeCopy.canYouBeatMe(title) : RemixCopy.shareHeadline(title: title)
    }

    /// Sends the new game to the picked friends through the existing paths: a challenge through
    /// `BubbleSocialHub` (ChallengeCenter opens it and posts `challenge_sent`), or for a microgame
    /// a share card through `RemixCenter` (posts `share`). Returns who got it.
    fileprivate func sendToFriends(_ bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) -> [MakeRecord.Person] {
        var sent: [MakeRecord.Person] = []
        for person in challengedPeople {
            let target = BubbleShareTarget(kind: .friend, targetID: person.id, title: person.name)
            let ok: Bool
            if bubble.formula == .microgame {
                ok = RemixCenter.shared.share(bubble, to: target, score: nil, result: nil, request: nil, note: "", appStore: appStore, bubbleStore: bubbleStore)
            } else {
                let center = ChallengeCenter.shared
                let card = center.card(for: center.bestDraft(for: bubble), bubble: bubble, target: target)
                ok = BubbleSocialHub.send(card, to: target, appStore: appStore, bubbleStore: bubbleStore)
            }
            if ok { sent.append(MakeRecord.Person(id: person.id, name: person.firstName)) }
        }
        return sent
    }

    /// Keeps what Muse did for each published level, for its page.
    fileprivate func saveMakeRecords(for published: [Bubble], sentTo: [MakeRecord.Person]) {
        for (index, bubble) in published.enumerated() {
            let level = levels.first { $0.manifest.id == bubble.id } ?? levels.first { !$0.isExisting && $0.manifest.title == bubble.title }
            let made = level.flatMap { makeRecords[$0.manifest.id] }
            var record = made ?? MakeRecord.build(
                gameID: bubble.id, events: [], reports: [:], isMicrogame: bubble.formula == .microgame,
                concepts: bubble.formula == .microgame ? StudioMicrogameBridge.fragments(of: bubble.manifest) : bubble.manifest.conceptIDs,
                models: bubble.manifest.studio?.models ?? [], seconds: bubble.manifest.studio?.durationSec,
                isOffline: bubble.manifest.studio?.offline ?? false, sourcesUsed: level?.sourcesUsed ?? []
            )
            record.gameID = bubble.id
            if index == 0 {
                record.sentTo = sentTo
                record.sharedTo = destinationName
            }
            record.madeAt = Date()
            MakeRecordStore.shared.save(record)
        }
    }
}
