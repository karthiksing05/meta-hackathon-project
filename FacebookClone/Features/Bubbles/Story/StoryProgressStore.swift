import Foundation
import Observation

// The app side of adventures (docs/BUBBLES.md 7.6): the story graph read from a manifest, the
// run tag a story kit reports ("ending=golden-hour;first=stairs;found=2/4;path=1.0.0.0"), the
// endings you've found (kept across launches), friends' paths (real bot runs on the same story),
// and sending your path to a chat or the Group.

/// One story Bubble's graph, read from its manifest the same way bubble-kit-story.js reads it.
struct StoryAdventure {
    struct Choice: Hashable {
        var index: Int
        var id: String
        var text: String
        var past: String
        var to: String
        var miss: String?
        var isSkill: Bool
        var needsFlag: Bool

        /// "took the ferry", or "chose “Walk it”" when the story gives no past tense.
        var pastTense: String {
            past.isEmpty ? StoryCopy.chose(text) : past
        }
    }

    struct Scene {
        var id: String
        var text: String
        var emoji: String
        var choices: [Choice]
        var ending: Ending?
    }

    struct Ending: Identifiable, Hashable {
        var id: String
        var sceneID: String
        var title: String
        var emoji: String
        var tone: String
        /// 1-based, in content order ("Ending 2 of 4").
        var number: Int

        var isSecret: Bool { tone == "secret" }
    }

    let start: String
    let scenes: [String: Scene]
    let endings: [Ending]

    init?(_ manifest: BubbleManifest) {
        guard manifest.formula == .story else { return nil }
        let content = manifest.content
        var scenes: [String: Scene] = [:]
        var endings: [Ending] = []
        var order: [String] = []
        for raw in content["scenes"]?.array ?? [] {
            guard let id = raw["id"]?.string, !id.isEmpty, scenes[id] == nil else { continue }
            var scene = Scene(id: id, text: raw["text"]?.string ?? "", emoji: raw["emoji"]?.string ?? "", choices: [], ending: nil)
            if let ending = raw["ending"], ending.object != nil {
                let item = Ending(
                    id: ending["id"]?.string ?? id,
                    sceneID: id,
                    title: ending["title"]?.string ?? StoryCopy.theEnd,
                    emoji: ending["emoji"]?.string ?? (scene.emoji.isEmpty ? "✨" : scene.emoji),
                    tone: ending["tone"]?.string ?? "good",
                    number: endings.count + 1
                )
                scene.ending = item
                endings.append(item)
            } else {
                var seen = Set<String>()
                for (k, choice) in (raw["choices"]?.array ?? []).enumerated() where scene.choices.count < 3 {
                    guard let text = choice["text"]?.string, let to = choice["to"]?.string else { continue }
                    var choiceID = choice["id"]?.string.map { String($0.prefix(24)) } ?? Self.slug(text)
                    if seen.contains(choiceID) { choiceID = String(choiceID.prefix(22)) + "-\(k + 1)" }
                    seen.insert(choiceID)
                    scene.choices.append(Choice(
                        index: k,
                        id: choiceID,
                        text: text,
                        past: choice["past"]?.string ?? "",
                        to: to,
                        miss: choice["skill"]?["miss"]?.string,
                        isSkill: choice["skill"]?.object != nil,
                        needsFlag: !(choice["need"]?.strings ?? []).isEmpty
                    ))
                }
            }
            scenes[id] = scene
            order.append(id)
        }
        guard !endings.isEmpty else { return nil }
        let startID = content["start"]?.string ?? ""
        self.start = scenes[startID] != nil ? startID : (order.first ?? "")
        self.scenes = scenes
        self.endings = endings
    }

    func ending(id: String?) -> Ending? {
        endings.first { $0.id == id }
    }

    /// A choice of the opening scene, by id (the tag's `first`).
    func firstChoice(id: String?) -> Choice? {
        scenes[start]?.choices.first { $0.id == id }
    }

    /// The choices a run took, in order, from its tag's path. A missed timing tap follows the
    /// choice's `miss` scene, like the kit.
    func choices(along tag: StoryRunTag) -> [Choice] {
        var out: [Choice] = []
        var scene = scenes[start]
        for step in tag.path {
            guard let current = scene, let choice = current.choices.first(where: { $0.index == step.index }) else { break }
            out.append(choice)
            scene = scenes[step.missed ? (choice.miss ?? choice.to) : choice.to]
        }
        return out
    }

