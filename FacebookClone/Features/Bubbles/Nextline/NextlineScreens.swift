import SwiftUI

/// Screens and launch hooks for the "nextline" feature (docs/BUBBLES.md 7.7). Owner: nextline.
/// Stub from feat/base: `BubbleFeatureRouter` calls these; fill them in.
///
/// QA targets, `FB_OPEN=feature:nextline/<screen>[/<arg>]`:
///   night/<groupID or chatID>          a quiz night lobby in a Group or group chat, members joining
///   live/<bubbleID>                    a quiz night in progress: the between-rounds leaderboard with bots answering
///   results/<bubbleID>                 the quiz night's final podium
enum NextlineScreens {
    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        BubbleFeaturePlaceholder(route: route)
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        BubbleFeaturePlaceholder(route: route)
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        false
    }

    /// `FB_OPEN=feature:nextline/...` (DEBUG): stage demo state, then open. Return false to fall back
    /// to `open`.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        false
    }

    /// Once at launch, after `BubbleSocialCast.install` (seed notifications, observers).
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// After the player records one of your runs.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
    }
}

/// Every new user-facing string for the "nextline" feature, in one place so a rename is easy.
enum NextlineCopy {
}
