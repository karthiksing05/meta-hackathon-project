import SwiftUI

/// Screens and launch hooks for the "learn" feature (docs/BUBBLES.md 7.8). Owner: learn.
///
/// QA targets, `FB_OPEN=feature:learn/<screen>[/<arg>]`:
///   lesson/<bubbleID>                  a lesson Bubble's page with its mastery and friends' streaks
///   group/<groupID>                    the Group page on its Games tab, with the Group mastery meter
///   streaks                            friends' learning streaks
enum LearnScreens {
    /// A pushed screen (`Route.bubbleFeature`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        switch route.screen {
        case "lesson":
            BubbleDetailView(bubbleID: route.arg)
        case "group":
            LearnGroupDestination(groupID: route.arg)
        default:
            LearnStreaksView()
        }
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        NavigationStack {
            destination(route)
                .appDestinations()
        }
    }

    /// Opens a route (notification taps, cards). Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        if route.screen == "lesson", !route.arg.isEmpty {
            router.push(.bubble(route.arg))
            return true
        }
        return false
    }

    /// `FB_OPEN=feature:learn/...` (DEBUG): stage demo state, then open. Return false to fall back
    /// to `open`.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        false
    }

    /// Once at launch.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        MainActor.assumeIsolated {
            LearnProgressStore.shared.install()
        }
    }

    /// After the player records one of your runs.
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
        guard bubble.formula == .learn else { return }
        let tag = LearnProgressStore.shared.notePlay(bubble, tag: score.share?.tag)
        // Played from a lesson card: your mastery joins the card everyone sees.
        if let cardID = request.context?.cardID, let tag {
            BubbleSocialHub.update(cardID: cardID, appStore: appStore) { card in
                guard card.kind == .lesson else { return }
                var learners = card.extras[LearnShare.learnersKey]?.object ?? [:]
                learners[appStore.me.id] = .string(tag.text)
                card.extras[LearnShare.learnersKey] = .object(learners)
            }
        }
    }

    /// After Muse Studio publishes new Bubbles (first level first): a new Group lesson starts its
    /// members' runs, so the meter is ready when you open the Games tab.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
        for bubble in bubbles where bubble.formula == .learn {
            if let group = bubble.group {
                let progress = LearnProgressStore.shared
                _ = (progress, group)
                bubbleStore.loadScores(for: bubble)
            }
        }
    }
}

/// The Group page, opened on its Games tab (`feature:learn/group/<id>`).
private struct LearnGroupDestination: View {
    let groupID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        if let group = appStore.group(id: groupID) ?? bubbleStore.resolveGroup(groupID) {
            GroupDetailView(group: group, startsOnGames: true)
        } else {
            GroupMissingState(groupID: groupID)
        }
    }
}

// MARK: - Sharing lesson cards

/// Sends lesson cards through `BubbleSocialHub` and plays the other side: friends in a chat learn
/// it too (real bot runs on the same seed), and their results land in the chat.
@MainActor
enum LearnShare {
    // Card extras (docs/BUBBLES.md 7.8).
    static let topicKey = "topic"
    static let subjectKey = "subject"
    static let masteryKey = "mastery"
    static let groupMasteryKey = "group_mastery"
    static let groupNameKey = "group_name"
    static let learnersKey = "learners"

    /// The Group a lesson belongs to, when the server says so.
    static func group(for bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) -> FBGroup? {
        bubble.group ?? bubbleStore.resolveGroup(bubble.manifest.structure.groupID)
    }

