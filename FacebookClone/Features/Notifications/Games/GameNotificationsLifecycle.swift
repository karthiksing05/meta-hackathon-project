import SwiftUI

/// Refreshes only while this account is active. A cold-start push waits for sign-in, then
/// resolves its ID through that account's server inbox before opening anything.
struct GameNotificationsLifecycle: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @AppStorage(SettingsKey.pushNotifications) private var pushEnabled = true

    private var inbox: GameNotificationInbox { .shared }
    private var push: GamePushNotifications { .shared }
    private var accountID: String? { store.isLoggedIn ? GamesAccount.shared.userID : nil }
    private var refreshKey: String { "\(accountID ?? "signed-out"):\(scenePhase == .active)" }
    private var tapKey: String { "\(accountID ?? "signed-out"):\(push.pendingNotificationID ?? ""):\(scenePhase == .active)" }

    func body(content: Content) -> some View {
        content
            .task(id: refreshKey) {
                inbox.useAccount(accountID)
                if accountID == nil { await push.updateBadge(0) }
                guard accountID != nil, scenePhase == .active else { return }
                await push.synchronize()
                while !Task.isCancelled {
                    await inbox.reload()
                    do { try await Task.sleep(for: .seconds(30)) } catch { break }
                }
            }
            .task(id: tapKey) {
                guard accountID != nil, scenePhase == .active,
                      let id = push.pendingNotificationID else { return }
                inbox.useAccount(accountID)
                let item = await inbox.resolve(id: id)
                guard !Task.isCancelled, push.pendingNotificationID == id else { return }
                push.pendingNotificationID = nil
                router.selectedTab = .notifications
                if let item {
                    GameNotificationNavigation.open(item, router: router)
                    await inbox.setRead(item, read: true)
                } else {
                    store.showToast("Open this notification from your inbox.", symbol: "bell")
                }
                await inbox.reload()
            }
            .onChange(of: pushEnabled) { _, _ in Task { await push.synchronize() } }
            .onChange(of: inbox.unreadCount) { _, _ in Task { await refreshBadge() } }
            .onChange(of: store.unreadNotificationCount) { _, _ in Task { await refreshBadge() } }
    }

    private func refreshBadge() async {
        await push.updateBadge(accountID == nil ? 0 : inbox.unreadCount + store.notifications.filter { !$0.kind.isBubble && !$0.isRead }.count)
    }
}

@MainActor
enum GameNotificationNavigation {
    static func open(_ item: RemoteGameNotification, router: Router) {
        switch item.kind {
        case "friend_challenge":
            router.push(.challengesInbox)
        case "leaderboard_lost":
            if let id = item.gameID { router.push(.bubbleBoard(id)) }
        case "group_game":
            if let id = item.groupID {
                router.push(.bubbleFeature(GroupsSearchScreens.gamesRoute(for: id)))
            } else if let id = item.gameID { router.push(.bubble(id)) }
        default:
            if let id = item.gameID { router.push(.bubble(id)) }
        }
    }
}
