import SwiftUI

/// One Glow palette. Hex values match `bubble-glow.css` and docs/BUBBLES.md exactly.
struct BubblePalette: Identifiable, Hashable {
    let id: String
    let name: String
    let topHex: UInt32
    let bottomHex: UInt32
    let inkHex: UInt32
    let glowHex: UInt32
    let accentHexes: [UInt32]

    var top: Color { Color(hex: topHex) }
    var bottom: Color { Color(hex: bottomHex) }
    var ink: Color { Color(hex: inkHex) }
    var glow: Color { Color(hex: glowHex) }
    var accents: [Color] { accentHexes.map { Color(hex: $0) } }

    var gradient: LinearGradient {
        LinearGradient(colors: [top, bottom], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// True for dark backgrounds (night-bloom, or a custom palette with dark colors).
    var isDark: Bool {
        func luminance(_ hex: UInt32) -> Double {
            let r = Double((hex >> 16) & 0xFF) / 255
            let g = Double((hex >> 8) & 0xFF) / 255
            let b = Double(hex & 0xFF) / 255
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        return (luminance(topHex) + luminance(bottomHex)) / 2 < 0.45
    }
}

/// The Bubbles brand: pastel, bubbly, glowing. Bubbles content (cards, player, Studio) uses
/// these; Facebook chrome (tab bar, headers, sheets) keeps `FBColor`.
enum BubbleGlow {
    static let lilacHaze = BubblePalette(
        id: "lilac-haze", name: "Lilac haze",
        topHex: 0xC9B8FF, bottomHex: 0xFFC8E8, inkHex: 0x2E1F5E, glowHex: 0xFFFFFF,
        accentHexes: [0x9EF0DA, 0xFFE59A, 0x9AD4FF, 0xFF9EC9]
    )
    static let peachFizz = BubblePalette(
        id: "peach-fizz", name: "Peach fizz",
        topHex: 0xFFC2B0, bottomHex: 0xFFE7A8, inkHex: 0x4D2238, glowHex: 0xFFF6E8,
        accentHexes: [0xFF8FB8, 0x8FD6FF, 0xB8F2A6, 0xC9A8FF]
    )
    static let mintPop = BubblePalette(
        id: "mint-pop", name: "Mint pop",
        topHex: 0xA6F2DC, bottomHex: 0xB3CCFF, inkHex: 0x123B4D, glowHex: 0xF2FFFB,
        accentHexes: [0xFF9ECB, 0xFFE48F, 0xC9A8FF, 0x8FE3FF]
    )
    static let skyGlow = BubblePalette(
        id: "sky-glow", name: "Sky glow",
        topHex: 0xADD8FF, bottomHex: 0xDCC8FF, inkHex: 0x1F2B66, glowHex: 0xF4F8FF,
        accentHexes: [0xFFB0D9, 0xA6F2DC, 0xFFE59A, 0x9AB8FF]
    )
    static let nightBloom = BubblePalette(
        id: "night-bloom", name: "Night bloom",
        topHex: 0x2B2150, bottomHex: 0x5A3577, inkHex: 0xFFF3FF, glowHex: 0xFFD9F5,
        accentHexes: [0xFF9DE2, 0x9DF2FF, 0xFFE59D, 0xB9A2FF]
    )

    static let palettes: [BubblePalette] = [lilacHaze, peachFizz, mintPop, skyGlow, nightBloom]

    static func palette(_ id: String?) -> BubblePalette {
        palettes.first { $0.id == id } ?? lilacHaze
    }

    /// The colors a Bubble really uses: its custom colors when it has them, otherwise its preset.
    /// Prefer this over `palette(_:)` for anything showing a specific Bubble.
    static func palette(for style: BubbleStyle) -> BubblePalette {
        let base = palette(style.palette)
        guard let colors = style.colors, let top = hex(colors.bgTop), let bottom = hex(colors.bgBottom) else {
            return base
        }
        let accents = [colors.primary, colors.secondary, colors.accent, colors.danger].compactMap { hex($0) }
        return BubblePalette(
            id: "custom", name: "Custom",
            topHex: top, bottomHex: bottom,
            inkHex: hex(colors.ink) ?? base.inkHex,
            glowHex: 0xFFFFFF,
            accentHexes: accents.isEmpty ? base.accentHexes : accents
        )
    }

    /// Parses "#RRGGBB" or "RRGGBB".
    static func hex(_ string: String?) -> UInt32? {
        guard var text = string?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        return value
    }

    // MARK: Brand

    static let lilac = Color(hex: 0xB9A7FF)
    static let pink = Color(hex: 0xFF9ECF)
    static let peach = Color(hex: 0xFFC59E)
    /// Deep plum for text on Glow surfaces.
    static let ink = Color(hex: 0x2E1F5E)

    /// Lilac → pink → peach, from the Muse cover art.
    static var brandGradient: LinearGradient {
        LinearGradient(colors: [lilac, pink, peach], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// Soap-bubble rim.
    static var iridescent: AngularGradient {
        AngularGradient(
            colors: [Color(hex: 0xFFB3E6), Color(hex: 0xB3E5FF), Color(hex: 0xC9FFE8), Color(hex: 0xFFF1B3), Color(hex: 0xD9B3FF), Color(hex: 0xFFB3E6)],
            center: .center
        )
    }
}

// MARK: - Glow modifiers

extension View {
    /// A soft halo in `color`, like light through a soap bubble.
    func bubbleGlow(_ color: Color = .white, radius: CGFloat = 12, opacity: Double = 0.8) -> some View {
        shadow(color: color.opacity(opacity), radius: radius)
            .shadow(color: color.opacity(opacity * 0.5), radius: radius * 2)
    }
}

// MARK: - Brand marks

/// A single iridescent soap bubble, drawn (not an image) so it stays crisp at any size.
struct BubbleOrb: View {
    var size: CGFloat = 28
    var tint: Color = .white

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [tint.opacity(0.05), tint.opacity(0.18), Color(hex: 0xFFD6F2).opacity(0.35)],
                        center: .center,
                        startRadius: 0,
                        endRadius: size / 2
                    )
                )
            Circle()
                .strokeBorder(BubbleGlow.iridescent, lineWidth: max(1.5, size * 0.07))
                .opacity(0.9)
            // Highlight
            Ellipse()
                .fill(Color.white.opacity(0.85))
                .frame(width: size * 0.28, height: size * 0.16)
                .rotationEffect(.degrees(-35))
                .offset(x: -size * 0.18, y: -size * 0.2)
                .blur(radius: size * 0.02)
        }
        .frame(width: size, height: size)
        .bubbleGlow(.white, radius: size * 0.18, opacity: 0.55)
        .accessibilityHidden(true)
    }
}

/// The "bubbles" wordmark: rounded heavy type in the brand gradient with a soft glow.
struct BubbleWordmark: View {
    var size: CGFloat = 28

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.08) {
            Text("bubbles")
                .font(.system(size: size, weight: .heavy, design: .rounded)) // Display text: brand wordmark
                .foregroundStyle(BubbleGlow.brandGradient)
                .bubbleGlow(BubbleGlow.pink, radius: size * 0.22, opacity: 0.35)
            BubbleOrb(size: size * 0.5)
                .offset(y: -size * 0.32)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Bubbles")
    }
}

/// "Made with Muse" chip.
struct MuseBadge: View {
    var compact = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
                .font(.system(size: FBIconSize.xs, weight: .bold))
            Text(compact ? "Muse" : "Made with Muse")
                .font(.fbCaptionEmphasized)
        }
        .foregroundStyle(BubbleGlow.ink)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(BubbleGlow.brandGradient.opacity(0.9), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.6), lineWidth: 0.5))
        .accessibilityLabel("Made with Muse")
    }
}
