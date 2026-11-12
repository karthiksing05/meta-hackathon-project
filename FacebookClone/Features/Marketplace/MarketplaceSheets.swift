import SwiftUI
import MapKit

// MARK: - Categories

struct MarketplaceCategoriesSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onSelect: (ListingCategory) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(ListingCategory.allCases) { category in
                        tile(category)
                    }
                }
                .padding(16)
            }
            .background(FBColor.background)
            .navigationTitle("Categories")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func tile(_ category: ListingCategory) -> some View {
        Button {
            Haptics.selection()
            onSelect(category)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: category.symbol)
                    .font(.system(size: FBIconSize.large, weight: .semibold))
                    .foregroundStyle(FBColor.accent)
                    .frame(width: 44, height: 44)
                    .background(FBColor.tintedBlueBackground, in: Circle())
                Text(category.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        }
        .buttonStyle(.pressable)
    }
}

// MARK: - Location

struct MarketplaceLocationSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var filters: MarketplaceFilters

    private static let center = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)

    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: MarketplaceLocationSheet.center,
            latitudinalMeters: 160_000,
            longitudinalMeters: 160_000
        )
    )

    private var radiusMeters: Double { filters.radius * 1609.34 }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                map
                controls
            }
            .navigationTitle("Location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Apply") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private var map: some View {
        Map(position: $position) {
            MapCircle(center: MarketplaceLocationSheet.center, radius: radiusMeters)
                .foregroundStyle(FBColor.brandBlue.opacity(0.18))
                .stroke(FBColor.brandBlue, lineWidth: 2)
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "location.fill")
                    .foregroundStyle(FBColor.accent)
                Text("San Francisco, California")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
            }
            Text("Radius: \(Int(filters.radius)) mi")
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
            Slider(value: $filters.radius, in: 1...100, step: 1)
                .tint(FBColor.accent)
                .onChange(of: filters.radius) {
                    withAnimation {
                        position = .region(
                            MKCoordinateRegion(
                                center: MarketplaceLocationSheet.center,
                                latitudinalMeters: radiusMeters * 3,
                                longitudinalMeters: radiusMeters * 3
                            )
                        )
                    }
                }
            Button("Apply") { dismiss() }
                .buttonStyle(.fbPrimary)
        }
        .padding(16)
        .background(FBColor.surface)
    }
}

// MARK: - Filters

struct MarketplaceFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var filters: MarketplaceFilters
    let resultCount: Int

    var body: some View {
        NavigationStack {
            Form {
                Section("Sort by") {
                    Picker("Sort by", selection: $filters.sort) {
                        ForEach(MarketplaceSort.allCases) { sort in
                            Text(sort.title).tag(sort)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section("Price") {
                    HStack(spacing: 12) {
                        TextField("Min", text: $filters.minPrice)
                            .keyboardType(.numberPad)
                        Text("to").foregroundStyle(FBColor.secondaryText)
                        TextField("Max", text: $filters.maxPrice)
                            .keyboardType(.numberPad)
                    }
                }
                Section("Condition") {
                    ForEach(ItemCondition.allCases) { condition in
                        conditionRow(condition)
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Reset") { filters.reset() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    dismiss()
                } label: {
                    Text(resultCount == 1 ? "See 1 listing" : "See \(resultCount) listings")
                }
                .buttonStyle(.fb(.primary, expand: true, height: 44))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(FBColor.surface)
            }
        }
    }

    private func conditionRow(_ condition: ItemCondition) -> some View {
        Button {
            if filters.conditions.contains(condition) {
                filters.conditions.remove(condition)
            } else {
                filters.conditions.insert(condition)
            }
        } label: {
            HStack {
                Text(condition.title)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                if filters.conditions.contains(condition) {
                    Image(systemName: "checkmark")
                        .foregroundStyle(FBColor.accent)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
