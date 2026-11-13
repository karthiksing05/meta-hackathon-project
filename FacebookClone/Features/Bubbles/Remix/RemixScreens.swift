import Observation
import SwiftUI

/// Screens and launch hooks for the "remix" feature (docs/BUBBLES.md 7.5). Owner: remix.
///
/// QA targets, `FB_OPEN=feature:remix/<screen>[/<arg>]`:
///   tree/<bubbleID>                    the remix tree for a Bubble, friends highlighted (pushed)
///   sendback/<bubbleID>                stages the Bubble as your remix, then shows 'Send it back'
///                                      (a sheet) into the original creator's chat
///   share/<bubbleID>                   the share sheet: feed, Group, chat or Stories, always as a
///                                      playable card (a sheet)
enum RemixScreens {
    static let tree = "tree"
    static let sendBack = "sendback"
    static let share = "share"

    static func route(_ screen: String, _ bubbleID: String) -> BubbleFeatureRoute {
        BubbleFeatureRoute(.remix, screen, bubbleID)
    }

    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case tree:
            RemixTreeScreen(bubbleID: route.arg)
        default:
            // Sheets pushed by mistake still work as pages.
            RemixRouteSheet(route: route)
        }
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case tree:
            NavigationStack {
                RemixTreeScreen(bubbleID: route.arg)
            }
        default:
            RemixRouteSheet(route: route)
        }
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        switch route.screen {
        case share, sendBack:
            router.bubbleSheet = route
            return true
        default:
            return false
        }
    }

    /// `FB_OPEN=feature:remix/...` (DEBUG): stage demo state, then open.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        switch route.screen {
        case sendBack:
            // Opens on the game as the server sent it; no local copy is made to stage it.
            router.bubbleSheet = route
            return true
        case tree:
            router.push(.bubbleFeature(route))
            return true
        default:
            return false
        }
    }

    /// Once at launch. No remix notifications are made up; they come from the server's moments
    /// inbox when it exists.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// After the player records one of your runs. Nothing to do for remixes.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// After Muse Studio publishes: every remix posts the `remix` signal with the original's
    /// creator, and that creator answers in your 1:1 chat a few seconds later.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
        // A remixed Chain publishes several levels at once: credit each, but signal and reply
        // once per original creator.
        var greeted: Set<String> = []
        for bubble in bubbles where RemixLineage.isRemix(bubble) {
            if let original = RemixLineage.original(of: bubble, in: bubbleStore.bubbles),
               bubble.manifest.lineage.remixOfTitle == nil || bubble.manifest.lineage.remixOfCreatorID == nil {
                var manifest = bubble.manifest
                RemixLineage.fillCredit(&manifest, base: original, me: appStore.me)
                bubble.manifest = manifest
                bubbleStore.scheduleSave()
            }
            guard let creator = RemixLineage.originalCreator(of: bubble, store: bubbleStore),
                  creator.id != appStore.me.id,
                  greeted.insert(creator.id).inserted else { continue }
            BubbleSocialSignals.post(.remix, bubbleID: bubble.id, with: [creator.id])
            let originalTitle = bubble.manifest.lineage.remixOfTitle ?? "my game"
            RemixCenter.shared.scheduleReply(
                from: creator,
                text: RemixCopy.creatorReply(bubble.title, original: originalTitle),
                about: bubble,
                after: 4,
                notification: RemixCopy.notificationPlayedYourRemix(bubble.title),
                appStore: appStore,
                bubbleStore: bubbleStore
            )
        }
    }
}

// MARK: - State

/// Remix state for this launch: which remixes you've sent back and where you've shared.
@MainActor
@Observable
final class RemixCenter {
    static let shared = RemixCenter()

    /// Bubble ids you've sent back to their original creator.
    private(set) var sentBack: Set<String> = []
    /// "bubbleID|targetID" for every share this launch, so share rows show "Sent".
    private(set) var shared: Set<String> = []
    @ObservationIgnored private var repliesScheduled: Set<String> = []

    private init() {}

