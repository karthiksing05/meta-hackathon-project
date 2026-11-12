import SwiftUI

// Slot views for the "story" feature (docs/BUBBLES.md 7.6). Owner: story.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift.

/// After an ending: which ending (N of M), endings found, friends' paths ('Maya took the
/// ferry'), and Send your path. Sheets open locally, because the player's cover sits over
/// `router.bubbleSheet`.
struct StoryResultEndings: View {
    let slot: BubbleResultSlotContext

    @State private var isSharing = false

    var body: some View {
        if slot.bubble.formula == .story {
            StoryEndingsPanel(
                bubble: slot.bubble,
                style: .result,
                onSendPath: { isSharing = true },
                onPlay: nil
            )
            .sheet(isPresented: $isSharing) {
                StoryPathShareSheet(bubbleID: slot.bubble.id)
            }
        }
    }
}

/// Endings found by you and friends on the Bubble page, with Play to find the rest.
struct StoryDetailEndings: View {
    let bubble: Bubble

    @Environment(Router.self) private var router
    @State private var isSharing = false

    var body: some View {
        if bubble.formula == .story {
            StoryEndingsPanel(
                bubble: bubble,
                style: .detail,
                onSendPath: { isSharing = true },
                onPlay: { router.play(bubble.id) }
            )
            .sheet(isPresented: $isSharing) {
                StoryPathShareSheet(bubbleID: bubble.id)
            }
        }
    }
}

/// Studio Ask entry: turn your own story into an adventure.
struct StoryStudioEntry: View {
    let model: StudioModel

    @State private var isWriting = false

    var body: some View {
        if model.mode == .create {
            Button {
                Haptics.light()
                isWriting = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: BubbleCategory.adventure.symbol)
                        .font(.system(size: FBIconSize.regular, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(StoryMyStorySheet.iconGradient, in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(StoryCopy.myStoryEntryTitle)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Text(hasStory ? StoryCopy.myStoryAdded : StoryCopy.myStoryEntrySubtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: hasStory ? "checkmark.circle.fill" : "chevron.right")
                        .font(.system(size: FBIconSize.small, weight: .semibold))
                        .foregroundStyle(hasStory ? FBColor.accent : FBColor.tertiaryText)
                        .accessibilityHidden(true)
                }
                .padding(12)
                .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, FBMetrics.screenPadding)
            .accessibilityLabel(StoryCopy.myStoryEntryTitle)
            .accessibilityHint(StoryCopy.myStoryEntrySubtitle)
            .sheet(isPresented: $isWriting) {
                StoryMyStorySheet(model: model)
            }
            .onAppear {
                // Opened with an own story (StudioLaunch.social): make it an adventure.
                if hasStory && model.formulaHint == nil {
                    model.formulaHint = .story
                }
            }
        }
    }

    private var hasStory: Bool {
        !(model.social?.personalStory ?? "").isEmpty
    }
}

/// Path cards in Messenger and Group posts ('Alex took the stairs. Which way would you go?').
struct StoryCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        StoryPathCardView(card: card, isFromMe: placement.isFromMe)
            .frame(width: isPost ? nil : 260)
            .padding(isPost ? EdgeInsets(top: 0, leading: FBMetrics.gutter, bottom: 8, trailing: FBMetrics.gutter) : EdgeInsets())
    }

    private var isPost: Bool {
        if case .post = placement { return true }
        return false
    }
}
