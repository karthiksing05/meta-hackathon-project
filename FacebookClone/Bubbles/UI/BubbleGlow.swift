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

/// Game looks and legacy brand names. Game content (cards, player, Studio) uses
/// these; Facebook chrome (tab bar, headers, sheets) keeps `FBColor`.
enum BubbleGlow {
    static let lilacHaze = BubblePalette(
        id: "lilac-haze", name: "Lilac haze",
        topHex: 0xC9B8FF, bottomHex: 0xE6EEFF, inkHex: 0x2E1F5E, glowHex: 0xFFFFFF,
        accentHexes: [0x9EF0DA, 0xFFE59A, 0x9AD4FF, 0xB8A6FF]
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
    //
    // The brand now lives in `GameColor` (DesignSystem/GameBrand.swift): pastel blue to violet,
    // no pink or peach. These names stay so existing callers keep compiling; new code should use
    // `GameColor` directly.

    /// Legacy name; now the brand's violet stop.
    static let lilac = GameColor.violet
    /// Legacy name; now periwinkle (the brand has no pink).
    static let pink = GameColor.periwinkle
    /// Legacy name; now sky blue (the brand has no peach).
    static let peach = GameColor.sky
    /// Text on brand surfaces.
    static let ink = GameColor.ink

    /// The brand gradient (`GameColor.gradient`): sky → periwinkle → violet.
    static var brandGradient: LinearGradient { GameColor.gradient }

    /// A rim in the brand stops (it was a rainbow soap-bubble rim).
    static var iridescent: AngularGradient { GameColor.rim }
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

/// The brand orb, kept under its old name for existing callers. See `GameOrb`.
struct BubbleOrb: View {
    var size: CGFloat = 28
    var tint: Color = .white
    var sparkle = false

    var body: some View {
        GameOrb(size: size, tint: tint, sparkle: sparkle)
    }
}

/// The product wordmark: "Muse" in ink and "Curios" in the blue-to-violet name gradient
/// (`ProductName.wordmarkLead`, `ProductName.wordmarkTail`), then the orb with its sparkle.
/// `lead` is the ink for "Muse": `GameColor.wordmarkInk` on light surfaces; the feed header, which
/// sits over dark game covers, passes white so the word stays readable.
struct BubbleWordmark: View {
    var size: CGFloat = 28
    var lead: Color = GameColor.wordmarkInk

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.08) {
            HStack(alignment: .firstTextBaseline, spacing: size * 0.22) {
                Text(ProductName.wordmarkLead)
                    .foregroundStyle(lead)
                Text(ProductName.wordmarkTail)
                    .foregroundStyle(GameColor.nameGradient)
            }
            .font(.system(size: size, weight: .heavy, design: .rounded)) // Display text: brand wordmark
            GameOrb(size: size * 0.5, sparkle: true)
                .offset(y: -size * 0.32)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ProductName.display)
        .accessibilityAddTraits(.isHeader)
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
        .foregroundStyle(GameColor.ink)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(GameColor.gradient.opacity(0.95), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.6), lineWidth: 0.5))
        .accessibilityLabel("Made with Muse")
    }
}
