import SwiftUI

/// Screens and launch hooks for the "challenge" feature (docs/BUBBLES.md 7.2). Owner: challenge.
/// Stub from feat/base: `BubbleFeatureRouter` calls these; fill them in.
///
/// QA targets, `FB_OPEN=feature:challenge/<screen>[/<arg>]`:
///   picker/<bubbleID>                  the Challenge Me picker (friends, recent chats, Groups) with the preview card
///   chat/<bubbleID>                    your 1:1 chat with Maya holding a live challenge card for <bubbleID>; her bot score lands a few seconds later
///   h2h/<bubbleID>                     the head-to-head result ('You 41, Maya 34') with Challenge back
///   groupchat/<bubbleID>               the 'New in SF crew' group chat with a shared session card ('3 of 5 played')
///   rivalry/<userID>                   a friend's profile scrolled to the rivalry line and Challenge button
enum ChallengeScreens {
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

    /// `FB_OPEN=feature:challenge/...` (DEBUG): stage demo state, then open. Return false to fall back
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

    /// After Muse Studio publishes new Bubbles (first level first): remixes, co-made games, games
    /// about me, adventures from your own story.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
    }
}

/// Every new user-facing string for the "challenge" feature, in one place so a rename is easy.
enum ChallengeCopy {
}
