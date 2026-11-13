import SwiftUI

/// The end-of-game card's look: a floating, frosted card inset from the screen edges, so the game's
/// final frame shows around and above it instead of an opaque sheet.
enum ResultCardStyle {
    /// Where the card rests: high enough for the score, your rank and the first actions; the top
    /// third stays the game.
    static let restingDetent = PresentationDetent.fraction(0.7)
    static let cornerRadius: CGFloat = 28
    static let inset: CGFloat = 8
}

private struct ResultCardModifier: ViewModifier {
    let isInline: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isInline { card(content) } else { content }
    }

    private func card(_ content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: ResultCardStyle.cornerRadius, style: .continuous)
        return content
            .background {
                ZStack {
                    shape.fill(.regularMaterial)
                    shape.fill(FBColor.surface.opacity(0.72))
                }
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.white.opacity(0.35), lineWidth: 0.75))
            .shadow(color: .black.opacity(0.22), radius: 20, y: 6)
            .padding(.horizontal, ResultCardStyle.inset)
            .padding(.bottom, ResultCardStyle.inset)
    }
}

/// Dims and softly blurs the game behind the end-of-game card, so the card reads first and the
/// game stays recognizable.
struct ResultBackdropScrim: View {
    let isShown: Bool
    var onTap: (() -> Void)? = nil

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).opacity(0.5)
            Color.black.opacity(0.18)
        }
        .ignoresSafeArea()
        .opacity(isShown ? 1 : 0)
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
        .allowsHitTesting(isShown && onTap != nil)
        .accessibilityHidden(true)
        .animation(.easeInOut(duration: 0.3), value: isShown)
    }
}

extension View {
    /// The end-of-game card's frosted, inset card (inline over the game; a sheet draws its own).
    func resultCard(isInline: Bool) -> some View {
        modifier(ResultCardModifier(isInline: isInline))
    }
}
