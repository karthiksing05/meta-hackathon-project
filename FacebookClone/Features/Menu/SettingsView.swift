import SwiftUI

/// Settings & privacy, styled after Facebook's settings list.
struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @AppStorage(SettingsKey.appearance) private var appearance: AppearanceMode = .system
    @AppStorage(SettingsKey.autoplayVideos) private var autoplay: Bool = true
    @AppStorage(SettingsKey.dataSaver) private var dataSaver: Bool = false
    @AppStorage(SettingsKey.haptics) private var haptics: Bool = true
    @AppStorage(SettingsKey.soundEffects) private var soundEffects: Bool = true
    @AppStorage(SettingsKey.showReactionCounts) private var showReactionCounts: Bool = true
    @AppStorage(SettingsKey.activeStatus) private var activeStatus: Bool = true
    @AppStorage(SettingsKey.pushNotifications) private var pushNotifications: Bool = true

    @State private var query = ""
    @State private var confirmClearHistory = false

    private var term: String {
        query.trimmingCharacters(in: .whitespaces).lowercased()
    }

    private func show(_ titles: String...) -> Bool {
        if term.isEmpty { return true }
        return titles.contains { $0.lowercased().contains(term) }
    }

    private var hideReactionCounts: Binding<Bool> {
        Binding(
            get: { !showReactionCounts },
            set: { showReactionCounts = !$0 }
        )
    }

    var body: some View {
        List {
            searchRow
            if term.isEmpty {
                accountsCenter
            }
            preferencesSection
            notificationsSection
            feedSection
            timeSection
            searchHistorySection
            aboutSection
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(FBColor.background)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Clear search history?", isPresented: $confirmClearHistory, titleVisibility: .visible) {
            Button("Clear search history", role: .destructive) {
                store.clearRecentSearches()
                store.showToast("Search history cleared", symbol: "checkmark.circle.fill")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes all of your recent searches.")
        }
    }

    // MARK: Pieces

    private var searchRow: some View {
        SearchField(placeholder: "Search settings", text: $query)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
    }

    private var accountsCenter: some View {
        Section {
            Button {
                router.push(.comingSoon(title: "Accounts Center", symbol: "person.crop.circle.badge.checkmark"))
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: store.me, size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Accounts Center")
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.primaryText)
                        Text("Password, security, personal details, ad preferences")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(FBColor.tertiaryText)
                }
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var preferencesSection: some View {
        let titles = ["Dark mode", "Autoplay videos", "Data saver", "Haptics", "Sound effects", "Hide number of reactions", "Active status"]
        if titles.contains(where: { show($0) }) {
            Section("Preferences") {
                if show("Dark mode") {
                    Picker(selection: $appearance) {
                        ForEach(AppearanceMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    } label: {
                        SettingsLabel(title: "Dark mode", symbol: "moon.fill", color: FBColor.savedPurple)
                    }
                    .pickerStyle(.menu)
                }
                if show("Autoplay videos") {
                    Toggle(isOn: $autoplay) {
                        SettingsLabel(title: "Autoplay videos", symbol: "play.circle.fill", color: FBColor.brandBlue)
                    }
                }
                if show("Data saver") {
                    Toggle(isOn: $dataSaver) {
                        SettingsLabel(title: "Data saver", symbol: "leaf.fill", color: FBColor.online)
                    }
                }
                if show("Haptics") {
                    Toggle(isOn: $haptics) {
                        SettingsLabel(title: "Haptics", symbol: "iphone.radiowaves.left.and.right", color: FBColor.checkInRed)
                    }
                }
                if show("Sound effects") {
                    Toggle(isOn: $soundEffects) {
                        SettingsLabel(title: "Sound effects", symbol: "speaker.wave.2.fill", color: FBColor.marketplaceTeal)
                    }
                }
                if show("Hide number of reactions") {
                    Toggle(isOn: hideReactionCounts) {
                        SettingsLabel(title: "Hide number of reactions", symbol: "hand.thumbsup.fill", color: FBColor.feelingYellow)
                    }
                }
                if show("Active status") {
                    Toggle(isOn: $activeStatus) {
                        SettingsLabel(title: "Active status", symbol: "circle.fill", color: FBColor.online)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var notificationsSection: some View {
        let titles = ["Push notifications", "Notification types"]
        if titles.contains(where: { show($0) }) {
            Section("Notifications") {
                if show("Push notifications") {
                    Toggle(isOn: $pushNotifications) {
                        SettingsLabel(title: "Push notifications", symbol: "bell.fill", color: FBColor.notificationRed)
                    }
                }
                if show("Notification types") {
                    NavigationLink {
                        SettingsNotificationTypesView()
                    } label: {
                        SettingsLabel(title: "Notification types", symbol: "bell.badge.fill", color: FBColor.eventRed)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var feedSection: some View {
        let titles = ["Favorites", "Snoozed", "Unfollowed", "Reconnect"]
        if titles.contains(where: { show($0) }) {
            Section("Feed") {
                if show("Favorites") {
                    NavigationLink {
                        SettingsFavoritesView()
                    } label: {
                        SettingsLabel(title: "Favorites", symbol: "star.fill", color: FBColor.feelingYellow)
                    }
                }
                if show("Snoozed") {
                    NavigationLink {
                        SettingsSnoozedView()
                    } label: {
                        SettingsLabel(title: "Snoozed", symbol: "clock.fill", color: FBColor.brandBlue)
                    }
                }
                if show("Unfollowed") {
                    NavigationLink {
                        SettingsUnfollowedView()
                    } label: {
                        SettingsLabel(title: "Unfollowed", symbol: "person.fill.xmark", color: FBColor.checkInRed)
                    }
                }
                if show("Reconnect") {
                    Button {
                        store.showToast("You're up to date with everyone you follow", symbol: "person.2.fill")
                    } label: {
                        SettingsLabel(title: "Reconnect", symbol: "arrow.triangle.2.circlepath", color: FBColor.marketplaceTeal)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private var timeSection: some View {
        if show("Your time on Facebook") {
            Section("Time") {
                NavigationLink {
                    SettingsTimeView()
                } label: {
                    SettingsLabel(title: "Your time on Facebook", symbol: "hourglass", color: FBColor.memoriesBlue)
                }
            }
        }
    }

    @ViewBuilder
    private var searchHistorySection: some View {
        if show("Clear search history", "Search history") {
            Section("Search history") {
                Button {
                    confirmClearHistory = true
                } label: {
                    SettingsLabel(title: "Clear search history", symbol: "magnifyingglass", color: FBColor.secondaryText)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var aboutSection: some View {
        let titles = ["About", "Version", "Terms of Service", "Privacy Policy", "Cookies Policy"]
        if titles.contains(where: { show($0) }) {
            Section("About") {
                if show("About", "Version") {
                    HStack {
                        Text("Version")
                            .font(.fbBodyLarge)
                            .foregroundStyle(FBColor.primaryText)
                        Spacer()
                        Text(appVersion)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                ForEach(["Terms of Service", "Privacy Policy", "Cookies Policy"], id: \.self) { title in
                    if show(title, "Terms & Policies") {
                        Button {
                            router.push(.comingSoon(title: title, symbol: "doc.text.fill"))
                        } label: {
                            HStack {
                                Text(title)
                                    .font(.fbBodyLarge)
                                    .foregroundStyle(FBColor.primaryText)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(FBColor.tertiaryText)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var appVersion: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return value ?? "1.0"
    }
}

/// Icon tile plus title used by every settings row.
struct SettingsLabel: View {
    let title: String
    let symbol: String
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(title)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
        }
    }
}

#Preview {
    NavigationStack { SettingsView() }.previewEnvironment()
}
