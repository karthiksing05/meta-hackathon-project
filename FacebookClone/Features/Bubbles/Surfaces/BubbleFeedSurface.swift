import Foundation

extension BubbleSurfaceHooks {
    /// Home feed posts that carry Bubbles. Called once at launch from `BubbleSurfaceHooks.install`.
    /// Authors come from the demo world when those people exist, otherwise from existing friends.
    static func installFeed(appStore: AppStore, bubbleStore: BubbleStore) {
        guard !appStore.posts.contains(where: { $0.id.hasPrefix("bubble-post-") }) else { return }

        func person(_ id: String, fallback: Int) -> User? {
            if let user = appStore.people.first(where: { $0.id == id }) { return user }
            let friends = appStore.friends
            guard !friends.isEmpty else { return nil }
            return friends[fallback % friends.count]
        }
        let group = appStore.groups.first { $0.id == BubbleDemo.groupID }
            ?? appStore.groups.first { $0.isMember }
            ?? appStore.groups.first

        struct Seed {
            let id: String
            let author: String
            let fallback: Int
            let bubble: String
            let text: String
            let score: Int?
            let minutesAgo: Double
            let inGroup: Bool
            let likes: Int
        }
        let seeds: [Seed] = [
            Seed(id: "diego-hill-hopper", author: "sf-diego-ramirez", fallback: 0, bubble: "hill-hopper",
                 text: "Shared Hill Hopper to \(group?.name ?? "my feed") ✨ Nobody has cleared Lombard yet.", score: 31,
                 minutesAgo: 22, inGroup: true, likes: 18),
            Seed(id: "chloe-fog-words", author: "sf-chloe-nguyen", fallback: 1, bubble: "newinsf-daily-fog-words",
                 text: "Got today's Fog Words in four. The fog was not helping.", score: 44,
                 minutesAgo: 95, inGroup: false, likes: 26),
            Seed(id: "maya-sourdough", author: "sf-maya-okafor", fallback: 2, bubble: "sourdough-stack",
                 text: "Scored 27 in Sourdough Stack. Beat it?", score: 27,
                 minutesAgo: 240, inGroup: false, likes: 11),
        ]

        var added: [Post] = []
        for seed in seeds {
            guard let author = person(seed.author, fallback: seed.fallback),
                  let bubble = bubbleStore.bubble(id: seed.bubble) else { continue }
            if let score = seed.score, bubbleStore.bestScore(of: author, in: bubble) == nil {
                bubble.scores.append(BubbleScore(user: author, score: score, achievedAt: Date().addingTimeInterval(-seed.minutesAgo * 60)))
            }
            let post = Post(
                id: "bubble-post-\(seed.id)",
                author: author,
                group: seed.inGroup ? group : nil,
                text: seed.text,
                createdAt: Date().addingTimeInterval(-seed.minutesAgo * 60),
                audience: .everyone,
                reactionCounts: [.like: seed.likes, .love: max(1, seed.likes / 4)],
                reactors: Array(appStore.friends.prefix(2)),
                shareCount: 1
            )
            post.bubbleID = bubble.id
            post.bubbleReplay = bubble.featuredRun?.replay
            added.append(post)
        }
        guard !added.isEmpty else { return }
        // Sit just below the top of the feed so they show up without a long scroll.
        let at = 0
        appStore.posts.insert(contentsOf: added.sorted { $0.createdAt > $1.createdAt }, at: at)
    }

    /// Floats a Bubble as a post: into `group` when given, otherwise to my feed. Pass `result` to
    /// attach the run as a Burst ("I got 42, beat it"). Returns the new post.
    @discardableResult
    static func float(_ bubble: Bubble, result: BubbleRunResult?, to group: FBGroup?, message: String, appStore: AppStore, bubbleStore: BubbleStore) -> Post? {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let text: String
        if !trimmed.isEmpty {
            text = trimmed
        } else if let result {
            text = "Scored \(result.score) in \(bubble.title). Beat it?"
        } else if let group {
            text = "Shared \(bubble.title) to \(group.name) ✨"
        } else {
            text = "Shared \(bubble.title) ✨"
        }
        let post = appStore.createPost(text: text, audience: group == nil ? .friends : .everyone, group: group)
        post.bubbleID = bubble.id
        post.bubbleReplay = result?.replay ?? bubble.featuredRun?.replay
        post.isUploading = false
        appStore.showToast(group.map { "Shared to \($0.name)" } ?? "Shared to your feed", symbol: "sparkles")
        return post
    }
}
