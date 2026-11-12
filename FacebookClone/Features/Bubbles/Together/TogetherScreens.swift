import SwiftUI

/// Screens and launch hooks for the "together" feature (docs/BUBBLES.md 7.4). Owner: together.
///
/// QA targets, `FB_OPEN=feature:together/<screen>[/<arg>]`:
///   start[/<group:id | chat:id | friend:id>]   start a co-made game: what friends add, who to invite
///   session/<sessionID or demo>                 a co-making session filling up with contributions
///                                               (demo: picnic trivia in New in SF crew, ~10 s)
///   aboutme[/<template>]                        'Games about me': the template picker, or a template's
///                                               form (how-well, first-month, favorite-spot)
///   profile/<userID or me>                      'Games about <name>' with who knows them best (me:
///                                               stages your first-month game and friends' plays)
enum TogetherScreens {
    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "session":
            TogetherSessionView(sessionID: route.arg == "demo" || route.arg.isEmpty ? TogetherCopy.demoSessionID : route.arg)
        case "profile":
            TogetherAboutPage(userID: route.arg)
        case "start", "aboutme":
            TogetherRouterSheet(route: route)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "start", "aboutme":
            TogetherRouterSheet(route: route)
        default:
            NavigationStack {
                destination(route)
                    .appDestinations()
            }
        }
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        switch route.screen {
        case "start", "aboutme":
            router.bubbleSheet = route
            return true
        default:
            return false
        }
    }

    /// `FB_OPEN=feature:together/...` (DEBUG): stage demo state, then open.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        switch route.screen {
        case "session":
            let id: String
            if route.arg.isEmpty || route.arg == "demo" {
                id = TogetherCenter.shared.stageDemo(appStore: appStore, bubbleStore: bubbleStore)?.id ?? TogetherCopy.demoSessionID
            } else {
                id = route.arg
            }
            router.push(.bubbleFeature(BubbleFeatureRoute(.together, "session", id)))
            return true
        case "profile":
            let userID = route.arg.isEmpty || route.arg == "me" ? appStore.me.id : route.arg
            if userID == appStore.me.id {
                stageAboutMeDemo(appStore: appStore, bubbleStore: bubbleStore)
            }
            router.push(.bubbleFeature(BubbleFeatureRoute(.together, "profile", userID)))
            return true
        default:
            return false
        }
    }

    /// Once at launch, after `BubbleSocialCast.install`.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// After the player records one of your runs: playing a friend's game about them is a
    /// "getting to know you" moment.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
        guard let about = bubble.manifest.about, about.subjectID != appStore.me.id, about.subjectID != "me" else { return }
        BubbleSocialSignals.post(.aboutMePlay, bubbleID: bubble.id, with: [about.subjectID])
    }

    /// After Muse Studio publishes: co-made games and games about you.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
        TogetherCenter.shared.didPublish(bubbles, appStore: appStore, bubbleStore: bubbleStore)
    }

    /// QA: your "My first month in SF" game, built from the template's sample answers exactly as
    /// the offline composer would, then friends' plays (Diego knows you best).
    @MainActor
    static func stageAboutMeDemo(appStore: AppStore, bubbleStore: BubbleStore) {
        let me = appStore.me
        let existing = bubbleStore.bubbles.first { $0.manifest.about?.subjectID == me.id || $0.manifest.about?.subjectID == "me" }
        if let existing {
            // A game kept from an earlier launch: replay friends' plays if Diego's run isn't there.
            if bubbleStore.bestScore(ofUserID: "sf-diego-ramirez", in: existing) == nil {
                TogetherCenter.shared.scheduleAboutMePlays(existing, appStore: appStore, bubbleStore: bubbleStore)
            }
            return
        }
        guard let base = bubbleStore.bubble(id: "aboutme-maya-first-month")?.manifest,
              let template = TogetherStudio.template("first-month") else { return }
        var manifest = base
        manifest.id = "aboutme-\(me.id)-first-month"
        let answers = Dictionary(uniqueKeysWithValues: template.questions.map { ($0.id, $0.sample) })
        TogetherStudio.configureAnswerKey(&manifest, rounds: TogetherStudio.aboutMeRounds(template: template, answers: answers, subject: me.firstName))
        manifest.title = template.gameTitle(me.firstName)
        manifest.oneLineRule = "Pick \(me.firstName)'s real answer each round."
        manifest.about = BubbleAboutMe(subjectID: me.id, subjectName: me.firstName, template: template.id)
        manifest.style.palette = "sky-glow"
        manifest.style.coverPrompt = nil
        manifest.studio = nil
        let bubble = bubbleStore.publish(manifest)
        TogetherCenter.shared.scheduleAboutMePlays(bubble, appStore: appStore, bubbleStore: bubbleStore)
    }
}

