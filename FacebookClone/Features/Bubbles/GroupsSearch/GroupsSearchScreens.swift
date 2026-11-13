import SwiftUI

/// Screens and launch hooks for the "groups-search" feature (docs/BUBBLES.md 7.3). Owner: groups-search.
///
/// QA targets, `FB_OPEN=feature:groups-search/<screen>[/<arg>]` (with `FB_SKIP_SPLASH=1`):
///   search/<query>          Facebook Search for <query> (URL-encoded) with the Games filter selected
///   games/<groupID>         the Group page on its Games tab
///   leaderboard/<groupID>   the weekly Group leaderboard with the trophy and Most improved
///   gamenight/<groupID>     the Group's game-night entry point (nextline's "night" route)
///   challenge/<groupID>     posts "Challenge the Group" for the Daily Bubble, then opens the Group feed
///   addfriend/<groupID>     sends Maya a friend request from the board, then opens the leaderboard
enum GroupsSearchScreens {
    /// The game-night entry point for a Group, implemented by nextline.
    static func gameNightRoute(for groupID: String) -> BubbleFeatureRoute {
        BubbleFeatureRoute(.nextline, "night", groupID)
    }

    static func leaderboardRoute(for groupID: String) -> BubbleFeatureRoute {
        BubbleFeatureRoute(.groupsSearch, "leaderboard", groupID)
    }

    static func gamesRoute(for groupID: String) -> BubbleFeatureRoute {
        BubbleFeatureRoute(.groupsSearch, "games", groupID)
    }

    static func searchRoute(_ query: String) -> BubbleFeatureRoute {
        BubbleFeatureRoute(.groupsSearch, "search", query.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? query)
    }

    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "search":
            SearchView(initialQuery: route.arg.removingPercentEncoding ?? route.arg, startsOnGames: true)
        case "games":
            GroupsSearchGroupScreen(groupID: route.arg, startsOnGames: true)
        case "feed":
            GroupsSearchGroupScreen(groupID: route.arg, startsOnGames: false)
        case "leaderboard":
            GroupWeeklyBoardView(groupID: route.arg)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// A sheet over the tabs (`router.bubbleSheet`): the "Challenge the Group" picker.
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "challenge":
            GroupChallengeSheetLoader(groupID: route.arg)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        switch route.screen {
        case "gamenight":
            BubbleFeatureRouter.open(gameNightRoute(for: route.arg), router: router)
            return true
        case "challenge":
            router.bubbleSheet = route
            return true
        default:
            return false
        }
    }

    /// `FB_OPEN=feature:groups-search/...` (DEBUG): stage demo state, then open.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        let groupID = route.arg
        switch route.screen {
        case "challenge":
            guard let group = bubbleStore.resolveGroup(groupID),
                  let bubble = bubbleStore.worldDailyBubble(for: group) ?? bubbleStore.worldBubbles(in: group).first else { return false }
            GroupChallengeComposer.post(bubble: bubble, in: group, appStore: appStore, bubbleStore: bubbleStore)
            router.push(.bubbleFeature(BubbleFeatureRoute(.groupsSearch, "feed", groupID)))
            return true
        case "games", "leaderboard":
            router.push(.bubbleFeature(BubbleFeatureRoute(.groupsSearch, route.screen, groupID)))
            return true
        default:
            return false
        }
    }

    /// Once at launch.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        MainActor.assumeIsolated {
            GroupGamesStore.shared.bubbleStore = bubbleStore
        }
    }

    /// After the player records one of your runs. The weekly board reads the boards live, so
    /// there is nothing to store here.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// After Muse Studio publishes. New Group games show up in the Games tab and Search on their own.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
    }
}

/// The Group page for a route, resolved from its id (app data first, then the demo world).
struct GroupsSearchGroupScreen: View {
    let groupID: String
    let startsOnGames: Bool

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        if let group = appStore.group(id: groupID) ?? bubbleStore.resolveGroup(groupID) {
            GroupDetailView(group: group, startsOnGames: startsOnGames)
        } else {
            GroupMissingState(groupID: groupID)
        }
    }
}

/// A Group that isn't here yet: the server fetch (`resolveGroup`) is still out, so it shows
/// "Opening the Group…" first, and only then, if nothing came, Try again or your Groups.
struct GroupMissingState: View {
    let groupID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    @State private var gaveUp = false
    @State private var attempt = 0

    var body: some View {
        Group {
            if gaveUp {
                LiveDataStateView(
                    kind: .failed(GroupsSearchCopy.groupMissingDetail),
                    title: GroupsSearchCopy.groupMissing,
                    retry: {
                        gaveUp = false
                        attempt += 1
                        bubbleStore.loadGroup(id: groupID)
                    },
                    action: LiveDataStateView.Action(title: "See your Groups") { router.push(.groups) }
                )
            } else {
                LiveDataStateView(kind: .loading, title: "Opening the Group…")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FBColor.surface)
        .task(id: attempt) {
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if !Task.isCancelled { gaveUp = true }
        }
    }
}

/// Every new user-facing string for the "groups-search" feature, in one place so a rename is easy.
enum GroupsSearchCopy {
    // Games tab
    static let gamesTabTitle = "Games in this Group"
    static let groupGamesTitle = "Games made for this Group"
    static func groupGamesSubtitle(_ count: Int) -> String { count == 1 ? "1 game" : "\(count) games" }
    static func membersPlayed(_ count: Int) -> String {
        switch count {
        case 0: return "Be the first to play"
        case 1: return "1 member played"
        default: return "\(count) members played"
        }
    }
    static let noGamesTitle = "No games here yet"
    static let noGamesDetail = "Games made for this Group show up here."
    static let makeOne = "Make a game"

