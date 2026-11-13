import SwiftUI
import UIKit

// Loading states for the games feature. Every loop here is clock-driven (`TimelineView` plus
// `GameMotion.loop`), never a repeating animation, and Reduce Motion shows a still state.

/// The games feature's loader: a breathing orb or three pulsing dots, with an optional label.
struct GameLoader: View {
    enum Style {
        /// The brand orb, breathing, with a turning rim. For screens and large cards.
        case orb
        /// Three dots in the brand stops. For buttons, rows and small cards.
        case dots
    }

    var style: Style = .orb
    /// Shown under the orb or beside the dots, and read by VoiceOver.
    var label: String? = nil
    /// Orb diameter, or dot diameter for `.dots`.
    var size: CGFloat? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            switch style {
            case .orb:
                VStack(spacing: 12) {
                    orb
                    if let label {
                        Text(label)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .multilineTextAlignment(.center)
                    }
                }
            case .dots:
                HStack(spacing: 8) {
                    dots
                    if let label {
                        Text(label)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label ?? "Loading")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private static let breath = GameMotion.loop(period: 2.4)
    private static let spin = GameMotion.loop(period: 3.2)
    private static let pulse = GameMotion.loop(period: 1.05)

    private var orb: some View {
        let diameter = size ?? 56
        return TimelineView(.animation(paused: reduceMotion)) { context in
            let wave = reduceMotion ? 0.5 : Self.breath.wave(at: context.date)
            let turn = reduceMotion ? 0 : Self.spin.phase(at: context.date)
            ZStack {
                Circle()
                    .fill(GameColor.periwinkle.opacity(0.25))
                    .frame(width: diameter * 1.5, height: diameter * 1.5)
                    .scaleEffect(0.85 + 0.15 * wave)
                    .opacity(0.4 + 0.4 * wave)
                GameOrb(size: diameter, sparkle: true)
                    .rotationEffect(.degrees(360 * turn))
                    .scaleEffect(0.96 + 0.06 * wave)
            }
            .frame(width: diameter * 1.5, height: diameter * 1.5)
        }
    }

    private var dots: some View {
        let dot = size ?? 7
        let colors = [GameColor.sky, GameColor.periwinkle, GameColor.violet]
        return TimelineView(.animation(paused: reduceMotion)) { context in
            let phase = Self.pulse.phase(at: context.date)
            HStack(spacing: dot * 0.6) {
                ForEach(0..<3, id: \.self) { index in
                    // Each dot peaks a third of a cycle after the one before it.
                    let local = (phase - Double(index) / 3).truncatingRemainder(dividingBy: 1)
                    let lift = reduceMotion ? 0 : max(0, sin((local < 0 ? local + 1 : local) * 2 * .pi))
                    Circle()
                        .fill(colors[index])
                        .overlay(Circle().strokeBorder(GameColor.deep.opacity(0.35), lineWidth: 0.5))
                        .frame(width: dot, height: dot)
                        .scaleEffect(1 + 0.3 * lift)
                        .offset(y: -dot * 0.4 * lift)
                        .opacity(reduceMotion ? 1 : 0.55 + 0.45 * lift)
                }
            }
            .padding(.vertical, dot * 0.4)
        }
    }
}

/// Placeholders for game content that hasn't arrived yet. Shimmer is clock-driven and stops under
/// Reduce Motion (`ShimmerModifier`).
struct GameSkeletonCard: View {
    enum Kind {
        /// A grid tile: tall cover plus a title line (Library, Group shelf, search).
        case tile
        /// A game card in a chat or a post: cover, two lines, a Play button.
        case chatCard
        /// A full feed page: brand backdrop, a loader in the middle, caption lines at the bottom.
        case feedPage
    }

    var kind: Kind = .tile
    /// Read by VoiceOver.
    var label: String = "Loading"

    var body: some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
    }

    @ViewBuilder
    private var content: some View {
        switch kind {
        case .tile: tile
        case .chatCard: chatCard
        case .feedPage: feedPage
        }
    }

    private var tile: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: FBMetrics.radiusMedium * 1.5, style: .continuous)
                .fill(GameColor.skeleton)
                .aspectRatio(3 / 4, contentMode: .fit)
            block(height: 12)
            block(width: 64, height: 10)
        }
        .shimmering()
    }

    private var chatCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Rectangle()
                .fill(GameColor.skeleton)
                .aspectRatio(16 / 9, contentMode: .fit)
            VStack(alignment: .leading, spacing: 6) {
                block(width: 150, height: 12)
                block(width: 100, height: 10)
            }
            .padding(.horizontal, FBMetrics.gutter)
            Capsule()
                .fill(GameColor.skeleton)
                .frame(height: 32)
                .padding(.horizontal, FBMetrics.gutter)
                .padding(.bottom, FBMetrics.gutter)
        }
        .frame(width: 240)
        .background(GameColor.wash)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium * 2, style: .continuous))
        .shimmering()
    }

    private var feedPage: some View {
        ZStack(alignment: .bottomLeading) {
            GameColor.gradient
            GameLoader(style: .orb)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 8) {
                block(width: 180, height: 14, fill: Color.white.opacity(0.5))
                block(width: 120, height: 10, fill: Color.white.opacity(0.4))
            }
            .padding(FBMetrics.screenPadding)
            .padding(.bottom, 24)
        }
    }

    private func block(width: CGFloat? = nil, height: CGFloat, fill: Color = GameColor.skeleton) -> some View {
        RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous)
            .fill(fill)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

