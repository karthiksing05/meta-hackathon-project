import SwiftUI

private struct MoreBirthdayMonth: Identifiable {
    let month: Int
    let users: [User]
    var id: Int { month }
}

struct BirthdaysView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if store.birthdaysToday.isEmpty && store.upcomingBirthdays.isEmpty {
                    ContentUnavailableView(
                        "No birthdays",
                        systemImage: "gift",
                        description: Text("Your friends' upcoming birthdays will show up here.")
                    )
                    .padding(.top, 50)
                } else {
                    todaySection
                    upcomingSection
                }
            }
        }
        .background(FBColor.background)
        .navigationTitle("Birthdays")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: Today

    @ViewBuilder
    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Today's birthdays")
            if store.birthdaysToday.isEmpty {
                Text("None of your friends have a birthday today.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                ForEach(store.birthdaysToday) { user in
                    todayCard(user)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .padding(.bottom, FBMetrics.feedSeparatorHeight)
    }

    private func todayCard(_ user: User) -> some View {
        VStack(spacing: 12) {
            NavigationLink(value: Route.profile(user)) {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: FBAvatarSize.row)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.name)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Text("Birthday today")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    Spacer()
                    Text("🎂")
                        .font(.system(size: 28)) // Display text
                }
            }
            .buttonStyle(.plain)
            HStack(spacing: 8) {
                Button {
                    router.composePost(CreatePostRequest(timelineOwner: user))
                } label: {
                    Text("Write on \(user.firstName)'s profile")
                }
                .buttonStyle(.fbPrimary)
                Button {
                    router.openChat(store.conversation(with: user))
                } label: {
                    MessengerGlyph(size: 20)
                        .frame(width: 44, height: 36)
                        .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Message \(user.firstName)")
            }
        }
        .padding(12)
        .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    // MARK: Upcoming

    private var months: [MoreBirthdayMonth] {
        var result: [MoreBirthdayMonth] = []
        for user in store.upcomingBirthdays {
            if let last = result.last, last.month == user.birthdayMonth {
                result[result.count - 1] = MoreBirthdayMonth(month: last.month, users: last.users + [user])
            } else {
                result.append(MoreBirthdayMonth(month: user.birthdayMonth, users: [user]))
            }
        }
        return result
    }

    @ViewBuilder
    private var upcomingSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(title: "Upcoming birthdays")
                .padding(16)
            if store.upcomingBirthdays.isEmpty {
                Text("No upcoming birthdays in the next 60 days.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
            } else {
                ForEach(months) { group in
                    Text(monthName(group.month))
                        .font(.fbName)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                    ForEach(group.users) { user in
                        upcomingRow(user)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private func upcomingRow(_ user: User) -> some View {
        NavigationLink(value: Route.profile(user)) {
            HStack(spacing: 12) {
                AvatarView(user: user, size: FBAvatarSize.compact)
                VStack(alignment: .leading, spacing: 2) {
                    Text(user.name)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(whenText(for: user))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func monthName(_ month: Int) -> String {
        let symbols = Calendar.current.monthSymbols
        guard month >= 1, month <= symbols.count else { return "" }
        return symbols[month - 1]
    }

    private func whenText(for user: User) -> String {
        guard let days = store.daysUntilBirthday(of: user) else { return "" }
        if days == 0 { return "Today" }
        if days == 1 { return "Tomorrow" }
        if days < 7 { return "In \(days) days" }
        let date = Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
        return "\(DateFormatters.weekday.string(from: date)), \(DateFormatters.monthDay.string(from: date))"
    }
}
