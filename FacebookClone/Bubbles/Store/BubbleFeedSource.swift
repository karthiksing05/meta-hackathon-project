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
    /// The server's `baseId`: the game's family (its Group copies, remixes and variants share it).
    var baseID: String? = nil
    /// Whose run plays as the Burst. The server doesn't send runs yet, so pages play the bot's
    /// demo.
    var runUserID: String? { nil }
}

// MARK: - Loading from the server

extension BubbleStore {
    /// How many pages to ask for at a time.
    static let feedPageSize = 10

    /// Pages in a row that brought nothing new before the feed counts as ended.
    static let feedStaleLimit = 2

    /// Asks the server for the next feed pages (`GET /v1/feed`). One request at a time. A game
    /// already in the feed never goes in again: the server shouldn't send one, and the app checks
    /// the game's server id, its id here and its family (`baseId`) anyway. Pages with nothing new
    /// (`feedStaleLimit` in a row, or an empty one) end the feed until `reloadFeed()`.
    func loadMoreFeed() {
        guard !isPreview, feedTask == nil, feedState != .end else { return }
        feedState = .loading
        let exclude = Array(Set(feedItems.map(\.bubbleID)))
        feedGeneration += 1
        let generation = feedGeneration
        feedTask = Task { @MainActor [weak self] in
            guard let self else { return }
            // A reload (account change) starts a newer request; this one then leaves the feed
            // alone, so a cancelled request never shows as "Couldn't load".
            defer { if self.feedGeneration == generation { self.feedTask = nil } }
            _ = await GamesAccount.shared.waitForUser()
            guard !Task.isCancelled, feedGeneration == generation else { return }
            do {
                let page = try await api.feed(limit: Self.feedPageSize, sessionID: feedSessionID, exclude: exclude)
                guard !Task.isCancelled, feedGeneration == generation else { return }
                var candidates: [BubbleFeedItem] = []
                for item in page {
                    guard let bubble = await adopt(item.game) else { continue }
                    candidates.append(BubbleFeedItem(
                        id: item.feedItemID, bubbleID: bubble.id, reason: BubbleFeedReason(server: item.reason),
                        serverReason: item.reason, why: item.why, team: item.team, sponsor: item.sponsor,
                        baseID: item.baseID
                    ))
                }
                #if DEBUG
                // FB_FEED_GAME=<id>: that game is the first page (screen audits, screenshots).
                if feedItems.isEmpty, let pinned = DebugLaunch.value("FB_FEED_GAME"), let bubble = await loadGame(id: pinned) {
                    candidates.removeAll { $0.bubbleID == bubble.id }
                    candidates.insert(BubbleFeedItem(id: "debug-\(bubble.id)", bubbleID: bubble.id, reason: .popular,
                                                     serverReason: "popular", why: nil, team: nil), at: 0)
                }
                #endif
                guard feedGeneration == generation else { return }
                // Checked against the feed as it is now: it can change while games load.
                var known = feedIdentityKeys(feedItems)
                var added: [BubbleFeedItem] = []
                for item in candidates {
                    let keys = feedIdentityKeys([item])
                    guard known.isDisjoint(with: keys) else { continue }
                    known.formUnion(keys)
                    added.append(item)
                }
                feedItems.append(contentsOf: added)
                feedStaleStreak = added.isEmpty ? feedStaleStreak + 1 : 0
                feedState = page.isEmpty || feedStaleStreak >= Self.feedStaleLimit ? .end : .idle
                debugCheckFeedForDuplicates("load")
            } catch {
                guard !Task.isCancelled, feedGeneration == generation else { return }
                feedState = .failed(error.localizedDescription)
            }
        }
    }

    /// Loads more after the end or a failure (pull to refresh, Try again). The pages already shown
    /// stay where they are, so the position holds. A load already running is left to finish: the
    /// server has counted its games as shown, so dropping it would lose them.
    func reloadFeed() {
        feedStaleStreak = 0
        guard feedTask == nil else { return }
        feedState = .idle
        loadMoreFeed()
    }

    /// A different account means a different personalized feed: the request for the old account is
    /// dropped and so are the pages fetched ahead of the one on screen. The page on screen and the
    /// ones before it stay, so the pager doesn't jump, and the new account's pages follow them.
    func restartFeedForNewAccount() {
        feedTask?.cancel()
        feedTask = nil
        feedGeneration += 1
        if feedItems.indices.contains(feedPosition) {
            feedItems.removeSubrange((feedPosition + 1)...)
        } else {
            feedItems.removeAll()
            feedPosition = 0
        }
        feedStaleStreak = 0
        feedState = .idle
        loadMoreFeed()
    }

    /// What makes two feed items the same game: its id here, its server id, and its family.
    func feedIdentityKeys(_ items: [BubbleFeedItem]) -> Set<String> {
        var keys = Set<String>()
        for item in items {
            keys.insert("game:\(item.bubbleID)")
            if let serverID = bubble(id: item.bubbleID)?.serverID, !serverID.isEmpty {
                keys.insert("server:\(serverID)")
            }
            if let base = item.baseID, !base.isEmpty {
                keys.insert("base:\(base)")
            }
        }
        return keys
    }

