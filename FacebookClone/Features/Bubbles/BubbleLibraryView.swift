import SwiftUI

/// Every Bubble you can play: yours, your Groups', friends', chains, saved and popular.
struct BubbleLibraryView: View {
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    @State private var query = ""
    @State private var formula: BubbleFormula?

    private let columns = [GridItem(.flexible(), spacing: 12, alignment: .top), GridItem(.flexible(), spacing: 12, alignment: .top)]

    var body: some View {
        let sections = bubbleStore.librarySections(query: query, formula: formula)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20, pinnedViews: []) {
                SearchField(placeholder: "Search Bubbles", text: $query)
                    .padding(.horizontal, FBMetrics.screenPadding)
                chips
                if query.isEmpty && formula == nil { blowBanner }
                if sections.isEmpty {
                    emptyState
                } else {
                    ForEach(sections) { section in
                        sectionView(section)
                    }
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(FBColor.surface)
        .navigationTitle("Library")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ChipView(title: "All", isSelected: formula == nil) { formula = nil }
                ForEach(BubbleFormula.allCases.filter { $0 != .make }, id: \.self) { item in
                    ChipView(title: item.title, symbol: item.symbol, isSelected: formula == item) {
                        formula = formula == item ? nil : item
                    }
                }
            }
            .padding(.horizontal, FBMetrics.screenPadding)
        }
    }

    private var blowBanner: some View {
        Button {
            router.openStudio()
        } label: {
            HStack(spacing: 12) {
                BubbleOrb(size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Blow a bubble")
                        .font(.fbHeadline)
                    Text("Tell Muse your idea. It makes the game.")
                        .font(.fbMeta)
                }
                Spacer(minLength: 0)
                Image(systemName: "plus")
                    .font(.system(size: FBIconSize.regular, weight: .bold))
            }
            .foregroundStyle(BubbleGlow.ink)
            .padding(14)
            .background(BubbleGlow.brandGradient.opacity(0.85), in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous).strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
        }
        .buttonStyle(.pressable)
        .padding(.horizontal, FBMetrics.screenPadding)
    }

    private func sectionView(_ section: BubbleStore.LibrarySection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: section.symbol)
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
                Text(section.title)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(section.bubbles) { bubble in
                    Button {
                        if section.id == "chains", let chainID = bubble.chainID {
                            router.push(.bubbleChain(chainID))
                        } else {
                            router.push(.bubble(bubble.id))
                        }
                    } label: {
                        BubbleCard(bubble: bubble, style: .regular)
                    }
                    .buttonStyle(.pressable)
                }
            }
            .padding(.horizontal, FBMetrics.screenPadding)
        }
    }

    private var emptyState: some View {
        let filtering = !query.isEmpty || formula != nil
        return VStack(spacing: 12) {
            BubbleOrb(size: 72)
            Text(filtering ? "No Bubbles match" : "Your Library is empty")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
            Text(filtering ? "Try another word or clear the filter." : "Bubbles you make, save or pop into show up here.")
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .multilineTextAlignment(.center)
            if filtering {
                Button("Clear filters") { query = ""; formula = nil }
                    .buttonStyle(.fb(.secondary, expand: false, height: 40))
            }
            Button("Blow a bubble") { router.openStudio() }
                .buttonStyle(.fb(.primary, expand: false, height: 40))
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.vertical, 40)
    }
}

#Preview {
    NavigationStack { BubbleLibraryView() }.previewEnvironment()
}
