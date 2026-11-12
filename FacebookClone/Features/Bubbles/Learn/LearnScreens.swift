import SwiftUI

/// Screens and launch hooks for the "learn" feature (docs/BUBBLES.md 7.8). Owner: learn.
/// Stub from feat/base: `BubbleFeatureRouter` calls these; fill them in.
///
/// QA targets, `FB_OPEN=feature:learn/<screen>[/<arg>]`:
///   lesson/<bubbleID>                  a lesson Bubble's page with its mastery and friends' streaks
///   group/<groupID>                    the Group's shared lesson with the Group mastery meter
///   streaks                            friends' learning streaks
enum LearnScreens {
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

    /// `FB_OPEN=feature:learn/...` (DEBUG): stage demo state, then open. Return false to fall back
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

/// Every new user-facing string for the "learn" feature, in one place so a rename is easy.
enum LearnCopy {
}
