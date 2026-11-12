import SwiftUI
import UIKit

// Shared Glow pieces for Muse Studio: the backdrop wash, frosted cards, buttons and chips.
// Studio is Bubbles content, so it uses the Glow look; type, icons and spacing stay Facebook tokens.

// MARK: - Decorative palette

/// Muse Studio's decorative colors, declared once next to the views that use them
/// (docs/STYLE_GUIDE.md, section 2). Brand hues come from `BubbleGlow`.
enum StudioGlow {
    /// The wash behind Studio: near-white lilac by day, deep plum at night.
    static let base = Color.dynamic(light: 0xFAF6FF, dark: 0x16121E)
    /// Frosted card tint, layered over a material.
    static let cardFill = translucent(light: 0xFFFFFF, lightAlpha: 0.62, dark: 0x2A2438, darkAlpha: 0.62)
    /// Text fields inside frosted cards.
    static let fieldFill = translucent(light: 0xFFFFFF, lightAlpha: 0.78, dark: 0x1C1826, darkAlpha: 0.72)
    /// Hairline around frosted cards.
    static let cardStroke = translucent(light: 0xFFFFFF, lightAlpha: 0.85, dark: 0xFFFFFF, darkAlpha: 0.10)
    /// Soft shadow under frosted cards.
    static let cardShadow = translucent(light: 0x5B3FC4, lightAlpha: 0.10, dark: 0x000000, darkAlpha: 0.40)
    /// Inactive progress segments and timeline connectors.
    static let track = translucent(light: 0x2E1F5E, lightAlpha: 0.12, dark: 0xFFFFFF, darkAlpha: 0.14)

    // Muse model tints (timeline chips).
    static let wonder = Color(hex: 0xB9A7FF)
    static let ember = Color(hex: 0xFFAE85)
    static let image = Color(hex: 0xFF9ECF)
    static let spark = Color(hex: 0x7FE0C8)
    static let device = Color(hex: 0x9AC2FF)
    static let offline = Color(hex: 0xB4B8C8)

    /// Validation problems.
    static let issue = Color(hex: 0xF2A23A)
    /// Fixed problems and finished steps.
    static let fixed = Color(hex: 0x3DBE8B)

    private static func translucent(light: UInt32, lightAlpha: CGFloat, dark: UInt32, darkAlpha: CGFloat) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: darkAlpha) : UIColor(hex: light, alpha: lightAlpha)
        })
    }
}

// MARK: - Backdrop

/// The soft brand-gradient wash behind every Studio step. Slowly drifting glows; still with
/// Reduce Motion. Tints toward the Bubble's palette once there is one.
struct StudioBackdrop: View {
    var palette: BubblePalette? = nil

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            // Dark Bubble palettes tint with their bright accents, so go easier on them.
            let strength = (colorScheme == .dark ? 0.30 : 0.62) * (palette?.isDark == true ? 0.6 : 1)
            let colors = blobColors
            ZStack {
                StudioGlow.base
                blob(colors[0], diameter: width * 1.35, opacity: strength)
                    .position(x: width * (drift ? 0.08 : 0.2), y: height * (drift ? 0.04 : 0.1))
                blob(colors[1], diameter: width * 1.1, opacity: strength * 0.8)
                    .position(x: width * (drift ? 0.98 : 0.86), y: height * (drift ? 0.44 : 0.36))
                blob(colors[2], diameter: width * 1.25, opacity: strength * 0.85)
                    .position(x: width * (drift ? 0.3 : 0.14), y: height * (drift ? 0.9 : 0.82))
            }
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.8), value: palette)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) {
                drift = true
            }
        }
        .accessibilityHidden(true)
    }

    private var blobColors: [Color] {
        guard let palette else { return [BubbleGlow.lilac, BubbleGlow.pink, BubbleGlow.peach] }
        if palette.isDark {
            return Array(palette.accents.prefix(3))
        }
        return [palette.top, palette.bottom, palette.accents.first ?? BubbleGlow.peach]
    }

    private func blob(_ color: Color, diameter: CGFloat, opacity: Double) -> some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [color.opacity(opacity), color.opacity(0)],
                    center: .center,
                    startRadius: 0,
                    endRadius: diameter / 2
                )
            )
            .frame(width: diameter, height: diameter)
    }
}

// MARK: - Frosted cards

private struct StudioCardModifier: ViewModifier {
    var padding: CGFloat
    var radius: CGFloat
    var isHighlighted: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                shape.fill(.ultraThinMaterial)
                shape.fill(StudioGlow.cardFill)
            }
            .overlay {
                if isHighlighted {
                    shape.strokeBorder(BubbleGlow.iridescent, lineWidth: 1.5)
                } else {
                    shape.strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75)
                }
            }
            .shadow(color: StudioGlow.cardShadow, radius: 18, y: 8)
    }
}

extension View {
    /// A frosted Glow card: material, a white hairline and a soft lilac shadow. Highlighted cards
    /// get an iridescent rim.
    func studioCard(padding: CGFloat = FBSpacing.l, radius: CGFloat = FBMetrics.radiusXL, highlighted: Bool = false) -> some View {
        modifier(StudioCardModifier(padding: padding, radius: radius, isHighlighted: highlighted))
    }

    /// The rounded type Glow uses for display titles (SF Pro Rounded), keeping the token size.
    func studioRounded() -> some View {
        fontDesign(.rounded)
    }
}

