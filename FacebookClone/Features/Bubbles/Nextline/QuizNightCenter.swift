import Foundation
import Observation

// Quiz nights (docs/BUBBLES.md 7.7): a live-feeling "guess what they say next" night in a Group or
// a group chat. Everyone plays the same scenes (one seed, one length). Members' sides need the
// server to run the night (docs/APP_LIVE_DATA_PLAN.md, Stage 4); nobody's side is simulated, and
// the lobby is a server round now (QuizNightRoundsView in NextlineScreens).

/// One answered round, from a run's share tag (`r=1:1.8:1:868|...`).
struct QuizRound: Hashable, Sendable {
    /// 0-based.
    var index: Int
    /// Seconds from the freeze to the pick (the full timer on a time-out).
    var seconds: Double
    var correct: Bool
    var points: Int
}

/// Reads the nextline kit's share tag: `right=4/5;streak=3;r=1:1.8:1:868|2:8.0:0:0`.
struct QuizTag: Hashable, Sendable {
    var right: Int
    var played: Int
    var streak: Int
    var rounds: [QuizRound]

    init?(_ tag: String?) {
        guard let tag, tag.hasPrefix("right=") else { return nil }
        var right = 0, played = 0, streak = 0
        var rounds: [QuizRound] = []
        for part in tag.split(separator: ";") {
            let kv = part.split(separator: "=", maxSplits: 1).map(String.init)
            guard kv.count == 2 else { continue }
            switch kv[0] {
            case "right":
                let nums = kv[1].split(separator: "/").compactMap { Int($0) }
                if nums.count == 2 { right = nums[0]; played = nums[1] }
            case "streak":
                streak = Int(kv[1]) ?? 0
            case "r":
                for entry in kv[1].split(separator: "|") {
                    let f = entry.split(separator: ":").map(String.init)
                    guard f.count >= 3, let i = Int(f[0]), let s = Double(f[1]) else { continue }
                    rounds.append(QuizRound(index: i - 1, seconds: s, correct: f[2] == "1", points: f.count > 3 ? Int(f[3]) ?? 0 : 0))
                }
            default:
                break
            }
        }
        self.right = right
        self.played = played
        self.streak = streak
        self.rounds = rounds
    }
}

/// The kit's fixed timing (bubble-kit-nextline.js), so the app can follow a run round by round.
struct QuizTimeline: Hashable, Sendable {
    /// Seconds from the round's start to the freeze, per round.
    var scenes: [Double]
    /// Seconds to answer.
    var timer: Double
    static let leadIn = 18.0 / 60
    static let reveal = 150.0 / 60

    init(manifest: BubbleManifest, rounds: Int) {
        let episodes = manifest.content["episodes"]?.array ?? []
        var scenes: [Double] = []
        for episode in episodes.prefix(max(1, rounds)) {
            var ticks = 54.0
            for line in episode["lines"]?.array ?? [] {
                let count = Double((line["text"]?.string ?? "").utf16.count)
                ticks += (count * 1.25).rounded(.up) + 22
            }
            scenes.append(ticks / 60)
        }
        if scenes.isEmpty { scenes = Array(repeating: 7, count: max(1, rounds)) }
        self.scenes = scenes
        let rule = manifest.concepts.first { $0.use == "rule.next_line" }
        timer = min(15, max(4, rule?.params?["round_seconds"]?.double ?? 8))
    }

    struct Beat: Hashable {
        var start: Double
        var freeze: Double
        var answer: Double
        var end: Double
    }

    /// Each round's beats for a player who took `answers[k]` seconds to answer round k.
    func beats(answers: (Int) -> Double) -> [Beat] {
        var t = Self.leadIn
        var out: [Beat] = []
        for (k, scene) in scenes.enumerated() {
            let freeze = t + scene
            let answer = freeze + min(timer, max(0.2, answers(k)))
            let end = answer + Self.reveal
            out.append(Beat(start: t, freeze: freeze, answer: answer, end: end))
            t = end
        }
        return out
    }
}

