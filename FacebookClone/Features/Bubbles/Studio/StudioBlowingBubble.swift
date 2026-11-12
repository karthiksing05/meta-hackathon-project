import SwiftUI
import UIKit

/// The compose header: a soap bubble being blown from a wand. It grows as Muse works, its rim
/// swirls, it shows the Bubble's emoji (then its cover) once Muse has them, and it lifts off the
/// wand when the Bubble is ready. Pure function of its inputs; drive `time` from a TimelineView.
struct StudioBlowingBubble: View {
    var progress: Double
    var time: TimeInterval
    var palette: BubblePalette?
    var emoji: String?
    var cover: UIImage?
    var isWorking: Bool
    var isFinished: Bool
    var reduceMotion: Bool

    private static let wandHeight: CGFloat = 39

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let maxDiameter = max(60, min(size.height - Self.wandHeight - 6, size.width * 0.62))
            let clamped = min(max(progress, 0), 1)
            let eased = 1 - pow(1 - clamped, 1.5)
            let diameter = 30 + (maxDiameter - 30) * eased
            let wobble = reduceMotion ? 0 : sin(time * 2.4) * (isFinished ? 0.012 : 0.035)
            ZStack(alignment: .bottom) {
                if isWorking && !reduceMotion {
                    satellites(height: size.height, spread: diameter)
                }
                bubble(diameter: diameter)
                    .scaleEffect(x: 1 + wobble, y: 1 - wobble, anchor: .bottom)
                    .offset(y: -(Self.wandHeight - 8) - (isFinished ? 16 : 0))
                    .animation(.spring(response: 0.6, dampingFraction: 0.6), value: isFinished)
                StudioWand()
                    .opacity(isFinished ? 0 : 1)
                    .offset(y: isFinished ? 10 : 0)
                    .animation(.easeOut(duration: 0.4), value: isFinished)
            }
            .frame(width: size.width, height: size.height, alignment: .bottom)
        }
        .accessibilityHidden(true)
    }

    private func bubble(diameter d: CGFloat) -> some View {
        let tint = palette?.top ?? BubbleGlow.lilac
        return ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [tint.opacity(0.12), tint.opacity(0.3), BubbleGlow.pink.opacity(0.38)],
                        center: UnitPoint(x: 0.4, y: 0.35),
                        startRadius: 0,
                        endRadius: d * 0.6
                    )
                )
            inside(diameter: d)
            Circle()
                .strokeBorder(BubbleGlow.iridescent, lineWidth: max(2, d * 0.045))
                .rotationEffect(.degrees(reduceMotion ? 0 : time * 35))
            Circle()
                .strokeBorder(Color.white.opacity(0.45), lineWidth: 1)
                .padding(d * 0.06)
            Ellipse()
                .fill(Color.white.opacity(0.85))
                .frame(width: d * 0.26, height: d * 0.13)
                .rotationEffect(.degrees(-35))
                .offset(x: -d * 0.2, y: -d * 0.25)
            Circle()
                .fill(Color.white.opacity(0.7))
                .frame(width: max(3, d * 0.06), height: max(3, d * 0.06))
                .offset(x: d * 0.27, y: d * 0.2)
        }
        .frame(width: d, height: d)
        .shadow(color: (palette?.glow ?? .white).opacity(0.7), radius: d * 0.08)
        .shadow(color: BubbleGlow.pink.opacity(0.35), radius: d * 0.18)
    }

    @ViewBuilder
    private func inside(diameter d: CGFloat) -> some View {
        if let cover {
            Image(uiImage: cover)
                .resizable()
                .scaledToFill()
                .frame(width: d * 0.92, height: d * 0.92)
                .clipShape(Circle())
                .opacity(0.94)
                .transition(.opacity.combined(with: .scale(scale: 0.8)))
        } else if let emoji, !emoji.isEmpty {
            Text(emoji)
                .font(.system(size: max(12, d * 0.36))) // Display text: the Bubble's emoji in the bubble
                .shadow(color: .white.opacity(0.8), radius: 6)
                .transition(.scale(scale: 0.4).combined(with: .opacity))
        } else {
            Image(systemName: "sparkles")
                .font(.system(size: max(10, d * 0.22), weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.95))
                .shadow(color: BubbleGlow.ink.opacity(0.2), radius: 2)
        }
    }

    /// Little bubbles drifting up around the big one while Muse works.
    private func satellites(height: CGFloat, spread: CGFloat) -> some View {
        ZStack {
            ForEach(0..<7, id: \.self) { index in
                let seed = Double(index)
                let rise = (time * (0.16 + seed.truncatingRemainder(dividingBy: 3) * 0.05) + seed * 0.37)
                    .truncatingRemainder(dividingBy: 1)
                let side = sin(time * 0.9 + seed * 1.7) * Double(spread * 0.5 + 26)
                let diameter = CGFloat(6 + (index * 5) % 12)
                Circle()
                    .fill(Color.white.opacity(0.18))
                    .overlay(Circle().strokeBorder(BubbleGlow.iridescent, lineWidth: 1.2))
                    .frame(width: diameter, height: diameter)
                    .offset(x: side, y: -CGFloat(rise) * (height - 20) - 24)
                    .opacity(rise < 0.15 ? rise / 0.15 : 1 - rise)
            }
        }
    }
}

