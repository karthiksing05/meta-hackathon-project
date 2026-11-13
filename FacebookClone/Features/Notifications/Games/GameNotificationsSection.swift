import SwiftUI
import UserNotifications

/// Live game activity inside Facebook's existing Notifications tab.
struct GameNotificationsSection: View {
    let unreadOnly: Bool
    @Environment(Router.self) private var router
    private var inbox: GameNotificationInbox { .shared }

    private var visible: [RemoteGameNotification] {
        unreadOnly ? inbox.items.filter { !$0.isRead } : inbox.items
    }

    var body: some View {
        if GamesAccount.shared.userID != nil {
            Group {
                Text("Games")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 4)
                    .gameNotificationListRow()
                GamePushPermissionRow()
                    .gameNotificationListRow()
                if let error = inbox.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Couldn't load game notifications")
                            .font(.fbHeadline)
                        Text(error).font(.fbMeta).foregroundStyle(FBColor.secondaryText)
                        Button("Try again") { Task { await inbox.reload() } }
                            .buttonStyle(.fb(.tinted, expand: false, height: 36))
                    }
                    .padding(16)
                    .gameNotificationListRow()
                }
                ForEach(visible) { item in
                    GameNotificationRow(item: item) {
                        GameNotificationNavigation.open(item, router: router)
                        if !item.isRead { Task { await inbox.setRead(item, read: true) } }
                    }
                    .gameNotificationListRow()
                    .contextMenu {
                        Button(item.isRead ? "Mark as unread" : "Mark as read",
                               systemImage: item.isRead ? "envelope.badge" : "envelope.open") {
                            Task { await inbox.setRead(item, read: !item.isRead) }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(item.isRead ? "Unread" : "Read", systemImage: item.isRead ? "envelope.badge" : "envelope.open") {
                            Task { await inbox.setRead(item, read: !item.isRead) }
                        }
                        .tint(FBColor.brandBlue)
                    }
                }
                if inbox.isLoading {
                    HStack { Spacer(); ProgressView("Loading game notifications…"); Spacer() }
                        .padding(16)
                        .gameNotificationListRow()
                } else if visible.isEmpty && inbox.errorMessage == nil {
                    Text(unreadOnly ? "No unread game notifications" : "Challenges, Group games and leaderboard updates will appear here.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(16)
                        .gameNotificationListRow()
                }
                if inbox.nextCursor != nil {
                    Button("See more game notifications") { Task { await inbox.loadMore() } }
                        .font(.fbHeadline)
                        .frame(maxWidth: .infinity)
                        .padding(16)
                        .disabled(inbox.isLoading)
                        .gameNotificationListRow()
                }
            }
        }
    }
}

private struct GameNotificationRow: View {
    let item: RemoteGameNotification
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: item.symbol)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(FBColor.brandBlue)
                    .frame(width: 56, height: 56)
                    .background(FBColor.tintedBlueBackground, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).font(.fbHeadline).foregroundStyle(FBColor.primaryText)
                    Text(item.body).font(.fbBody).foregroundStyle(FBColor.primaryText)
                    Text(item.createdAt.fbShort)
                        .font(.fbCaption)
                        .foregroundStyle(item.isRead ? FBColor.secondaryText : FBColor.accent)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !item.isRead {
                    Circle().fill(FBColor.brandBlue).frame(width: 10, height: 10)
                        .padding(.top, 8).accessibilityHidden(true)
                }
            }
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(item.isRead ? FBColor.surface : FBColor.unreadBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityValue(item.isRead ? "Read" : "Unread")
        .accessibilityHint("Opens the game activity")
    }
}

private struct GamePushPermissionRow: View {
    @Environment(\.openURL) private var openURL
    @AppStorage(SettingsKey.pushNotifications) private var enabled = true
    private var push: GamePushNotifications { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if push.authorization == .denied {
                Text("Get game alerts on your lock screen")
                    .font(.fbHeadline)
                Button("Open notification settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .font(.fbMeta)
            } else if push.authorization == .notDetermined || !enabled {
                HStack(spacing: 12) {
                    Text("Get game alerts on your lock screen")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    Spacer(minLength: 0)
                    Button("Enable") { Task { await push.requestPermission() } }
                        .buttonStyle(.fb(.tinted, expand: false, height: 36))
                }
            }
            if let message = push.errorMessage {
                Text(message).font(.fbMeta).foregroundStyle(FBColor.secondaryText)
                Button("Try again") { Task { await push.synchronize() } }
                    .font(.fbMeta)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(push.authorization == .notDetermined || push.authorization == .denied || !enabled || push.errorMessage != nil ? 16 : 0)
    }
}

private extension View {
    func gameNotificationListRow() -> some View {
        listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}
