import SwiftUI
import Observation

// MARK: - Listing helpers

struct MarketplaceImageItem: Identifiable {
    let id: Int
    let url: URL?
    let data: Data?
}

extension Listing {
    /// Every image of the listing, user photos first.
    var marketplaceImages: [MarketplaceImageItem] {
        var items: [MarketplaceImageItem] = []
        for data in imageData {
            items.append(MarketplaceImageItem(id: items.count, url: nil, data: data))
        }
        for url in imageURLs {
            items.append(MarketplaceImageItem(id: items.count, url: url, data: nil))
        }
        return items
    }

    var marketplaceMedia: [Media] {
        var media: [Media] = []
        for data in imageData { media.append(Media.localPhoto(data)) }
        for url in imageURLs { media.append(Media.photo(url)) }
        return media
    }

    var marketplaceIsJustListed: Bool {
        Date().timeIntervalSince(createdAt) < 24 * 3600
    }

    var marketplaceShareText: String {
        "\(title) - \(priceText) on Marketplace"
    }

    /// "Seattle" or "Seattle · 12 mi".
    var marketplaceLocationText: String {
        if distanceMiles < 1 { return city }
        return "\(city) · \(Int(distanceMiles.rounded())) mi"
    }
}

extension User {
    private var marketplaceSeedValue: Int {
        id.unicodeScalars.reduce(0) { partial, scalar in partial &+ Int(scalar.value) }
    }

    /// Deterministic mock rating between 4.0 and 4.9.
    var marketplaceRating: Double {
        4.0 + Double(marketplaceSeedValue % 10) / 10.0
    }

    var marketplaceRatingCount: Int {
        12 + marketplaceSeedValue % 88
    }
}

// MARK: - Recently viewed

@Observable
final class MarketplaceRecents {
    static let shared = MarketplaceRecents()

    var ids: [String] = []

    func record(_ listing: Listing) {
        ids.removeAll { $0 == listing.id }
        ids.insert(listing.id, at: 0)
        if ids.count > 20 { ids.removeLast(ids.count - 20) }
    }
}

// MARK: - Sorting and filtering

enum MarketplaceSort: String, CaseIterable, Identifiable {
    case suggested
    case priceLow
    case priceHigh
    case newest
    case nearest

    var id: String { rawValue }

    var title: String {
        switch self {
        case .suggested: return "Suggested"
        case .priceLow: return "Price: low to high"
        case .priceHigh: return "Price: high to low"
        case .newest: return "Date listed: newest"
        case .nearest: return "Distance: nearest"
        }
    }

    func sorted(_ listings: [Listing]) -> [Listing] {
        switch self {
        case .suggested: return listings
        case .priceLow: return listings.sorted { $0.price < $1.price }
        case .priceHigh: return listings.sorted { $0.price > $1.price }
        case .newest: return listings.sorted { $0.createdAt > $1.createdAt }
        case .nearest: return listings.sorted { $0.distanceMiles < $1.distanceMiles }
        }
    }
}

@Observable
final class MarketplaceFilters {
    var sort: MarketplaceSort = .suggested
    var minPrice: String = ""
    var maxPrice: String = ""
    var conditions: Set<ItemCondition> = []
    var radius: Double = 40

    var isActive: Bool {
        sort != .suggested || !minPrice.isEmpty || !maxPrice.isEmpty || !conditions.isEmpty
    }

    func reset() {
        sort = .suggested
        minPrice = ""
        maxPrice = ""
        conditions = []
    }

    func apply(to listings: [Listing]) -> [Listing] {
        let low = Int(minPrice)
        let high = Int(maxPrice)
        let filtered = listings.filter { listing in
            if let low, listing.price < low { return false }
            if let high, listing.price > high { return false }
            if !conditions.isEmpty && !conditions.contains(listing.condition) { return false }
            return listing.distanceMiles <= radius
        }
        return sort.sorted(filtered)
    }
}

// MARK: - Grid cell

struct MarketplaceListingImage: View {
    let listing: Listing

    var body: some View {
        let first = listing.marketplaceImages.first
        RemoteImage(url: first?.url, data: first?.data)
    }
}

struct MarketplaceGridCell: View {
    @Environment(AppStore.self) private var store
    let listing: Listing
    var onHide: ((Listing) -> Void)? = nil

    var body: some View {
        NavigationLink(value: Route.listing(listing)) {
            VStack(alignment: .leading, spacing: 0) {
                imageBlock
                textBlock
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                store.toggleSave(listing)
            } label: {
                Label(listing.isSaved ? "Unsave" : "Save", systemImage: listing.isSaved ? "bookmark.slash" : "bookmark")
            }
            ShareLink(item: listing.marketplaceShareText) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            if let onHide {
                Button {
                    onHide(listing)
                } label: {
                    Label("Hide", systemImage: "eye.slash")
                }
            }
        }
    }

    private var imageBlock: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { MarketplaceListingImage(listing: listing) }
            .overlay(alignment: .topLeading) { badge.padding(6) }
            .overlay(alignment: .topTrailing) {
                if listing.isSaved {
                    Image(systemName: "bookmark.fill")
                        .font(.system(size: FBIconSize.small, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(Color.black.opacity(0.45), in: Circle())
                        .padding(6)
                }
            }
            .clipped()
    }

    @ViewBuilder
    private var badge: some View {
        if listing.isSold {
            MarketplaceBadge(text: "Sold", color: FBColor.notificationRed)
        } else if listing.isPending {
            MarketplaceBadge(text: "Pending", color: FBColor.feelingYellow)
        } else if listing.marketplaceIsJustListed {
            MarketplaceBadge(text: "Just listed", color: FBColor.photoGreen)
        }
    }

    private var textBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(listing.priceText)
                    .font(.fbName)
                    .fontWeight(.bold)
                    .foregroundStyle(FBColor.primaryText)
                if let original = listing.originalPriceText {
                    Text(original)
                        .font(.fbMeta)
                        .strikethrough()
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Text(listing.title)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Text(listing.marketplaceLocationText)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .padding(.bottom, 10)
    }
}

struct MarketplaceBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.fbMicroEmphasized)
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color, in: Capsule())
    }
}

/// A two-column grid of listings with 2 pt spacing.
struct MarketplaceGrid: View {
    let listings: [Listing]
    var onHide: ((Listing) -> Void)? = nil

    private let columns = [
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 2) {
            ForEach(listings) { listing in
                MarketplaceGridCell(listing: listing, onHide: onHide)
            }
        }
    }
}

struct MarketplaceSkeletonGrid: View {
    private let columns = [
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 2) {
            ForEach(0..<6, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 6) {
                    Color.clear
                        .aspectRatio(1, contentMode: .fit)
                        .background(FBColor.skeleton)
                    SkeletonBlock(width: 70, height: 14)
                        .padding(.horizontal, 8)
                    SkeletonBlock(width: 110, height: 12)
                        .padding(.horizontal, 8)
                    SkeletonBlock(width: 80, height: 10)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 10)
                }
            }
        }
        .shimmering()
    }
}

/// Star row for a mock seller rating.
struct MarketplaceStars: View {
    let rating: Double

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { index in
                Image(systemName: Double(index) + 0.5 <= rating ? "star.fill" : "star")
                    .font(.system(size: FBIconSize.small))
                    .foregroundStyle(FBColor.feelingYellow)
            }
        }
    }
}

/// Small thumbnail used in list rows.
struct MarketplaceThumb: View {
    let listing: Listing
    var size: CGFloat = 64

    var body: some View {
        MarketplaceListingImage(listing: listing)
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
    }
}