    func didShare(_ bubble: Bubble, to target: BubbleShareTarget) -> Bool {
        shared.contains("\(bubble.id)|\(target.id)")
    }

    /// The card 'Send it back' sends: "I remixed your <original> → <remix>".
    func sendBackCard(for bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) -> BubbleChatCard? {
        guard let originalID = bubble.manifest.lineage.remixOf, RemixLineage.isRemix(bubble) else { return nil }
        let originalTitle = bubble.manifest.lineage.remixOfTitle
            ?? RemixLineage.original(of: bubble, in: bubbleStore.bubbles)?.title
            ?? "game"
        return BubbleChatCard(
            id: "remix-card-\(bubble.id)-\(UUID().uuidString.prefix(6))",
            kind: .remix,
            bubbleID: bubble.id,
            seed: bubble.manifest.seed,
            length: bubble.manifest.length,
            fromUserID: appStore.me.id,
            headline: RemixCopy.cardHeadline(original: originalTitle, remix: bubble.title),
            extras: [
                RemixCardKeys.originalID: .string(originalID),
                RemixCardKeys.remixID: .string(bubble.id),
            ]
        )
    }

    /// 'Send it back': your remix lands in the original creator's chat as a playable card. Returns
    /// that chat.
    @discardableResult
    func sendBack(_ bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) -> Conversation? {
        guard let creator = RemixLineage.originalCreator(of: bubble, store: bubbleStore),
              creator.id != appStore.me.id,
              let card = sendBackCard(for: bubble, appStore: appStore, bubbleStore: bubbleStore) else { return nil }
        let target = BubbleShareTarget(kind: .friend, targetID: creator.id, title: creator.name)
        guard BubbleSocialHub.send(card, to: target, appStore: appStore, bubbleStore: bubbleStore) else { return nil }
        sentBack.insert(bubble.id)
        BubbleSocialSignals.post(.remix, bubbleID: bubble.id, with: [creator.id])
        let chat = BubbleSocialHub.conversation(for: target, appStore: appStore, bubbleStore: bubbleStore)
        scheduleReply(
            from: creator,
            text: RemixCopy.sendBackReply(bubble.title),
            about: bubble,
            after: 3,
            appStore: appStore,
            bubbleStore: bubbleStore
        )
        return chat
    }

    /// Shares a playable card to the feed, a Group or a chat, or the Bubble to your story.
    /// Posts the `share` signal with the people it reached.
    @discardableResult
    func share(
        _ bubble: Bubble,
        to target: BubbleShareTarget,
        score: Int?,
        result: BubbleRunResult?,
        request: BubblePlayRequest?,
        note: String,
        appStore: AppStore,
        bubbleStore: BubbleStore
    ) -> Bool {
        let ok: Bool
        if target.kind == .story {
            if let result {
                ok = BubbleSurfaceHooks.shareToStory(bubble, result: result, appStore: appStore, bubbleStore: bubbleStore)
            } else {
                _ = appStore.addStory(.bubble(id: bubble.id, replay: bubble.featuredRun?.replay, score: nil))
                appStore.showToast(RemixCopy.addedToStory, symbol: "checkmark.circle.fill")
                ok = true
            }
        } else {
            var extras: [String: JSONValue] = [:]
            if let score { extras[RemixCardKeys.score] = .number(Double(score)) }
            let card = BubbleChatCard(
                kind: .share,
                bubbleID: bubble.id,
                seed: request?.seed ?? bubble.manifest.seed,
                length: request?.length ?? bubble.manifest.length,
                fromUserID: appStore.me.id,
                headline: score.map { RemixCopy.shareHeadline(score: $0, title: bubble.title) } ?? RemixCopy.shareHeadline(title: bubble.title),
                score: score,
                extras: extras
            )
            let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
            ok = BubbleSocialHub.send(card, to: target, note: trimmed.isEmpty ? nil : trimmed, appStore: appStore, bubbleStore: bubbleStore)
        }
        guard ok else { return false }
        shared.insert("\(bubble.id)|\(target.id)")
        BubbleSocialSignals.post(.share, bubbleID: bubble.id, with: recipients(of: target, appStore: appStore, bubbleStore: bubbleStore))
        return true
    }

