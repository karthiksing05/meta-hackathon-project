import SwiftUI

/// Screens and launch hooks for the "story" feature (docs/BUBBLES.md 7.6). Owner: story.
///
/// QA targets, `FB_OPEN=feature:story/<screen>[/<arg>]`:
///   endings/<bubbleID>                 the endings screen: which endings you and friends found, who took the other path
///   path/<bubbleID>                    send your path to a friend, a chat or the Group
///   mystory                            turn your own story ('my first week in SF') into an adventure
enum StoryScreens {
    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "endings":
            StoryEndingsView(bubbleID: route.arg)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "path":
            StoryPathShareSheet(bubbleID: route.arg)
        case "mystory":
            StoryMyStorySheet(model: nil)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        switch route.screen {
        case "path", "mystory":
            router.bubbleSheet = route
            return true
        default:
            return false
        }
    }

    /// `FB_OPEN=feature:story/...` (DEBUG): stage demo state, then open.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        // With no id, the first story game the server sent this session.
        let found = route.arg.isEmpty ? bubbleStore.bubbles.first(where: { $0.formula == .story }) : bubbleStore.bubble(id: route.arg)
        guard let bubble = found else { return false }
        let bubbleID = bubble.id
        switch route.screen {
        case "endings":
            StoryProgressStore.shared.loadFriends(for: bubble, bubbleStore: bubbleStore)
            router.push(.bubbleFeature(BubbleFeatureRoute(.story, "endings", bubbleID)))
            return true
        case "path":
            router.bubbleSheet = BubbleFeatureRoute(.story, "path", bubbleID)
            return true
        default:
            return false
        }
    }

    /// Once at launch. Nothing is staged.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// After the player records one of your runs: the ending joins the endings you've found.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
        guard bubble.formula == .story else { return }
        StoryProgressStore.shared.record(score, in: bubble, request: request)
        StoryProgressStore.shared.loadFriends(for: bubble, bubbleStore: bubbleStore)
    }

    /// After Muse Studio publishes: friends' paths start loading for a new adventure.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
        for bubble in bubbles where bubble.formula == .story {
            StoryProgressStore.shared.loadFriends(for: bubble, bubbleStore: bubbleStore)
        }
    }
}

/// Every new user-facing string for the "story" feature, in one place so a rename is easy. The
/// category is "Adventure" (never "Story", so it isn't confused with Facebook Stories).
enum StoryCopy {
    static let category = "Adventure"
    static let theEnd = "The end"
    static let foundAnEnding = "found an ending"
    static let endingsTitle = "Endings"
    static let friendsPathsTitle = "Which way did friends go?"
    static let friendsLoading = "Seeing which way your friends went…"
    static let sendPath = "Send your path"
    static let sendPathSubtitle = "Ask a friend, the crew or the Group which way they'd go."
    static let playToFind = "Play to find the rest"
    static let playFirst = "Play it first"
    static let playFirstDetail = "Finish the adventure once, then send your path to friends."
    static let notPlayedYet = "You haven't found an ending yet. Every choice counts."
    static let allFound = "You found every ending!"
    static let hiddenEnding = "Hidden ending"
    /// An ending chip you haven't found yet: its number only, no spoiler.
    static func unfoundEnding(_ number: Int) -> String { "Ending \(number)" }
    static let secretEnding = "Secret ending"
    static let addFriend = "Add friend"
    static let requestSent = "Request sent"
    static let yourPath = "Your path"
    static let sent = "Sent"
    static let send = "Send"
    static let sendTo = "Send to"
    static let chats = "Chats"
    static let groups = "Groups"
    static let friends = "Friends"
    static let done = "Done"
    static let cancel = "Cancel"
    static let pathLabel = "Path"
    static let play = "Play"
    static let whichWay = "Which way would you go?"
    static let seeEndings = "See endings"

    // Own story → adventure.
    static let myStoryEntryTitle = "Turn your story into an adventure"
    static let myStoryEntrySubtitle = "Tell Muse about your first week, a trip, a big day. Friends play your path."
    static let myStoryTitle = "Your story, as an adventure"
    static let myStoryIntro = "Write it the way you'd tell a friend. Muse turns the moments into scenes and the decisions into choices, and friends get to play your week."
    static let myStoryPlaceholder = "I moved to SF on Monday. I got lost on the 22 bus, found a tiny bakery, and…"
    static let myStoryExample = "I moved to SF on Monday with two suitcases. I got lost on the 22 bus and ended up at a tiny bakery. On Wednesday I joined New in SF and went to my first picnic. Maya taught me how to catch a cable car. By Saturday the fog felt like home."
    static let myStoryUseExample = "Use an example"
    static let myStoryPrivacy = "Only what you write here goes to Muse. Muse keeps your real details and invents nothing private."
    static let myStoryMake = "Make my adventure"
    static let myStoryPrompt = "An adventure of my first week in SF"
    static let myStoryAdded = "Your story is in. Muse will build the adventure from it."

    static func chose(_ text: String) -> String { "chose “\(text)”" }
    static func endingOf(_ number: Int, _ total: Int) -> String { "Ending \(number) of \(total)" }
    static func secretOf(_ number: Int, _ total: Int) -> String { "Secret ending · \(number) of \(total)" }
    static func foundCount(_ found: Int, _ total: Int) -> String { "You've found \(found) of \(total) endings" }
    static func took(_ name: String, _ past: String) -> String { "\(name) \(past)" }
    static func friendFound(_ ending: StoryAdventure.Ending, known: Bool) -> String {
        if ending.isSecret { return known ? "Found the secret ending: \(ending.title)" : "Found a secret ending" }
        return known ? "Ending \(ending.number): \(ending.title)" : "Ending \(ending.number) · play to find it"
    }
    static func otherPath(_ name: String) -> String { "\(name) took the other path" }
    static let otherPathTag = "Other path"
    static func cardHeadline(name: String, past: String) -> String { "\(name) \(past). \(whichWay)" }
    static func replyHeadline(name: String, past: String) -> String { "\(name) \(past). Your move!" }
    static func replyNote(differentPath: Bool) -> String { differentPath ? "Ha, I went the other way 👀" : "Same start, different ending?" }
    static func youTook(_ past: String) -> String { "You \(past)" }
    static func madeAdventureNotification(_ title: String) -> String { "made an adventure in New in SF: \(title)\(title.hasSuffix("?") || title.hasSuffix("!") ? "" : ".") Which way would you go?" }
    static func pathSentToast(_ title: String) -> String { "Path sent to \(title)" }
    static func steps(_ count: Int) -> String { count == 1 ? "1 choice" : "\(count) choices" }
}
