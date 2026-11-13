import Foundation

actor NotificationTestAPI: GameNotificationsAPI {
    var pages: [RemoteGameNotificationPage] = []
    var failWrites = false
    var pending: CheckedContinuation<RemoteGameNotificationPage, Error>?
    var suspendNext = false
    var readAllCalls = 0
    var suspendWrite = false
    var pendingWrite: CheckedContinuation<Void, Never>?
    var readRequests: [Bool] = []
    func pauseNextWrite() { suspendWrite = true }
    var writeIsWaiting: Bool { pendingWrite != nil }
    func resumeWrite() { pendingWrite?.resume(); pendingWrite = nil }
    func configure(_ pages: [RemoteGameNotificationPage], fail: Bool = false, suspend: Bool = false) {
        self.pages = pages; failWrites = fail; suspendNext = suspend
    }
    func gameNotifications(cursor: String?) async throws -> RemoteGameNotificationPage {
        if suspendNext {
            suspendNext = false
            return try await withCheckedThrowingContinuation { pending = $0 }
        }
        return pages.removeFirst()
    }
    func resume(_ page: RemoteGameNotificationPage) { pending?.resume(returning: page); pending = nil }
    var isWaiting: Bool { pending != nil }
    func setGameNotificationRead(id: String, read: Bool) async throws {
        if failWrites { throw URLError(.notConnectedToInternet) }
        readRequests.append(read)
        if suspendWrite {
            suspendWrite = false
            await withCheckedContinuation { pendingWrite = $0 }
        }
    }
    func markAllGameNotificationsRead() async throws { readAllCalls += 1 }
    func registerGamePushDevice(installationID: String, token: String, environment: String) async throws {}
    func unregisterGamePushDevice(installationID: String) async throws {}
    func shareGameToGroup(gameID: String, groupID: String, eventID: String) async throws {}
}

// The production singleton isn't used by these tests; the live actor is supplied by the app.
actor GamesAPILive: GameNotificationsAPI {
    static let shared = GamesAPILive()
    func gameNotifications(cursor: String?) async throws -> RemoteGameNotificationPage { fatalError() }
    func setGameNotificationRead(id: String, read: Bool) async throws { fatalError() }
    func markAllGameNotificationsRead() async throws { fatalError() }
    func registerGamePushDevice(installationID: String, token: String, environment: String) async throws { fatalError() }
    func unregisterGamePushDevice(installationID: String) async throws { fatalError() }
    func shareGameToGroup(gameID: String, groupID: String, eventID: String) async throws { fatalError() }
}

@main
struct NotificationTests {
    @MainActor
    static func main() async throws {
        let api = NotificationTestAPI()
        let inbox = GameNotificationInbox(api: api)
        let now = Date()
        let item = RemoteGameNotification(id: "n1", kind: "friend_challenge", title: "Challenge", body: "A friend sent a game", gameID: "g1", groupID: nil, challengeID: "c1", seriesID: nil, createdAt: now)
        let second = RemoteGameNotification(id: "n2", kind: "future_kind", title: "New game", body: "", gameID: "g2", groupID: nil, challengeID: nil, seriesID: nil, createdAt: now)
        let firstPage = RemoteGameNotificationPage(items: [item], nextCursor: "page2", unreadCount: 72)
        let lastPage = RemoteGameNotificationPage(items: [item, second], nextCursor: nil, unreadCount: 72)

        precondition(item.destination == .challenges)
        precondition(second.destination == .game("g2"))
        let boardJSON = Data(#"{"id":"board","kind":"leaderboard_lost","title":"New leader","body":"Try again","gameId":"g3","createdAt":"2026-11-13T08:00:00Z"}"#.utf8)
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        let boardItem = try decoder.decode(RemoteGameNotification.self, from: boardJSON)
        precondition(boardItem.destination == .leaderboard("g3") && !boardItem.isRead)
        let groupJSON = Data(#"{"id":"group","kind":"group_game","title":"Shared game","body":"Try it","gameId":"g4","groupId":"club","createdAt":"2026-11-13T08:00:00Z"}"#.utf8)
        let groupItem = try decoder.decode(RemoteGameNotification.self, from: groupJSON)
        precondition(groupItem.destination == .game("g4"), "a shared game need not have been made for the Group")

        inbox.useAccount("alice")
        await api.configure([firstPage, lastPage])
        await inbox.reload(); await inbox.loadMore()
        precondition(inbox.items.count == 2 && inbox.unreadCount == 72, "pagination must dedupe without losing server total")
        precondition(second.symbol == "gamecontroller.fill", "unknown server kinds need a safe presentation")

        await api.configure([], fail: true)
        await inbox.setRead(item, read: true)
        precondition(!inbox.items[0].isRead && inbox.unreadCount == 72 && inbox.errorMessage != nil, "failed write must preserve unread state")
        await api.configure([])
        await inbox.setRead(item, read: true)
        precondition(inbox.items[0].isRead && inbox.unreadCount == 71)
        await inbox.markAllRead()
        precondition(inbox.unreadCount == 0 && inbox.items.allSatisfy(\.isRead), "mark-all must include unseen pages on server")
        let calls = await api.readAllCalls
        precondition(calls == 1)

        // A previous account's delayed network response may never populate the new account.
        await api.configure([], suspend: true)
        let request = Task { await inbox.reload() }
        while !(await api.isWaiting) { await Task.yield() }
        inbox.useAccount("bob")
        await api.resume(firstPage); await request.value
        precondition(inbox.items.isEmpty && inbox.unreadCount == 0 && !inbox.isLoading, "account switch leaked old inbox")

        // An old GET must not undo a successful read mutation.
        await api.configure([firstPage]); await inbox.reload()
        await api.configure([], suspend: true)
        let staleGet = Task { await inbox.reload() }
        while !(await api.isWaiting) { await Task.yield() }
        await inbox.setRead(item, read: true)
        await api.resume(firstPage); await staleGet.value
        precondition(inbox.items[0].isRead && inbox.unreadCount == 71, "stale GET undid read mutation")

        // A second read-state action is queued, never silently dropped behind the first.
        await api.pauseNextWrite()
        let reading = Task { await inbox.setRead(item, read: true) }
        while !(await api.writeIsWaiting) { await Task.yield() }
        let unreading = Task { await inbox.setRead(item, read: false) }
        await Task.yield()
        await api.resumeWrite()
        await reading.value; await unreading.value
        precondition(!inbox.items[0].isRead, "rapid unread action was dropped")

        // A push ID is resolved through this account's server inbox, not its untrusted payload.
        await api.configure([firstPage, lastPage])
        let found = await inbox.resolve(id: "n2")
        precondition(found?.id == "n2")
        await api.configure([RemoteGameNotificationPage(items: [], nextCursor: nil, unreadCount: 0)])
        let missing = await inbox.resolve(id: "another-account-notification")
        precondition(missing == nil)
        inbox.useAccount(nil)
        precondition(inbox.items.isEmpty && inbox.nextCursor == nil)
        print("Notifications: pagination, write failure, mark-all, account isolation, stale-response and push-resolution checks passed.")
    }
}