    /// Who a share reaches, by user id (never you).
    func recipients(of target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore) -> [String] {
        let me = appStore.me.id
        switch target.kind {
        case .friend:
            return target.targetID == me ? [] : [target.targetID]
        case .chat:
            let chat = appStore.conversations.first { $0.id == target.targetID }
            return (chat?.participants ?? []).map(\.id).filter { $0 != me }
        case .group:
            return (bubbleStore.serverGroups[target.targetID]?.memberSample ?? []).map(\.id).filter { $0 != me }
        case .feed, .story:
            return []
        }
    }

    /// The original creator's reply to a remix. Their replies need the server's moments inbox, so
    /// nothing is shown in their name.
    func scheduleReply(
        from user: User,
        text: String,
        about bubble: Bubble,
        after delay: TimeInterval,
        notification: String? = nil,
        appStore: AppStore,
        bubbleStore: BubbleStore
    ) {
        // The other person's reply comes from them, through the server's moments inbox (not
        // built yet). Nothing is written in their name here.
        _ = repliesScheduled.insert("\(user.id)|\(bubble.id)")
    }
}

/// `.remix` and `.share` card extras (docs/BUBBLES.md 7.5).
enum RemixCardKeys {
    /// `.remix`: the Bubble that was remixed.
    static let originalID = "original_id"
    /// `.remix`: the remix.
    static let remixID = "remix_id"
    /// `.share`: the sharer's score, when the share came from a result.
    static let score = "score"
}

// MARK: - Copy

/// Every new user-facing string for the "remix" feature, in one place so a rename is easy.
enum RemixCopy {
    // Credits
    static func credit(_ title: String, by name: String?) -> String {
        if let name, !name.isEmpty { return "Remix of \(title) by \(name)" }
        return "Remix of \(title)"
    }
    static func creditByYou(_ title: String) -> String { "Remix of your \(title)" }
    static func remixedBy(_ name: String) -> String { "Remixed by \(name)" }
    static func remixedByFrom(_ name: String, original: String) -> String { "Remixed by \(name) · from \(original)" }
    static func remixCount(_ count: Int) -> String { count == 1 ? "1 remix" : "\(count.withCommas) remixes" }

    // Actions
    static let remix = "Remix"
    static let remixIt = "Remix it"
    static let remixBack = "Remix back"
    static let share = "Share"
    static let sendItBack = "Send it back"
    static let openOriginal = "Open original"
    static let play = "Play"
    static let seeAll = "See all"
    static func sentBackTo(_ name: String) -> String { "Sent to \(name)" }
    static func sendBackTo(_ name: String) -> String { "Send it back to \(name)" }
    static func remixHint(_ title: String) -> String { "Make your own version of \(title)" }

    // Tree
    static let treeTitle = "Remixes"
    static let treeNavTitle = "Remix tree"
    static let treeEmpty = "No remixes yet. Make the first one and it shows up here, credited to you."
    static let original = "Original"
    static let you = "You"
    static let yourGame = "your game"
    static let friend = "Friend"
    static let thisOne = "You're here"
    static func more(_ count: Int) -> String { "+\(count) more" }
    static func byLine(_ name: String) -> String { "by \(name)" }
    static func treeSubtitle(_ remixes: Int, friends: Int) -> String {
        let base = remixCount(remixes)
        guard friends > 0 else { return base }
        return "\(base) · \(friends) by friends"
    }
    static let treeIntro = "Every remix credits the game it came from. Friends' remixes are ringed in blue."

