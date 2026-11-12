import SwiftUI

struct MarketplaceYouView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var pendingDelete: Listing?
    @State private var showDeleteConfirm = false

    private var recents: [Listing] {
        MarketplaceRecents.shared.ids.compactMap { store.listing(id: $0) }
    }

    /// Sellers the user might be buying from (saved and recently viewed items).
    private var buyingSellers: [User] {
        var seen: Set<String> = []
        var result: [User] = []
        for listing in store.savedListings + recents where !listing.isMine {
            if seen.insert(listing.seller.id).inserted {
                result.append(listing.seller)
            }
        }
        return Array(result.prefix(4))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ratingCard
                FeedSeparator()
                yourListings
                FeedSeparator()
                savedSection
                FeedSeparator()
                buyingSection
                FeedSeparator()
                sellingSection
                FeedSeparator()
                recentSection
            }
        }
        .background(FBColor.surface)
        .navigationTitle("You")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Delete this listing?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete listing", role: .destructive) {
                if let listing = pendingDelete {
                    store.deleteListing(listing)
                    Haptics.warning()
                }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        }
    }

    // MARK: Rating

    private var ratingCard: some View {
        let me = store.me
        return HStack(spacing: 12) {
            AvatarView(user: me, size: FBAvatarSize.row)
            VStack(alignment: .leading, spacing: 4) {
                Text(me.firstName + " " + me.lastName)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                HStack(spacing: 6) {
                    MarketplaceStars(rating: me.marketplaceRating)
                    Text("\(String(format: "%.1f", me.marketplaceRating)) · \(me.marketplaceRatingCount) ratings")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Text("Seller rating")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer()
        }
        .padding(16)
    }

    // MARK: Your listings

    private var yourListings: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Your listings", subtitle: "\(store.myListings.count) items")
            if store.myListings.isEmpty {
                Text("You haven't listed anything yet. Tap Sell on the Marketplace home to get started.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                ForEach(store.myListings) { listing in
                    myListingRow(listing)
                }
            }
        }
        .padding(16)
    }

    private func myListingRow(_ listing: Listing) -> some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.listing(listing)) {
                HStack(spacing: 12) {
                    MarketplaceThumb(listing: listing)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(listing.title)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text(listing.priceText)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.primaryText)
                        Text(listing.isSold ? "Sold" : "Available")
                            .font(.fbMeta)
                            .foregroundStyle(listing.isSold ? FBColor.notificationRed : FBColor.online)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Menu {
                Button {
                    store.toggleSold(listing)
                } label: {
                    Label(listing.isSold ? "Mark as available" : "Mark as sold", systemImage: "tag")
                }
                ShareLink(item: listing.marketplaceShareText) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                Button(role: .destructive) {
                    pendingDelete = listing
                    showDeleteConfirm = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: FBIconSize.medium, weight: .bold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 36, height: 36)
                    .background(FBColor.buttonGray, in: Circle())
            }
            .accessibilityLabel("Listing options")
        }
    }

    // MARK: Saved

    private var savedSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Saved items", subtitle: "\(store.savedListings.count) items")
            if store.savedListings.isEmpty {
                Text("Items you save will show up here.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                horizontalStrip(store.savedListings)
            }
        }
        .padding(16)
    }

    private func horizontalStrip(_ listings: [Listing]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(listings) { listing in
                    NavigationLink(value: Route.listing(listing)) {
                        VStack(alignment: .leading, spacing: 4) {
                            MarketplaceThumb(listing: listing, size: 120)
                            Text(listing.priceText)
                                .font(.fbName)
                                .foregroundStyle(FBColor.primaryText)
                            Text(listing.title)
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                                .lineLimit(1)
                        }
                        .frame(width: 120, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Buying and selling

    private var buyingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Buying", subtitle: "Chats with sellers")
            if buyingSellers.isEmpty {
                Text("Save or view items to message sellers.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                ForEach(buyingSellers) { seller in
                    Button {
                        router.openChat(store.conversation(with: seller))
                    } label: {
                        sellerRow(seller)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(16)
    }

    private func sellerRow(_ seller: User) -> some View {
        HStack(spacing: 12) {
            AvatarView(user: seller, size: FBAvatarSize.post)
            Text(seller.firstName + " " + seller.lastName)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
            Spacer()
            Image(systemName: "message.fill")
                .foregroundStyle(FBColor.accent)
        }
        .contentShape(Rectangle())
    }

    private var sellingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Selling", subtitle: "Messages from buyers")
            Button {
                router.openMessenger()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "tray.fill")
                        .font(.system(size: FBIconSize.regular))
                        .foregroundStyle(FBColor.accent)
                        .frame(width: 44, height: 44)
                        .background(FBColor.tintedBlueBackground, in: Circle())
                    Text("Open your Marketplace inbox")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.small, weight: .semibold))
                        .foregroundStyle(FBColor.secondaryText)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(16)
    }

    // MARK: Recently viewed

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Recently viewed")
            if recents.isEmpty {
                Text("Listings you open will show up here.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                horizontalStrip(recents)
            }
        }
        .padding(16)
        .padding(.bottom, 24)
    }
}
