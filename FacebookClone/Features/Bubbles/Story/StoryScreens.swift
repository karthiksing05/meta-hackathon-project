import SwiftUI

/// Screens and launch hooks for the "story" feature (docs/BUBBLES.md 7.6). Owner: story.
/// Stub from feat/base: `BubbleFeatureRouter` calls these; fill them in.
///
/// QA targets, `FB_OPEN=feature:story/<screen>[/<arg>]`:
///   endings/<bubbleID>                 the endings screen: which endings you and friends found, who took the other path
///   path/<bubbleID>                    send your path to a friend or the Group
///   mystory                            Studio prefilled to turn your own story ('my first week in SF') into an adventure
enum StoryScreens {
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

    /// `FB_OPEN=feature:story/...` (DEBUG): stage demo state, then open. Return false to fall back
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

/// Every new user-facing string for the "story" feature, in one place so a rename is easy.
enum StoryCopy {
}