// MARK: - Navigation

/// Leaving the covers a co-making action starts from (Messenger, Studio, a feature sheet) before
/// opening the next one: SwiftUI presents one cover at a time.
@MainActor
enum TogetherNav {
    static func afterCovers(_ router: Router, _ action: @escaping @MainActor () -> Void) {
        var closed = false
        if router.isMessengerPresented { router.isMessengerPresented = false; closed = true }
        if router.studioLaunch != nil { router.studioLaunch = nil; closed = true }
        if router.bubbleSheet != nil { router.bubbleSheet = nil; closed = true }
        if closed {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 600_000_000)
                action()
            }
        } else {
            action()
        }
    }

    /// Pushes a co-making session on the current tab, from anywhere.
    static func openSession(_ id: String, router: Router) {
        afterCovers(router) {
            router.push(.bubbleFeature(BubbleFeatureRoute(.together, "session", id)))
        }
    }

    /// Opens Studio for "Games about me" from anywhere.
    static func openAboutMeStudio(prompt: String, social: StudioSocialContext, router: Router) {
        afterCovers(router) {
            router.openStudio(StudioLaunch(mode: .create, prompt: prompt, social: social))
        }
    }
}

/// The start and about-me sheets when opened through the router (`router.bubbleSheet`).
struct TogetherRouterSheet: View {
    let route: BubbleFeatureRoute

    @Environment(Router.self) private var router

    var body: some View {
        if route.screen == "start" {
            TogetherStartSheet(preset: route.arg) { sessionID in
                TogetherNav.openSession(sessionID, router: router)
            }
        } else {
            AboutMeFlow(templateID: route.arg.isEmpty ? nil : route.arg) { prompt, social in
                TogetherNav.openAboutMeStudio(prompt: prompt, social: social, router: router)
            }
        }
    }
}

// MARK: - Copy

/// Every new user-facing string for the "together" feature, in one place so a rename is easy.
enum TogetherCopy {
    static let demoSessionID = "together-demo"

    // Kinds
    static func kindTitle(_ kind: TogetherAskKind) -> String {
        switch kind {
        case .question: return "A question"
        case .words: return "Words"
        case .scene: return "A scene"
        case .level: return "A level"
        }
    }

    static func kindSubtitle(_ kind: TogetherAskKind) -> String {
        switch kind {
        case .question: return "Trivia, one each"
        case .words: return "For a word game"
        case .scene: return "For an adventure"
        case .level: return "Describe a level"
        }
    }

    static func kindSymbol(_ kind: TogetherAskKind) -> String {
        switch kind {
        case .question: return "questionmark.bubble.fill"
        case .words: return "textformat.abc"
        case .scene: return "film.stack"
        case .level: return "flag.checkered"
        }
    }

    static func kindNoun(_ kind: TogetherAskKind) -> String {
        switch kind {
        case .question: return "a question"
        case .words: return "words"
        case .scene: return "a scene"
        case .level: return "a level idea"
        }
    }

    static func defaultTitle(_ kind: TogetherAskKind) -> String {
        switch kind {
        case .question: return "Picnic Trivia"
        case .words: return "Picnic Words"
        case .scene: return "Picnic Story"
        case .level: return "Picnic Run"
        }
    }

    static func defaultAsk(_ kind: TogetherAskKind) -> String {
        switch kind {
        case .question: return "Add a trivia question for our picnic"
        case .words: return "Add a few picnic words, one word each"
        case .scene: return "Add a scene to our picnic story"
        case .level: return "Describe a level for our picnic run"
        }
    }

    // Start sheet
    static let startTitle = "Make it together"
    static let startSubtitle = "Friends each add something. Muse stitches it into one game with everyone's name on it."
    static let whatFriendsAdd = "What friends add"
    static let gameName = "Game name"
    static let askThem = "What to ask"
    static let invite = "Invite"
    static let startButton = "Start and invite"
    static let cancel = "Cancel"
    static let noTargets = "Start a chat or join a Group to make a game together."
    static func targetSubtitle(_ kind: BubbleShareTarget.Kind, people: Int) -> String {
        switch kind {
        case .chat: return people > 1 ? "Group chat · \(people) people" : "Chat"
        case .friend: return "Friend"
        case .group: return "Group · contributions arrive as a post"
        case .feed: return "Your feed"
        case .story: return "Your story"
        }
    }

