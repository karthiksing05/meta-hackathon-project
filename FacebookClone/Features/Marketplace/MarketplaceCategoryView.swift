import SwiftUI

struct MarketplaceCategoryView: View {
    @Environment(AppStore.self) private var store

    let category: ListingCategory

    @State private var sort: MarketplaceSort = .suggested
    @State private var selectedChip: String?

    private var listings: [Listing] {
        sort.sorted(store.listings(in: category))
    }

    private var subcategories: [String] {
        switch category {
        case .vehicles: return ["Cars & Trucks", "Motorcycles", "Boats", "Parts"]
        case .rentals: return ["Apartments", "Houses", "Rooms", "Short term"]
        case .electronics: return ["Phones", "Computers", "Cameras", "Audio", "Gaming"]
        case .furniture: return ["Sofas", "Tables", "Beds", "Storage", "Desks"]
        case .homeGoods: return ["Kitchen", "Decor", "Lighting", "Appliances"]
        case .apparel: return ["Women", "Men", "Shoes", "Bags", "Accessories"]
        case .family: return ["Baby", "Kids", "Health", "Beauty"]
        case .garden: return ["Tools", "Plants", "Patio", "Grills"]
        case .toys: return ["Board games", "Video games", "Puzzles", "Outdoor toys"]
        case .sports: return ["Bikes", "Fitness", "Camping", "Water sports"]
        case .instruments: return ["Guitars", "Keyboards", "Drums", "Studio gear"]
        case .hobbies: return ["Art", "Collectibles", "Crafts", "Books"]
        case .pets: return ["Dogs", "Cats", "Aquariums", "Accessories"]
        case .free: return ["Furniture", "Clothes", "Electronics", "Other"]
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                chips
                if listings.isEmpty {
                    ContentUnavailableView(
                        "Nothing here yet",
                        systemImage: category.symbol,
                        description: Text("There are no \(category.title.lowercased()) listings right now.")
                    )
                    .padding(.top, 40)
                } else {
                    MarketplaceGrid(listings: listings)
                }
            }
        }
        .background(FBColor.surface)
        .navigationTitle(category.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(MarketplaceSort.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .accessibilityLabel("Sort")
            }
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(subcategories, id: \.self) { name in
                    ChipView(title: name, isSelected: selectedChip == name) {
                        selectedChip = selectedChip == name ? nil : name
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 10)
    }
}
