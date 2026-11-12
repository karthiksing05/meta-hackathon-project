import SwiftUI

/// One round reaction icon: blue thumbs up, red heart, or an emoji face.
struct ReactionBadge: View {
    let type: ReactionType
    var size: CGFloat = 18
    /// Draws a thin ring in the surface color so stacked badges separate cleanly.
    var showsBorder: Bool = true

    var body: some View {
        icon
            .frame(width: size, height: size)
            .background {
                if showsBorder {
                    Circle()
                        .fill(FBColor.surface)
                        .padding(-1.5)
                }
            }
            .accessibilityLabel(type.title)
    }

    @ViewBuilder
    private var icon: some View {
        switch type {
        case .like:
            Circle()
                .fill(LinearGradient(colors: [Color(hex: 0x18AFFF), Color(hex: 0x0062DF)], startPoint: .top, endPoint: .bottom))
                .overlay {
                    Image(systemName: "hand.thumbsup.fill")
                        .font(.system(size: size * 0.52, weight: .bold))
                        .foregroundStyle(.white)
                }
        case .love:
            Circle()
                .fill(LinearGradient(colors: [Color(hex: 0xFF6680), Color(hex: 0xE61739)], startPoint: .top, endPoint: .bottom))
                .overlay {
                    Image(systemName: "heart.fill")
                        .font(.system(size: size * 0.5, weight: .bold))
                        .foregroundStyle(.white)
                }
        default:
            Text(type.emoji)
                .font(.system(size: size * 0.92))
        }
    }
}

/// Overlapping reaction icons, most popular in front.
struct ReactionBadgeStack: View {
    let types: [ReactionType]
    var size: CGFloat = 18

    var body: some View {
        HStack(spacing: -size * 0.22) {
            ForEach(Array(types.enumerated()), id: \.element) { index, type in
                ReactionBadge(type: type, size: size)
                    .zIndex(Double(types.count - index))
            }
        }
        .accessibilityElement(children: .combine)
    }
}
