import SwiftUI

struct MarketplaceView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var filters = MarketplaceFilters()
    @State private var searchText = ""
    @State private var showSearch = false
    @State private var showSell = false
    @State private var showCategories = false
    @State private var showLocation = false
    @State private var showFilter = false
    @State private var showYou = false
    @State private var showLocalOnly = false
    @State private var hiddenIDs: Set<String> = []
    @State private var isLoading = true

    private var displayed: [Listing] {
        var items = store.listings.filter { !hiddenIDs.contains($0.id) }
        if showLocalOnly {
            items = items.filter { $0.distanceMiles <= 10 }
        }
        let query = searchText.trimmingCharacters(in: .whitespaces)
        if !query.isEmpty {
            items = items.filter { $0.title.localizedCaseInsensitiveContains(query) }
        }
        return filters.apply(to: items)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header.id("marketplaceTop")
                    if showSearch { searchBar }
                    chipsRow
                    picksHeader
                    content
                }
            }
            .refreshable {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
            .onChange(of: router.scrollToTopSignal(for: .marketplace)) {
                withAnimation { proxy.scrollTo("marketplaceTop", anchor: .top) }
            }
        }
        .background(FBColor.surface)
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(isPresented: $showYou) { MarketplaceYouView() }
        .sheet(isPresented: $showSell) { sellSheet }
        .sheet(isPresented: $showCategories) { categoriesSheet }
        .sheet(isPresented: $showLocation) {
            MarketplaceLocationSheet(filters: filters)
                .presentationDetents([.large])
        }
        .sheet(isPresented: $showFilter) {
            MarketplaceFilterSheet(filters: filters, resultCount: displayed.count)
                .presentationDetents([.large])
        }
        .task {
            guard isLoading else { return }
            try? await Task.sleep(nanoseconds: 600_000_000)
            withAnimation { isLoading = false }
        }
    }

    // MARK: Sections

    private var header: some View {
        TabHeader("Marketplace") {
            CircleButton(symbol: "person.fill", accessibilityLabel: "Your Marketplace") {
                showYou = true
            }
            CircleButton(symbol: "magnifyingglass", accessibilityLabel: "Search Marketplace") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showSearch.toggle()
                    if !showSearch { searchText = "" }
                }
            }
        }
    }

    private var searchBar: some View {
        SearchField(placeholder: "Search Marketplace", text: $searchText, autoFocus: true)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .transition(.opacity)
    }

    private var chipsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ChipView(title: "Sell", symbol: "tag.fill") { showSell = true }
                ChipView(title: "For you", isSelected: !showLocalOnly) {
                    showLocalOnly = false
                }
                ChipView(title: "Local", symbol: "location.fill", isSelected: showLocalOnly) {
                    showLocalOnly = true
                }
                ChipView(title: "Categories", symbol: "square.grid.2x2.fill") { showCategories = true }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 8)
    }

    private var picksHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Today's picks")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                CircleButton(symbol: "slider.horizontal.3", size: 32, accessibilityLabel: "Filters") {
                    showFilter = true
                }
                .overlay(alignment: .topTrailing) {
                    if filters.isActive {
                        Circle().fill(FBColor.accent).frame(width: 10, height: 10)
                    }
                }
            }
            Button {
                showLocation = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "location.fill")
                        .font(.system(size: 12))
                    Text("San Francisco · \(Int(filters.radius)) mi")
                        .font(.fbButton)
                }
                .foregroundStyle(FBColor.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            MarketplaceSkeletonGrid()
        } else if displayed.isEmpty {
            ContentUnavailableView(
                "No listings found",
                systemImage: "storefront",
                description: Text("Try changing your filters or search.")
            )
            .padding(.top, 40)
        } else {
            MarketplaceGrid(listings: displayed) { listing in
                hiddenIDs.insert(listing.id)
                store.showToast("Listing hidden", symbol: "eye.slash")
            }
        }
    }

    // MARK: Sheets

    private var sellSheet: some View {
        MarketplaceSellView { listing in
            Task {
                try? await Task.sleep(nanoseconds: 400_000_000)
                router.push(.listing(listing))
            }
        }
    }

    private var categoriesSheet: some View {
        MarketplaceCategoriesSheet { category in
            showCategories = false
            Task {
                try? await Task.sleep(nanoseconds: 400_000_000)
                router.push(.marketplaceCategory(category))
            }
        }
        .presentationDetents([.large])
    }
}

#Preview {
    NavigationStack { MarketplaceView() }.previewEnvironment()
}