/// Someone at the night (not you).
struct QuizNightMember: Identifiable, Hashable {
    let user: User
    /// Nil until they "join" the lobby.
    var joinedAt: Date?
    /// Their run on the night's seed and length, once the bot run comes back.
    var score: Int?
    var rounds: [QuizRound] = []
    var isVerified = false
    /// How long their run takes on the night's clock (the kit's timing with their answer times).
    var duration: Double = 60
    /// When their result shows: paced to the night's clock, so finishers appear one by one.
    var revealedAt: Date?

    var id: String { user.id }
    var hasJoined: Bool { joinedAt != nil }
    var isDone: Bool { score != nil && revealedAt != nil }
}

/// Where a night happens.
struct QuizNightPlace: Hashable {
    enum Kind: Hashable { case group, chat }
    var kind: Kind
    var id: String
    var name: String

    var target: BubbleShareTarget {
        BubbleShareTarget(kind: kind == .group ? .group : .chat, targetID: id, title: name)
    }
}

struct QuizNight: Identifiable, Hashable {
    enum Phase: Hashable { case lobby, live, finished }

    let id: String
    var place: QuizNightPlace
    var bubbleID: String
    var seed: Int
    var rounds: Int
    var members: [QuizNightMember]
    var phase: Phase = .lobby
    var cardID: String?
    var createdAt = Date()
    var startedAt: Date?
    /// Your score and rounds once you've played.
    var myScore: Int?
    var myRounds: [QuizRound] = []
    /// DEBUG staging (`FB_OPEN=feature:nextline/results/...`): your side is a bot run, never recorded.
    var isStaged = false
    /// The night this one is a rematch of.
    var rematchOf: String?
    /// True once you and everyone else are done and the winner is announced.
    var announced = false

    var length: BubbleLength { .rounds(rounds) }
    var joined: [QuizNightMember] { members.filter(\.hasJoined) }
    var memberIDs: [String] { joined.map(\.user.id) }

    struct Standing: Identifiable, Hashable {
        let user: User
        let score: Int
        let right: Int
        var id: String { user.id }
    }

    /// Everyone with a score, best first (ties: you first, then by name).
    func standings(me: User) -> [Standing] {
        var rows = joined.filter(\.isDone).compactMap { m in m.score.map { Standing(user: m.user, score: $0, right: m.rounds.filter(\.correct).count) } }
        if let myScore {
            rows.append(Standing(user: me, score: myScore, right: myRounds.filter(\.correct).count))
        }
        return rows.sorted { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.user.isMe != b.user.isMe { return a.user.isMe }
            return a.user.firstName < b.user.firstName
        }
    }
}

/// Every quiz night this launch: lobbies, live nights and podiums. Owner: nextline.
@MainActor
@Observable
final class QuizNightCenter {
    static let shared = QuizNightCenter()

    private(set) var nights: [QuizNight] = []
    /// A Bubble someone picked on its page ("Start a quiz night in…"), by place id.
    var preferredBubble: [String: String] = [:]

    private init() {}

    // MARK: Queries

    func night(id: String) -> QuizNight? {
        nights.first { $0.id == id }
    }

    /// The newest night at a place (any phase).
    func latestNight(at placeID: String) -> QuizNight? {
        nights.filter { $0.place.id == placeID }.max { $0.createdAt < $1.createdAt }
    }

    /// The open (lobby or live) night at a place.
    func openNight(at placeID: String) -> QuizNight? {
        nights.filter { $0.place.id == placeID && $0.phase != .finished }.max { $0.createdAt < $1.createdAt }
    }

    /// The last finished night at a place.
    func lastFinished(at placeID: String) -> QuizNight? {
        nights.filter { $0.place.id == placeID && $0.phase == .finished }.max { $0.createdAt < $1.createdAt }
    }

