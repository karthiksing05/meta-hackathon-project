import SwiftUI

/// Shared motion for the games feature, so every screen moves the same way.
///
/// Rule: never start a repeating animation (`withAnimation(.repeatForever)`) in `onAppear`. On
/// iOS 18 it joined that frame's transaction and replayed the Home feed's inset change forever
/// (see `ShimmerModifier`). Loops read the clock instead: wrap them in `TimelineView` and take
/// their phase from `GameMotion.loop(period:)`.
enum GameMotion {
    /// Taps and toggles: quick, a little bounce.
    static let tap = Animation.spring(response: 0.25, dampingFraction: 0.6)
    /// Content arriving: rows, cards, badges, toasts.
    static let appear = Animation.spring(response: 0.35, dampingFraction: 0.85)
    /// Wins, new bests, publish: a bigger, bouncier spring.
    static let celebrate = Animation.spring(response: 0.45, dampingFraction: 0.55)
    /// Moving between Studio stages or big panels.
    static let stage = Animation.spring(response: 0.45, dampingFraction: 0.9)
    /// A poster or placeholder handing over to live content.
    static let reveal = Animation.easeOut(duration: 0.25)
    /// What every animation becomes under Reduce Motion: a short fade, no movement.
    static let reduced = Animation.easeInOut(duration: 0.2)

    /// `animation`, or a plain fade when Reduce Motion is on.
    static func resolved(_ animation: Animation, reduceMotion: Bool) -> Animation {
        reduceMotion ? reduced : animation
    }

    /// A clock-driven loop for `TimelineView`. Read its phase at the timeline's date:
    ///
    ///     let spin = GameMotion.loop(period: 2)
    ///     TimelineView(.animation(paused: reduceMotion)) { context in
    ///         Ring().rotationEffect(.degrees(360 * spin.phase(at: context.date)))
    ///     }
    static func loop(period: TimeInterval) -> GameLoop {
        GameLoop(period: period)
    }
}

/// A repeating phase computed from the clock, never from animation state.
struct GameLoop: Hashable {
    /// Seconds per cycle.
    let period: TimeInterval

    /// 0 → 1 once per period, then jumps back to 0.
    func phase(at date: Date) -> Double {
        guard period > 0 else { return 0 }
        return date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
    }

    /// 0 → 1 → 0 once per period, eased like a breath (a cosine).
    func wave(at date: Date) -> Double {
        (1 - cos(phase(at: date) * 2 * .pi)) / 2
    }

    /// Which of `count` steps is current (for dots and frame-by-frame loops).
    func step(at date: Date, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(count - 1, Int(phase(at: date) * Double(count)))
    }
}

// MARK: - Appear

private struct GameAppearModifier: ViewModifier {
    var delay: Double
    var offset: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : offset)
            .scaleEffect(shown || reduceMotion ? 1 : 0.97)
            // Scoped to `shown`, so the one-shot change can't animate anything outside this view.
            .animation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion).delay(delay), value: shown)
            .task { shown = true }
    }
}

// MARK: - Press

/// A button style that squeezes on press. Under Reduce Motion it only dims.
struct GamePressStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(GameMotion.resolved(GameMotion.tap, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

extension View {
    /// Fades and lifts the view in once, the first time it appears. `delay` staggers lists.
    func gameAppear(delay: Double = 0, offset: CGFloat = 8) -> some View {
        modifier(GameAppearModifier(delay: delay, offset: offset))
    }

    /// The games feature's press feel for a `Button` (or anything that takes a button style).
    func gamePress(scale: CGFloat = 0.96) -> some View {
        buttonStyle(GamePressStyle(scale: scale))
    }
}
