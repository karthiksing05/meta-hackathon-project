import Charts
import SwiftUI

// MARK: - Notification types

private struct SettingsNotificationToggle: View {
    let title: String
    let symbol: String
    @AppStorage private var isOn: Bool

    init(title: String, symbol: String, key: String) {
        self.title = title
        self.symbol = symbol
        _isOn = AppStorage(wrappedValue: true, "settings.notifications." + key)
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            SettingsLabel(title: title, symbol: symbol, color: FBColor.brandBlue)
        }
    }
}

struct SettingsNotificationTypesView: View {
    var body: some View {
        List {
            Section("What you get notified about") {
                SettingsNotificationToggle(title: "Comments", symbol: "bubble.left.fill", key: "comments")
                SettingsNotificationToggle(title: "Tags", symbol: "tag.fill", key: "tags")
                SettingsNotificationToggle(title: "Reminders", symbol: "bell.fill", key: "reminders")
                SettingsNotificationToggle(title: "Friend requests", symbol: "person.fill.badge.plus", key: "friendRequests")
                SettingsNotificationToggle(title: "Birthdays", symbol: "gift.fill", key: "birthdays")
                SettingsNotificationToggle(title: "Groups", symbol: "person.3.fill", key: "groups")
                SettingsNotificationToggle(title: "Events", symbol: "calendar", key: "events")
                SettingsNotificationToggle(title: "Marketplace", symbol: "storefront.fill", key: "marketplace")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(FBColor.background)
        .navigationTitle("Notification types")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Favorites, snoozed, unfollowed

private struct SettingsPersonRow<Trailing: View>: View {
    let user: User
    let subtitle: String?
    let trailing: Trailing

    init(user: User, subtitle: String? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.user = user
        self.subtitle = subtitle
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(user: user, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                NameWithBadge(user: user)
                if let subtitle {
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Spacer()
            trailing
        }
    }
}

struct SettingsFavoritesView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        List {
            ForEach(store.friends + store.pages) { user in
                SettingsPersonRow(user: user, subtitle: user.isPage ? user.category : nil) {
                    Button {
                        Haptics.light()
                        store.toggleFavorite(user)
                    } label: {
                        Image(systemName: user.isFavorite ? "star.fill" : "star")
                            .font(.system(size: 20))
                            .foregroundStyle(user.isFavorite ? FBColor.feelingYellow : FBColor.secondaryText)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(user.isFavorite ? "Remove from Favorites" : "Add to Favorites")
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Favorites")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SettingsSnoozedView: View {
    @Environment(AppStore.self) private var store

    private var snoozed: [User] {
        (store.people + store.pages).filter { $0.isSnoozed }
    }

    var body: some View {
        Group {
            if snoozed.isEmpty {
                ContentUnavailableView("No snoozed people", systemImage: "clock", description: Text("People you snooze will show up here."))
            } else {
                List {
                    ForEach(snoozed) { user in
                        SettingsPersonRow(user: user, subtitle: "Snoozed for 30 days") {
                            Button("Unsnooze") {
                                withAnimation { store.unsnooze(user) }
                            }
                            .buttonStyle(.fb(.secondary, expand: false, height: 34))
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Snoozed")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SettingsUnfollowedView: View {
    @Environment(AppStore.self) private var store

    private var unfollowed: [User] {
        (store.people + store.pages).filter { !$0.isFollowing }
    }

    var body: some View {
        Group {
            if unfollowed.isEmpty {
                ContentUnavailableView("No unfollowed accounts", systemImage: "person.fill.checkmark", description: Text("People and Pages you unfollow will show up here."))
            } else {
                List {
                    ForEach(unfollowed) { user in
                        SettingsPersonRow(user: user, subtitle: user.isPage ? user.category : nil) {
                            Button("Follow") {
                                withAnimation { store.follow(user) }
                            }
                            .buttonStyle(.fb(.tinted, expand: false, height: 34))
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Unfollowed")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Your time on Facebook

private struct SettingsDayUsage: Identifiable {
    let id: Int
    let label: String
    let minutes: Int
    let isToday: Bool
}

struct SettingsTimeView: View {
    @State private var reminderIndex = 0
    @State private var quietMode = false

    private let reminderOptions = ["No reminder", "15 minutes", "30 minutes", "1 hour", "2 hours"]
    private let mockMinutes = [42, 65, 38, 80, 55, 71, 47]

    private var days: [SettingsDayUsage] {
        let calendar = Calendar.current
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        var result: [SettingsDayUsage] = []
        for offset in 0..<7 {
            let daysAgo = 6 - offset
            let date = calendar.date(byAdding: .day, value: -daysAgo, to: Date()) ?? Date()
            result.append(
                SettingsDayUsage(
                    id: offset,
                    label: formatter.string(from: date),
                    minutes: mockMinutes[offset],
                    isToday: daysAgo == 0
                )
            )
        }
        return result
    }

    private var averageMinutes: Int {
        let total = mockMinutes.reduce(0, +)
        return total / mockMinutes.count
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Daily average")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    Text(averageText)
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(FBColor.primaryText)
                    chart
                        .padding(.top, 8)
                }
                .padding(.vertical, 6)
            }
            Section {
                Picker("Set daily time reminder", selection: $reminderIndex) {
                    ForEach(0..<reminderOptions.count, id: \.self) { index in
                        Text(reminderOptions[index]).tag(index)
                    }
                }
                Toggle("Quiet mode", isOn: $quietMode)
            } footer: {
                Text("Quiet mode mutes push notifications so you can focus.")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(FBColor.background)
        .navigationTitle("Your time on Facebook")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var averageText: String {
        let hours = averageMinutes / 60
        let minutes = averageMinutes % 60
        return hours > 0 ? "\(hours) h \(minutes) min" : "\(minutes) min"
    }

    private var chart: some View {
        Chart(days) { day in
            BarMark(
                x: .value("Day", day.label),
                y: .value("Minutes", day.minutes)
            )
            .foregroundStyle(day.isToday ? FBColor.brandBlue : FBColor.brandBlue.opacity(0.35))
            .cornerRadius(4)
        }
        .frame(height: 180)
    }
}
