import SwiftUI

/// Model for one tile in the Menu grid.
struct MenuTileItem: Identifiable {
    let id: String
    let title: String
    let symbol: String
    let color: Color
    var badge: Int = 0
    let action: () -> Void
}

/// White rounded card with a colored icon and a title.
struct MenuTile: View {
    let item: MenuTileItem

    var body: some View {
        Button {
            Haptics.light()
            item.action()
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Image(systemName: item.symbol)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(item.color)
                        .frame(height: 30)
                    Spacer()
                    if item.badge > 0 {
                        BadgeCount(count: item.badge)
                    }
                }
                Text(item.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 1)
        }
        .buttonStyle(.pressable)
    }
}

/// A row inside a collapsible Menu section.
struct MenuLinkRow: View {
    let title: String
    let symbol: String
    var detail: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 34, height: 34)
                    .background(FBColor.buttonGray, in: Circle())
                Text(title)
                    .font(.fbBodyLarge)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                if let detail {
                    Text(detail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(FBColor.tertiaryText)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A white card with a header that collapses its content.
struct MenuCollapsibleSection<Content: View>: View {
    let title: String
    let symbol: String
    @State private var isExpanded = false
    private let content: Content

    init(title: String, symbol: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.symbol = symbol
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.25)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: symbol)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(FBColor.primaryText)
                        .frame(width: 34, height: 34)
                        .background(FBColor.buttonGray, in: Circle())
                    Text(title)
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(FBColor.secondaryText)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)

            if isExpanded {
                VStack(spacing: 0) {
                    HairlineDivider(leadingInset: 12)
                    content
                        .padding(.vertical, 4)
                }
                .transition(.opacity)
            }
        }
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 1)
        .clipped()
    }
}

/// Sheet with three radio rows for the appearance setting.
struct MenuDarkModeSheet: View {
    @AppStorage(SettingsKey.appearance) private var appearance: AppearanceMode = .system
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Dark mode")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(FBColor.primaryText)
                        .frame(width: 32, height: 32)
                        .background(FBColor.buttonGray, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .padding(16)
            Text("Adjust the appearance of Facebook to reduce glare and give your eyes a break.")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            ForEach(AppearanceMode.allCases) { mode in
                Button {
                    Haptics.selection()
                    appearance = mode
                } label: {
                    HStack {
                        Text(mode.title)
                            .font(.fbBodyLarge)
                            .foregroundStyle(FBColor.primaryText)
                        Spacer()
                        Image(systemName: appearance == mode ? "largecircle.fill.circle" : "circle")
                            .font(.system(size: 22))
                            .foregroundStyle(appearance == mode ? FBColor.accent : FBColor.tertiaryText)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .background(FBColor.surface)
    }
}