    // Weekly board
    static let weeklyTitle = "This week's leaderboard"
    static let weeklySubtitle = "This week · every Group game counts"
    static let pointsRule = "Each Group game this week: 1st 10 pts · 2nd 7 · 3rd 5 · 4th 3 · 5th 2 · played 1"
    static func points(_ value: Int) -> String { value == 1 ? "1 pt" : "\(value) pts" }
    static func leads(_ name: String) -> String { "\(name) leads the Group" }
    static let youLead = "You lead the Group"
    static let leaderBadge = "Top of the week"
    static func gamesPlayed(_ count: Int) -> String { count == 1 ? "1 game this week" : "\(count) games this week" }
    static let mostImproved = "Most improved"
    static func mostImprovedLine(_ name: String, _ gain: Int) -> String { "\(name) is up \(gain) pts on last week" }
    static func lastWeekChampion(_ name: String) -> String { "Last week's champion: \(name)" }
    static let seeFullBoard = "See full leaderboard"
    static let emptyBoardTitle = "Nobody's on the board yet"
    static let emptyBoardDetail = "Play any of the Group's games this week to get on it."
    static let you = "You"
    static func yourRank(_ rank: Int, _ count: Int) -> String { "You're #\(rank) of \(count)" }
    static let notOnBoard = "Play a Group game today to get on the board"
    static let addFriend = "Add friend"
    static let requested = "Requested"
    static let confirm = "Confirm"
    static let friend = "Friend"
    static func requestSentToast(_ name: String) -> String { "Friend request sent to \(name)" }
    static func up(_ places: Int) -> String { "Up \(places)" }
    static func down(_ places: Int) -> String { "Down \(places)" }
    static let new = "New"
    static let groupMissing = "Couldn't open this Group"
    static let groupMissingDetail = "It may be private, or the connection dropped."

    // Featured teaser
    static func teaser(leader: String, you: Int?) -> String {
        if let you { return "This week: \(leader) leads · you're #\(you)" }
        return "This week: \(leader) leads · jump in"
    }
    static func teaserYouLead(_ second: String?) -> String {
        if let second { return "This week: you lead · \(second) is close behind" }
        return "This week: you lead the Group"
    }

    // Challenge the Group
    static let challengeTitle = "Challenge the Group"
    static let challengeDetail = "Post a game to the Group feed. Everyone plays the same round and the board fills up live."
    static let challengeButton = "Challenge the Group"
    static let challengePickerTitle = "Pick a game for the Group"
    static let challengePickerSubtitle = "Everyone plays the same round, so it's a fair fight."
    static let challengeSend = "Post challenge"
    static let cancel = "Cancel"
    static let todaysDaily = "Today's Daily"
    static func challengeHeadline(_ title: String) -> String { "Group challenge: who tops \(title)?" }
    static func challengeNote(_ title: String, _ myScore: Int?, _ groupName: String) -> String {
        if let myScore {
            return "Challenge the Group 🏆 I put up \(myScore) in \(title). Who can beat it? Same round for everyone in \(groupName)."
        }
        return "Challenge the Group 🏆 Let's see who tops \(title) this week. Same round for everyone in \(groupName)."
    }
    static func challengePosted(_ groupName: String) -> String { "Challenge posted to \(groupName)" }
    static let challengeLive = "Your challenge is live in the Group feed"
    static let viewPost = "View post"

    // Game night

    // Daily
    static let dailyTitle = "Today's Daily \(ProductName.singular)"

    // Search
    static let gamesFilter = "Games"
    static let gamesSection = "Games"
    static let play = "Play"
    static func friendsPlayed(_ count: Int) -> String { count == 1 ? "1 friend played" : "\(count) friends played" }
    static func playersCount(_ count: Int) -> String { count == 1 ? "1 player" : "\(count.withCommas) players" }
    static func by(_ name: String) -> String { "by \(name)" }
    static func inGroup(_ name: String) -> String { "in \(name)" }
    static func personGames(_ firstName: String) -> String { "\(firstName)'s games" }
    static let yourGames = "Your games"
    static func makeWithMuse(_ query: String) -> String { "Make \u{201C}\(query)\u{201D} with Muse" }
    static let makeWithMuseDetail = "No game like that yet. Describe it and Muse builds it in a few minutes."
    static func noGames(_ query: String) -> String { "No games for \u{201C}\(query)\u{201D}" }
    static func playA11y(_ title: String) -> String { "Play \(title)" }
    static let openGameHint = "Opens the game's page"

    // VoiceOver (weekly board)
    static func leaderA11y(_ line: String, _ points: Int) -> String { "Trophy. \(line) with \(points) points" }
    static func rowA11y(_ rank: Int, _ name: String, _ points: Int) -> String { "Number \(rank), \(name), \(points) points" }
    static func confirmA11y(_ name: String) -> String { "Confirm \(name)" }
    static func addFriendA11y(_ name: String) -> String { "Add \(name) as a friend" }
    static func saveA11y(_ title: String, _ saved: Bool) -> String { saved ? "Remove \(title) from saved" : "Save \(title)" }
}