/// A bubble wand: an iridescent ring on a pastel handle.
struct StudioWand: View {
    var body: some View {
        VStack(spacing: -1) {
            Ellipse()
                .strokeBorder(BubbleGlow.iridescent, lineWidth: 3)
                .frame(width: 48, height: 14)
            Capsule()
                .fill(LinearGradient(colors: [BubbleGlow.lilac, BubbleGlow.pink], startPoint: .top, endPoint: .bottom))
                .frame(width: 5, height: 26)
        }
        .shadow(color: BubbleGlow.pink.opacity(0.35), radius: 6)
    }
}

/// Eases the header bubble toward Muse's progress so jumps between steps look like breaths.
final class StudioProgressSmoother {
    private var current: Double = 0.02
    private var lastDate: Date?

    func step(toward target: Double, at date: Date) -> Double {
        let dt = lastDate.map { min(0.1, max(0, date.timeIntervalSince($0))) } ?? 0
        lastDate = date
        current += (target - current) * min(1, dt * 2.2)
        return current
    }
}

/// A celebratory pop: a ring and a spray of little bubbles and sparkles.
struct StudioPopBurst: View {
    var color: Color = BubbleGlow.pink

    @State private var burst = false

    private static let pieces: [(angle: Double, distance: CGFloat, size: CGFloat, sparkle: Bool)] = (0..<18).map { index in
        let angle = Double(index) / 18 * 2 * .pi + (index.isMultiple(of: 2) ? 0.12 : -0.08)
        let distance = CGFloat(110 + (index * 37) % 70)
        let size = CGFloat(8 + (index * 7) % 14)
        return (angle, distance, size, index % 3 == 0)
    }

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(BubbleGlow.iridescent, lineWidth: burst ? 1 : 6)
                .frame(width: burst ? 320 : 120, height: burst ? 320 : 120)
                .opacity(burst ? 0 : 0.9)
            ForEach(Array(Self.pieces.enumerated()), id: \.offset) { _, piece in
                Group {
                    if piece.sparkle {
                        Image(systemName: "sparkle")
                            .font(.system(size: piece.size, weight: .bold))
                            .foregroundStyle(BubbleGlow.brandGradient)
                    } else {
                        Circle()
                            .fill(Color.white.opacity(0.25))
                            .overlay(Circle().strokeBorder(BubbleGlow.iridescent, lineWidth: 1.5))
                            .frame(width: piece.size, height: piece.size)
                    }
                }
                .offset(
                    x: burst ? cos(piece.angle) * piece.distance : 0,
                    y: burst ? sin(piece.angle) * piece.distance : 0
                )
                .scaleEffect(burst ? 1 : 0.3)
                .opacity(burst ? 0 : 1)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.75)) {
                burst = true
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
