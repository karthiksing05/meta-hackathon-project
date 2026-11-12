import SwiftUI

/// The picture layer of a Burst page in Reels: the run plays muted like a video while the page
/// is current, and every other page shows the Bubble's cover. Touches pass through to the page,
/// whose single tap is "take over".
struct BubbleBurstReelLayer: View {
    let bubbleID: String
    let replay: BubbleInputLog?
    /// This page is the one on screen (and nothing covers Reels).
    let isLive: Bool
    /// Held by a finger or paused by the viewer.
    let isPaused: Bool

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let bubble = bubbleStore.bubble(id: bubbleID)
        ZStack {
            if let bubble {
                BubbleCoverView(bubble: bubble)
                if isLive {
                    BubbleWebView(
                        manifest: bubble.manifest,
                        mode: replay.map { .replay($0) } ?? .demo,
                        isActive: !isPaused,
                        isMuted: true,
                        reducedMotion: reduceMotion
                    )
                }
            } else {
                BubbleGlow.brandGradient
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// "Tap to take over" capsule floated near the top of a Burst page.
struct BubbleBurstTakeoverHint: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "hand.tap.fill")
            Text("Tap to take over")
        }
        .font(.system(size: 14, weight: .bold, design: .rounded))
        .foregroundStyle(BubbleGlow.ink)
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(Color.white.opacity(0.92), in: Capsule())
        .bubbleGlow(.white, radius: 10, opacity: 0.6)
        .accessibilityHidden(true)
    }
}

/// The Burst line under the creator's name on a Reels page.
struct BubbleBurstInfoRow: View {
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        let title = bubbleStore.bubble(id: bubbleID)?.title ?? ProductName.withArticleCapitalized
        HStack(spacing: 6) {
            Text(bubbleStore.bubble(id: bubbleID)?.emoji ?? "✨")
            Text("Replay · \(title)")
                .font(.fbMetaEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(Color.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.white.opacity(0.18), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Replay of \(title). Tap to take over.")
    }
}

/// The "Bursts" row in the Video tab: covers only, no live runtimes.
struct BubbleBurstCarousel: View {
    let bursts: [Post]
    let onOpen: (Post?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(BubbleGlow.lilac)
                Text("Replays")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text("Replays you can take over")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button {
                    onOpen(nil)
                } label: {
                    Text("See all")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, FBMetrics.gutter)

            ScrollView(.horizontal) {
                LazyHStack(spacing: 8) {
                    ForEach(bursts) { burst in
                        Button {
                            onOpen(burst)
                        } label: {
                            BubbleBurstCard(burst: burst)
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(.horizontal, FBMetrics.gutter)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.vertical, 12)
        .background(FBColor.surface)
    }
}

private struct BubbleBurstCard: View {
    let burst: Post

    @Environment(BubbleStore.self) private var bubbleStore
    private let width: CGFloat = 112

    var body: some View {
        let bubble = burst.bubbleID.flatMap { bubbleStore.bubble(id: $0) }
        ZStack {
            if let bubble {
                BubbleCoverView(bubble: bubble)
            } else {
                BubbleGlow.brandGradient
            }
        }
        .frame(width: width, height: width * 16 / 9)
        .overlay {
            LinearGradient(
                colors: [Color.black.opacity(0.2), Color.clear, Color.black.opacity(0.6)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .overlay(alignment: .topLeading) {
            AvatarView(user: burst.author, size: FBAvatarSize.reply)
                .overlay { Circle().stroke(Color.white, lineWidth: 2) }
                .padding(8)
        }
        .overlay(alignment: .bottomLeading) {
            VStack(alignment: .leading, spacing: 4) {
                Text(bubble?.title ?? ProductName.withArticleCapitalized)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 3) {
                    Image(systemName: "play.fill")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                    Text(burst.viewCount.fbCompact)
                        .font(.fbCaptionEmphasized)
                }
            }
            .foregroundStyle(Color.white)
            .shadow(color: Color.black.opacity(0.45), radius: 2, y: 1)
            .padding(8)
        }
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Replay of \(bubble?.title ?? "a Bubble") by \(burst.author.name)")
        .accessibilityHint("Opens Reels")
    }
}