/// Eases a displayed progress value toward a target, so jumps between steps look like breaths.
/// Call `step(toward:at:)` from a `TimelineView` with the timeline's date. A class (not state)
/// on purpose: it keeps its value across body evaluations without triggering new ones.
final class GameProgressSmoother {
    private(set) var value: Double
    /// How fast it catches up, per second (2.2 closes about 90% of a gap in one second).
    private let rate: Double
    private var lastDate: Date?

    init(start: Double = 0.02, rate: Double = 2.2) {
        self.value = start
        self.rate = rate
    }

    func step(toward target: Double, at date: Date) -> Double {
        // Cap the frame gap so a paused timeline doesn't leap when it resumes.
        let dt = lastDate.map { min(0.1, max(0, date.timeIntervalSince($0))) } ?? 0
        lastDate = date
        value += (target - value) * min(1, dt * rate)
        return value
    }

    /// Jumps to `value` (for a retry or a new run).
    func reset(to value: Double = 0.02) {
        self.value = value
        lastDate = nil
    }
}

/// An overlay that shows a game's poster (an exact still of its first frame) until the live game
/// is ready, then fades out. Put it on top of the live view. After a short wait it adds a small
/// loader, so slow starts (a first engine load) don't look frozen.
struct PosterReveal<Fallback: View>: View {
    var poster: UIImage?
    var isLive: Bool
    /// Read by VoiceOver while loading.
    var label: String
    /// False leaves loading to the caller (for example `EngineLoadingView` on top).
    var showsLoader: Bool
    private let fallback: Fallback

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isLoaderVisible = false

    init(poster: UIImage?, isLive: Bool, label: String = "Loading", showsLoader: Bool = true, @ViewBuilder fallback: () -> Fallback) {
        self.poster = poster
        self.isLive = isLive
        self.label = label
        self.showsLoader = showsLoader
        self.fallback = fallback()
    }

    /// Seconds before the loader joins the poster.
    private static var loaderDelay: Duration { .milliseconds(450) }

    var body: some View {
        ZStack {
            if !isLive {
                ZStack(alignment: .bottom) {
                    backdrop
                    if isLoaderVisible {
                        GameLoader(style: .dots, label: nil)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(.bottom, 32)
                            .transition(.opacity)
                    }
                }
                .transition(.opacity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
            }
        }
        .animation(GameMotion.resolved(GameMotion.reveal, reduceMotion: reduceMotion), value: isLive)
        .animation(GameMotion.reveal, value: isLoaderVisible)
        .allowsHitTesting(!isLive)
        .task(id: isLive) {
            isLoaderVisible = false
            guard !isLive, showsLoader else { return }
            try? await Task.sleep(for: Self.loaderDelay)
            if !Task.isCancelled { isLoaderVisible = true }
        }
    }

    @ViewBuilder
    private var backdrop: some View {
        if let poster {
            Color.clear
                .overlay {
                    Image(uiImage: poster)
                        .resizable()
                        .scaledToFill()
                }
                .clipped()
        } else {
            fallback
        }
    }
}

extension PosterReveal where Fallback == LinearGradient {
    /// Falls back to the brand gradient when there is no poster yet.
    init(poster: UIImage?, isLive: Bool, label: String = "Loading", showsLoader: Bool = true) {
        self.init(poster: poster, isLive: isLive, label: label, showsLoader: showsLoader) { GameColor.gradient }
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 24) {
            GameLoader(style: .orb, label: "Muse is making your \(ProductName.singular)")
            GameLoader(style: .dots, label: "Checking…")
            HStack(spacing: 12) {
                GameSkeletonCard(kind: .tile)
                GameSkeletonCard(kind: .tile)
            }
            GameSkeletonCard(kind: .chatCard)
            GameSkeletonCard(kind: .feedPage).frame(height: 320)
            PosterReveal(poster: nil, isLive: false).frame(height: 200)
        }
        .padding()
    }
}
