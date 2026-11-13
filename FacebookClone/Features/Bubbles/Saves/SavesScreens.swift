import SwiftUI

/// Screens and launch hooks for the "saves" feature (docs/BUBBLES.md 7.10). Owner: saves.
/// Stub from feat/base: `BubbleFeatureRouter` calls these; fill them in.
///
/// QA targets, `FB_OPEN=feature:saves/<screen>[/<arg>]`:
///   hint                               the first-run 'Saves are how you like a game' hint
///   stats/<bubbleID>                   a Bubble's saves stats (who saved it, friends first)
///   library                            the Library with saves stats
enum SavesScreens {
    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "stats":
            SavesStatsView(bubbleID: route.arg)
        case "library":
            BubbleLibraryView()
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        NavigationStack {
            destination(route)
        }
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        false
    }

    private static func pushStats(bubbleID: String, router: Router, bubbleStore: BubbleStore) {
        let id = bubbleStore.bubble(id: bubbleID) != nil ? bubbleID : (bubbleStore.bubbles.first { $0.creator.isMe }?.id ?? bubbleID)
        router.push(.bubbleFeature(BubbleFeatureRoute(.saves, "stats", id)))
    }

    /// `FB_OPEN=feature:saves/...` (DEBUG): stage demo state, then open. Return false to fall back
    /// to `open`.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        switch route.screen {
        case "hint":
            // The hint shows in the player (and on the feed caption); play a game so it is in view.
            SavesHintCenter.shared.reset()
            router.play(route.arg.isEmpty ? "hill-hopper" : route.arg)
            return true
        case "stats":
            pushStats(bubbleID: route.arg, router: router, bubbleStore: bubbleStore)
            return true
        case "library":
            router.push(.bubbleLibrary)
            return true
        default:
            return false
        }
    }

    /// Once at launch: milestone notifications for your own games' saves. Nothing is staged.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        MainActor.assumeIsolated {
            SavesMilestones.start(appStore: appStore, bubbleStore: bubbleStore)
        }
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

/// Every new user-facing string for the "saves" feature, in one place so a rename is easy.


enum SavesCopy {
    static let save = "Save"
    static let saved = "Saved"
    static let statsTitle = "Saves"
    static let whoSaved = "Who saved it"
    static let friendsFirst = "Friends first. Saving is how people show love for a game."
    static let seeAll = "See everyone who saved it"
    static let friend = "Friend"
    static let youSaved = "You saved this"
    static let newInSF = "New in SF"
    static let requestSent = "Request sent"
    static let addFriend = "Add friend"
    static let confirm = "Confirm"
    static let emptyTitle = "No saves yet"
    static let emptyBody = "When someone saves this game, they show up here."
    static let hintTitle = "Saving is how you show love for a game."
    static let hintBody = "Tap the bookmark anytime, even mid-game."
    static let mostSaved = "Most saved"
    static let libraryEmptyTitle = "Saves are the likes"
    static let libraryEmptyBody = "Make a game and your friends can save it. Their names show up here."

    static func savesCount(_ n: Int) -> String { n == 1 ? "1 save" : "\(n.fbCompact) saves" }
    static func savesThisWeek(_ n: Int) -> String { n == 1 ? "1 save this week" : "\(n.fbCompact) saves this week" }
    static func savedBy(_ who: String) -> String { "Saved by \(who)" }
    static func savedByCount(_ n: Int) -> String { "Saved by \(n.fbCompact) \(n == 1 ? "person" : "people")" }
    static func andMore(_ n: Int) -> String { "and \(n.fbCompact) more" }
    static func mutual(_ n: Int) -> String { n == 1 ? "1 mutual friend" : "\(n) mutual friends" }
    static func libraryWeekly(_ n: Int) -> String { "Your games were saved \(n.fbCompact) \(n == 1 ? "time" : "times") this week" }
    static func milestone(_ title: String, _ n: Int) -> String { "\(title) just passed \(n.fbCompact) saves." }
}

/// A milestone notification when a save pushes one of your Bubbles across a round number.
@MainActor
enum SavesMilestones {
    private static var task: Task<Void, Never>?
    static let steps = [10, 25, 50, 100, 250, 500, 1000]

    static func start(appStore: AppStore, bubbleStore: BubbleStore) {
        guard task == nil else { return }
        task = Task { @MainActor in
            for await note in NotificationCenter.default.notifications(named: .bubbleSaveChanged) {
                guard let id = note.userInfo?[BubbleSaveSignals.bubbleIDKey] as? String,
                      note.userInfo?[BubbleSaveSignals.isSavedKey] as? Bool == true,
                      let bubble = bubbleStore.bubble(id: id), bubble.creator.isMe,
                      steps.contains(bubble.saveCount) else { continue }
                let noteID = "bubble-note-saves-milestone-\(id)-\(bubble.saveCount)"
                // Unsave then save again lands on the same number; say it once.
                guard !appStore.notifications.contains(where: { $0.id == noteID }) else { continue }
                let item = AppNotification(
                    id: noteID, kind: .bubblePlayed, actors: [],
                    message: SavesCopy.milestone(bubble.title, bubble.saveCount), isRead: false, bubbleID: id
                )
                item.bubbleAction = BubbleFeatureRoute(.saves, "stats", id)
                appStore.notifications.insert(item, at: 0)
            }
        }
    }
}