    /// A lesson card for `bubble` with your mastery and the Group meter.
    static func card(for bubble: Bubble, tag: LearnResultTag?, seed: Int? = nil, appStore: AppStore, bubbleStore: BubbleStore) -> BubbleChatCard {
        let lesson = LearnLesson(bubble)
        var extras: [String: JSONValue] = [
            topicKey: .string(lesson.topic),
            subjectKey: .string(lesson.subject),
        ]
        if let tag {
            extras[masteryKey] = .string(tag.text)
            extras[learnersKey] = .object([appStore.me.id: .string(tag.text)])
        }
        if let group = group(for: bubble, appStore: appStore, bubbleStore: bubbleStore) {
            let meter = LearnProgressStore.shared.groupMastery(of: bubble, group: group, bubbleStore: bubbleStore)
            if meter > 0 {
                extras[groupMasteryKey] = .number((meter * 100).rounded() / 100)
                extras[groupNameKey] = .string(group.name)
            }
        }
        return BubbleChatCard(
            kind: .lesson,
            bubbleID: bubble.id,
            seed: seed ?? bubble.manifest.seed,
            fromUserID: appStore.me.id,
            headline: tag.map { LearnCopy.cardHeadline(mastery: $0.text, title: bubble.title) } ?? LearnCopy.cardInvite(bubble.title),
            sessionID: "lesson-\(bubble.id)",
            score: nil,
            extras: extras
        )
    }

    /// Sends a lesson card to a chat, friend or Group and posts `lesson_shared`. Returns false
    /// when the target can't take a card.
    @discardableResult
    static func send(_ bubble: Bubble, tag: LearnResultTag?, seed: Int? = nil, to target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        let card = card(for: bubble, tag: tag, seed: seed, appStore: appStore, bubbleStore: bubbleStore)
        guard BubbleSocialHub.send(card, to: target, note: LearnCopy.shareNote(bubble.title), appStore: appStore, bubbleStore: bubbleStore) else {
            return false
        }
        let people = audience(of: target, appStore: appStore, bubbleStore: bubbleStore)
        BubbleSocialSignals.post(.lessonShared, bubbleID: bubble.id, with: people.map(\.id))
        return true
    }

    /// Who a share reaches (never you): a chat's members, a friend, or the Group's members.
    static func audience(of target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore) -> [User] {
        switch target.kind {
        case .chat:
            return appStore.conversations.first { $0.id == target.targetID }?.participants.filter { !$0.isMe } ?? []
        case .friend:
            return [appStore.user(id: target.targetID) ?? bubbleStore.resolvePerson(target.targetID)].filter { !$0.isMe }
        case .group:
            return Array((bubbleStore.serverGroups[target.targetID]?.memberSample ?? []).filter { !$0.isMe }.prefix(10))
        case .feed, .story:
            return []
        }
    }

    /// The share targets a lesson offers first: its Group, then the group chats, then friends.
    static func targets(for bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) -> [BubbleShareTarget] {
        var out: [BubbleShareTarget] = []
        if let group = group(for: bubble, appStore: appStore, bubbleStore: bubbleStore) {
            out.append(BubbleShareTarget(kind: .group, targetID: group.id, title: group.name))
        }
        let rest = BubbleSocialHub.targets(appStore: appStore, kinds: [.chat, .friend]).filter { target in
            !out.contains { $0.id == target.id }
        }
        return out + rest.prefix(8)
    }
}

/// Every new user-facing string for the "learn" feature, in one place so a rename is easy.
enum LearnCopy {
    static let category = "Learn"
    static let learnTogether = "Learn together"
    static let learnIt = "Learn it"
    static let shareLesson = "Share lesson"
    static let mastered = "mastered"
    static let whatYouLearned = "What you learned"
    static let reviewHint = "Worth another look"
    static let youKnowIt = "You know this"
    static let friendsStreaks = "Friends' streaks"
    static let learningStreaks = "Learning streaks"
    static let seeAll = "See all"
    static let notPracticedYet = "You haven't practiced this lesson yet."
    static let yourMastery = "Your mastery"
    static let groupMissing = "Group not found"
    static let groupMissingDetail = "It may be private or gone."
    static let streaksTitle = "Learning streaks"
    static let lessonsToLearn = "Lessons to learn"
    static let noLessons = "No lessons yet"
    static let noLessonsDetail = "Turn a topic or your notes into a lesson with Muse."
    static let makeLesson = "Make a lesson"
    static let sendLesson = "Send a lesson"
    static let you = "You"
    static let sent = "Sent"
    static let topLearners = "Top learners"
    static let studioEntryTitle = "Turn a topic or notes into a lesson"
    static let studioEntrySubtitle = "Paste notes or name a topic. Muse writes a short lesson, practice questions and explanations."
    static let notesAttached = "Lesson notes attached"
    static let removeNotes = "Remove notes"
    static let notesSheetTitle = "Make a lesson"
    static let topicLabel = "Topic"
    static let topicPlaceholder = "SF's hills, Spanish greetings, the history of the cable cars…"
    static let notesLabel = "Your notes (optional)"
    static let notesHelp = "Muse uses only facts from your notes, and every question gets a short explanation."
    static let sampleNotes = "Use sample notes"
    static let sampleNotesText = """
    Twin Peaks is two summits side by side near the middle of the city.
    Lombard Street's famously crooked block winds down Russian Hill.
    Coit Tower stands on top of Telegraph Hill, above North Beach.
    Cable car lines climb up and over Nob Hill.
    """
    static let makeIt = "Make it a lesson"
    static let cancel = "Cancel"
    static let lessonCardLabel = "Lesson"
    static let countingLearners = "Checking who knows it…"

