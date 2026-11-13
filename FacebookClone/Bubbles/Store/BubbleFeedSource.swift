import Foundation

/// Why the server's recommender put a game on a page (`reason` in `GET /v1/feed`). Drives the
/// page's context line. Unknown reasons are kept as `other`.
enum BubbleFeedReason: Hashable {
    case friendBurst, groupBurst, daily, icebreaker, nearby, nextLevel, yours, popular, newest
    case other(String)

    init(server raw: String) {
        switch raw {
        case "friendBurst": self = .friendBurst
        case "groupBurst": self = .groupBurst
        case "daily": self = .daily
        case "icebreaker": self = .icebreaker
        case "nearby": self = .nearby
        case "nextLevel": self = .nextLevel
        case "yours": self = .yours
        case "popular": self = .popular
        case "newest": self = .newest
        default: self = .other(raw)
        }
    }
}

/// One page of the games tab, as the server chose it.
struct BubbleFeedItem: Identifiable, Hashable {
    /// The server's `feedItemID` (or a local id for a game you just made).
    let id: String
    let bubbleID: String
    let reason: BubbleFeedReason
    /// The server's reason as sent, for page events.
    let serverReason: String
    /// The server's one-line why, shown as is.
    let why: String?
    /// `A` or `B` when the server interleaves.
    let team: String?
    /// Set when the server marks this page as a sponsored post.
    var sponsor: RemoteSponsor? = nil
    /// Whose run plays as the Burst. The server doesn't send runs yet, so pages play the bot's
    /// demo.
    var runUserID: String? { nil }
}

// MARK: - Loading from the server

extension BubbleStore {
    /// How many pages to ask for at a time.
    static let feedPageSize = 10

    /// Asks the server for the next feed pages (`GET /v1/feed`). One request at a time; a page with
    /// nothing new ends the feed until `reloadFeed()`.
    func loadMoreFeed() {
        guard !isPreview, feedTask == nil, feedState != .end else { return }
        feedState = .loading
        let exclude = Array(Set(feedItems.map(\.bubbleID)))
        feedGeneration += 1
        let generation = feedGeneration
        feedTask = Task { @MainActor [weak self] in
            guard let self else { return }
            // A reload (account change, Try again) starts a newer request; this one then leaves
            // the feed alone, so a cancelled request never shows as "Couldn't load".
            defer { if self.feedGeneration == generation { self.feedTask = nil } }
            _ = await GamesAccount.shared.waitForUser()
            guard !Task.isCancelled, feedGeneration == generation else { return }
            do {
                let page = try await api.feed(limit: Self.feedPageSize, sessionID: feedSessionID, exclude: exclude)
                guard !Task.isCancelled, feedGeneration == generation else { return }
                var added: [BubbleFeedItem] = []
                for item in page where !feedItems.contains(where: { $0.id == item.feedItemID }) {
                    guard let bubble = await adopt(item.game) else { continue }
                    added.append(BubbleFeedItem(
                        id: item.feedItemID, bubbleID: bubble.id, reason: BubbleFeedReason(server: item.reason),
                        serverReason: item.reason, why: item.why, team: item.team, sponsor: item.sponsor
                    ))
                }
                guard feedGeneration == generation else { return }
                feedItems.append(contentsOf: added)
                feedState = added.isEmpty ? .end : .idle
            } catch {
                guard !Task.isCancelled, feedGeneration == generation else { return }
                feedState = .failed(error.localizedDescription)
            }
        }
    }

    /// Starts the feed over (pull to refresh, Try again).
    func reloadFeed() {
        feedTask?.cancel()
        feedTask = nil
        feedState = .idle
        loadMoreFeed()
    }

    /// Kept for callers that grew the feed by a count; loads the next server page.
    func extendFeed(by count: Int) {
        loadMoreFeed()
    }

