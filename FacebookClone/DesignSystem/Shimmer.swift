import SwiftUI

/// Sweeps a soft highlight across the view, like Facebook's loading placeholders.
///
/// The sweep is driven by the clock (`TimelineView`), not by a repeating `withAnimation` in
/// `onAppear`. A repeating animation started there joins that frame's whole transaction: on
/// iOS 18 the Home feed's one-time top inset change at launch was captured by it and replayed
/// every 1.3 s forever, so the feed crept downwards by itself. A clock-driven sweep can't leak.
struct ShimmerModifier: ViewModifier {
    var isActive: Bool = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// One sweep, left to right, in seconds.
    private static let period: TimeInterval = 1.3

    func body(content: Content) -> some View {
        content
            .overlay {
                if isActive && !reduceMotion {
                    TimelineView(.animation) { timeline in
                        GeometryReader { proxy in
                            let width = proxy.size.width
                            LinearGradient(
                                colors: [.clear, Color.white.opacity(0.35), .clear],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .frame(width: width * 0.6)
                            .offset(x: Self.phase(at: timeline.date) * width * 1.3)
                        }
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                }
            }
    }

    /// Where the highlight is at `date`: -1 (just off the leading edge) to 1.4 (past the trailing
    /// edge), linearly, once per period.
    private static func phase(at date: Date) -> CGFloat {
        let progress = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
        return CGFloat(-1 + 2.4 * progress)
    }
}

extension View {
    func shimmering(active: Bool = true) -> some View {
        modifier(ShimmerModifier(isActive: active))
    }
}

/// A gray rounded block used to build loading placeholders.
struct SkeletonBlock: View {
    var width: CGFloat? = nil
    var height: CGFloat
    var cornerRadius: CGFloat = FBMetrics.radiusSmall

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(FBColor.skeleton)
            .frame(width: width, height: height)
    }
}

/// A placeholder post shown while the feed loads.
struct PostSkeletonView: View {
    var showsMedia: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Circle()
                    .fill(FBColor.skeleton)
                    .frame(width: FBAvatarSize.post, height: FBAvatarSize.post)
                VStack(alignment: .leading, spacing: 6) {
                    SkeletonBlock(width: 140, height: 12)
                    SkeletonBlock(width: 80, height: 10)
                }
                Spacer()
            }
            .padding(.horizontal, FBMetrics.gutter)

            VStack(alignment: .leading, spacing: 6) {
                SkeletonBlock(height: 12)
                SkeletonBlock(width: 220, height: 12)
            }
            .padding(.horizontal, FBMetrics.gutter)

            if showsMedia {
                Rectangle()
                    .fill(FBColor.skeleton)
                    .frame(height: 260)
            }

            HStack {
                SkeletonBlock(width: 60, height: 10)
                Spacer()
                SkeletonBlock(width: 60, height: 10)
                Spacer()
                SkeletonBlock(width: 60, height: 10)
            }
            .padding(.horizontal, 32)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(FBColor.surface)
        .shimmering()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}
