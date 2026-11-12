import SwiftUI

/// The Glow bubble glyph that stands in for an avatar on Bubble notifications.
struct BubbleNotificationGlyph: View {
    var size: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(BubbleGlow.brandGradient)
            BubbleOrb(size: size * 0.62, tint: .white)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Cover thumbnail on the right of a Bubble notification row.
struct BubbleNotificationThumb: View {
    let bubbleID: String
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        if let bubble = bubbleStore.bubble(id: bubbleID) {
            BubbleCoverView(bubble: bubble, showsEmoji: true)
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                        .strokeBorder(BubbleGlow.iridescent, lineWidth: 1.5)
                }
                .accessibilityHidden(true)
        }
    }
}
