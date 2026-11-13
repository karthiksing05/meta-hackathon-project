import SwiftUI

/// The Bubble card on a post: cover or Burst preview, title and rule, the author's score and
/// "Pop in". The live runtime only starts after a tap, so scrolling the feed stays cheap.
struct BubblePostAttachment: View {
    let post: Post
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @State private var coverFrame: CGRect = .zero

    var body: some View {
        if let bubble = bubbleStore.bubble(id: bubbleID) {
            card(bubble)
                .padding(.horizontal, FBMetrics.gutter)
                .padding(.bottom, 8)
        }
    }

    private func card(_ bubble: Bubble) -> some View {
        let shape = RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
        // The game's theme (docs/BUBBLES.md, "App theme"): its cover full bleed, its wordmark over
        // it, its palette on the Play button and the border. Nil while loading: Glow fallbacks.
        let theme = GameThemeCenter.shared.resolved(for: bubble)
        let accent = bubble.themeAccent(theme)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                startPlay(bubble)
            } label: {
                Color.clear
                    .aspectRatio(4.0 / 5.0, contentMode: .fit)
                    .overlay { GameCoverArt(bubble: bubble) }
                    .clipped()
                    .frame(maxWidth: .infinity)
                    .overlay(alignment: .bottom) { coverTitle(bubble) }
                    .overlay(alignment: .topLeading) { badge(bubble) }
                    .overlay(alignment: .topTrailing) { burstChip }
                    .modifier(GameHandoffSource(frame: $coverFrame))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(post.bubbleReplay == nil ? "Play \(bubble.title)" : "Watch the replay, then play \(bubble.title)")

            VStack(alignment: .leading, spacing: 6) {
                if let line = scoreLine(bubble) {
                    Text(line)
                        .font(.fbMeta.weight(.semibold))
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                }
                HStack(spacing: 8) {
                    Button {
                        startPlay(bubble)
                    } label: {
                        Label("Play", systemImage: "play.fill")
                            .font((theme ?? .empty).bodyFont(size: 16, weight: .bold))
                            .foregroundStyle(bubble.themeOnAccent(theme))
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(accent, in: Capsule())
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
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.inputBackground)
        }
        .clipShape(shape)
        .overlay { shape.strokeBorder(accent.opacity(0.7), lineWidth: 1) }
        #if DEBUG
        .task {
            guard DebugLaunch.value("FB_HANDOFF_AUTOTAP") == "1" else { return }
            try? await Task.sleep(for: .seconds(2.5))
            startPlay(bubble)
        }
        #endif
        .animation(.easeOut(duration: 0.25), value: theme == nil)
    }

    /// The game's wordmark and rule over a soft scrim at the bottom of the cover.
    private func coverTitle(_ bubble: Bubble) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            GameWordmark(bubble: bubble, size: 28, maxHeight: 72)
                .shadow(color: .black.opacity(0.35), radius: 3, y: 1)
            Text(bubble.rule)
                .font(.fbMeta)
                .foregroundStyle(Color.white.opacity(0.92))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.top, 36)
        .padding(.bottom, 12)
        .background(
            LinearGradient(colors: [.black.opacity(0), .black.opacity(0.62)], startPoint: .top, endPoint: .bottom)
        )
    }

    /// Plays the game, zooming this cover into it (`GameHandoffZoom`).
    private func startPlay(_ bubble: Bubble) {
        Haptics.light()
        GameHandoff.begin(bubble.id, frame: coverFrame, cornerRadius: FBMetrics.radiusLarge)
        router.play(bubble.id, replay: post.bubbleReplay)
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
