import Foundation

extension BubbleSurfaceHooks {
    /// Bubble notifications. Called once at launch from `BubbleSurfaceHooks.install`.
    static func installNotifications(appStore: AppStore, bubbleStore: BubbleStore) {
        guard !appStore.notifications.contains(where: { $0.id.hasPrefix("bubble-note-") }) else { return }

        func person(_ id: String, fallback: Int) -> User? {
            if let user = appStore.people.first(where: { $0.id == id }) { return user }
            let friends = appStore.friends
            return friends.isEmpty ? nil : friends[fallback % friends.count]
        }
        let groupName = appStore.groups.first { $0.id == BubbleDemo.groupID }?.name ?? "New in SF"
        let daily = appStore.groups.first { $0.id == BubbleDemo.groupID }.flatMap { bubbleStore.dailyBubble(for: $0) }
            ?? bubbleStore.bubble(id: "newinsf-daily-fog-words")
        let hop = bubbleStore.bubble(id: "hill-hopper")
        let mine = bubbleStore.bubbles.first { $0.creator.isMe }

        var rows: [AppNotification] = []
        func add(_ id: String, _ kind: NotificationKind, _ actor: User?, _ text: String, _ bubble: Bubble?, minutes: Double, group: Bool = false) {
            guard let bubble else { return }
            rows.append(AppNotification(
                id: "bubble-note-\(id)", kind: kind, actors: actor.map { [$0] } ?? [], message: text,
                createdAt: Date().addingTimeInterval(-minutes * 60), isRead: false,
                groupID: group ? BubbleDemo.groupID : nil, bubbleID: bubble.id
            ))
        }
        add("daily", .bubbleDaily, nil, "Today's Daily Bubble in \(groupName) is ready. Pop in before the fog lifts.", daily, minutes: 12)
        add("beat", .bubbleScore, person("sf-diego-ramirez", fallback: 0), "beat your score in \(hop?.title ?? "Hill Hopper"). Take it back?", hop, minutes: 48)
        add("remix", .bubbleRemix, person("sf-priya-natarajan", fallback: 1), "remixed your Bubble.", mine ?? hop, minutes: 130)
        add("played", .bubblePlayed, person("sf-jordan-brooks", fallback: 2), "played your Bubble.", mine ?? hop, minutes: 300)
        appStore.notifications.insert(contentsOf: rows, at: 0)
    }

    /// Called after I finish a run, once it is on the Board. Adds notifications such as
    /// "You passed Maya in Fog Words".
    static func didRecord(_ score: BubbleScore, in bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) {
        let board = bubbleStore.leaderboard(for: bubble, scope: .everyone)
        // Everyone ranked just below me whose best is below this run, and who was above my previous best.
        let previousBest = bubble.scores
            .filter { $0.user.isMe && $0.id != score.id }
            .map(\.score).max() ?? Int.min
        let passed = board.filter { !$0.user.isMe && $0.score < score.score && $0.score >= previousBest }
        guard let target = passed.max(by: { $0.score < $1.score }) else { return }
        let extra = passed.count - 1
        let name = target.user.firstName
        let text = extra > 0
            ? "You passed \(name) and \(extra) \(extra == 1 ? "other" : "others") in \(bubble.title)."
            : "You passed \(name) in \(bubble.title)."
        appStore.notifications.insert(AppNotification(
            kind: .bubbleScore, actors: [], message: text, isRead: false, bubbleID: bubble.id
        ), at: 0)
    }
}
