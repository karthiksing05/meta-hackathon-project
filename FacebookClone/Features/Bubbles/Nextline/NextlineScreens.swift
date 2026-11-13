import SwiftUI

/// Screens and launch hooks for the "nextline" feature: quiz nights of "guess what they say next"
/// in a Group or a group chat (docs/BUBBLES.md 7.7). Owner: nextline.
///
/// Screens (`BubbleFeatureRoute(.nextline, screen, arg)`):
///   night/<groupID or chatID>   the quiz night lobby: pick the scenes, members join, Start
///   podium/<nightID>            a night's podium, round by round, Rematch
///   results/<bubbleID>          the latest finished night on that Bubble's podium
///
/// Quiz nights need the server to run the night and collect everyone's answers
/// (docs/APP_LIVE_DATA_PLAN.md, Stage 4), which isn't there yet, so `night` says so and offers the
/// Group's games instead (`QuizNightUnavailableView`).
enum NextlineScreens {
    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "night", "live":
            QuizNightUnavailableView(placeID: route.arg)
        case "podium":
            QuizNightPodiumView(nightID: route.arg)
        case "results":
            QuizNightResultsLookup(bubbleID: route.arg)
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

    /// `FB_OPEN=feature:nextline/...` (DEBUG): stage demo state, then open.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        false
    }

    /// Once at launch.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        MainActor.assumeIsolated {
            QuizNightCenter.appStore = appStore
        }
    }

    /// After the player records one of your runs: a quiz night run updates the night and its card.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
        guard let context = request.context, context.kind == .gameNight else { return }
        QuizNightCenter.shared.didFinish(score, nightID: context.id, appStore: appStore, bubbleStore: bubbleStore)
    }

    /// After Muse Studio publishes: nothing to do; new quiz night Bubbles show up in lobbies.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
    }
}

/// Every new user-facing string for the "nextline" feature, in one place so a rename is easy.
enum NextlineCopy {
    static let quizNight = "Quiz night"
    static let tagline = "Guess what they say next"
    static let pitch = "Everyone plays the same scenes at the same time. Pick the punchline before the timer runs out."
    static let startOne = "Start one"
    static let start = "Start quiz night"
    static let join = "Join"
    static let playNow = "Play now"
    static let seeResults = "See results"
    static let rematch = "Rematch"
    static let fullResults = "Full results"
    static let addFriend = "Add friend"
    static let requested = "Requested"
    static let pickScenes = "Pick the scenes"
    static let whosHere = "Who's here"
    static let you = "You"
    static let waiting = "Joining…"
    static let joined = "Joined"
    static let right = "Right"
    static let wrong = "Wrong"
    static let done = "Done"
    static let howScene = "A short scene plays and freezes right before the punchline."
    static let howPick = "Pick the real next line from four. Right and fast scores more; streaks multiply."
    static let howPodium = "Everyone sees who got it and how fast, then the podium. The card in the chat keeps score."
    static let playing = "Playing"
    static let thinking = "…"
    static let liveNow = "Live now"
    static let noNightsYet = "No quiz nights yet. Start the first one and see who knows the punchline."
    static let noScenes = "No quiz night games yet. Make one with Muse: try “roommates figuring out the thermostat”."
    static let makeWithMuse = "Make one with Muse"
    static let museExample = "Quiz night: roommates figuring out the thermostat"
    static let notFound = "This quiz night has ended."
    static let rounds = "Round by round"
    static let podiumTitle = "Quiz night results"
    static let staged = "Staged for QA: your side is a practice bot run and isn't on the board."
    static let startIn = "Start a quiz night in…"
    static let startInDetail = "Your Group or group chat plays these scenes together, live."
    static let groups = "Groups"
    static let chats = "Group chats"
    static let closeLabel = "Close"

    static func roundsLabel(_ n: Int) -> String { n == 1 ? "1 round" : "\(n) rounds" }
    static func joinedCount(_ n: Int) -> String { "\(n) joined" }
    static func tonight(_ n: Int) -> String { "Quiz night tonight · \(n) joined" }
    static func inPlace(_ name: String) -> String { "in \(name)" }
    static func cardHeadline(_ title: String) -> String { "Quiz night: \(title)" }
    static func cardNote(_ place: String) -> String { "Quiz night is on in \(place)! Guess what they say next 🎬" }
    static func lastWinner(_ name: String, _ score: Int) -> String { "Last night: \(name) won with \(score.withCommas)" }
    static func youWon(_ score: Int) -> String { "You won with \(score.withCommas)!" }
    static func placed(_ rank: Int, of total: Int) -> String { "You placed \(ordinal(rank)) of \(total)" }
    static func won(_ name: String) -> String { "\(name) won" }
    static func roundOf(_ k: Int, _ n: Int) -> String { "Round \(k) of \(n)" }
    static func afterRound(_ k: Int) -> String { "After round \(k)" }
    static func secondsShort(_ s: Double) -> String { String(format: "%.1fs", s) }
    static func rightCount(_ right: Int, _ total: Int) -> String { "\(right)/\(total) right" }
    static func points(_ n: Int) -> String { "\(n.withCommas) points" }
    static func notificationWon(score: Int, place: String) -> String { "won quiz night in \(place) with \(score.withCommas). Rematch?" }
    static func startLabel(_ title: String) -> String { "Start quiz night with \(title)" }
    static func memberAnswered(_ name: String, correct: Bool, seconds: Double) -> String {
        "\(name) answered \(correct ? "right" : "wrong") in \(String(format: "%.1f", seconds)) seconds"
    }
    static func memberWaiting(_ name: String) -> String { "\(name) is thinking" }
    static func standingLabel(_ rank: Int, _ name: String, _ score: Int) -> String { "Number \(rank), \(name), \(score) points" }
    static let chatReactionYouWon = "Okay you're way too good at this 😂 rematch?"
    static let chatReactionTheyWon = "GG everyone 🏆 that last punchline got me"

    static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 100, n % 10) {
        case (11...13, _): suffix = "th"
        case (_, 1): suffix = "st"
        case (_, 2): suffix = "nd"
        case (_, 3): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }
}

/// A quiz night while the server can't run one: says so kindly, and offers the Group's games
/// (or the games tab, from a group chat).
struct QuizNightUnavailableView: View {
    /// A Group id or a group chat id.
    let placeID: String

    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        let isGroup = appStore.group(id: placeID) != nil
        LiveDataStateView(
            kind: .notAvailable(LiveDataCopy.quizNight),
            title: NextlineCopy.quizNight,
            action: LiveDataStateView.Action(title: isGroup ? "Play the Group's games" : "Play something", symbol: "play.fill") {
                if isGroup {
                    router.push(.bubbleFeature(GroupsSearchScreens.gamesRoute(for: placeID)))
                } else {
                    router.select(.bubbles)
                }
            }
        )
        .frame(maxHeight: .infinity)
        .background(FBColor.surface)
        .navigationTitle(NextlineCopy.quizNight)
        .navigationBarTitleDisplayMode(.inline)
    }
}
