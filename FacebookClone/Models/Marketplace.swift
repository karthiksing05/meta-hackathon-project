import Foundation
import Observation

enum ListingCategory: String, CaseIterable, Identifiable, Hashable {
    case vehicles
    case rentals
    case electronics
    case furniture
    case homeGoods
    case apparel
    case family
    case garden
    case toys
    case sports
    case instruments
    case hobbies
    case pets
    case free

    var id: String { rawValue }

    var title: String {
        switch self {
        case .vehicles: return "Vehicles"
        case .rentals: return "Property Rentals"
        case .electronics: return "Electronics"
        case .furniture: return "Furniture"
        case .homeGoods: return "Home Goods"
        case .apparel: return "Apparel"
        case .family: return "Family"
        case .garden: return "Garden & Outdoor"
        case .toys: return "Toys & Games"
        case .sports: return "Sporting Goods"
        case .instruments: return "Musical Instruments"
        case .hobbies: return "Hobbies"
        case .pets: return "Pet Supplies"
        case .free: return "Free Stuff"
        }
    }

    /// SF Symbol name.
    var symbol: String {
        switch self {
        case .vehicles: return "car.fill"
        case .rentals: return "house.fill"
        case .electronics: return "desktopcomputer"
        case .furniture: return "sofa.fill"
        case .homeGoods: return "lamp.table.fill"
        case .apparel: return "tshirt.fill"
        case .family: return "figure.and.child.holdinghands"
        case .garden: return "leaf.fill"
        case .toys: return "puzzlepiece.fill"
        case .sports: return "sportscourt.fill"
        case .instruments: return "guitars.fill"
        case .hobbies: return "paintpalette.fill"
        case .pets: return "pawprint.fill"
        case .free: return "gift.fill"
        }
    }
}

enum ItemCondition: String, CaseIterable, Identifiable, Hashable {
    case new
    case likeNew
    case good
    case fair

    var id: String { rawValue }

    var title: String {
        switch self {
        case .new: return "New"
        case .likeNew: return "Used - Like New"
        case .good: return "Used - Good"
        case .fair: return "Used - Fair"
        }
    }
}

@Observable
final class Listing: Identifiable, Hashable {
    let id: String
    var title: String
    /// Whole dollars. 0 means free.
    var price: Int
    /// Set when the seller dropped the price.
    var originalPrice: Int?
    var category: ListingCategory
    var condition: ItemCondition
    var details: String
    var imageURLs: [URL]
    /// Photos picked from the library when the signed-in user creates a listing.
    var imageData: [Data]
    var seller: User
    var city: String
    var latitude: Double
    var longitude: Double
    var distanceMiles: Double
    var createdAt: Date
    var isSaved: Bool
    var isSold: Bool
    var isPending: Bool
    var isMine: Bool
    var viewCount: Int

    init(
        id: String = UUID().uuidString,
        title: String,
        price: Int,
        originalPrice: Int? = nil,
        category: ListingCategory,
        condition: ItemCondition = .good,
        details: String = "",
        imageURLs: [URL] = [],
        imageData: [Data] = [],
        seller: User,
        city: String,
        latitude: Double,
        longitude: Double,
        distanceMiles: Double,
        createdAt: Date = Date(),
        isSaved: Bool = false,
        isSold: Bool = false,
        isPending: Bool = false,
        isMine: Bool = false,
        viewCount: Int = 0
    ) {
        self.id = id
        self.title = title
        self.price = price
        self.originalPrice = originalPrice
        self.category = category
        self.condition = condition
        self.details = details
        self.imageURLs = imageURLs
        self.imageData = imageData
        self.seller = seller
        self.city = city
        self.latitude = latitude
        self.longitude = longitude
        self.distanceMiles = distanceMiles
        self.createdAt = createdAt
        self.isSaved = isSaved
        self.isSold = isSold
        self.isPending = isPending
        self.isMine = isMine
        self.viewCount = viewCount
    }

    /// "Free" or "$1,250".
    var priceText: String {
        price == 0 ? "Free" : "$" + price.withCommas
    }

    var originalPriceText: String? {
        guard let originalPrice, originalPrice > price else { return nil }
        return "$" + originalPrice.withCommas
    }

    var coverURL: URL? { imageURLs.first }

    static func == (lhs: Listing, rhs: Listing) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
