import SwiftUI

/// How big a `BubbleCard` is drawn.
enum BubbleCardStyle {
    /// Grid tile: cover on top, title and rule below.
    case regular
    /// Small square for carousels and profile grids.
    case compact
    /// Full-width row with the cover on the left.
    case wide
}

/// A Bubble's cover: its Muse Image art when there is one, otherwise a Glow gradient in the
/// Bubble's palette with drifting orbs and its emoji. Fills exactly the frame it is given.
struct BubbleCoverView: View {
    let bubble: Bubble
    var showsEmoji = true

    var body: some View {
        let palette = BubbleGlow.palette(bubble.paletteID)
        ZStack {
            palette.gradient
            if let data = bubble.coverImageData {
                RemoteImage(url: nil, data: data, placeholder: .clear)
            } else {
                GeometryReader { proxy in
                    let side = min(proxy.size.width, proxy.size.height)
                    BubbleOrb(size: side * 0.42, tint: palette.glow)
                        .position(x: proxy.size.width * 0.32, y: proxy.size.height * 0.4)
                    BubbleOrb(size: side * 0.2, tint: palette.glow)
                        .position(x: proxy.size.width * 0.74, y: proxy.size.height * 0.28)
                    BubbleOrb(size: side * 0.13, tint: palette.glow)
                        .position(x: proxy.size.width * 0.68, y: proxy.size.height * 0.72)
                }
                if showsEmoji {
                    Text(bubble.emoji)
                        .font(.system(size: 34)) // Display text: cover glyph
                        .shadow(color: .white.opacity(0.8), radius: 8)
                }
            }
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

/// The small pill on a cover: "Daily", "Level 2" or the formula.
struct BubbleCoverTag: View {
    let bubble: Bubble

    private var text: String {
        if bubble.isDaily { return "Daily" }
        if bubble.isIcebreaker { return "Icebreaker" }
        if let level = bubble.levelIndex { return "Level \(level)" }
        return bubble.formula.title
    }

    private var symbol: String {
        if bubble.isDaily { return "sun.max.fill" }
        if bubble.isIcebreaker { return "hands.sparkles.fill" }
        if bubble.levelIndex != nil { return "link" }
        return bubble.formula.symbol
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.xs, weight: .bold))
            Text(text)
                .font(.fbMicroEmphasized)
        }
        .foregroundStyle(BubbleGlow.palette(bubble.paletteID).isDark ? Color.white : BubbleGlow.ink)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.55), lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}

/// A Bubble in lists, grids and carousels. Keep this initializer stable; other screens use it.
struct BubbleCard: View {
    let bubble: Bubble
    var style: BubbleCardStyle = .regular

    private var accessibilitySummary: String {
        var parts = [bubble.title, bubble.rule]
        if bubble.isDaily { parts.append("Daily \(ProductName.singular)") }
        if let level = bubble.levelIndex { parts.append("Level \(level)") }
        if bubble.category != .play { parts.append(bubble.category.title) }
        return parts.joined(separator: ". ")
    }

    var body: some View {
        switch style {
        case .regular:
            VStack(alignment: .leading, spacing: 8) {
                BubbleCoverView(bubble: bubble)
                    .aspectRatio(4.0 / 5.0, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .overlay(alignment: .topLeading) {
                        BubbleCoverTag(bubble: bubble).padding(8)
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.5), lineWidth: 1)
                    }
                    .shadow(color: BubbleGlow.palette(bubble.paletteID).top.opacity(0.45), radius: 8, y: 3)
                Text(bubble.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(bubble.rule)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                BubbleCategoryChip(category: bubble.category)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)
        case .compact:
            BubbleCoverView(bubble: bubble)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    Text(bubble.title)
                        .font(.fbCaptionEmphasized)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(6)
                        .shadow(color: .black.opacity(0.35), radius: 3)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilitySummary)
        case .wide:
            HStack(spacing: 12) {
                BubbleCoverView(bubble: bubble, showsEmoji: true)
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(bubble.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text(bubble.rule)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)
        }
    }
}
