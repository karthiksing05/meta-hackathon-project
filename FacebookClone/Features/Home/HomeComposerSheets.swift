import SwiftUI

// MARK: - Audience

/// "Post audience": Public, Friends, Friends except..., Only me.
struct HomeAudienceSheet: View {
    @Binding var selection: Audience

    @Environment(\.dismiss) private var dismiss

    init(selection: Binding<Audience>) {
        _selection = selection
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Who can see your post?")
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.primaryText)
                        Text("Your post will show up in Feed, on your profile and in search results.")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)

                    ForEach(Audience.allCases) { option in
                        Button {
                            Haptics.selection()
                            selection = option
                        } label: {
                            HomeAudienceRow(option: option, isSelected: option == selection)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Button("Done") {
                    dismiss()
                }
                .buttonStyle(.fb(.primary, height: 44))
                .padding(16)
                .background(FBColor.surface)
            }
            .background(FBColor.surface)
            .navigationTitle("Post audience")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .foregroundStyle(FBColor.primaryText)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct HomeAudienceRow: View {
    let option: Audience
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: option.symbol)
                .font(.system(size: FBIconSize.regular, weight: .semibold))
                .foregroundStyle(FBColor.primaryText)
                .frame(width: 48, height: 48)
                .background(FBColor.buttonGray, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(option.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(option.subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 8)
            ZStack {
                Circle()
                    .stroke(isSelected ? FBColor.brandBlue : FBColor.tertiaryText, lineWidth: 2)
                    .frame(width: 22, height: 22)
                if isSelected {
                    Circle()
                        .fill(FBColor.brandBlue)
                        .frame(width: 12, height: 12)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Feeling

/// Searchable grid of feelings. Picking one sets "— feeling 😊 happy" in the header.
struct HomeFeelingPicker: View {
    @Binding var selection: Feeling?

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    init(selection: Binding<Feeling?>) {
        _selection = selection
    }

    private let columns = [GridItem(.flexible(), spacing: 0), GridItem(.flexible(), spacing: 0)]

    private var results: [Feeling] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !term.isEmpty else { return Feeling.all }
        return Feeling.all.filter { $0.name.lowercased().contains(term) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    SearchField(placeholder: "Search", text: $query)
                        .padding(.horizontal, 16)
                    if results.isEmpty {
                        ContentUnavailableView.search(text: query)
                            .padding(.top, 24)
                    } else {
                        LazyVGrid(columns: columns, spacing: 0) {
                            ForEach(results) { feeling in
                                Button {
                                    choose(feeling)
                                } label: {
                                    HomeFeelingCell(feeling: feeling, isSelected: selection == feeling)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .overlay {
                            Rectangle().stroke(FBColor.divider, lineWidth: 0.5)
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            .background(FBColor.surface)
            .navigationTitle("How are you feeling?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if selection != nil {
                        Button("Remove") {
                            selection = nil
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private func choose(_ feeling: Feeling) {
        Haptics.selection()
        selection = feeling
        dismiss()
    }
}

private struct HomeFeelingCell: View {
    let feeling: Feeling
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text(feeling.emoji)
                .font(.system(size: 26)) // Display text
            Text(feeling.name)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .frame(height: 54)
        .background(isSelected ? FBColor.tintedBlueBackground : FBColor.surface)
        .overlay {
            Rectangle().stroke(FBColor.divider, lineWidth: 0.5)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Tag people

/// Multi-select from your friends with search. Selected people show as a strip on top.
struct HomeTagPeopleSheet: View {
    @Binding var selection: [User]

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    init(selection: Binding<[User]>) {
        _selection = selection
    }

    private var results: [User] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let friends = store.friends.sorted { $0.name < $1.name }
        guard !term.isEmpty else { return friends }
        return friends.filter { $0.name.lowercased().contains(term) }
    }

    private var sectionTitle: String {
        query.isEmpty ? "Suggestions" : "Results"
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                SearchField(placeholder: "Search for friends", text: $query)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                if !selection.isEmpty {
                    selectedStrip
                    HairlineDivider()
                }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        Text(sectionTitle)
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.primaryText)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                        if results.isEmpty {
                            emptyState
                        }
                        ForEach(results) { user in
                            Button {
                                toggle(user)
                            } label: {
                                HomeTagRow(user: user, isSelected: selection.contains(user))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .background(FBColor.surface)
            .navigationTitle("Tag people")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if query.isEmpty {
            ContentUnavailableView("No friends yet", systemImage: "person.2", description: Text("Friends you add will show up here."))
        } else {
            ContentUnavailableView.search(text: query)
        }
    }

    private var selectedStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(selection) { user in
                    Button {
                        toggle(user)
                    } label: {
                        VStack(spacing: 4) {
                            AvatarView(user: user, size: FBAvatarSize.compact)
                                .overlay(alignment: .topTrailing) {
                                    Image(systemName: "xmark")
                                        .font(.system(size: FBIconSize.xs, weight: .bold))
                                        .foregroundStyle(FBColor.primaryText)
                                        .frame(width: 18, height: 18)
                                        .background(FBColor.buttonGray, in: Circle())
                                        .overlay {
                                            Circle().stroke(FBColor.surface, lineWidth: 1.5)
                                        }
                                }
                            Text(user.firstName)
                                .font(.fbCaption)
                                .foregroundStyle(FBColor.primaryText)
                                .lineLimit(1)
                                .frame(width: 56)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(user.name)")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func toggle(_ user: User) {
        Haptics.selection()
        withAnimation(.easeInOut(duration: 0.2)) {
            if let index = selection.firstIndex(of: user) {
                selection.remove(at: index)
            } else {
                selection.append(user)
            }
        }
    }
}

private struct HomeTagRow: View {
    let user: User
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(user: user, size: FBAvatarSize.post)
            Text(user.name)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Spacer(minLength: 8)
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: FBIconSize.xl))
                .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.tertiaryText)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Check in

struct HomePlace: Identifiable, Hashable {
    let name: String
    let category: String
    /// Miles from the user.
    let distance: Double

    var id: String { name }

    var distanceText: String {
        String(format: "%.1f mi", distance)
    }

    static let nearby: [HomePlace] = [
        HomePlace(name: "Sunrise Bakery", category: "Bakery", distance: 0.2),
        HomePlace(name: "Blue Door Coffee", category: "Coffee shop", distance: 0.3),
        HomePlace(name: "Green Leaf Market", category: "Grocery store", distance: 0.4),
        HomePlace(name: "Luigi's Pizzeria", category: "Pizza place", distance: 0.5),
        HomePlace(name: "Iron Works Gym", category: "Gym", distance: 0.7),
        HomePlace(name: "City Public Library", category: "Library", distance: 0.9),
        HomePlace(name: "Harbor Sushi Bar", category: "Sushi restaurant", distance: 1.1),
        HomePlace(name: "Golden Gate Park", category: "Park", distance: 1.3),
        HomePlace(name: "Dolores Park", category: "Park", distance: 1.6),
        HomePlace(name: "Bay Cinema 12", category: "Movie theater", distance: 1.9),
        HomePlace(name: "Union Square", category: "Shopping district", distance: 2.2),
        HomePlace(name: "Ferry Building Marketplace", category: "Market", distance: 2.4),
        HomePlace(name: "Twin Peaks", category: "Scenic lookout", distance: 2.7),
        HomePlace(name: "Pier 39", category: "Tourist attraction", distance: 3.1),
        HomePlace(name: "Ocean Beach", category: "Beach", distance: 3.8),
    ]
}

/// "Search for location": nearby places with distance, or add your own.
struct HomeCheckInSheet: View {
    @Binding var selection: String?

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    init(selection: Binding<String?>) {
        _selection = selection
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var results: [HomePlace] {
        let term = trimmedQuery.lowercased()
        guard !term.isEmpty else { return HomePlace.nearby }
        return HomePlace.nearby.filter {
            $0.name.lowercased().contains(term) || $0.category.lowercased().contains(term)
        }
    }

    /// The typed name, offered as a custom place when it isn't in the list.
    private var customPlace: String? {
        let name = trimmedQuery
        guard !name.isEmpty else { return nil }
        let exists = HomePlace.nearby.contains { $0.name.caseInsensitiveCompare(name) == .orderedSame }
        return exists ? nil : name
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    SearchField(placeholder: "Where are you?", text: $query)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    if let customPlace {
                        Button {
                            choose(customPlace)
                        } label: {
                            HomeActionRow(symbol: "plus", color: FBColor.brandBlue, title: "Add \"\(customPlace)\"")
                        }
                        .buttonStyle(.plain)
                    }
                    if selection != nil {
                        Button {
                            selection = nil
                            dismiss()
                        } label: {
                            HomeActionRow(symbol: "xmark", color: FBColor.secondaryText, title: "Remove location")
                        }
                        .buttonStyle(.plain)
                    }
                    Text("Nearby")
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 6)
                    ForEach(results) { place in
                        Button {
                            choose(place.name)
                        } label: {
                            HomePlaceRow(place: place, isSelected: selection == place.name)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .background(FBColor.surface)
            .navigationTitle("Search for location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func choose(_ name: String) {
        Haptics.selection()
        selection = name
        dismiss()
    }
}

private struct HomePlaceRow: View {
    let place: HomePlace
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mappin")
                .font(.system(size: FBIconSize.regular, weight: .semibold))
                .foregroundStyle(FBColor.checkInRed)
                .frame(width: 44, height: 44)
                .background(FBColor.inputBackground, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(place.name)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text("\(place.category) · \(place.distanceText)")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: FBIconSize.medium, weight: .bold))
                    .foregroundStyle(FBColor.accent)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// A one-line action row with a round icon ("Add ...", "Remove location").
private struct HomeActionRow: View {
    let symbol: String
    let color: Color
    let title: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.regular, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 44, height: 44)
                .background(FBColor.inputBackground, in: Circle())
            Text(title)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

// MARK: - Full tool list

/// The expanded "Add to your post" list.
struct HomeComposerToolsSheet: View {
    let activeTools: Set<HomeComposerTool>
    let onSelect: (HomeComposerTool) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Add to your post")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .padding(.horizontal, 16)
                    .padding(.top, 20)
                    .padding(.bottom, 8)
                ForEach(HomeComposerTool.allCases) { tool in
                    Button {
                        onSelect(tool)
                    } label: {
                        HStack(spacing: 14) {
                            HomeComposerToolIcon(tool: tool)
                                .frame(width: 32)
                            Text(tool.title)
                                .font(.fbBodyLarge)
                                .foregroundStyle(FBColor.primaryText)
                            Spacer(minLength: 8)
                            if activeTools.contains(tool) {
                                Image(systemName: "checkmark")
                                    .font(.system(size: FBIconSize.medium, weight: .bold))
                                    .foregroundStyle(FBColor.accent)
                            }
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 52)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    HairlineDivider(leadingInset: 62)
                }
            }
            .padding(.bottom, 12)
        }
        .background(FBColor.surface)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