    // Cards and chat lines
    static func inviteHeadline(name: String, title: String) -> String { "\(name) started \(title)" }
    static func inviteNote(_ ask: String) -> String { "Let's make a game together! \(ask) 🫧" }
    static func addedHeadline(name: String, kind: TogetherAskKind, title: String) -> String { "\(name) added \(kindNoun(kind)) to \(title)" }
    static func addedNotification(kind: TogetherAskKind, title: String) -> String { "added \(kindNoun(kind)) to \(title). Stitch it when everyone's in." }
    static func publishedHeadline(_ title: String) -> String { "We made \(title) together" }
    static func publishedNote(_ title: String) -> String { "It's live! \(title) is ready to play 🎉" }
    static func publishedNotification(_ title: String, where place: String?) -> String {
        "made \(title) with you. It's live\(place.map { " in \($0)" } ?? "")."
    }
    static func playedHeadline(name: String, title: String, score: Int) -> String { "\(name) played \(title) · \(score)" }
    static func aboutMePlayedNotification(_ title: String, line: String?) -> String {
        "played \(title)\(line.map { ": \($0)" } ?? ""). See who knows you best."
    }
    static let addYoursButton = "Add yours"
    static let openButton = "Open"
    static let playButton = "Play"
    static let sessionGone = "This game is on another phone"
    static func addedCount(_ count: Int) -> String { count == 1 ? "1 added" : "\(count) added" }
    static let answerLabel = "Answer"
    static let questionStitched = "Stitched into the game"

    static func contributionReply(_ kind: TogetherAskKind, index: Int) -> String {
        let lines: [String]
        switch kind {
        case .question: lines = ["Added one! Bet nobody gets it 😏", "Here's mine 🧺", "One more, couldn't help it"]
        case .words: lines = ["Words are in!", "A few from me", "Okay, last ones"]
        case .scene: lines = ["Scene added 🎬", "Here's where it gets good", "And a twist"]
        case .level: lines = ["Level idea!", "Make this one hard", "Final level, trust me"]
        }
        return lines[index % lines.count]
    }

    static func playedReply(index: Int) -> String {
        let lines = ["Ha, got most of them!", "Okay that parrot one got me 🦜", "Rematch at the picnic?", "We should make another one"]
        return lines[abs(index) % lines.count]
    }

    /// Canned, original contributions friends "add" in the demo, in arrival order.
    static func cannedContributions(_ kind: TogetherAskKind) -> [String] {
        switch kind {
        case .question:
            return [
                TogetherStudio.encodeQuestion(.init(question: "Which hill has the best sunset?", answer: "Bernal Hill", decoys: ["Twin Peaks", "Tank Hill"])),
                TogetherStudio.encodeQuestion(.init(question: "Who's bringing the good bread Saturday?", answer: "Maya", decoys: ["Chloe", "Priya", "Diego"])),
                TogetherStudio.encodeQuestion(.init(question: "Which hill has the wild parrots?", answer: "Telegraph Hill", decoys: ["Russian Hill", "Nob Hill"])),
            ]
        case .words:
            return ["BLANKET (what we all sit on), LEMONADE", "FRISBEE (never leaves home without one), SUNHAT", "GRAPES, SOURDOUGH (the good bread)"]
        case .scene:
            return [
                "The fog rolls in right as the blankets go down. Stay put or race uphill to the sun?",
                "A dog grabs the sourdough and sprints toward the fountain.",
                "The sun breaks through and the whole park cheers.",
            ]
        case .level:
            return [
                "Run up the park's big hill while frisbees fly past",
                "Catch falling grapes before the fog hides them",
                "Golden hour finale: everything glows and speeds up",
            ]
        }
    }

    /// The Studio prompt for a stitch, with the title in quotes (Studio's offline path reads it).
    static func stitchPrompt(title: String, kind: TogetherAskKind, ask: String, friends: [String]) -> String {
        let game: String
        switch kind {
        case .question: game = "a trivia quiz"
        case .words: game = "a word guessing game"
        case .scene: game = "a short choose-your-path adventure"
        case .level: game = "a quick arcade game"
        }
        let with = friends.isEmpty ? "" : " made together with \(TogetherStudio.names(friends))"
        return "“\(title)”: \(game)\(with). We each added \(kindNoun(kind)): \(ask.lowercased())."
    }

    /// "Made by Maya, Diego and you". Pass nil for you.
    static func madeBy(_ names: [String?]) -> String {
        let others = names.compactMap { $0 }
        let includesYou = names.contains { $0 == nil }
        let list = others + (includesYou ? ["you"] : [])
        return list.isEmpty ? "" : "Made by \(TogetherStudio.names(list))"
    }

