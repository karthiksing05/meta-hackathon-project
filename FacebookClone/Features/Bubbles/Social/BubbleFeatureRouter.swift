import SwiftUI

// Routing for the collaboration features (docs/BUBBLES.md 7.1). Every feature owns one
// `<Feature>Screens` enum in its own folder (Features/Bubbles/<Feature>/) with the same five
// entry points; this file only dispatches to them, so features never edit each other's files.
//
//   destination(_:)  a pushed screen         (Route.bubbleFeature)
//   sheet(_:)        a sheet over the tabs   (router.bubbleSheet)
//   open(_:router:)  notification taps and other deep links; return false to push the default
//   debugOpen(...)   FB_OPEN=feature:<key>/<screen>[/<arg>]; return false to fall back to open
//   install(...)     once at launch (seed chats, notifications, observers)
//   didFinish(...)   after every recorded run in the player
//   didPublish(...)  after Muse Studio publishes (remixes, co-made games, games about me)
//
// Don't edit this file in a feature branch.

/// The collaboration features, by the key used in specs, branches and FB_OPEN.
enum BubbleFeature: String, CaseIterable, Hashable, Codable, Sendable {
    case challenge
    case groupsSearch = "groups-search"
    case together
    case remix
    case story
    case nextline
    case learn
    case length
    case saves
}

/// One screen of a feature: `screen` names it inside the feature ("picker", "tree"), `arg` is
/// usually a Bubble, Group, user or chat id.
struct BubbleFeatureRoute: Hashable, Identifiable, Codable, Sendable {
    var feature: BubbleFeature
    var screen: String
    var arg: String

    init(_ feature: BubbleFeature, _ screen: String, _ arg: String = "") {
        self.feature = feature
        self.screen = screen
        self.arg = arg
    }

    var id: String { "\(feature.rawValue)/\(screen)/\(arg)" }

    /// Parses `<key>/<screen>[/<arg>]` (the part after `feature:` in FB_OPEN). The arg keeps any
    /// further slashes.
    init?(debugPath: String) {
        let parts = debugPath.split(separator: "/", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 2, let feature = BubbleFeature(rawValue: parts[0]), !parts[1].isEmpty else { return nil }
        self.init(feature, parts[1], parts.count > 2 ? parts[2] : "")
    }
}

enum BubbleFeatureRouter {
    // MARK: Views

    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.feature {
        case .challenge: ChallengeScreens.destination(route)
        case .groupsSearch: GroupsSearchScreens.destination(route)
        case .together: TogetherScreens.destination(route)
        case .remix: RemixScreens.destination(route)
        case .story: StoryScreens.destination(route)
        case .nextline: NextlineScreens.destination(route)
        case .learn: LearnScreens.destination(route)
        case .length: LengthScreens.destination(route)
        case .saves: SavesScreens.destination(route)
        }
    }

    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        switch route.feature {
        case .challenge: ChallengeScreens.sheet(route)
        case .groupsSearch: GroupsSearchScreens.sheet(route)
        case .together: TogetherScreens.sheet(route)
        case .remix: RemixScreens.sheet(route)
        case .story: StoryScreens.sheet(route)
        case .nextline: NextlineScreens.sheet(route)
        case .learn: LearnScreens.sheet(route)
        case .length: LengthScreens.sheet(route)
        case .saves: SavesScreens.sheet(route)
        }
    }

    // MARK: Opening

    /// Opens a route from anywhere with a router (notification taps, cards). The feature decides
    /// (push, sheet, chat, player); otherwise the route is pushed on the current tab.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) {
        let handled: Bool
        switch route.feature {
        case .challenge: handled = ChallengeScreens.open(route, router: router)
        case .groupsSearch: handled = GroupsSearchScreens.open(route, router: router)
        case .together: handled = TogetherScreens.open(route, router: router)
        case .remix: handled = RemixScreens.open(route, router: router)
        case .story: handled = StoryScreens.open(route, router: router)
        case .nextline: handled = NextlineScreens.open(route, router: router)
        case .learn: handled = LearnScreens.open(route, router: router)
        case .length: handled = LengthScreens.open(route, router: router)
        case .saves: handled = SavesScreens.open(route, router: router)
        }
        if !handled {
            router.push(.bubbleFeature(route))
        }
    }

    /// FB_OPEN=feature:<key>/<screen>[/<arg>] (DEBUG). Features may stage demo state first.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) {
        let handled: Bool
        switch route.feature {
        case .challenge: handled = ChallengeScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .groupsSearch: handled = GroupsSearchScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .together: handled = TogetherScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .remix: handled = RemixScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .story: handled = StoryScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .nextline: handled = NextlineScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .learn: handled = LearnScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .length: handled = LengthScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        case .saves: handled = SavesScreens.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
        }
        if !handled {
            open(route, router: router)
        }
    }

    // MARK: Lifecycle

    /// Once at launch, after the shared social cast is installed (`BubbleSurfaceHooks.install`).
    static func installAll(appStore: AppStore, bubbleStore: BubbleStore) {
        ChallengeScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        GroupsSearchScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        TogetherScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        RemixScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        StoryScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        NextlineScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        LearnScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        LengthScreens.install(appStore: appStore, bubbleStore: bubbleStore)
        SavesScreens.install(appStore: appStore, bubbleStore: bubbleStore)
    }

    /// After the player records a run (yours, not a Burst). `request` says how the play started
    /// (seed, length, challenge or session context); `score` is the recorded entry.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
        ChallengeScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        GroupsSearchScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        TogetherScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        RemixScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        StoryScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        NextlineScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        LearnScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        LengthScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
        SavesScreens.didFinish(score, in: bubble, request: request, appStore: appStore, bubbleStore: bubbleStore)
    }

    /// After Muse Studio publishes (`BubbleStore.publishFromStudio`), first level first.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
        ChallengeScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        GroupsSearchScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        TogetherScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        RemixScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        StoryScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        NextlineScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        LearnScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        LengthScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
        SavesScreens.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
    }
}

/// What a stub screen shows until its feature fills it in, so every FB_OPEN target opens
/// something during QA.
struct BubbleFeaturePlaceholder: View {
    let route: BubbleFeatureRoute

    var body: some View {
        ContentUnavailableView(
            "Coming soon",
            systemImage: "sparkles",
            description: Text("\(route.feature.rawValue) · \(route.screen)\(route.arg.isEmpty ? "" : " · \(route.arg)")")
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FBColor.surface)
        .navigationTitle(ProductName.display)
        .navigationBarTitleDisplayMode(.inline)
    }
}