    static func groupKnows(_ group: String, percent: Int, subject: String) -> String {
        "\(group) knows \(percent)% of \(subject)"
    }

    static func acrossLessons(_ count: Int, percent: Int) -> String {
        "Across \(count) lessons: \(percent)%"
    }

    static func streakDays(_ days: Int) -> String {
        days == 1 ? "1-day streak" : "\(days)-day streak"
    }

    static func learningStreak(_ days: Int) -> String {
        days == 1 ? "1-day learning streak" : "\(days)-day learning streak"
    }

    /// Under the streak on the streaks screen: how to start or keep it.
    static func streakSubtitle(_ days: Int) -> String {
        days == 0
            ? "Finish a lesson to start a streak. Friends see it next to yours."
            : "Finish a lesson each day to keep it going. Friends see it next to yours."
    }

    static func shareWith(_ name: String) -> String { "Share with \(name)" }
    static func sendTo(_ name: String) -> String { "Send to \(name)" }
    static func sharedTo(_ name: String) -> String { "Shared to \(name)" }
    static func masteryLine(_ text: String) -> String { "\(text) mastered" }
    static func percent(_ value: Double) -> String { "\(Int((value * 100).rounded()))%" }

    static func cardHeadline(mastery: String, title: String) -> String {
        "I learned \(title): \(mastery). Learn it with me?"
    }

    static func cardInvite(_ title: String) -> String { "Learn \(title) with me" }

    static func shareNote(_ title: String) -> String { "Learning \(title) 🎓" }

    static func friendLearned(_ name: String, mastery: String, title: String) -> String {
        "\(name) learned \(title): \(mastery)"
    }

    static func friendReply(streak: Int) -> String {
        streak > 1 ? "Done! \(streak)-day streak 🔥" : "Done! Learned something new 🎓"
    }

    static func sendLessonTo(_ name: String) -> String { "Send a lesson to \(name)" }
    static func viewShared(_ name: String) -> String { "Shared · open \(name)" }
    static let sampleTopic = "SF's hills"

    static func friendsStreaksLabel(_ rows: [(String, Int)]) -> String {
        "Friends' streaks: " + rows.map { "\($0.0), \(streakDays($0.1))" }.joined(separator: "; ")
    }

    static func learnedBy(_ names: [String]) -> String {
        switch names.count {
        case 0: return ""
        case 1: return "\(names[0]) learned it"
        case 2: return "\(names[0]) and \(names[1]) learned it"
        default: return "\(names[0]), \(names[1]) and \(names.count - 2) more learned it"
        }
    }

    static func makeLessonFor(_ group: String) -> String { "Make a lesson for \(group)" }

    static func notesWords(_ count: Int) -> String { count == 1 ? "1 word" : "\(count) words" }

    static func lessonPrompt(topic: String) -> String {
        topic.isEmpty ? "Make a lesson from my notes" : "Make a lesson: \(topic)"
    }

    static func profileLearning(_ title: String, percent: String) -> String { "\(title) · \(percent)" }
}
