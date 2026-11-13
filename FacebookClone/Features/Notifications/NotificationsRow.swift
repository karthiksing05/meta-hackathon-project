import SwiftUI

/// Symbol and color for the small badge on a notification avatar.
struct NotificationsKindStyle {
    let symbol: String
    let color: Color

    static func style(for kind: NotificationKind) -> NotificationsKindStyle {
        switch kind {
        case .reaction:
            return NotificationsKindStyle(symbol: "hand.thumbsup.fill", color: FBColor.brandBlue)
        case .comment, .reply, .mention:
            return NotificationsKindStyle(symbol: "bubble.left.fill", color: FBColor.online)
        case .friendRequest, .friendAccepted:
            return NotificationsKindStyle(symbol: "person.fill", color: FBColor.brandBlue)
        case .birthday:
            return NotificationsKindStyle(symbol: "gift.fill", color: FBColor.reelsPink)
        case .groupPost, .groupInvite:
            return NotificationsKindStyle(symbol: "person.3.fill", color: FBColor.groupsBlue)
        case .event:
            return NotificationsKindStyle(symbol: "calendar", color: FBColor.eventRed)
        case .memory:
            return NotificationsKindStyle(symbol: "clock.arrow.circlepath", color: FBColor.memoriesBlue)
        case .live:
            return NotificationsKindStyle(symbol: "video.fill", color: FBColor.liveRed)
        case .marketplace:
            return NotificationsKindStyle(symbol: "storefront.fill", color: FBColor.marketplaceTeal)
        case .share:
            return NotificationsKindStyle(symbol: "arrowshape.turn.up.right.fill", color: FBColor.brandBlue)
        case .tag:
            return NotificationsKindStyle(symbol: "tag.fill", color: FBColor.tagBlue)
        case .video:
            return NotificationsKindStyle(symbol: "play.fill", color: FBColor.brandBlue)
        case .pageInvite:
            return NotificationsKindStyle(symbol: "flag.fill", color: FBColor.checkInRed)
        case .suggestion:
            return NotificationsKindStyle(symbol: "person.badge.plus", color: FBColor.brandBlue)
        case .bubbleScore, .bubbleDaily, .bubbleRemix, .bubblePlayed:
            return NotificationsKindStyle(symbol: "sparkles", color: GameColor.deepFill)
        }
    }
}

/// Leading avatar (or large symbol) with the kind badge.
struct NotificationsAvatar: View {
    let notification: AppNotification

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            main
            kindBadge
                .offset(x: 3, y: 3)
        }
        .frame(width: FBAvatarSize.row, height: FBAvatarSize.row)
    }

    @ViewBuilder
    private var main: some View {
        if let actor = notification.actors.first {
            AvatarView(user: actor, size: FBAvatarSize.row)
        } else if notification.kind.isBubble {
            BubbleNotificationGlyph(size: FBAvatarSize.row)
        } else {
            let style = NotificationsKindStyle.style(for: notification.kind)
            SymbolBadge(symbol: style.symbol, color: style.color, size: FBAvatarSize.row)
        }
    }

    @ViewBuilder
    private var kindBadge: some View {
        if notification.actors.isEmpty {
            EmptyView()
        } else if case .reaction(let type) = notification.kind {
            ReactionBadge(type: type, size: 24)
        } else if notification.kind.isBubble {
            BubbleNotificationGlyph(size: 24)
                .overlay { Circle().stroke(FBColor.surface, lineWidth: 2) }
        } else {
            let style = NotificationsKindStyle.style(for: notification.kind)
            SymbolBadge(symbol: style.symbol, color: style.color, size: 24)
                .overlay {
                    Circle().stroke(FBColor.surface, lineWidth: 2)
                }
        }
    }
}

/// One notification row. Tapping is handled by the caller (`onOpen`).
struct NotificationsRow: View {
    let notification: AppNotification
    let onOpen: () -> Void
    let onMore: () -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            NotificationsAvatar(notification: notification)
            VStack(alignment: .leading, spacing: 4) {
                messageText
                Text(notification.createdAt.fbShort)
                    .font(.fbMeta)
                    .foregroundStyle(notification.isRead ? FBColor.secondaryText : FBColor.accent)
                    .fontWeight(notification.isRead ? .regular : .semibold)
                requestSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(notification.isRead ? FBColor.surface : FBColor.unreadBackground)
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
    }

    private var messageText: some View {
        let who = notification.actorsText
        let combined: Text = who.isEmpty
            ? Text(notification.message)
            : Text(who).bold() + Text(" " + notification.message)
        return combined
            .font(.fbBody)
            .foregroundStyle(FBColor.primaryText)
            // Game rows carry a cover thumbnail, so they keep to three lines to stay compact.
            .lineLimit(notification.kind.isBubble ? 3 : 4)
            .multilineTextAlignment(.leading)
    }

    /// The cover thumbnail (game rows) sits beside the menu button, not above it, so a short
    /// message doesn't make a tall row.
    private var trailing: some View {
        HStack(alignment: .top, spacing: 2) {
            if notification.kind.isBubble, let id = notification.bubbleID {
                BubbleNotificationThumb(bubbleID: id)
            }
            menuColumn
        }
    }

    private var menuColumn: some View {
        VStack(spacing: 10) {
            Button(action: onMore) {
                Image(systemName: "ellipsis")
                    .font(.system(size: FBIconSize.regular, weight: .bold))
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("More options")
            if !notification.isRead {
                Circle()
                    .fill(FBColor.brandBlue)
                    .frame(width: 12, height: 12)
                    .accessibilityLabel("Unread")
            }
        }
    }

    @ViewBuilder
    private var requestSection: some View {
        if notification.kind == .friendRequest, let actor = notification.actors.first {
            if let action = notification.requestAction {
                Text(action == .confirmed ? "Request accepted" : "Request removed")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.top, 2)
            } else {
                HStack(spacing: 8) {
                    Button("Confirm") {
                        Haptics.light()
                        withAnimation { store.confirmRequest(from: actor) }
                    }
                    .buttonStyle(.fb(.primary, expand: true, height: 36))
                    Button("Delete") {
                        Haptics.light()
                        withAnimation { store.deleteRequest(from: actor) }
                    }
                    .buttonStyle(.fb(.secondary, expand: true, height: 36))
                }
                .padding(.top, 4)
            }
        }
    }
}