    /// DEBUG builds log any game that is in the feed twice (by id here, server id or family).
    func debugCheckFeedForDuplicates(_ context: String) {
        #if DEBUG
        var seen: [String: Int] = [:]
        for (index, item) in feedItems.enumerated() {
            for key in feedIdentityKeys([item]) {
                if let first = seen[key] {
                    print("[feed] duplicate after \(context): \(key) at pages \(first) and \(index) (\(item.id))")
                } else {
                    seen[key] = index
                }
            }
        }
        #endif
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

    /// A game you just made shows up as the next page. If the feed already holds it, that page
    /// moves there instead of the game showing twice.
    func insertIntoFeed(_ bubble: Bubble) {
        let item = BubbleFeedItem(id: "made-\(bubble.id)", bubbleID: bubble.id, reason: .yours, serverReason: "yours", why: nil, team: nil)
        let keys = feedIdentityKeys([item])
        let currentID = feedItems.indices.contains(feedPosition) ? feedItems[feedPosition].id : nil
        feedItems.removeAll { $0.id == item.id || ($0.id != currentID && !feedIdentityKeys([$0]).isDisjoint(with: keys)) }
        if let currentID, !feedIdentityKeys(feedItems.filter { $0.id == currentID }).isDisjoint(with: keys) {
            return // it is the page on screen
        }
        let current = currentID.flatMap { id in feedItems.firstIndex { $0.id == id } } ?? (feedPosition - 1)
        feedPosition = max(0, current)
        feedItems.insert(item, at: min(current + 1, feedItems.count))
        debugCheckFeedForDuplicates("insert")
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
            loadCover(for: existing, from: game.coverURL)
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

    /// Fetches the game's `coverUrl` into `coverImageData`, which every cover (Library, profile,
    /// Saves, feed placeholder, Studio card) draws. Without one the Glow placeholder stays.
    func loadCover(for bubble: Bubble, from url: URL?) {
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
        var score = BubbleScore(id: "\(row.userID)-\(Int(row.updatedAt.timeIntervalSince1970))", user: user, score: row.points,
                                achievedAt: row.updatedAt, day: Self.dayKey(row.updatedAt), replay: nil, share: nil)
        score.hasServerReplay = row.replayAvailable == true
        return score
    }

    /// Replaces the board with the server's rows. Your own row keeps the replay of the run you
    /// just played (the server keeps scores only), so sharing it still works.
    func apply(_ rows: [RemoteScore], to bubble: Bubble, keepingReplay mine: BubbleScore?) {
        let myID = GamesAccount.shared.userID
        bubble.scores = rows.map { row in
            let user = row.userID == myID ? appStore.me : person(id: row.userID, name: row.username)
            let isMyRun = user.isMe && mine?.score == row.points
            var score = BubbleScore(
                id: "\(row.userID)-\(Int(row.updatedAt.timeIntervalSince1970))",
                user: user,
                score: row.points,
                achievedAt: row.updatedAt,
                day: Self.dayKey(row.updatedAt),
                replay: isMyRun ? mine?.replay : nil,
                share: isMyRun ? mine?.share : nil
            )
            score.hasServerReplay = row.replayAvailable == true
            return score
        }
        boardStates[bubble.id] = .idle
    }

    /// The run behind a board row, to watch as a Burst: the one already on the row, or the server's
    /// (`GET /v1/games/{id}/runs/{userId}/log`, friends and Group-mates only). The fetched run is put
    /// on the game's board row too, so the player shows whose replay it is.
    func watchableReplay(for entry: BubbleScore, in bubble: Bubble) async throws -> BubbleInputLog? {
        if let replay = entry.replay { return replay }
        guard entry.hasServerReplay else { return nil }
        let run = try await api.runReplay(gameID: bubble.serverID, userID: entry.user.id)
        if let index = bubble.scores.firstIndex(where: { $0.user.id == entry.user.id }) {
            bubble.scores[index].replay = run.replay
        } else {
            var row = entry
            row.replay = run.replay
            bubble.scores.append(row)
        }
        return run.replay
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
        // Only an id and a name here: the picture comes from the server in a moment.
        if !isPreview { ServerAvatarLookup.shared.fill(user) }
        return user
    }

    /// A server profile as an app user, with their picture (or cartoon), bio and cover color.
    func person(_ profile: RemoteProfile) -> User {
        let user = person(id: profile.id, name: profile.displayName.isEmpty ? profile.username : profile.displayName, isFriend: profile.isFriend)
        if !user.isMe { apply(profile, to: user) }
        return user
    }

    /// Copies a server profile onto an app user (someone in a list, or the person whose profile is
    /// open). A picked photo (`avatarData`) still wins over the URL.
    func apply(_ profile: RemoteProfile, to user: User) {
        let name = profile.displayName.isEmpty ? profile.username : profile.displayName
        if !name.isEmpty, serverPeople[user.id] === user {
            user.firstName = name
            user.lastName = ""
        }
        user.bio = profile.bio ?? ""
        user.coverColor = profile.coverColor
        if let picture = PersonAvatarURL.forProfile(profile) { user.avatarURL = picture }
        if let count = profile.friendCount { user.friendCount = count }
    }
}
