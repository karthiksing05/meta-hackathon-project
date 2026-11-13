import SwiftUI

/// Brand colors for the games feature: pastel blue to violet, no pink, rose, coral or peach.
/// Game chrome (badges, wordmark, loaders, Studio accents) uses these; Facebook chrome keeps
/// `FBColor`. Game looks (`BubbleGlow.palettes`) are separate: they color a game, not the app.
///
/// Contrast (WCAG): `ink` on `sky` 8.8, on `periwinkle` 7.5, on `violet` 7.1, on white 13.2.
/// `deep` is 4.8 on white and 6.3 (dark variant) on the dark surface.
enum GameColor {
    /// Light sky blue, first gradient stop.
    static let sky = Color(hex: 0xADD8FF)
    /// Between sky and violet, middle gradient stop.
    static let periwinkle = Color(hex: 0xB8BFFF)
    /// Soft violet, last gradient stop.
    static let violet = Color(hex: 0xC9B2FF)
    /// Text and icons on the pastel stops. The stops are light in both modes, so ink stays dark.
    static let ink = Color(hex: 0x1F2B66)
    /// Accent text, icons and small fills on regular surfaces. Lighter in dark mode for contrast.
    static let deep = Color.dynamic(light: 0x5B5BFF, dark: 0x9C9CFF)
    /// `deep` that never changes with the mode, for fills behind white text.
    static let deepFill = Color(hex: 0x5B5BFF)

    /// A faint tint for placeholders and quiet backgrounds on regular surfaces.
    static let wash = Color.dynamic(light: 0xEEF0FF, dark: 0x2A2D45)
    /// Skeleton blocks inside game placeholders.
    static let skeleton = Color.dynamic(light: 0xDDE2FF, dark: 0x3A3E5C)

    /// The brand gradient: sky → periwinkle → violet.
    static var gradient: LinearGradient {
        LinearGradient(colors: [sky, periwinkle, violet], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// Facebook blue → purple, for feature accents with white text (challenge, together, learn,
    /// length, board badges). White on either stop is 4.5:1 or better.
    static var accentGradient: LinearGradient {
        LinearGradient(colors: [FBColor.brandBlue, FBColor.savedPurple], startPoint: .leading, endPoint: .trailing)
    }

    /// A ring of the brand stops, for rims and spinners.
    static var rim: AngularGradient {
        AngularGradient(colors: [sky, periwinkle, violet, Color(hex: 0xE6EEFF), sky], center: .center)
    }
}

/// The brand mark: a soft blue-violet orb, optionally with a sparkle. Drawn, so it stays crisp.
struct GameOrb: View {
    var size: CGFloat = 28
    /// Inner glow color. White on the brand; game covers pass their palette's glow.
    var tint: Color = .white
    var sparkle = false

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [tint.opacity(0.10), GameColor.periwinkle.opacity(0.30), GameColor.violet.opacity(0.55)],
                        center: UnitPoint(x: 0.4, y: 0.35),
                        startRadius: 0,
                        endRadius: size / 2
                    )
                )
            Circle()
                .strokeBorder(GameColor.rim, lineWidth: max(1.5, size * 0.07))
                .opacity(0.95)
            Ellipse()
                .fill(Color.white.opacity(0.85))
                .frame(width: size * 0.28, height: size * 0.16)
                .rotationEffect(.degrees(-35))
                .offset(x: -size * 0.18, y: -size * 0.2)
                .blur(radius: size * 0.02)
            if sparkle {
                Image(systemName: "sparkle")
                    .font(.system(size: size * 0.34, weight: .bold)) // Drawn mark, scales with the orb
                    .foregroundStyle(Color.white)
                    .offset(x: size * 0.12, y: size * 0.1)
            }
        }
        .frame(width: size, height: size)
        .shadow(color: GameColor.periwinkle.opacity(0.45), radius: size * 0.18)
        .accessibilityHidden(true)
    }
}

#Preview {
    VStack(spacing: 16) {
        HStack(spacing: 16) {
            GameOrb(size: 64, sparkle: true)
            GameOrb(size: 32)
        }
        RoundedRectangle(cornerRadius: 12).fill(GameColor.gradient).frame(height: 44)
            .overlay(Text("Ink on the brand").foregroundStyle(GameColor.ink))
        Capsule().fill(GameColor.accentGradient).frame(height: 32)
            .overlay(Text("Accent").foregroundStyle(.white))
        Text("Deep accent text").foregroundStyle(GameColor.deep)
    }
    .padding()
}