    // Send it back
    static let sendBackTitle = "Send it back"
    static func sendBackBody(_ name: String, original: String) -> String {
        "\(name) made \(original). Send your remix to their chat so they can play what you made of it."
    }
    static let sendBackNotRemix = "This \(ProductName.singular) isn't a remix, so there's no one to send it back to."
    static let sendBackYourOwn = "This is a remix of your own game. Share it with friends instead."
    static let openChat = "Open chat"
    static let done = "Done"
    static let notNow = "Not now"
    static func sendBackSent(_ name: String) -> String { "Sent to \(name). They can play it right in the chat." }

    // Share
    static let shareTitle = "Share"
    static let shareSubtitle = "Everyone gets a playable card, not just a link."
    static let notePlaceholder = "Say something about it (posts only)"
    static let yourFeed = "Your feed"
    static let yourFeedSub = "Friends can play from Home"
    static let yourStory = "Your story"
    static let yourStorySub = "Friends see it for 24 hours"
    static let groups = "Groups"
    static let groupSub = "Post a playable card in the Group"
    static let chats = "Chats"
    static let friends = "Friends"
    static let send = "Send"
    static let sent = "Sent"
    static let shareFailed = "Couldn't share this right now"
    static let addedToStory = "Added to your story"
    static func sharedTo(_ title: String) -> String { "Shared to \(title)" }
    static func shareHeadline(score: Int, title: String) -> String { "Beat my \(score.withCommas) in \(title)" }
    static func shareHeadline(title: String) -> String { "Play \(title) with me" }
    static func groupChatSub(_ count: Int) -> String { "Group chat · \(count) people" }
    static let chatSub = "Chat"

    // Cards
    static func cardHeadline(original: String, remix: String) -> String { "I remixed your \(original) → \(remix)" }
    static func cardFromThem(_ name: String, original: String, remix: String) -> String {
        "\(name) remixed your \(original) → \(remix)"
    }
    static func cardFromMe(_ name: String?, original: String, remix: String) -> String {
        if let name { return "You remixed \(name)'s \(original) → \(remix)" }
        return "You remixed \(original) → \(remix)"
    }
    static let cardTag = "Remix"
    static let cardUnavailable = "This remix isn't available anymore."

    // People in the tree
    static let peopleTitle = "Remixers you might know"
    static func peopleSub(_ name: String) -> String { "\(name) remixed a game in this tree" }
    static let addFriend = "Add friend"
    static let confirm = "Confirm"
    static let requested = "Requested"
    static func addFriendLabel(_ name: String) -> String { "Add \(name) as a friend" }

    // Accessibility
    static let notFound = "\(ProductName.singular) not found"
    static let seeAllLabel = "See the whole remix tree"
    static func openOriginalLabel(_ title: String) -> String { "Open original: \(title)" }
    static let a11yMadeByYou = "made by you"
    static func a11yMadeBy(_ name: String) -> String { "made by \(name)" }
    static let a11yOriginal = "original"
    static let a11yFriend = "your friend"
    static let a11yThisOne = "this \(ProductName.singular)"
    static let a11yOpens = "Opens this \(ProductName.singular)"
    static func sentTo(_ title: String) -> String { "Sent to \(title)" }
    static func sendTo(_ title: String) -> String { "Send to \(title)" }
    static func playLabel(_ title: String?) -> String { "Play \(title ?? "the remix")" }
    static func remixBackLabel(_ title: String?) -> String { "Remix \(title ?? "it") back" }
    static func previewLabel(_ headline: String) -> String { "Preview: \(headline)" }

    // Notifications and replies
    static func notificationYourGame(_ original: String, remix: String) -> String {
        "remixed your \(original) into \(remix). See the remix tree."
    }
    static func notificationFriendsGame(_ original: String, by name: String, remix: String) -> String {
        "remixed \(name)'s \(original) into \(remix)."
    }
    static func creatorReply(_ remix: String, original: String) -> String {
        "Ha, \(remix) is so good. Love what you did with my \(original) 🙌"
    }
    static func notificationPlayedYourRemix(_ remix: String) -> String {
        "played your remix \(remix) and replied in Messenger."
    }
    static func sendBackReply(_ remix: String) -> String {
        "Just played \(remix). Okay, that's better than mine 😄 Remixing it back"
    }
}