    // Session
    static func waiting(_ name: String, kind: TogetherAskKind) -> String { "\(name) is adding \(kindNoun(kind))" }
    static let noContributionsYet = "Waiting for the first contribution"
    static let noContributionsDetail = "Contributions show up here and in the chat as they arrive."
    static func inTarget(_ title: String) -> String { "In \(title)" }
    static let contributions = "Contributions"
    static let addYoursTitle = "Add yours"
    static let yourQuestion = "Your question"
    static let rightAnswer = "The right answer"
    static let wrongAnswers = "Wrong answers, comma separated (optional)"
    static let wordsPlaceholder = "BLANKET, FRISBEE (clue in parentheses)"
    static let scenePlaceholder = "What happens in your scene?"
    static let levelPlaceholder = "Describe your level"
    static let addButton = "Add"
    static let stitchButton = "Stitch with Muse"
    static let stitchHint = "Muse keeps everyone's wording and credits every maker."
    static let stitchNeedsMore = "Stitch once a friend has added something."
    static func liveTitle(_ title: String) -> String { "\(title) is live" }
    static let openGame = "Open"
    static let openChat = "Open chat"
    static func makingTogether(_ names: String) -> String { "\(names) are making this" }

    // Credits
    static let madeTogether = "Made together"
    static func gameAbout(_ name: String) -> String { "A game about \(name)" }

    // Group row
    static func groupRowTitle(_ name: String) -> String { "Make a game together with \(name)" }
    static let groupRowSubtitle = "Everyone adds a question, Muse stitches them into one game"
    static func groupSessionRow(_ title: String, count: Int) -> String { "\(title) · \(addedCount(count))" }

    // Games about me
    static let aboutMeTitle = "Games about me"
    static let aboutMeSubtitle = "Muse turns your answers into a game. Friends play it to show how well they know you."
    static func gamesAbout(_ name: String) -> String { "Games about \(name)" }
    static func whoKnowsBest(_ name: String) -> String { "Who knows \(name) best" }
    static let whoKnowsYouBest = "Who knows you best"
    static let makeAboutMe = "Make a game about me"
    static let makeAnother = "Make another"
    static let playIt = "Play it"
    static let addFriend = "Add friend"
    static let requested = "Requested"
    static let friends = "Friends"
    static func noKnowers(_ name: String, isMe: Bool) -> String {
        isMe ? "No one has played yet. Send it to friends and see who knows you best."
             : "No one has played yet. Be the first to show how well you know \(name)."
    }
    static func knowerDetail(games: Int, right: String?) -> String {
        let played = games == 1 ? "Played 1 game" : "Played \(games) games"
        return right.map { "\(played) · \($0)" } ?? played
    }
    static let usePosts = "Use my opted-in posts"
    static func usePostsDetail(_ count: Int) -> String {
        count == 0 ? "None of your posts are opted in to Bubbles yet." : "Muse may read \(count == 1 ? "1 post" : "\(count) posts") you opted in."
    }
    static let editAnything = "These are your answers. Edit anything; leave one blank to skip it."
    static let createWithMuse = "Make it with Muse"
    static let chooseTemplate = "Pick a game about you"
    static func aboutMePrompt(_ template: TogetherStudio.Template, name: String) -> String {
        "“\(template.gameTitle(name))”: a quiz about me. Friends pick my real answers."
    }
    static func templateSubtitle(_ id: String) -> String {
        switch id {
        case "first-month": return "Your first weeks here, in order"
        case "favorite-spot": return "Where you go, when and why"
        default: return "Your favorites, from food to coffee"
        }
    }
    static func templateSymbol(_ id: String) -> String {
        switch id {
        case "first-month": return "calendar"
        case "favorite-spot": return "mappin.and.ellipse"
        default: return "person.fill.questionmark"
        }
    }

    // Studio entry
    static let studioTogetherTitle = "Make it together"
    static let studioTogetherSubtitle = "Friends add, Muse stitches"
    static let studioAboutTitle = "Games about me"
    static let studioAboutSubtitle = "Friends guess your answers"
    static func stitching(_ count: Int, names: String) -> String {
        "Stitching \(count == 1 ? "1 contribution" : "\(count) contributions") from \(names)"
    }
    static func aboutMeBanner(_ templateTitle: String) -> String { "A game about you · \(templateTitle)" }
    static let aboutMeBannerDetail = "Your answers are the right ones. Muse writes the decoys."
}
