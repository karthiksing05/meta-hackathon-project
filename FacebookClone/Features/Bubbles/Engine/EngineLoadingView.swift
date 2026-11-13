import SwiftUI

/// What people see while a game's engine starts: a breathing orb (or dots) with an honest label.
///
/// Keep it in the hierarchy and drive it with `isLoading`. It waits 150 ms before it shows, because
/// a warm runtime switches games in well under 50 ms (docs/BUBBLES.md 4.8) and a loader that
/// flashes for a frame looks broken. Once shown, it stays at least 400 ms. It never takes touches.
struct EngineLoadingView: View {
    enum Style {
        /// The orb in a soft card, centered. For the full-screen player.
        case card
        /// Dots in a small capsule. For feed pages, where the caption already fills the bottom.
        case pill
    }

    var isLoading: Bool
    var label: String = "Loading"
    var style: Style = .card

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isShown = false
    @State private var shownAt = Date.distantPast

    /// Quiet time before the loader appears.
    static let showDelay: Duration = .milliseconds(150)
    /// Shortest time the loader stays once it has appeared.
    static let minimumHold: TimeInterval = 0.4

    var body: some View {
        ZStack {
            if isShown {
                content
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94)))
            }
        }
        .animation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion), value: isShown)
        .allowsHitTesting(false)
        .task(id: isLoading) {
            if isLoading {
                guard !isShown else { return }
                try? await Task.sleep(for: Self.showDelay)
                guard !Task.isCancelled else { return }
                shownAt = Date()
                isShown = true
            } else {
                guard isShown else { return }
                let held = Date().timeIntervalSince(shownAt)
                if held < Self.minimumHold {
                    try? await Task.sleep(for: .seconds(Self.minimumHold - held))
                }
                guard !Task.isCancelled else { return }
                isShown = false
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch style {
        case .card:
            GameLoader(style: .orb, label: label, size: 48)
                .padding(.horizontal, 24)
                .padding(.vertical, 18)
                .frame(minWidth: 180)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
                .shadow(color: Color.black.opacity(0.12), radius: 12, y: 4)
        case .pill:
            GameLoader(style: .dots, label: label, size: 6)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.ultraThinMaterial, in: Capsule())
        }
    }

    /// The label for starting `manifest`: microgames run on the WASM engine, which compiles on
    /// first use, so they say so; everything else just loads.
    static func label(for manifest: BubbleManifest) -> String {
        manifest.formula == .microgame ? "Warming up the game engine" : "Loading"
    }
}

#Preview {
    ZStack {
        GameColor.gradient.ignoresSafeArea()
        VStack(spacing: 40) {
            EngineLoadingView(isLoading: true, label: "Warming up the game engine")
            EngineLoadingView(isLoading: true, style: .pill)
        }
    }
}
