import SwiftUI

/// The Bubble card on a post: cover or Burst preview, title and rule, the author's score and
/// "Pop in". The live runtime only starts after a tap, so scrolling the feed stays cheap.
struct BubblePostAttachment: View {
    let post: Post
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        if let bubble = bubbleStore.bubble(id: bubbleID) {
            card(bubble)
                .padding(.horizontal, FBMetrics.gutter)
                .padding(.bottom, 8)
        }
    }

    private func card(_ bubble: Bubble) -> some View {
        let shape = RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                Haptics.light()
                router.play(bubble.id, replay: post.bubbleReplay)
            } label: {
                BubbleCoverView(bubble: bubble)
                    .aspectRatio(16.0 / 10.0, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .overlay(alignment: .topLeading) { badge(bubble) }
                    .overlay(alignment: .bottomTrailing) { burstChip }
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(post.bubbleReplay == nil ? "Play \(bubble.title)" : "Watch the replay, then play \(bubble.title)")

            VStack(alignment: .leading, spacing: 6) {
                Text(bubble.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(bubble.rule)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
                if let line = scoreLine(bubble) {
                    Text(line)
                        .font(.fbMeta.weight(.semibold))
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                        .padding(.top, 2)
                }
                HStack(spacing: 8) {
                    Button {
                        Haptics.light()
                        router.play(bubble.id, replay: post.bubbleReplay)
                    } label: {
                        Label("Play", systemImage: "sparkles")
                            .font(.fbName)
                            .foregroundStyle(BubbleGlow.ink)
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(BubbleGlow.brandGradient, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    Button {
                        router.push(.bubbleBoard(bubble.id))
                    } label: {
                        Label("Board", systemImage: "list.number")
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 36)
                            .background(FBColor.divider.opacity(0.6), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open the board for \(bubble.title)")
                }
                .padding(.top, 4)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.inputBackground)
        }
        .clipShape(shape)
        .overlay { shape.strokeBorder(BubbleGlow.palette(bubble.paletteID).top.opacity(0.7), lineWidth: 1) }
    }

    private func badge(_ bubble: Bubble) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
            Text(bubble.isDaily ? "Daily \(ProductName.singular)" : ProductName.singular)
        }
        .font(.fbCaptionEmphasized)
        .foregroundStyle(BubbleGlow.ink)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.white.opacity(0.85), in: Capsule())
        .padding(8)
    }

    @ViewBuilder
    private var burstChip: some View {
        if post.bubbleReplay != nil {
            HStack(spacing: 4) {
                Image(systemName: "play.fill")
                Text("Replay")
            }
            .font(.fbCaptionEmphasized)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.black.opacity(0.45), in: Capsule())
            .padding(8)
        }
    }

    private func scoreLine(_ bubble: Bubble) -> String? {
        guard let entry = bubbleStore.bestScore(of: post.author, in: bubble) else { return nil }
        let who = post.author.isMe ? "You" : post.author.firstName
        let verb = post.author.isMe ? "scored" : "scored"
        return "\(who) \(verb) \(entry.score) · beat it"
    }
}
