import SwiftUI

private enum SearchFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case posts = "Posts"
    case people = "People"
    case groups = "Groups"
    case pages = "Pages"
    case marketplace = "Marketplace"
    case events = "Events"

    var id: String { rawValue }
}

/// Search screen (Route.search).
struct SearchView: View {
    var initialQuery: String = ""

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var filter: SearchFilter = .all
    @State private var showAllRecents = false
    @State private var confirmClear = false
    @State private var didPrefill = false

    private let trending = [
        "Weekend getaway ideas",
        "#hiking",
        "Best pizza near me",
        "Home workout routines",
        "Live music tonight"
    ]

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(spacing: 0) {
            topRow
            HairlineDivider()
            ScrollView {
                if trimmedQuery.isEmpty {
                    idleContent
                } else {
                    resultsContent
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(FBColor.surface)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            if !didPrefill {
                didPrefill = true
                query = initialQuery
            }
        }
        .confirmationDialog("Clear search history?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear all", role: .destructive) {
                store.clearRecentSearches()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes all of your recent searches.")
        }
    }

    // MARK: Top row

    private var topRow: some View {
        HStack(spacing: 8) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")
            SearchField(placeholder: "Search Facebook", text: $query, autoFocus: true) {
                store.addRecentSearch(query)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    private func open(_ route: Route) {
        store.addRecentSearch(trimmedQuery)
        router.push(route)
    }

    // MARK: Idle

    private var visibleRecents: [String] {
        showAllRecents ? store.recentSearches : Array(store.recentSearches.prefix(5))
    }

    private var idleContent: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if !store.recentSearches.isEmpty {
                HStack {
                    Text("Recent")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    Spacer()
                    if store.recentSearches.count > 5 {
                        Button(showAllRecents ? "See less" : "See all") {
                            withAnimation { showAllRecents.toggle() }
                        }
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 4)
                ForEach(visibleRecents, id: \.self) { term in
                    recentRow(term)
                }
                Button("Clear all") {
                    Haptics.warning()
                    confirmClear = true
                }
                .font(.fbBody)
                .foregroundStyle(FBColor.accent)
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            peopleYouMayKnow
            SearchSectionTitle(title: "Trending")
            ForEach(trending, id: \.self) { term in
                trendingRow(term)
            }
        }
        .padding(.bottom, 24)
    }

    private func recentRow(_ term: String) -> some View {
        HStack(spacing: 12) {
            Button {
                query = term
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "clock")
                        .font(.system(size: FBIconSize.regular, weight: .semibold))
                        .foregroundStyle(FBColor.primaryText)
                        .frame(width: 36, height: 36)
                        .background(FBColor.buttonGray, in: Circle())
                    Text(term)
                        .font(.fbBodyLarge)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button {
                withAnimation { store.removeRecentSearch(term) }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(term)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var peopleYouMayKnow: some View {
        let people = Array(store.suggestions.prefix(10))
        if !people.isEmpty {
            SearchSectionTitle(title: "People you may know")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(people) { user in
                        Button {
                            router.push(.profile(user))
                        } label: {
                            VStack(spacing: 6) {
                                AvatarView(user: user, size: FBAvatarSize.row)
                                Text(user.firstName)
                                    .font(.fbCaption)
                                    .foregroundStyle(FBColor.primaryText)
                                    .lineLimit(1)
                                    .frame(width: 64)
                            }
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func trendingRow(_ term: String) -> some View {
        Button {
            query = term
            store.addRecentSearch(term)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(FBColor.accent)
                    .frame(width: 36, height: 36)
                    .background(FBColor.tintedBlueBackground, in: Circle())
                Text(term)
                    .font(.fbBodyLarge)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Results

    private var resultsContent: some View {
        let results = store.search(trimmedQuery)
        return VStack(alignment: .leading, spacing: 0) {
            chips
            if results.isEmpty {
                emptyState
            } else {
                resultSections(results)
            }
        }
        .padding(.bottom, 24)
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(SearchFilter.allCases) { option in
                    ChipView(title: option.rawValue, isSelected: filter == option) {
                        Haptics.selection()
                        withAnimation { filter = option }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 40))
                .foregroundStyle(FBColor.tertiaryText)
            Text("No results for \u{201C}\(trimmedQuery)\u{201D}")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
            Text("Check the spelling or try a new search.")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
        .padding(.horizontal, 24)
    }

    private func limit<T>(_ items: [T], for target: SearchFilter) -> [T] {
        filter == .all ? Array(items.prefix(4)) : items
    }

    private func shows(_ target: SearchFilter) -> Bool {
        filter == .all || filter == target
    }

    @ViewBuilder
    private func resultSections(_ results: SearchResults) -> some View {
        if shows(.people) && !results.people.isEmpty {
            SearchSectionTitle(title: "People")
            ForEach(limit(results.people, for: .people)) { user in
                SearchPersonRow(user: user, query: trimmedQuery, open: open)
            }
        }
        if shows(.pages) && !results.pages.isEmpty {
            SearchSectionTitle(title: "Pages")
            ForEach(limit(results.pages, for: .pages)) { page in
                SearchPageRow(page: page, query: trimmedQuery, open: open)
            }
        }
        if shows(.groups) && !results.groups.isEmpty {
            SearchSectionTitle(title: "Groups")
            ForEach(limit(results.groups, for: .groups)) { group in
                SearchGroupRow(group: group, query: trimmedQuery, open: open)
            }
        }
        if shows(.events) && !results.events.isEmpty {
            SearchSectionTitle(title: "Events")
            ForEach(limit(results.events, for: .events)) { event in
                SearchEventRow(event: event, query: trimmedQuery, open: open)
            }
        }
        if shows(.marketplace) && !results.listings.isEmpty {
            SearchSectionTitle(title: "Marketplace")
            listingGrid(limit(results.listings, for: .marketplace))
        }
        if shows(.posts) && !results.posts.isEmpty {
            SearchSectionTitle(title: "Posts")
            postResults(results.posts)
        }
        if filter != .all && isFilterEmpty(results) {
            emptyState
        }
    }

    private func isFilterEmpty(_ results: SearchResults) -> Bool {
        switch filter {
        case .all: return results.isEmpty
        case .posts: return results.posts.isEmpty
        case .people: return results.people.isEmpty
        case .groups: return results.groups.isEmpty
        case .pages: return results.pages.isEmpty
        case .marketplace: return results.listings.isEmpty
        case .events: return results.events.isEmpty
        }
    }

    private func listingGrid(_ listings: [Listing]) -> some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
            spacing: 12
        ) {
            ForEach(listings) { listing in
                SearchListingCell(listing: listing, open: open)
            }
        }
        .padding(.horizontal, 12)
    }

    @ViewBuilder
    private func postResults(_ posts: [Post]) -> some View {
        if filter == .posts {
            ForEach(posts) { post in
                PostCard(post: post)
                FeedSeparator()
            }
        } else {
            ForEach(Array(posts.prefix(4))) { post in
                SearchPostRow(post: post, query: trimmedQuery, open: open)
            }
        }
    }
}

#Preview {
    NavigationStack { SearchView(initialQuery: "") }.previewEnvironment()
}
