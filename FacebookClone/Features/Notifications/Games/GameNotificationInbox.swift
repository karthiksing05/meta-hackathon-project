import Foundation
import Observation

/// A transient view of the server inbox. No local eligibility or fabricated notifications.
@MainActor
@Observable
final class GameNotificationInbox {
    static let shared = GameNotificationInbox(api: GamesAPILive.shared)

    private(set) var items: [RemoteGameNotification] = []
    private(set) var unreadCount = 0
    private(set) var nextCursor: String?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var accountID: String?
    @ObservationIgnored private let api: any GameNotificationsAPI
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var mutationID: UUID?

    init(api: any GameNotificationsAPI) { self.api = api }

    func useAccount(_ id: String?) {
        guard accountID != id else { return }
        accountID = id
        generation = UUID()
        items = []
        unreadCount = 0
        nextCursor = nil
        errorMessage = nil
        isLoading = false
        mutationID = nil
    }

    func reload() async { await load(cursor: nil) }
    func loadMore() async {
        guard let nextCursor else { return }
        await load(cursor: nextCursor)
    }

    private func load(cursor: String?) async {
        guard accountID != nil, !isLoading, mutationID == nil else { return }
        let request = generation
        isLoading = true
        defer { if generation == request { isLoading = false } }
        do {
            let page = try await api.gameNotifications(cursor: cursor)
            guard generation == request, !Task.isCancelled else { return }
            if cursor == nil { items = [] }
            var seen = Set(items.map(\.id))
            items.append(contentsOf: page.items.filter { seen.insert($0.id).inserted })
            nextCursor = page.nextCursor == cursor ? nil : page.nextCursor
            unreadCount = max(0, page.unreadCount)
            errorMessage = nil
        } catch {
            guard generation == request, !Task.isCancelled else { return }
            errorMessage = Self.message(for: error)
        }
    }

    func setRead(_ item: RemoteGameNotification, read: Bool) async {
        guard accountID != nil, mutationID == nil else { return }
        generation = UUID() // invalidate any list request that started before this write
        isLoading = false
        let request = generation
        let mutation = UUID()
        mutationID = mutation
        defer { if mutationID == mutation { mutationID = nil } }
        do {
            try await api.setGameNotificationRead(id: item.id, read: read)
            guard generation == request else { return }
            if let index = items.firstIndex(where: { $0.id == item.id }) {
                let wasRead = items[index].isRead
                items[index].readAt = read ? Date() : nil
                if wasRead != read { unreadCount = max(0, unreadCount + (read ? -1 : 1)) }
            }
            errorMessage = nil
        } catch {
            if generation == request { errorMessage = Self.message(for: error) }
        }
    }

    func markAllRead() async {
        guard accountID != nil, mutationID == nil else { return }
        generation = UUID() // invalidate any list request that started before this write
        isLoading = false
        let request = generation
        let mutation = UUID()
        mutationID = mutation
        defer { if mutationID == mutation { mutationID = nil } }
        do {
            try await api.markAllGameNotificationsRead()
            guard generation == request else { return }
            let now = Date()
            for i in items.indices where !items[i].isRead { items[i].readAt = now }
            unreadCount = 0
            errorMessage = nil
        } catch {
            if generation == request { errorMessage = Self.message(for: error) }
        }
    }

    /// Remote taps resolve the ID through this account's authenticated inbox. Push payload
    /// destinations alone are not trusted, especially after logout or an account switch.
    func resolve(id: String) async -> RemoteGameNotification? {
        guard accountID != nil else { return nil }
        let request = generation
        var cursor: String?
        var visited = Set<String>()
        do {
            for _ in 0..<20 {
                let page = try await api.gameNotifications(cursor: cursor)
                guard generation == request, !Task.isCancelled else { return nil }
                if let item = page.items.first(where: { $0.id == id }) { return item }
                guard let next = page.nextCursor, !next.isEmpty, visited.insert(next).inserted else { return nil }
                cursor = next
            }
        } catch {
            if generation == request { errorMessage = Self.message(for: error) }
        }
        return nil
    }

    private static func message(for error: Error) -> String {
        if let error = error as? GamesAPIError, error == .notFound {
            return "Game notifications aren't available yet."
        }
        return error.localizedDescription
    }
}