    /// Resolves a Group or chat id to a place.
    func place(_ id: String, appStore: AppStore, bubbleStore: BubbleStore) -> QuizNightPlace? {
        if let group = appStore.group(id: id) ?? bubbleStore.resolveGroup(id) {
            return QuizNightPlace(kind: .group, id: group.id, name: group.name)
        }
        if let chat = appStore.conversations.first(where: { $0.id == id }) {
            return QuizNightPlace(kind: .chat, id: chat.id, name: chat.title)
        }
        return nil
    }

    /// Who's invited: the chat's people, or the Group's members on the server.
    func people(at place: QuizNightPlace, appStore: AppStore, bubbleStore: BubbleStore) -> [User] {
        switch place.kind {
        case .chat:
            let chat = appStore.conversations.first { $0.id == place.id }
            return Array((chat?.participants ?? []).filter { !$0.isMe }.prefix(5))
        case .group:
            let members = bubbleStore.serverGroups[place.id]?.memberSample ?? []
            return Array(members.filter { !$0.isMe }.prefix(4))
        }
    }

    /// Quiz night Bubbles you can pick: the place's own first (newest first), then the rest.
    func episodeSets(for placeID: String, bubbleStore: BubbleStore) -> [Bubble] {
        let all = bubbleStore.bubbles.filter { $0.formula == .nextline }
        let own = all.filter { $0.group?.id == placeID }.sorted { $0.createdAt > $1.createdAt }
        let rest = all.filter { $0.group?.id != placeID }.sorted { $0.createdAt > $1.createdAt }
        return own + rest
    }

    func defaultBubbleID(for placeID: String, bubbleStore: BubbleStore) -> String? {
        if let preferred = preferredBubble[placeID], bubbleStore.bubble(id: preferred) != nil { return preferred }
        return episodeSets(for: placeID, bubbleStore: bubbleStore).first?.id
    }

    static func rounds(in bubble: Bubble) -> Int {
        let episodes = bubble.manifest.content["episodes"]?.array?.count ?? 5
        return max(1, min(5, episodes))
    }

    // MARK: Lobby

    /// The open night at a place, or a new lobby. Members join on short delays and their bot runs
    /// start right away, so results are ready by the time you start.
    @discardableResult
    func openLobby(at placeID: String, appStore: AppStore, bubbleStore: BubbleStore, instant: Bool = false) -> QuizNight? {
        if let open = openNight(at: placeID), open.phase == .lobby {
            if let preferred = preferredBubble.removeValue(forKey: placeID), preferred != open.bubbleID {
                choose(bubbleID: preferred, for: open.id, bubbleStore: bubbleStore)
            }
            return night(id: open.id)
        }
        guard let place = place(placeID, appStore: appStore, bubbleStore: bubbleStore),
              let bubbleID = defaultBubbleID(for: placeID, bubbleStore: bubbleStore),
              let bubble = bubbleStore.bubble(id: bubbleID) else { return nil }
        preferredBubble[placeID] = nil
        let people = people(at: place, appStore: appStore, bubbleStore: bubbleStore)
        let night = QuizNight(
            id: "night-\(UUID().uuidString.prefix(8).lowercased())",
            place: place,
            bubbleID: bubble.id,
            seed: Int.random(in: 10_000...2_000_000_000),
            rounds: Self.rounds(in: bubble),
            members: people.map { QuizNightMember(user: $0, joinedAt: instant ? Date() : nil) }
        )
        nights.append(night)
        if !instant { scheduleJoins(night.id) }
        simulateMembers(night.id, bubbleStore: bubbleStore)
        return night
    }

    /// Switches the episode set (lobby only) and re-runs the members on it.
    func choose(bubbleID: String, for nightID: String, bubbleStore: BubbleStore) {
        guard let i = index(nightID), nights[i].phase == .lobby, nights[i].bubbleID != bubbleID,
              let bubble = bubbleStore.bubble(id: bubbleID) else { return }
        nights[i].bubbleID = bubbleID
        nights[i].rounds = Self.rounds(in: bubble)
        for k in nights[i].members.indices {
            nights[i].members[k].score = nil
            nights[i].members[k].rounds = []
            nights[i].members[k].revealedAt = nil
        }
        simulateMembers(nightID, bubbleStore: bubbleStore)
    }

