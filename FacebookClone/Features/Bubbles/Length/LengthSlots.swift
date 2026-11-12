import SwiftUI

// Slot views for the "length" feature (docs/BUBBLES.md 7.9). Owner: length.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Keep each
// struct's name and stored properties (its call signature).

/// The mode label on the result sheet: "60 seconds · 41". In a challenge, group-chat session or
/// game night it says the length was the same for everyone ("10 rounds for everyone").
struct LengthResultLabel: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        if let length = BubbleLength.of(run: slot.result.result.replay, in: slot.bubble) {
            let shared = slot.play != nil || slot.request?.context != nil
            let who = slot.play?.opponentName ?? slot.request?.context?.opponentName
            VStack(spacing: 6) {
                LengthChip(length: length, text: LengthCopy.resultLine(length, score: slot.result.result.score), style: .tinted, locked: false)
                if shared {
                    HStack(spacing: 4) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: FBIconSize.xs, weight: .semibold))
                        Text(LengthCopy.sharedLine(length, with: who))
                            .font(.fbMeta)
                            .multilineTextAlignment(.center)
                    }
                    .foregroundStyle(FBColor.secondaryText)
                    .accessibilityElement(children: .combine)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

/// The length chip on feed pages ('Endless: beat 42' with your best, or '10 rounds').
struct LengthCaptionLabel: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore

    var body: some View {
        if let length = BubbleLength.display(for: bubble) {
            let best = bubbleStore.bestScore(of: appStore.me, in: bubble)?.score
            LengthChip(length: length, text: length.label(best: best), style: .onDark)
        }
    }
}

/// The length on the Bubble page: the mode and its numbers, your best to beat, the shared-play
/// promise, and Customize for the creator.
struct LengthDetailRow: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        if let length = BubbleLength.display(for: bubble) {
            let best = bubbleStore.bestScore(of: appStore.me, in: bubble)?.score
            let mine = bubble.creator.id == appStore.me.id
            HStack(alignment: .center, spacing: FBSpacing.m) {
                ZStack {
                    Circle().fill(GameColor.accentGradient)
                    Image(systemName: length.symbol)
                        .font(.system(size: FBIconSize.small, weight: .bold))
                        .foregroundStyle(.white)
                }
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(length.label(best: best))
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(LengthCopy.detailSubtitle(length))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
                if mine {
                    Button(LengthCopy.customize) {
                        Haptics.selection()
                        LengthCustomizer.shared.requestScroll()
                        router.openStudio(StudioLaunch(mode: .edit, baseBubbleID: bubble.id))
                    }
                    .buttonStyle(.fb(.secondary, expand: false, height: 32))
                    .accessibilityHint(LengthCopy.customizeHint)
                }
            }
            .padding(FBSpacing.m)
            .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        }
    }
}

/// Studio's Customize panel: length mode, its numbers and the formula's tuning knobs.
struct LengthCustomizePanel: View {
    let model: StudioModel

    var body: some View {
        LengthCustomizePanelView(model: model)
    }
}