    /// The games tab reports the page on screen; the feed loads ahead of it.
    func noteFeedPosition(_ index: Int) {
        feedPosition = index
        if index >= feedItems.count - 3 {
            loadMoreFeed()
        }
    }

    /// A game you just made shows up as the next page.
    func insertIntoFeed(_ bubble: Bubble) {
        let item = BubbleFeedItem(id: "made-\(bubble.id)", bubbleID: bubble.id, reason: .yours, serverReason: "yours", why: nil, team: nil)
        feedItems.removeAll { $0.id == item.id }
        feedItems.insert(item, at: min(feedPosition + 1, feedItems.count))
    }

    /// A game by id (a slug or a server id): the one already fetched, or `GET /v1/games/{id}`.
    @MainActor
    func loadGame(id: String) async -> Bubble? {
        if let bubble = bubble(id: id) { return bubble }
        if let pending = gameRequests[id] { return await pending.value }
        let task = Task { @MainActor [weak self] () -> Bubble? in
            guard let self, let game = try? await api.game(id: id) else { return nil }
            return await adopt(game)
        }
        gameRequests[id] = task
        let bubble = await task.value
        gameRequests[id] = nil
        return bubble
    }

    /// Builds (or refreshes) the app's game for a server game: its manifest from `manifestUrl`,
    /// its owner and Group, counters and cover. Nil when the manifest can't be read.
    @MainActor
    @discardableResult
    func adopt(_ game: RemoteGame) async -> Bubble? {
        if let existing = bubbles.first(where: { $0.serverID == game.id }) {
            refreshCounters(existing, from: game)
            return existing
        }
        guard let data = try? await api.fetch(game.manifestURL), var manifest = try? BubbleManifest.decode(data) else { return nil }
        // The game's id in the app: its slug when the manifest's id is that slug, else the server id.
        if manifest.id != game.slug { manifest.id = game.id }
        if let existing = bubbles.first(where: { $0.id == manifest.id }) {
            existing.serverID = game.id
            refreshCounters(existing, from: game)
            return existing
        }
        let bubble = Bubble(
            manifest: manifest,
            creator: person(id: game.ownerID, name: game.ownerUsername),
            group: resolveGroup(game.groupID ?? manifest.structure.groupID),
            createdAt: game.createdAt,
            playCount: game.plays,
            likeCount: game.likes,
            isLiked: game.likedByMe,
            isSaved: game.likedByMe,
            saveCount: game.likes
        )
        bubble.serverID = game.id
        remoteGames[bubble.id] = game
        let index = bubbles.firstIndex { $0.createdAt < bubble.createdAt } ?? bubbles.count
        bubbles.insert(bubble, at: index)
        noteDaily(bubble)
        loadCover(for: bubble, from: game.coverURL)
        return bubble
    }

    private func refreshCounters(_ bubble: Bubble, from game: RemoteGame) {
        remoteGames[bubble.id] = game
        bubble.playCount = game.plays
        bubble.likeCount = game.likes
        bubble.saveCount = game.likes
        bubble.isLiked = game.likedByMe
        bubble.isSaved = game.likedByMe
    }

    func noteDaily(_ bubble: Bubble) {
        if bubble.isDaily, let groupID = bubble.group?.id ?? bubble.manifest.structure.groupID {
            dailyBubbleIDs[groupID] = bubble.id
        }
    }

    private func loadCover(for bubble: Bubble, from url: URL?) {
        guard let url, bubble.coverImageData == nil else { return }
        Task { @MainActor [weak self] in
            guard let self, let data = try? await api.fetch(url) else { return }
            bubble.coverImageData = data
        }
    }

    /// Your own games (`GET /v1/creations`), for the Library. Drafts (Studio builds and tweaks
    /// that were never shared) stay out.
    @MainActor
    func loadMyGames() async {
        guard !isPreview, await GamesAccount.shared.waitForUser() != nil,
              let games = try? await api.creations() else { return }
        for game in games where !game.unlisted {
            await adopt(game)
        }
    }