    private func scheduleJoins(_ nightID: String) {
        guard let night = night(id: nightID) else { return }
        for (k, member) in night.members.enumerated() {
            let delay = 0.7 + Double(k) * 0.9 + Double(abs(member.user.id.hashValue % 5)) * 0.12
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, let i = self.index(nightID), let m = self.nights[i].members.firstIndex(where: { $0.id == member.id }),
                      self.nights[i].members[m].joinedAt == nil else { return }
                self.nights[i].members[m].joinedAt = Date()
                Haptics.selection()
            }
        }
    }

    /// Members' runs come from the server once it runs quiz nights; none are made up here.
    private func simulateMembers(_ nightID: String, bubbleStore: BubbleStore) {
    }

    /// Seconds people spend on the intro card before the first scene.
    static let introAllowance = 1.8

    /// Shows a member's result when their run would end on the night's clock (lobby: not yet).
    private func scheduleReveal(_ nightID: String, memberID: String) {
        guard let night = night(id: nightID), night.phase != .lobby,
              let member = night.members.first(where: { $0.id == memberID }), member.score != nil, member.revealedAt == nil else { return }
        let due = (night.startedAt ?? Date()).addingTimeInterval(member.duration)
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, due.timeIntervalSinceNow)) { [weak self] in
            guard let self, let i = self.index(nightID), let m = self.nights[i].members.firstIndex(where: { $0.id == memberID }),
                  self.nights[i].members[m].score != nil, self.nights[i].members[m].revealedAt == nil else { return }
            self.nights[i].members[m].revealedAt = Date()
            self.refreshCard(nightID)
            self.announceIfDone(nightID)
        }
    }

    // MARK: Start, finish, rematch

    /// Posts the night's card to the Group or chat and opens the player on the night's seed.
    func start(_ nightID: String, router: Router, appStore: AppStore, bubbleStore: BubbleStore) {
        guard let i = index(nightID), let bubble = bubbleStore.bubble(id: nights[i].bubbleID) else { return }
        // Anyone still on their way in joins as the night starts.
        for k in nights[i].members.indices where nights[i].members[k].joinedAt == nil {
            nights[i].members[k].joinedAt = Date()
        }
        nights[i].phase = .live
        nights[i].startedAt = Date()
        let night = nights[i]
        for member in night.members { scheduleReveal(night.id, memberID: member.id) }
        if night.cardID == nil {
            let card = BubbleChatCard(
                kind: .gameNight,
                bubbleID: bubble.id,
                seed: night.seed,
                length: night.length,
                fromUserID: appStore.me.id,
                headline: NextlineCopy.cardHeadline(bubble.title),
                sessionID: night.id,
                extras: cardExtras(night, me: appStore.me)
            )
            if BubbleSocialHub.send(card, to: night.place.target, note: NextlineCopy.cardNote(night.place.name), appStore: appStore, bubbleStore: bubbleStore) {
                nights[i].cardID = card.id
            }
        }
        BubbleSocialSignals.post(.gameNightPlay, bubbleID: bubble.id, with: night.memberIDs)
        play(nightID, router: router)
    }

    /// Opens the player for a night (from the lobby, a card or a rematch).
    func play(_ nightID: String, router: Router) {
        guard let night = night(id: nightID) else { return }
        router.play(BubblePlayRequest(
            bubbleID: night.bubbleID,
            seed: night.seed,
            length: night.length,
            context: BubblePlayContext(kind: .gameNight, id: night.id, cardID: night.cardID, opponentName: night.place.name)
        ))
    }

    /// Your run on a night: standings, the card's winner line, the signal and a notification.
    func didFinish(_ score: BubbleScore, nightID: String, appStore: AppStore, bubbleStore: BubbleStore) {
        // Your first run of the night counts; Play again is practice.
        guard let i = index(nightID), nights[i].myScore == nil else { return }
        nights[i].myScore = score.score
        nights[i].myRounds = QuizTag(score.share?.tag)?.rounds ?? []
        nights[i].phase = .finished
        let night = nights[i]
        refreshCard(nightID)
        BubbleSocialSignals.post(.gameNightPlay, bubbleID: night.bubbleID, with: night.memberIDs)
        announceIfDone(nightID)
    }

    /// A new night at the same place with the same people, a new seed, and play.
    @discardableResult
    func rematch(_ nightID: String, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> String? {
        guard let old = night(id: nightID) else { return nil }
        let night = QuizNight(
            id: "night-\(UUID().uuidString.prefix(8).lowercased())",
            place: old.place,
            bubbleID: old.bubbleID,
            seed: Int.random(in: 10_000...2_000_000_000),
            rounds: old.rounds,
            members: old.joined.map { QuizNightMember(user: $0.user, joinedAt: Date()) },
            rematchOf: old.id
        )
        nights.append(night)
        simulateMembers(night.id, bubbleStore: bubbleStore)
        start(night.id, router: router, appStore: appStore, bubbleStore: bubbleStore)
        return night.id
    }

    // MARK: Cards

    func cardExtras(_ night: QuizNight, me: User) -> [String: JSONValue] {
        let standings = night.standings(me: me)
        var extras: [String: JSONValue] = [
            "night_id": .string(night.id),
            "bubble_id": .string(night.bubbleID),
            "rounds": .number(Double(night.rounds)),
            "members": .number(Double(night.joined.count + 1)),
            "place_name": .string(night.place.name),
            "standings": .array(standings.map { .object(["user_id": .string($0.user.id), "score": .number(Double($0.score))]) }),
        ]
        if night.announced, let top = standings.first {
            extras["winner_id"] = .string(top.user.id)
        }
        return extras
    }

    private func refreshCard(_ nightID: String) {
        guard let night = night(id: nightID), let cardID = night.cardID, let appStore = Self.appStore else { return }
        let extras = cardExtras(night, me: appStore.me)
        BubbleSocialHub.update(cardID: cardID, appStore: appStore) { card in
            card.extras = extras
            if night.phase == .finished, let score = night.myScore { card.score = score }
        }
    }

    /// Once you and everyone else are done: the winner on the card, a notification when someone
    /// else won, and the group chat reacting.
    private func announceIfDone(_ nightID: String) {
        guard let i = index(nightID), !nights[i].announced, !nights[i].isStaged, nights[i].myScore != nil,
              nights[i].joined.allSatisfy(\.isDone), let appStore = Self.appStore else { return }
        nights[i].announced = true
        refreshCard(nightID)
        let night = nights[i]
        let rows = night.standings(me: appStore.me)
        guard let top = rows.first else { return }
        let route = BubbleFeatureRoute(.nextline, "podium", night.id)
        if !top.user.isMe {
            let note = AppNotification(
                kind: .bubbleScore,
                actors: [top.user],
                message: NextlineCopy.notificationWon(score: top.score, place: night.place.name),
                groupID: night.place.kind == .group ? night.place.id : nil,
                bubbleID: night.bubbleID
            )
            note.bubbleAction = route
            appStore.notifications.insert(note, at: 0)
        }
        // In a group chat, the people react a moment later.
        if night.place.kind == .chat, let chat = appStore.conversations.first(where: { $0.id == night.place.id }) {
            let speaker = rows.first { !$0.user.isMe }?.user
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                guard let speaker else { return }
                let text = top.user.isMe ? NextlineCopy.chatReactionYouWon : NextlineCopy.chatReactionTheyWon
                chat.messages.append(Message(senderID: speaker.id, text: text, status: .seen))
                if appStore.conversations.first?.id != chat.id { chat.unreadCount += 1 }
            }
        }
    }

    // MARK: DEBUG staging

    // MARK: Helpers

    private func index(_ nightID: String) -> Int? {
        nights.firstIndex { $0.id == nightID }
    }

    /// Set once at install, so card updates can reach the chats and posts.
    static var appStore: AppStore?
}
