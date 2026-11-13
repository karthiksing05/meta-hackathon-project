import SwiftUI

private enum NotificationsFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case unread = "Unread"
    var id: String { rawValue }
}

/// Notifications tab root.
struct NotificationsView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var filter: NotificationsFilter = .all
    @State private var showHeaderMenu = false
    @State private var menuTarget: AppNotification?

    private let topID = "notifications.top"

    private var newItems: [AppNotification] {
        let items = store.newNotifications.filter { !$0.kind.isBubble }
        return filter == .unread ? items.filter { !$0.isRead } : items
    }

    private var earlierItems: [AppNotification] {
        let items = store.earlierNotifications.filter { !$0.kind.isBubble }
        return filter == .unread ? items.filter { !$0.isRead } : items
    }

    var body: some View {
        ScrollViewReader { proxy in
            list
                .onChange(of: router.scrollToTopSignal(for: .notifications)) {
                    withAnimation { proxy.scrollTo(topID, anchor: .top) }
                }
        }
        .background(FBColor.surface)
        .toolbar(.hidden, for: .navigationBar)
        .confirmationDialog("Notifications", isPresented: $showHeaderMenu, titleVisibility: .hidden) {
            Button("Mark all as read") {
                Task {
                    let inbox = GameNotificationInbox.shared
                    await inbox.markAllRead()
                    if let error = inbox.errorMessage {
                        store.showToast(error, symbol: "exclamationmark.circle")
                    } else {
                        store.markAllNotificationsRead()
                        store.showToast("All notifications marked as read", symbol: "checkmark.circle.fill")
                    }
                }
            }
            Button("Notification settings") { router.push(.settings) }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Notification options",
            isPresented: Binding(
                get: { menuTarget != nil },
                set: { if !$0 { menuTarget = nil } }
            ),
            titleVisibility: .hidden,
            presenting: menuTarget
        ) { item in
            Button(item.isRead ? "Mark as unread" : "Mark as read") {
                item.isRead.toggle()
            }
            Button("Remove this notification", role: .destructive) {
                withAnimation { store.removeNotification(item) }
            }
            Button("Turn off notifications like this") {
                withAnimation { store.turnOffNotifications(like: item) }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var list: some View {
        List {
            header
                .id(topID)
                .plainRow()
            chips
                .plainRow()
            GameNotificationsSection(unreadOnly: filter == .unread)
            if newItems.isEmpty && earlierItems.isEmpty && GamesAccount.shared.userID == nil {
                emptyState
                    .plainRow()
            }
            if !newItems.isEmpty {
                sectionTitle("New")
                    .plainRow()
                ForEach(newItems) { item in
                    row(item)
                }
            }
            if !earlierItems.isEmpty {
                sectionTitle("Earlier")
                    .plainRow()
                ForEach(earlierItems) { item in
                    row(item)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .animation(.default, value: store.notifications.map { $0.id })
        .animation(.default, value: filter)
        .refreshable {
            await GameNotificationInbox.shared.reload()
        }
    }

    private var header: some View {
        TabHeader("Notifications") {
            CircleButton(symbol: "magnifyingglass", accessibilityLabel: "Search") {
                router.push(.search(""))
            }
            CircleButton(symbol: "ellipsis", accessibilityLabel: "More options") {
                showHeaderMenu = true
            }
        }
    }

    private var chips: some View {
        HStack(spacing: 8) {
            ForEach(NotificationsFilter.allCases) { option in
                ChipView(title: option.rawValue, isSelected: filter == option) {
                    Haptics.selection()
                    filter = option
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.fbTitle)
            .foregroundStyle(FBColor.primaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 4)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "bell.badge")
                .font(.system(size: 44))
                .foregroundStyle(FBColor.tertiaryText)
            Text("You're all caught up")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            Text("New notifications will show up here.")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private func row(_ item: AppNotification) -> some View {
        NotificationsRow(
            notification: item,
            onOpen: { open(item) },
            onMore: { menuTarget = item }
        )
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                withAnimation { store.removeNotification(item) }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            Button {
                item.isRead.toggle()
            } label: {
                Label(item.isRead ? "Mark as unread" : "Mark as read", systemImage: "envelope.open")
            }
            Button(role: .destructive) {
                withAnimation { store.removeNotification(item) }
            } label: {
                Label("Remove this notification", systemImage: "trash")
            }
            Button {
                withAnimation { store.turnOffNotifications(like: item) }
            } label: {
                Label("Turn off notifications like this", systemImage: "bell.slash")
            }
        }
    }

    private func open(_ item: AppNotification) {
        store.markRead(item)
        if item.kind == .friendRequest {
            if let actor = item.actors.first { router.push(.profile(actor)) }
            return
        }
        if let action = item.bubbleAction {
            BubbleFeatureRouter.open(action, router: router)
            return
        }
        if let id = item.bubbleID, item.kind.isBubble {
            if item.kind == .bubbleDaily || item.kind == .bubbleScore {
                router.play(id)
            } else {
                router.push(.bubble(id))
            }
            return
        }
        if item.kind == .birthday {
            router.push(.birthdays)
            return
        }
        if item.kind == .memory {
            router.push(.memories)
            return
        }
        if let id = item.postID, let post = store.post(id: id) {
            router.push(.post(post))
        } else if let id = item.groupID, let group = store.group(id: id) {
            router.push(.group(group))
        } else if let id = item.eventID, let event = store.event(id: id) {
            router.push(.event(event))
        } else if let id = item.listingID, let listing = store.listing(id: id) {
            router.push(.listing(listing))
        } else if let id = item.userID, let user = store.user(id: id) {
            router.push(.profile(user))
        } else if let actor = item.actors.first {
            router.push(.profile(actor))
        }
    }
}

private extension View {
    /// Styles a view as a bare full-width list row.
    func plainRow() -> some View {
        self
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

#Preview {
    NavigationStack { NotificationsView() }.previewEnvironment()
}
