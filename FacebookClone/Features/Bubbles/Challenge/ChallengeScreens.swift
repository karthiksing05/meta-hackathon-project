import SwiftUI

/// Screens and launch hooks for the "challenge" feature (docs/BUBBLES.md 7.2). Owner: challenge.
///
/// QA targets, `FB_OPEN=feature:challenge/<screen>[/<arg>]` (with `FB_SKIP_SPLASH=1`):
///   picker/<bubbleID>      the Challenge Me picker (friends, recent chats, Groups) with the preview
///                          card, using your best score (or a staged 34)
///   chat/<bubbleID>        stages a challenge from you to Maya and opens your chat; her bot score
///                          lands about 4 s later, with a notification
///   h2h/<bubbleID>         the head-to-head result for a staged finished challenge (You 45, Maya 41)
///   groupchat/<bubbleID>   starts a session in 'New in SF crew' and opens it; the card fills in
///                          over about 20 s
///   rivalry/<userID>       that person's profile, with the rivalry line and Challenge button
///   friend/<userID>        the "pick a game" sheet for challenging that person
///
/// Routes it opens at runtime: `chat/<challengeOrSessionID>` (notification taps), `h2h/<challengeID>`.
enum ChallengeScreens {
    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "h2h":
            ChallengeHeadToHeadView(challengeID: route.arg)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "picker":
            ChallengePickerSheet(bubbleID: route.arg, draft: nil)
        case "friend":
            ChallengeGamePickerSheet(userID: route.arg)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        let center = ChallengeCenter.shared
        switch route.screen {
        case "picker", "friend":
            router.bubbleSheet = route
            return true
        case "chat":
            if let chat = center.conversation(for: route.arg) {
                router.openChat(chat)
                return true
            }
            if let session = center.session(route.arg), let groupID = session.groupID,
               let group = center.appStore?.group(id: groupID) {
                router.push(.group(group))
                return true
            }
            if let appStore = center.appStore, let bubbleStore = center.bubbleStore {
                // A person id: your 1:1 chat with them.
                let person = bubbleStore.resolvePerson(route.arg)
                if !person.isMe {
                    router.openChat(appStore.conversation(with: person))
                    return true
                }
            }
            return false
        case "rivalry":
            guard let bubbleStore = center.bubbleStore else { return false }
            let person = bubbleStore.resolvePerson(route.arg)
            router.push(.profile(person))
            return true
        default:
            return false
        }
    }

    /// `FB_OPEN=feature:challenge/...` (DEBUG): stage demo state, then open.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        #if DEBUG
        let center = ChallengeCenter.shared
        center.install(appStore: appStore, bubbleStore: bubbleStore)
        let bubble = bubbleStore.bubble(id: route.arg)
        switch route.screen {
        case "picker":
            router.bubbleSheet = route
            return true
        case "chat":
            guard let bubble, let chat = center.stageChallengeToRival(on: bubble) else { return false }
            router.openChat(chat)
            return true
        case "h2h":
            guard let bubble, let id = center.stageFinishedChallenge(on: bubble) else { return false }
            router.push(.bubbleFeature(BubbleFeatureRoute(.challenge, "h2h", id)))
            return true
        case "groupchat":
            guard let bubble, let chat = center.stageGroupChatSession(on: bubble) else { return false }
            router.openChat(chat)
            return true
        default:
            return false
        }
        #else
        return false
        #endif
    }

    /// Once at launch, after `BubbleSocialCast.install`: Maya's chat, a finished session in New in
    /// SF crew, rivalry history. Runs on the main thread (from the app's init).
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        MainActor.assumeIsolated {
            ChallengeCenter.shared.install(appStore: appStore, bubbleStore: bubbleStore)
        }
    }

    /// After the player records one of your runs: challenge and session plays count here.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
        ChallengeCenter.shared.didFinish(score, in: bubble, request: request)
    }

    /// After Muse Studio publishes new Bubbles. Challenge plays existing Bubbles as they are.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
    }
}

