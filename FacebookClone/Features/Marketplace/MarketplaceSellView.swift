import SwiftUI
import PhotosUI

private struct MarketplaceSellPhoto: Identifiable {
    let id = UUID()
    let data: Data
}

struct MarketplaceSellView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    /// Called after the sheet is dismissed with the newly created listing.
    var onPublished: (Listing) -> Void = { _ in }

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var photos: [MarketplaceSellPhoto] = []
    @State private var title = ""
    @State private var priceText = ""
    @State private var isFree = false
    @State private var category: ListingCategory = .electronics
    @State private var condition: ItemCondition = .good
    @State private var details = ""
    @State private var city = ""
    @State private var hideFromFriends = false

    private let maxPhotos = 10

    private var canPublish: Bool {
        let hasTitle = !title.trimmingCharacters(in: .whitespaces).isEmpty
        let hasPrice = isFree || Int(priceText) != nil
        return hasTitle && hasPrice
    }

    var body: some View {
        NavigationStack {
            Form {
                photosSection
                Section("About this item") {
                    TextField("Title", text: $title)
                    priceRow
                    Picker("Category", selection: $category) {
                        ForEach(ListingCategory.allCases) { category in
                            Text(category.title).tag(category)
                        }
                    }
                    Picker("Condition", selection: $condition) {
                        ForEach(ItemCondition.allCases) { condition in
                            Text(condition.title).tag(condition)
                        }
                    }
                    TextField("Description", text: $details, axis: .vertical)
                        .lineLimit(3...8)
                }
                Section("Location") {
                    TextField("City", text: $city)
                }
                Section {
                    Toggle("Hide from friends", isOn: $hideFromFriends)
                } footer: {
                    Text("Friends on Facebook won't see this listing.")
                }
            }
            .navigationTitle("Item for sale")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Publish") { publish() }
                        .fontWeight(.semibold)
                        .disabled(!canPublish)
                }
            }
            .onAppear {
                if city.isEmpty { city = store.me.city }
            }
            .onChange(of: pickerItems) {
                loadPickedItems()
            }
        }
    }

    // MARK: Photos

    private var photosSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    if photos.count < maxPhotos {
                        addTile
                    }
                    ForEach(photos) { photo in
                        thumbnail(photo)
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("Photos · \(photos.count)/\(maxPhotos)")
        }
    }

    private var addTile: some View {
        PhotosPicker(
            selection: $pickerItems,
            maxSelectionCount: max(1, maxPhotos - photos.count),
            matching: .images
        ) {
            VStack(spacing: 6) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 22))
                Text("Add photos")
                    .font(.fbMeta)
            }
            .foregroundStyle(FBColor.accent)
            .frame(width: 96, height: 96)
            .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func thumbnail(_ photo: MarketplaceSellPhoto) -> some View {
        RemoteImage(url: nil, data: photo.data)
            .frame(width: 96, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(alignment: .topTrailing) {
                Button {
                    photos.removeAll { $0.id == photo.id }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Color.black.opacity(0.65), in: Circle())
                }
                .buttonStyle(.plain)
                .padding(4)
                .accessibilityLabel("Remove photo")
            }
    }

    private var priceRow: some View {
        HStack {
            Text("$")
                .foregroundStyle(.secondary)
            TextField("Price", text: $priceText)
                .keyboardType(.numberPad)
                .disabled(isFree)
                .opacity(isFree ? 0.4 : 1)
            Toggle("Free", isOn: $isFree)
                .labelsHidden()
            Text("Free")
                .foregroundStyle(FBColor.secondaryText)
        }
    }

    // MARK: Actions

    private func loadPickedItems() {
        let items = pickerItems
        guard !items.isEmpty else { return }
        Task {
            for item in items {
                if photos.count >= maxPhotos { break }
                if let data = try? await item.loadTransferable(type: Data.self) {
                    photos.append(MarketplaceSellPhoto(data: data))
                }
            }
            pickerItems = []
        }
    }

    private func publish() {
        let price = isFree ? 0 : (Int(priceText) ?? 0)
        let listing = store.createListing(
            title: title.trimmingCharacters(in: .whitespaces),
            price: price,
            category: category,
            condition: condition,
            details: details,
            imageData: photos.map { $0.data },
            city: city
        )
        Haptics.success()
        dismiss()
        onPublished(listing)
    }
}

#Preview {
    MarketplaceSellView().previewEnvironment()
}
