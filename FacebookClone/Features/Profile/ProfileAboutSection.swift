import SwiftUI

/// The "About" tab of a profile.
struct ProfileAboutSection: View {
    let user: User

    private struct Row: Identifiable {
        let id = UUID()
        let symbol: String
        let title: String
        let subtitle: String?
    }

    private var birthdayText: String {
        let symbols = Calendar.current.monthSymbols
        let index = user.birthdayMonth - 1
        guard index >= 0, index < symbols.count else { return "" }
        return "\(symbols[index]) \(user.birthdayDay)"
    }

    private var joinedText: String {
        user.joinedDate.formatted(.dateTime.month(.wide).year())
    }

    var body: some View {
        VStack(spacing: 0) {
            card("Overview", rows: overviewRows)
            ProfileGap()
            card("Work and education", rows: workRows)
            ProfileGap()
            card("Places lived", rows: placeRows)
            ProfileGap()
            card("Contact and basic info", rows: contactRows)
            ProfileGap()
            card("Family and relationships", rows: familyRows)
            ProfileGap()
            card("Details about \(user.isMe ? "you" : user.firstName)", rows: detailRows)
        }
    }

    private var overviewRows: [Row] {
        var rows: [Row] = []
        if !user.work.isEmpty { rows.append(Row(symbol: "briefcase.fill", title: "Works at \(user.work)", subtitle: nil)) }
        if !user.school.isEmpty { rows.append(Row(symbol: "graduationcap.fill", title: "Studied at \(user.school)", subtitle: nil)) }
        if !user.city.isEmpty { rows.append(Row(symbol: "house.fill", title: "Lives in \(user.city)", subtitle: nil)) }
        if !user.hometown.isEmpty { rows.append(Row(symbol: "mappin.and.ellipse", title: "From \(user.hometown)", subtitle: nil)) }
        if !user.relationship.isEmpty && !user.isPage { rows.append(Row(symbol: "heart.fill", title: user.relationship, subtitle: nil)) }
        rows.append(Row(symbol: "clock.fill", title: "Joined \(joinedText)", subtitle: nil))
        return rows
    }

    private var workRows: [Row] {
        var rows: [Row] = []
        if !user.work.isEmpty { rows.append(Row(symbol: "briefcase.fill", title: "Works at \(user.work)", subtitle: "Current")) }
        if !user.school.isEmpty { rows.append(Row(symbol: "graduationcap.fill", title: "Studied at \(user.school)", subtitle: "Education")) }
        return rows
    }

    private var placeRows: [Row] {
        var rows: [Row] = []
        if !user.city.isEmpty { rows.append(Row(symbol: "house.fill", title: user.city, subtitle: "Current city")) }
        if !user.hometown.isEmpty { rows.append(Row(symbol: "mappin.and.ellipse", title: user.hometown, subtitle: "Hometown")) }
        return rows
    }

    private var contactRows: [Row] {
        var rows: [Row] = []
        if let website = user.website, !website.isEmpty {
            rows.append(Row(symbol: "link", title: website, subtitle: "Website"))
        }
        if !user.isPage && !birthdayText.isEmpty {
            rows.append(Row(symbol: "gift.fill", title: birthdayText, subtitle: "Birthday"))
        }
        if user.isPage, let category = user.category, !category.isEmpty {
            rows.append(Row(symbol: "tag.fill", title: category, subtitle: "Category"))
        }
        return rows
    }

    private var familyRows: [Row] {
        if user.relationship.isEmpty || user.isPage { return [] }
        return [Row(symbol: "heart.fill", title: user.relationship, subtitle: "Relationship")]
    }

    private var detailRows: [Row] {
        var rows: [Row] = []
        if !user.bio.isEmpty { rows.append(Row(symbol: "text.quote", title: user.bio, subtitle: "About")) }
        rows.append(Row(symbol: "person.2.fill", title: "\((user.isPage ? user.followerCount : user.friendCount).withCommas) \(user.isPage ? "followers" : "friends")", subtitle: nil))
        return rows
    }

    private func card(_ title: String, rows: [Row]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
            if rows.isEmpty {
                Text("Nothing to show")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: row.symbol)
                            .font(.system(size: FBIconSize.regular))
                            .foregroundStyle(FBColor.secondaryText)
                            .frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title)
                                .font(.fbBodyLarge)
                                .foregroundStyle(FBColor.primaryText)
                                .fixedSize(horizontal: false, vertical: true)
                            if let subtitle = row.subtitle {
                                Text(subtitle)
                                    .font(.fbMeta)
                                    .foregroundStyle(FBColor.secondaryText)
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(FBColor.surface)
    }
}