/// Every new user-facing string for the "challenge" feature, in one place so a rename is easy.
enum ChallengeCopy {
    // Buttons and titles
    static let challengeMe = "Challenge Me"
    static let challengeBack = "Challenge back"
    static let challenge = "Challenge"
    static let challengeAFriend = "Challenge a friend"
    static let rematch = "Rematch"
    static let openChat = "Open chat"
    static let backToChat = "Back to the chat"
    static let play = "Play"
    static let playAgain = "Play again"
    static let send = "Send"
    static let sent = "Sent"
    static let cancel = "Cancel"
    static let done = "Done"
    static let pickerTitle = "Challenge Me"
    static let gamePickerTitle = "Pick a game"
    static let friends = "Friends"
    static let recentChats = "Recent chats"
    static let yourGroups = "Your Groups"
    static let sameSeedNote = "Same course, same rules. Every score is a real, replayable run."
    static let couldNotSend = "Couldn't send the challenge right now"
    static let rematchNote = "Rematch! New course 🔁"
    static let groupNote = "Same course for everyone. Who's on top? 🏁"
    static let pastSessionNote = "Fog Drift showdown. Same course for all of us 🌫️"
    static let headToHeadTitle = "Head to head"
    static func watchRun(_ name: String) -> String { "Watch \(name)'s run" }
    static func addFriend(_ name: String) -> String { "Add \(name) as a friend" }
    static let requestSent = "Friend request sent"
    static let gamesYouPlayed = "Games you've played"
    static let tryThese = "Haven't played these yet"
    static let tryTheseNote = "They play first, then it's your turn."
    static let noGames = "No games yet"
    static let noGamesNote = "Play \(ProductName.withArticle), then challenge your friends to beat you."
    static let verified = "Verified run"
    static let sameCourseChip = "Same course"
    static let waiting = "Waiting…"
    static let yourTurnShort = "Your turn"
    static let challengeAFriendNote = "Same course, head to head"
    static let you = "You"
    static let versus = "vs"
    static let winner = "Winner"
    static let bubbleGone = "This \(ProductName.singular) didn't load"
    static let bubbleGoneNote = "It isn't available anymore."
    static let challengeSentShort = "Challenge sent"
    static let challengeMeHint = "Send this run to a friend, a chat or a Group to beat on the same course"
    static func challengeName(_ name: String) -> String { "Challenge \(name)" }
    static func challengeToGame(_ name: String) -> String { "Challenge \(name) to a game" }
    static func challengeIn(_ name: String, _ title: String) -> String { "Challenge \(name) in \(title)" }
    static func sentTo(_ title: String) -> String { "Sent to \(title)" }
    static func sendChallengeTo(_ title: String) -> String { "Send challenge to \(title)" }
    static func previewLabel(_ text: String) -> String { "Preview: \(text)" }
    static func scoreLabel(_ name: String, _ score: Int) -> String { "\(name): \(score.withCommas)" }
    static func waitingNames(_ names: [String]) -> String { "\(waiting) \(names.joined(separator: ", "))" }

    static let rivalIntro = [
        "Hey! Maya from New in SF 👋 Loved your picnic idea",
        "Also heard you're good at Hill Hopper… prove it? 😄",
    ]

    // Headlines
    static func beatMy(_ score: Int, in title: String) -> String { "Beat my \(score.withCommas) in \(title)" }
    static func canYouBeatMe(_ title: String) -> String { "Can you beat me in \(title)?" }
    static func sameCourse(_ title: String) -> String { "\(title): same course for everyone" }
    static func rematchHeadline(_ title: String) -> String { "Rematch! New course in \(title)" }

    static func headToHead(mine: Int, name: String, theirs: Int?) -> String {
        guard let theirs else { return "You \(mine.withCommas) · \(name) is up next" }
        return "You \(mine.withCommas) · \(name) \(theirs.withCommas)"
    }

    static func replyHeadline(_ score: Int, mine: Int?) -> String {
        guard let mine else { return "\(score.withCommas). Your move! 👀" }
        if score > mine { return "\(score.withCommas) 💪 your move" }
        if score == mine { return "\(score.withCommas)! A tie?! 😮" }
        return "\(score.withCommas). Okay, you win this one 😅"
    }

    // Notifications and toasts
    static func opponentNote(score: Int, mine: Int?, bubble: String) -> String {
        guard let mine else { return "played your \(bubble) challenge: \(score.withCommas). Your turn!" }
        if score > mine { return "beat your \(mine.withCommas) with \(score.withCommas) in \(bubble). Rematch?" }
        return "played your \(bubble) challenge: \(score.withCommas)."
    }

