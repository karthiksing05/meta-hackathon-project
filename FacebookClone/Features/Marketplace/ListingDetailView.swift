import SwiftUI
import MapKit

struct ListingDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    let listing: Listing

    @State private var page = 0
    @State private var showViewer = false
    @State private var messageText = "Hi, is this available?"
    @State private var sentChat: Conversation?
    @State private var descriptionExpanded = false
    @State private var showDeleteConfirm = false

    private let quickReplies = [
        "Is this still available?",
        "Is the price negotiable?",
        "Can you deliver?",
        "What condition is it in?"
    ]

    private var images: [MarketplaceImageItem] { listing.marketplaceImages }

    private var similar: [Listing] {
        let others = store.listings.filter { $0.id != listing.id }
        let sameCategory = others.filter { $0.category == listing.category }
        let rest = others.filter { $0.category != listing.category }
        return Array((sameCategory + rest).prefix(12))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                pager
                titleBlock
                actionRow
                if listing.isMine {
                    ownerCard
                } else {
                    messageCard
                }
                HairlineDivider()
                detailsBlock
                HairlineDivider()
                locationBlock
                HairlineDivider()
                sellerBlock
                FeedSeparator()
                picksBlock
            }
        }
        .background(FBColor.surface)
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("")
        .onAppear { MarketplaceRecents.shared.record(listing) }
        .fullScreenCover(isPresented: $showViewer) {
            PhotoViewer(media: listing.marketplaceMedia, startIndex: page)
        }
        .confirmationDialog("Delete this listing?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete listing", role: .destructive) {
                store.deleteListing(listing)
                Haptics.warning()
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: Pager

    private var pager: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if images.isEmpty {
                    Rectangle()
                        .fill(FBColor.skeleton)
                        .overlay {
                            Image(systemName: listing.category.symbol)
                                .font(.system(size: 44))
                                .foregroundStyle(FBColor.tertiaryText)
                        }
                } else {
                    TabView(selection: $page) {
                        ForEach(images) { item in
                            RemoteImage(url: item.url, data: item.data)
                                .contentShape(Rectangle())
                                .onTapGesture { showViewer = true }
                                .tag(item.id)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if images.count > 1 {
                    Text("\(page + 1)/\(images.count)")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.black.opacity(0.6), in: Capsule())
                        .padding(12)
                        .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .topLeading) {
                statusBadge.padding(12)
            }
            .clipped()
    }

    @ViewBuilder
    private var statusBadge: some View {
        if listing.isSold {
            MarketplaceBadge(text: "Sold", color: FBColor.notificationRed)
        } else if listing.isPending {
            MarketplaceBadge(text: "Pending", color: FBColor.feelingYellow)
        }
    }

    // MARK: Title

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(listing.title)
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
            HStack(spacing: 8) {
                Text(listing.priceText)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                if let original = listing.originalPriceText {
                    Text(original)
                        .font(.fbBody)
                        .strikethrough()
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Text("Listed \(listing.createdAt.fbLong) in \(listing.city)")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    // MARK: Actions

    private var actionRow: some View {
        HStack(alignment: .top, spacing: 0) {
            Button {
                focusMessage()
            } label: {
                MarketplaceRoundLabel(symbol: "message.fill", title: "Message", highlighted: true)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)

            Button {
                store.toggleSave(listing)
                Haptics.light()
            } label: {
                MarketplaceRoundLabel(
                    symbol: listing.isSaved ? "bookmark.fill" : "bookmark",
                    title: listing.isSaved ? "Saved" : "Save",
                    highlighted: listing.isSaved
                )
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)

            ShareLink(item: listing.marketplaceShareText) {
                MarketplaceRoundLabel(symbol: "square.and.arrow.up", title: "Share", highlighted: false)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)

            Menu {
                Button(role: .destructive) {
                    store.showToast("Thanks for reporting this listing", symbol: "flag.fill")
                } label: {
                    Label("Report listing", systemImage: "flag")
                }
                Button {
                    store.showToast("Listing hidden", symbol: "eye.slash")
                    dismiss()
                } label: {
                    Label("Hide listing", systemImage: "eye.slash")
                }
            } label: {
                MarketplaceRoundLabel(symbol: "ellipsis", title: "More", highlighted: false)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 16)
    }

    private func focusMessage() {
        Haptics.light()
        if let sentChat {
            router.openChat(sentChat)
        } else {
            router.openChat(store.conversation(with: listing.seller))
        }
    }

    // MARK: Message seller

    private var messageCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Send seller a message")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            if let chat = sentChat {
                sentRow(chat)
            } else {
                composeRow
                quickReplyRow
            }
        }
        .padding(16)
        .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }

    private func sentRow(_ chat: Conversation) -> some View {
        Button {
            router.openChat(chat)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(FBColor.online)
                Text("Message sent · ")
                    .foregroundStyle(FBColor.primaryText)
                + Text("See conversation")
                    .foregroundStyle(FBColor.accent)
                Spacer()
            }
            .font(.fbBody)
        }
        .buttonStyle(.plain)
    }

    private var composeRow: some View {
        HStack(spacing: 8) {
            TextField("Write a message", text: $messageText)
                .font(.fbBodyLarge)
                .padding(.horizontal, 14)
                .frame(height: 40)
                .background(FBColor.surface, in: Capsule())
            Button("Send") { sendMessage() }
                .buttonStyle(.fb(.primary, expand: false, height: 40))
                .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private var quickReplyRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(quickReplies, id: \.self) { reply in
                    ChipView(title: reply) { messageText = reply }
                }
            }
        }
    }

    private func sendMessage() {
        let text = messageText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        sentChat = store.messageSeller(about: listing, text: text)
        Haptics.success()
    }

    // MARK: Owner

    private var ownerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                store.toggleSold(listing)
            } label: {
                Text(listing.isSold ? "Mark as available" : "Mark as sold")
            }
            .buttonStyle(.fbPrimary)
            ShareLink(item: listing.marketplaceShareText) {
                Text("Share")
            }
            .buttonStyle(.fbSecondary)
            Button {
                showDeleteConfirm = true
            } label: {
                Text("Delete listing")
            }
            .buttonStyle(.fb(.destructive))
            Text("\(listing.viewCount) people viewed this listing")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }

    // MARK: Details

    private var detailsBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Details")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            detailRow(label: "Condition", value: listing.condition.title)
            NavigationLink(value: Route.marketplaceCategory(listing.category)) {
                HStack {
                    Text("Category")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                    Spacer()
                    Text(listing.category.title)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                }
            }
            .buttonStyle(.plain)
            if !listing.details.isEmpty {
                descriptionBlock
            }
        }
        .padding(16)
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
            Spacer()
            Text(value)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
        }
    }

    private var descriptionBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(listing.details)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(descriptionExpanded ? nil : 4)
            if !descriptionExpanded && listing.details.count > 160 {
                Button("See more") {
                    withAnimation { descriptionExpanded = true }
                }
                .font(.fbButton)
                .foregroundStyle(FBColor.accent)
            }
        }
    }

    // MARK: Location

    private var locationBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Location")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            Map(
                initialPosition: .region(
                    MKCoordinateRegion(
                        center: coordinate,
                        latitudinalMeters: 5000,
                        longitudinalMeters: 5000
                    )
                ),
                interactionModes: []
            ) {
                MapCircle(center: coordinate, radius: 900)
                    .foregroundStyle(FBColor.brandBlue.opacity(0.2))
                    .stroke(FBColor.brandBlue, lineWidth: 2)
            }
            .frame(height: 170)
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .allowsHitTesting(false)
            Text(listing.city)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
            Text("Approximate location to protect the seller's privacy")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .padding(16)
    }

    private var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: listing.latitude, longitude: listing.longitude)
    }

    // MARK: Seller

    private var sellerBlock: some View {
        let seller = listing.seller
        let year = Calendar.current.component(.year, from: seller.joinedDate)
        return VStack(alignment: .leading, spacing: 12) {
            Text("Seller information")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            HStack(spacing: 12) {
                AvatarView(user: seller, size: FBAvatarSize.compact)
                VStack(alignment: .leading, spacing: 3) {
                    Text(seller.firstName + " " + seller.lastName)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Joined Facebook in \(String(year))")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    HStack(spacing: 6) {
                        MarketplaceStars(rating: seller.marketplaceRating)
                        Text("\(String(format: "%.1f", seller.marketplaceRating)) (\(seller.marketplaceRatingCount))")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                Spacer()
            }
            NavigationLink(value: Route.profile(seller)) {
                Text("Seller details")
            }
            .buttonStyle(.fbSecondary)
        }
        .padding(16)
    }

    // MARK: Similar

    private var picksBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Today's picks")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
                .padding(.horizontal, 16)
                .padding(.top, 14)
            MarketplaceGrid(listings: similar)
        }
    }
}

struct MarketplaceRoundLabel: View {
    let symbol: String
    let title: String
    let highlighted: Bool

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.regular, weight: .semibold))
                .foregroundStyle(highlighted ? FBColor.accent : FBColor.primaryText)
                .frame(width: 44, height: 44)
                .background(highlighted ? FBColor.tintedBlueBackground : FBColor.buttonGray, in: Circle())
            Text(title)
                .font(.fbMeta)
                .foregroundStyle(FBColor.primaryText)
        }
    }
}
