import SwiftUI

// Slot views for the "length" feature (docs/BUBBLES.md 7.9). Owner: length.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// The mode label on the result sheet ('10 rounds').
struct LengthResultLabel: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        EmptyView()
    }
}

/// The length chip on feed pages ('Endless: beat 42').
struct LengthCaptionLabel: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// The length on the Bubble page.
struct LengthDetailRow: View {
    let bubble: Bubble

    var body: some View {
        EmptyView()
    }
}

/// Studio's Customize panel: length mode, its numbers and the formula's tuning knobs.
struct LengthCustomizePanel: View {
    let model: StudioModel

    var body: some View {
        EmptyView()
    }
}