    static func opponentToast(name: String, score: Int, mine: Int?) -> String {
        guard let mine else { return "\(name) played: \(score.withCommas). Your turn!" }
        if score > mine { return "\(name) beat your \(mine.withCommas) with \(score.withCommas). Rematch?" }
        return "\(name) played your challenge: \(score.withCommas)"
    }

    static func sentToast(_ name: String) -> String { "Challenge sent to \(name)" }
    static func rematchSent(_ name: String) -> String { "Rematch sent to \(name)" }
    static func everyonePlayedNote(_ chat: String, bubble: String) -> String { "played \(bubble) in \(chat). Everyone's in but you. Your turn!" }
    static func yourTurnToast(_ chat: String) -> String { "Your turn in \(chat)" }

    // Banter
    static func rivalConcedes(round: Int) -> String {
        round == 0 ? "Okay okay, you got me 😤 Rematch soon?" : "Fine, you're on a roll. Again tomorrow?"
    }
    static func cheer(_ winner: String) -> String { "GG \(winner) 👏 rematch?" }
    static func cheerYou(_ me: String) -> String { "\(me) takes it! 🏆 rematch?" }

    // Player banner
    static func beat(_ name: String, _ score: Int) -> String { "Beat \(name)'s \(score.withCommas)" }
    static func ahead(of name: String) -> String { "Ahead of \(name)!" }
    static func playingAgainst(_ name: String) -> String { "Same course as \(name)" }

    // Head to head
    static func youWin(_ name: String) -> String { "You win! You beat \(name)" }
    static func theyWin(_ name: String) -> String { "\(name) wins this round" }
    static let tie = "It's a tie"
    static func waitingFor(_ name: String) -> String { "Waiting for \(name) to play…" }
    static func yourMove(_ name: String) -> String { "\(name) played. Your move" }

    // Sessions
    static func playedCount(_ played: Int, of members: Int) -> String { "\(played) of \(members) played" }
    static func yourTurn(_ name: String) -> String { "Your turn, \(name)" }
    static func winnerLine(_ name: String, _ score: Int) -> String { "🏆 \(name) wins with \(score.withCommas)" }
    static func youWonSession(_ score: Int) -> String { "🏆 You win with \(score.withCommas)" }
    static func rankLine(_ rank: Int, of count: Int, in title: String) -> String { "You're \(ordinal(rank)) of \(count) in \(title)" }
    static func challengeTheGroup(_ name: String) -> String { "Challenge \(name)" }

    // Rivalry
    static func rivalry(_ name: String, wins: Int, losses: Int) -> String { "You vs \(name): \(wins)-\(losses) this week" }
    static func noRivalry(_ name: String) -> String { "No games with \(name) yet. Start a friendly rivalry" }
    static func rivalryLead(_ name: String, wins: Int, losses: Int) -> String {
        if wins > losses { return "You lead" }
        if losses > wins { return "\(name) leads" }
        return "All square"
    }
    static func historyRow(_ outcome: ChallengeOutcome, mine: Int, theirs: Int) -> String {
        let label: String
        switch outcome {
        case .won: label = "Won"
        case .lost: label = "Lost"
        case .tied: label = "Tied"
        }
        return "\(label) \(mine.withCommas)–\(theirs.withCommas)"
    }
    static let today = "Today"
    static func daysAgo(_ days: Int) -> String { days <= 1 ? "Yesterday" : "\(days) days ago" }

    // Picker
    static func preview(_ score: Int?, title: String) -> String { score.map { beatMy($0, in: title) } ?? canYouBeatMe(title) }
    static func members(_ count: Int) -> String { "\(count) people" }
    static func groupMembers(_ count: Int) -> String { "Group · \(count.withCommas) members" }
    static let friendSubtitle = "Friend"
    static let chatSubtitle = "Messenger"
    static func yourBest(_ score: Int) -> String { "Your best: \(score.withCommas)" }
    static func leads(_ name: String, _ theirs: Int, _ mine: Int) -> String { "\(name) leads \(theirs.withCommas)–\(mine.withCommas)" }
    static func youLead(_ name: String, _ mine: Int, _ theirs: Int) -> String { "You lead \(name) \(mine.withCommas)–\(theirs.withCommas)" }

    static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 10, n % 100) {
        case (_, 11...13): suffix = "th"
        case (1, _): suffix = "st"
        case (2, _): suffix = "nd"
        case (3, _): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }
}
