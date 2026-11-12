import SwiftUI

/// One Bubble story item, drawn under the story chrome. Fills its frame.
///
/// - Live (`isLive`): the Burst plays full-bleed in a web view, muted. Only the story on screen is
///   live; every other card shows the cover (docs/BUBBLES.md, 4.8).
/// - Compact: the tray card, a cover with the title and no buttons.
///
/// The web view ignores touches, so the story's own gestures (hold, swipe, edge taps) keep
/// working. "Pop in" opens the player with the same run.
struct BubbleStoryContentView: View {
    let bubbleID: String
    let replay: BubbleInputLog?
    let score: Int?
    var isLive = false
    var isPaused = false
    var isCompact = false

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var bubble: Bubble? { bubbleStore.bubble(id: bubbleID) }

    var body: some View {
        ZStack {
            backdrop
            if isLive, !isCompact, let bubble {
                BubbleWebView(
                    manifest: bubble.manifest,
                    mode: replay.map { .replay($0) } ?? .demo,
                    bestScore: score,
                    isActive: !isPaused,
                    isMuted: true,
                    reducedMotion: reduceMotion
                )
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            if isCompact {
                compactOverlay
            } else {
                stickers
            }
        }
        .clipped()
    }

    // MARK: Layers

    @ViewBuilder
    private var backdrop: some View {
        if let bubble {
            BubbleCoverView(bubble: bubble, showsEmoji: isCompact)
        } else {
            BubbleGlow.brandGradient
        }
    }

    private var title: String { bubble?.title ?? "A Bubble" }

    private var palette: BubblePalette { BubbleGlow.palette(bubble?.paletteID) }

    private var scoreText: String {
        if let score { return "Score \(score) · beat it" }
        return "Can you beat it?"
    }

    private var compactOverlay: some View {
        VStack {
            Spacer(minLength: 0)
            LinearGradient(colors: [.clear, Color.black.opacity(0.4)], startPoint: .top, endPoint: .bottom)
                .frame(height: 70)
                .overlay(alignment: .bottomLeading) {
                    Text(title)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.leading, 10)
                        .padding(.trailing, 10)
                        .padding(.bottom, 34)
                }
        }
        .allowsHitTesting(false)
    }

    private var stickers: some View {
        VStack(spacing: 10) {
            VStack(spacing: 8) {
                sticker("\(bubble?.emoji ?? "🫧") \(title)", size: 20)
                    .rotationEffect(.degrees(-3))
                sticker(scoreText, size: 15, filled: true)
                    .rotationEffect(.degrees(2))
            }
            .padding(.top, 104)
            Spacer(minLength: 0)
            popInButton
                .padding(.bottom, 28)
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
    }

    private func sticker(_ text: String, size: CGFloat, filled: Bool = false) -> some View {
        Text(text)
            .font(.system(size: size, weight: .heavy, design: .rounded))
            .foregroundStyle(filled ? Color.white : palette.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background {
                Capsule()
                    .fill(filled ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(Color.white.opacity(0.92)))
            }
            .overlay {
                Capsule().stroke(Color.white.opacity(filled ? 0.7 : 0.9), lineWidth: 1.5)
            }
            .bubbleGlow(.white, radius: 10, opacity: 0.55)
            .accessibilityLabel(text)
    }

    private var popInButton: some View {
        Button {
            popIn()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "bubbles.and.sparkles.fill")
                Text("Pop in")
            }
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .foregroundStyle(BubbleGlow.ink)
            .padding(.horizontal, 28)
            .frame(height: 48)
            .background(Color.white, in: Capsule())
            .bubbleGlow(.white, radius: 14, opacity: 0.7)
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Pop in to \(title)")
        .accessibilityHint("Opens the game")
    }

    private func popIn() {
        Haptics.medium()
        let router = router
        let id = bubbleID
        let log = replay
        dismiss()
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            router.play(id, replay: log)
        }
    }
}
