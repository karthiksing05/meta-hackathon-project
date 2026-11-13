import SwiftUI

/// A path card (`.storyPath`, docs/BUBBLES.md 7.6): "Alex took the stairs. Which way would you go?"
/// with the choices taken, which ending (by number, no spoilers) and Play, which plays the same
/// seed. Extras: `ending_id`, `path_choices` ([choice text]), `found` (endings the sender has found).
struct StoryPathCardView: View {
    let card: BubbleChatCard
    let isFromMe: Bool
    var showsPlay = true

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        let story = bubble.flatMap { StoryAdventure($0.manifest) }
        let choices = card.extras["path_choices"]?.strings ?? []
        let ending = story?.ending(id: card.extras["ending_id"]?.string)
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                Group {
                    if let bubble {
                        BubbleCoverView(bubble: bubble, showsEmoji: true)
                    } else {
                        BubbleGlow.lilacHaze.gradient
                    }
                }
                .frame(height: 104)
                .frame(maxWidth: .infinity)
                .clipped()
                BubbleCategoryChip(category: .adventure, onDark: true)
                    .padding(8)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(headline(story: story, choices: choices))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if !choices.isEmpty {
                    pathLine(choices)
                }
                HStack(spacing: 6) {
                    if let bubble {
                        Text(bubble.title)
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    if let ending, let story {
                        Text("·")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.tertiaryText)
                        Text("\(StoryCopy.endingOf(ending.number, story.endings.count)) \(ending.emoji)")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                }
                if showsPlay {
                    Button {
                        Haptics.light()
                        BubbleSocialHub.play(card, router: router)
                    } label: {
                        Label(StoryCopy.play, systemImage: "play.fill")
                    }
                    .buttonStyle(.fb(.primary, height: 36))
                    .disabled(bubble == nil)
                    .accessibilityHint(StoryCopy.whichWay)
                }
            }
            .padding(12)
        }
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(FBColor.divider, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(headline(story: story, choices: choices))
    }

    /// Your own card reads "You took the stairs…"; everyone else sees the sender's name.
    private func headline(story: StoryAdventure?, choices: [String]) -> String {
        guard isFromMe, let story, let first = choices.first,
              let choice = story.scenes[story.start]?.choices.first(where: { $0.text == first }) else {
            return card.headline
        }
        return "\(StoryCopy.youTook(choice.pastTense)). \(StoryCopy.whichWay)"
    }

    private func pathLine(_ choices: [String]) -> some View {
        let shown = choices.prefix(4)
        return FlowLayout(spacing: 4, lineSpacing: 4) {
            ForEach(Array(shown.enumerated()), id: \.offset) { index, text in
                HStack(spacing: 4) {
                    if index > 0 {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(FBColor.tertiaryText)
                    }
                    Text(text)
                        .font(.fbCaptionEmphasized)
                        .foregroundStyle(FBColor.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(FBColor.tintedBlueBackground, in: Capsule())
                }
            }
            if choices.count > shown.count {
                Text("+\(choices.count - shown.count)")
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(isFromMe ? StoryCopy.yourPath : StoryCopy.pathLabel): \(choices.joined(separator: ", "))")
    }
}