// MARK: - Buttons

/// The main action on each Studio step: a brand-gradient capsule with deep ink text.
struct StudioPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.fbHeadline)
            .lineLimit(1)
            .foregroundStyle(BubbleGlow.ink)
            .padding(.horizontal, FBSpacing.l)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .background(BubbleGlow.brandGradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
            .shadow(color: BubbleGlow.pink.opacity(isEnabled ? 0.45 : 0), radius: 14, y: 6)
            .saturation(isEnabled ? 1 : 0.15)
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

/// Secondary Studio actions: a frosted capsule.
struct StudioSecondaryButtonStyle: ButtonStyle {
    var expand = true
    var height: CGFloat = 40

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.fbButton)
            .lineLimit(1)
            .foregroundStyle(FBColor.primaryText)
            .padding(.horizontal, 14)
            .frame(maxWidth: expand ? .infinity : nil)
            .frame(minHeight: height)
            .background {
                Capsule().fill(.ultraThinMaterial)
                Capsule().fill(StudioGlow.cardFill)
            }
            .overlay(Capsule().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75))
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

extension ButtonStyle where Self == StudioPrimaryButtonStyle {
    static var studioPrimary: StudioPrimaryButtonStyle { StudioPrimaryButtonStyle() }
}

extension ButtonStyle where Self == StudioSecondaryButtonStyle {
    static var studioSecondary: StudioSecondaryButtonStyle { StudioSecondaryButtonStyle() }

    static func studioSecondary(expand: Bool, height: CGFloat = 40) -> StudioSecondaryButtonStyle {
        StudioSecondaryButtonStyle(expand: expand, height: height)
    }
}

/// A frosted circle button for Studio's top bar and overlays.
struct StudioCircleButton: View {
    let symbol: String
    let accessibilityLabel: String
    var size: CGFloat = 36
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.regular, weight: .semibold))
                .foregroundStyle(FBColor.primaryText)
                .frame(width: size, height: size)
                .background {
                    Circle().fill(.ultraThinMaterial)
                    Circle().fill(StudioGlow.cardFill)
                }
                .overlay(Circle().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(accessibilityLabel)
    }
}

// MARK: - Chips

/// A Glow chip. Selected chips fill with the brand gradient; the rest are frosted.
struct StudioChip: View {
    let title: String
    var symbol: String? = nil
    var isSelected = false
    var trailingSymbol: String? = nil
    /// Long chips (example prompts) wrap onto a second line instead of truncating.
    var wraps = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            StudioChipLabel(title: title, symbol: symbol, isSelected: isSelected, trailingSymbol: trailingSymbol, wraps: wraps)
        }
        .buttonStyle(.pressable)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// How a Studio chip looks, for buttons and menus.
struct StudioChipLabel: View {
    let title: String
    var symbol: String? = nil
    var isSelected = false
    var trailingSymbol: String? = nil
    var wraps = false

    var body: some View {
        HStack(spacing: 6) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.small, weight: .semibold))
            }
            Text(title)
                .font(.fbButton)
                .lineLimit(wraps ? 2 : 1)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: wraps)
                .padding(.vertical, wraps ? 8 : 0)
            if let trailingSymbol {
                Image(systemName: trailingSymbol)
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                    .opacity(0.7)
            }
        }
        .foregroundStyle(isSelected ? BubbleGlow.ink : FBColor.primaryText)
        .padding(.horizontal, 14)
        .frame(minHeight: 36)
        .background { background }
        .overlay {
            shape.stroke(isSelected ? Color.white.opacity(0.75) : StudioGlow.cardStroke, lineWidth: isSelected ? 1 : 0.75)
        }
        .contentShape(shape)
    }

    /// Capsules for one-line chips; a rounded card when the text wraps.
    private var shape: AnyShape {
        wraps ? AnyShape(RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)) : AnyShape(Capsule())
    }

    @ViewBuilder
    private var background: some View {
        if isSelected {
            shape.fill(BubbleGlow.brandGradient)
        } else {
            shape.fill(.ultraThinMaterial)
            shape.fill(StudioGlow.cardFill)
        }
    }
}

/// Title row inside Studio cards.
struct StudioSectionTitle: View {
    let title: String
    var detail: String? = nil
    var symbol: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            Text(title)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            if let detail {
                Text(detail)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Brand bits

/// Muse's avatar in Studio: a glowing brand-gradient bubble with sparkles.
struct StudioMuseAvatar: View {
    var size: CGFloat = FBAvatarSize.post

    var body: some View {
        ZStack {
            Circle().fill(BubbleGlow.brandGradient)
            Image(systemName: "sparkles")
                .font(.system(size: size >= FBAvatarSize.post ? FBIconSize.large : FBIconSize.medium, weight: .semibold))
                .foregroundStyle(.white)
                .shadow(color: BubbleGlow.ink.opacity(0.25), radius: 2)
            Circle().strokeBorder(BubbleGlow.iridescent, lineWidth: 1.5)
        }
        .frame(width: size, height: size)
        .bubbleGlow(BubbleGlow.pink, radius: 6, opacity: 0.3)
        .accessibilityHidden(true)
    }
}

/// A bubble that drifts up a little and back, for floating covers.
struct StudioBob: ViewModifier {
    var amount: CGFloat = 6
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var up = false

    func body(content: Content) -> some View {
        content
            .offset(y: up ? -amount : amount)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
                    up = true
                }
            }
    }
}