    // MARK: Boards

    /// Loads a game's board from the server (`GET /v1/games/{id}/leaderboard`).
    func loadScores(for bubble: Bubble) {
        guard !isPreview, boardStates[bubble.id] != .loading else { return }
        boardStates[bubble.id] = .loading
        let gameID = bubble.serverID
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let rows = try await api.scores(gameID: gameID)
                apply(rows, to: bubble, keepingReplay: nil)
            } catch {
                boardStates[bubble.id] = .failed(error.localizedDescription)
            }
        }
    }

    /// Loads a friends or Group board (`?scope=friends|group&groupId=`). `groupID` defaults to the
    /// Group the game was made for. Its load state is under the same key in `boardStates`.
    func loadScores(for bubble: Bubble, scope: BubbleBoardScope, groupID: String? = nil) {
        guard scope != .everyone else { return loadScores(for: bubble) }
        let group = scope == .group ? (groupID ?? bubble.group?.id) : nil
        if scope == .group && group == nil { return }
        let key = Self.boardKey(bubble.id, scope, groupID: group)
        guard !isPreview, boardStates[key] != .loading else { return }
        boardStates[key] = .loading
        let gameID = bubble.serverID
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let rows = try await api.scores(gameID: gameID, scope: scope.rawValue, groupID: group)
                scopedBoards[key] = rows.map { self.scoreRow($0) }
                boardStates[key] = .idle
            } catch {
                boardStates[key] = .failed(error.localizedDescription)
            }
        }
    }

    /// One server board row as an app score.
    func scoreRow(_ row: RemoteScore) -> BubbleScore {
        let myID = GamesAccount.shared.userID
        let user = row.userID == myID ? appStore.me : person(id: row.userID, name: row.username)
        return BubbleScore(id: "\(row.userID)-\(Int(row.updatedAt.timeIntervalSince1970))", user: user, score: row.points,
                           achievedAt: row.updatedAt, day: Self.dayKey(row.updatedAt), replay: nil, share: nil)
    }

    /// Replaces the board with the server's rows. Your own row keeps the replay of the run you
    /// just played (the server keeps scores only), so sharing it still works.
    func apply(_ rows: [RemoteScore], to bubble: Bubble, keepingReplay mine: BubbleScore?) {
        let myID = GamesAccount.shared.userID
        bubble.scores = rows.map { row in
            let user = row.userID == myID ? appStore.me : person(id: row.userID, name: row.username)
            let isMyRun = user.isMe && mine?.score == row.points
            return BubbleScore(
                id: "\(row.userID)-\(Int(row.updatedAt.timeIntervalSince1970))",
                user: user,
                score: row.points,
                achievedAt: row.updatedAt,
                day: Self.dayKey(row.updatedAt),
                replay: isMyRun ? mine?.replay : nil,
                share: isMyRun ? mine?.share : nil
            )
        }
        boardStates[bubble.id] = .idle
    }

    // MARK: People and Groups

    /// A server person as an app user. You (the signed-in account) are `appStore.me`.
    func person(id: String, name: String, isFriend: Bool? = nil) -> User {
        if !id.isEmpty, id == GamesAccount.shared.userID { return appStore.me }
        if let known = serverPeople[id] {
            if let isFriend { known.friendship = isFriend ? .friends : .none }
            return known
        }
        let user = User(id: id, firstName: name.isEmpty ? "Player" : name, friendship: isFriend == true ? .friends : .none, isFollowing: isFriend == true)
        serverPeople[id] = user
        return user
    }

    /// A server profile as an app user.
    func person(_ profile: RemoteProfile) -> User {
        let user = person(id: profile.id, name: profile.displayName.isEmpty ? profile.username : profile.displayName, isFriend: profile.isFriend)
        if !user.isMe {
            user.firstName = profile.displayName.isEmpty ? profile.username : profile.displayName
            user.bio = profile.bio ?? ""
        }
        return user
    }
}