    /// The kit's default choice id: a slug of the text.
    static func slug(_ text: String) -> String {
        var out = ""
        var dash = false
        for scalar in text.lowercased().unicodeScalars {
            let isWord = (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9")
            if isWord {
                out.unicodeScalars.append(scalar)
                dash = false
            } else if !dash && !out.isEmpty {
                out.append("-")
                dash = true
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out.isEmpty ? "choice" : String(out.prefix(24))
    }
}

/// A story run's result tag (docs/BUBBLES.md 7.6): `ending=<id>;first=<choice id>;found=<n>/<m>;path=<steps>`.
struct StoryRunTag: Hashable, Codable {
    struct Step: Hashable, Codable {
        var index: Int
        /// A missed timing tap (the kit took the choice's `miss` scene).
        var missed: Bool
    }

    var ending: String
    var first: String
    /// This ending's number and the story's ending count ("Ending 2 of 4").
    var number: Int
    var total: Int
    var path: [Step]

    init?(_ tag: String?) {
        guard let tag, !tag.isEmpty else { return nil }
        var fields: [String: String] = [:]
        for pair in tag.split(separator: ";") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 { fields[parts[0]] = parts[1] }
        }
        guard let ending = fields["ending"], !ending.isEmpty else { return nil }
        self.ending = ending
        self.first = fields["first"] ?? ""
        let found = (fields["found"] ?? "").split(separator: "/").compactMap { Int($0) }
        self.number = found.first ?? 0
        self.total = found.count > 1 ? found[1] : 0
        self.path = (fields["path"] ?? "").split(separator: ".").compactMap { raw in
            let missed = raw.hasSuffix("x")
            guard let index = Int(missed ? raw.dropLast() : raw) else { return nil }
            return Step(index: index, missed: missed)
        }
    }
}

/// A friend's run of a story: a real bot run on the same story, with its tag.
struct StoryFriendPath: Identifiable {
    let user: User
    let tag: StoryRunTag
    let score: Int
    var id: String { user.id }
}

/// Your latest run of a story, for "Send your path".
struct StoryMyRun: Codable, Hashable {
    var tag: String
    var score: Int
    var seed: Int?
    var length: BubbleLength?
}

/// Endings found, your latest path and friends' paths, per story Bubble. The one source of story
/// state for every story screen.
@MainActor
@Observable
final class StoryProgressStore {
    static let shared = StoryProgressStore()

    /// Bubble id → ending ids you've found.
    private(set) var found: [String: [String]] = [:]
    /// Bubble id → your latest run.
    private(set) var latest: [String: StoryMyRun] = [:]
    /// Bubble id → friends' paths, cached for the session.
    private(set) var friends: [String: [StoryFriendPath]] = [:]
    private(set) var loadingFriends: Set<String> = []
    /// Card ids → share targets already sent this session ("Sent" in the sheet).
    private(set) var sentTargets: [String: Set<String>] = [:]

    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private let storageKey = "bubbles.story.progress.v1"

    private struct Saved: Codable {
        var found: [String: [String]]
        var latest: [String: StoryMyRun]
    }

    private init() {
        if let data = defaults.data(forKey: storageKey), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            found = saved.found
            latest = saved.latest
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(Saved(found: found, latest: latest)) {
            defaults.set(data, forKey: storageKey)
        }
    }

    // MARK: Your progress

    func foundEndings(_ bubbleID: String) -> Set<String> {
        Set(found[bubbleID] ?? [])
    }

    func latestTag(_ bubbleID: String) -> StoryRunTag? {
        StoryRunTag(latest[bubbleID]?.tag)
    }

    /// After you finish a story run (`StoryScreens.didFinish`): the ending joins your found endings.
    func record(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest) {
        record(tag: score.share?.tag, score: score.score, in: bubble, request: request)
    }

    /// The same from a result sheet (the Bubbles tab plays without the player). Idempotent.
    func record(_ result: BubbleRunResult, in bubble: Bubble, request: BubblePlayRequest?) {
        record(tag: result.share.tag, score: result.score, in: bubble, request: request)
    }

    private func record(tag raw: String?, score: Int, in bubble: Bubble, request: BubblePlayRequest?) {
        guard bubble.formula == .story, let raw, let tag = StoryRunTag(raw) else { return }
        var list = found[bubble.id] ?? []
        if !list.contains(tag.ending) { list.append(tag.ending) }
        let run = StoryMyRun(tag: raw, score: score, seed: request?.seed, length: request?.length)
        guard found[bubble.id] != list || latest[bubble.id] != run else { return }
        found[bubble.id] = list
        latest[bubble.id] = run
        persist()
        // Friends' paths loaded before this run (the Bubble page, the endings screen) were picked
        // without knowing your path. If none of them took the other path from you, drop them so
        // the next load picks again and the "Maya took the ferry" moment shows.
        if let cached = friends[bubble.id], !loadingFriends.contains(bubble.id),
           !cached.contains(where: { $0.tag.first != tag.first }) {
            friends[bubble.id] = nil
        }
    }

    #if DEBUG
    /// FB_OPEN staging: a path for you from a real bot run, so the send-path sheet has something to
    /// send. Never recorded as a score.
    func stageDebugRun(_ raw: String, score: Int, in bubbleID: String) {
        guard let tag = StoryRunTag(raw) else { return }
        var list = found[bubbleID] ?? []
        if !list.contains(tag.ending) { list.append(tag.ending) }
        found[bubbleID] = list
        latest[bubbleID] = StoryMyRun(tag: raw, score: score, seed: nil, length: nil)
    }
    #endif

    // MARK: Friends' paths

    /// Who plays the other side: the default rival (Maya), then friends and New in SF crew members.
    static let friendIDs = [BubbleSocialCast.rivalID, "sf-diego-ramirez", "sf-chloe-nguyen"]

    /// Loads friends' paths once per Bubble: each friend's run is a real bot run of this story.
    /// The runs are chosen to show the range (someone who took the other path, someone who found
    /// a secret ending) and arrive one by one, so it feels live.
    func loadFriends(for bubble: Bubble, bubbleStore: BubbleStore) {
        guard bubble.formula == .story, friends[bubble.id] == nil, !loadingFriends.contains(bubble.id),
              let story = StoryAdventure(bubble.manifest) else { return }
        loadingFriends.insert(bubble.id)
        let myFirst = latestTag(bubble.id)?.first
        let people = Self.friendIDs.map { bubbleStore.resolvePerson($0) }.filter { !$0.isMe }
        // What each friend's run should show, in order: Maya took the other path from you, Diego
        // found a secret ending, Chloe found an ending nobody has shown yet.
        let wishes: [(StoryRunTag, [StoryFriendPath]) -> Bool] = [
            { tag, _ in myFirst == nil || tag.first != myFirst },
            { tag, _ in story.ending(id: tag.ending)?.isSecret == true },
            { tag, shown in !shown.contains { $0.tag.ending == tag.ending } },
        ]
        let skills = [0.8, 0.95, 0.55]
        let tries = 8

        func next(_ personIndex: Int, _ shown: [StoryFriendPath]) {
            guard personIndex < people.count else {
                loadingFriends.remove(bubble.id)
                friends[bubble.id] = shown
                return
            }
            let user = people[personIndex]
            let wish = wishes[min(personIndex, wishes.count - 1)]
            let base = Int(truncatingIfNeeded: StoryStudio.hash("story|\(user.id)|\(bubble.id)") & 0x3FFF_FFFF)
            var first: StoryFriendPath?
            func attempt(_ index: Int) {
                bubbleStore.simulateRun(of: user, on: bubble, manifest: bubble.manifest, skill: skills[min(personIndex, skills.count - 1)], botSeed: base + index * 7919) { [weak self] score in
                    guard let self else { return }
                    let path = StoryRunTag(score.share?.tag).map { StoryFriendPath(user: user, tag: $0, score: score.score) }
                    if first == nil { first = path }
                    if let path, wish(path.tag, shown) {
                        self.deliver(shown + [path], of: bubble.id) { next(personIndex + 1, shown + [path]) }
                    } else if index + 1 < tries {
                        attempt(index + 1)
                    } else if let first {
                        self.deliver(shown + [first], of: bubble.id) { next(personIndex + 1, shown + [first]) }
                    } else {
                        next(personIndex + 1, shown)
                    }
                }
            }
            attempt(0)
        }
        next(0, [])
    }

    /// Shows friends' paths so far, after a short beat, so each one arrives like a reply.
    private func deliver(_ paths: [StoryFriendPath], of bubbleID: String, then: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            guard let self else { return }
            self.friends[bubbleID] = paths
            then()
        }
    }

    // MARK: Sending your path

    /// The `.storyPath` card for your latest run (nil before you've played).
    func pathCard(for bubble: Bubble, appStore: AppStore) -> BubbleChatCard? {
        guard let run = latest[bubble.id], let tag = StoryRunTag(run.tag), let story = StoryAdventure(bubble.manifest) else { return nil }
        let choices = story.choices(along: tag)
        let first = choices.first?.pastTense ?? StoryCopy.foundAnEnding
        return BubbleChatCard(
            kind: .storyPath,
            bubbleID: bubble.id,
            seed: run.seed,
            length: run.length,
            fromUserID: appStore.me.id,
            headline: StoryCopy.cardHeadline(name: appStore.me.firstName, past: first),
            score: run.score,
            extras: [
                "ending_id": .string(tag.ending),
                "path_choices": .array(choices.map { .string($0.text) }),
                "found": .number(Double(foundEndings(bubble.id).count)),
            ]
        )
    }

    /// Sends your path to a chat, a friend or a Group, and reports the moment (`.storyPathShared`).
    /// A friend in the chat answers a few seconds later with their own path.
    @discardableResult
    func sendPath(of bubble: Bubble, to target: BubbleShareTarget, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        guard let card = pathCard(for: bubble, appStore: appStore) else { return false }
        guard BubbleSocialHub.send(card, to: target, appStore: appStore, bubbleStore: bubbleStore) else { return false }
        sentTargets[bubble.id, default: []].insert(target.id)
        let chat = BubbleSocialHub.conversation(for: target, appStore: appStore, bubbleStore: bubbleStore)
        let recipients: [String]
        switch target.kind {
        case .friend: recipients = [target.targetID]
        case .chat: recipients = chat?.participants.filter { !$0.isMe }.map(\.id) ?? []
        case .group: recipients = target.targetID == BubbleDemo.groupID ? BubbleSocialCast.groupMembers(bubbleStore).map(\.id) : []
        case .feed, .story: recipients = []
        }
        BubbleSocialSignals.post(.storyPathShared, bubbleID: bubble.id, with: recipients.filter { $0 != appStore.me.id })
        if let chat {
            answer(in: chat, about: bubble, appStore: appStore, bubbleStore: bubbleStore)
        }
        return true
    }

    func wasSent(_ bubbleID: String, to target: BubbleShareTarget) -> Bool {
        sentTargets[bubbleID]?.contains(target.id) ?? false
    }

    /// Someone in the chat plays it (a real bot run) and sends their own path back.
    private func answer(in chat: Conversation, about bubble: Bubble, appStore: AppStore, bubbleStore: BubbleStore) {
        guard let friend = chat.participants.first(where: { !$0.isMe }), let story = StoryAdventure(bubble.manifest) else { return }
        let myFirst = latestTag(bubble.id)?.first
        let base = Int(truncatingIfNeeded: StoryStudio.hash("reply|\(friend.id)|\(bubble.id)") & 0x3FFF_FFFF)
        func attempt(_ index: Int) {
            bubbleStore.simulateRun(of: friend, on: bubble, manifest: bubble.manifest, skill: 0.8, botSeed: base + index * 104_729) { score in
                guard let tag = StoryRunTag(score.share?.tag) else { return }
                if tag.first == myFirst && index < 5 {
                    attempt(index + 1)
                    return
                }
                let choices = story.choices(along: tag)
                let reply = BubbleChatCard(
                    kind: .storyPath,
                    bubbleID: bubble.id,
                    fromUserID: friend.id,
                    headline: StoryCopy.replyHeadline(name: friend.firstName, past: choices.first?.pastTense ?? StoryCopy.foundAnEnding),
                    score: score.score,
                    extras: [
                        "ending_id": .string(tag.ending),
                        "path_choices": .array(choices.map { .string($0.text) }),
                        "found": .number(1),
                    ]
                )
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                    BubbleSocialHub.receive(reply, from: friend, in: chat, text: StoryCopy.replyNote(differentPath: tag.first != myFirst), appStore: appStore)
                }
            }
        }
        attempt(0)
    }
}
