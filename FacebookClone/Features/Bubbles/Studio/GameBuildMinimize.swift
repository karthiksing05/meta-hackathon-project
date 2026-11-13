import SwiftUI

/// Studio's Minimize: a chevron-down in the top bar and a swipe down from the top of the screen,
/// while Muse builds. The build keeps going in `GameBuildTracker` and shows in the dock.

/// The top-bar chevron.
struct GameBuildMinimizeButton: View {
    let action: () -> Void

    var body: some View {
        StudioCircleButton(symbol: "chevron.down", accessibilityLabel: "Minimize. Keeps building", action: action)
    }
}

/// Swipe down from the top part of Studio to minimize. The screen follows the finger a little;
/// past the threshold it minimizes, otherwise it springs back.
struct GameBuildMinimizeGesture: ViewModifier {
    let isEnabled: Bool
    let onMinimize: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drag: CGFloat = 0

    /// Only drags that start in the top of the screen (top bar and header), so the Build step's
    /// own scrolling is left alone.
    private let startZone: CGFloat = 220
    private let threshold: CGFloat = 120

    func body(content: Content) -> some View {
        content
            .offset(y: reduceMotion ? 0 : drag)
            .scaleEffect(reduceMotion ? 1 : 1 - min(drag, 300) / 3000, anchor: .top)
            .simultaneousGesture(
                DragGesture(minimumDistance: 16, coordinateSpace: .global)
                    .onChanged { value in
                        guard isEnabled, value.startLocation.y < startZone,
                              value.translation.height > abs(value.translation.width) else { return }
                        drag = max(0, value.translation.height * 0.5)
                    }
                    .onEnded { value in
                        let pulled = isEnabled && value.startLocation.y < startZone
                            && max(value.translation.height, value.predictedEndTranslation.height * 0.6) > threshold
                            && value.translation.height > abs(value.translation.width)
                        if pulled {
                            onMinimize()
                        } else {
                            withAnimation(GameMotion.appear) { drag = 0 }
                        }
                    },
                including: isEnabled ? .all : .subviews
            )
    }
}
