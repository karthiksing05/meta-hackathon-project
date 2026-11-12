import SwiftUI

/// Sweeps a soft highlight across the view, like Facebook's loading placeholders.
struct ShimmerModifier: ViewModifier {
    var isActive: Bool = true
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                if isActive {
                    GeometryReader { proxy in
                        let width = proxy.size.width
                        LinearGradient(
                            colors: [.clear, Color.white.opacity(0.35), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: width * 0.6)
                        .offset(x: phase * width * 1.3)
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                }
            }
            .onAppear {
                guard isActive else { return }
                withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) {
                    phase = 1.4
                }
            }
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
