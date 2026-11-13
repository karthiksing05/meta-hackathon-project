import SwiftUI

// Length labels and the shared-play helpers (docs/BUBBLES.md 7.9). Owner: length.

extension BubbleLength {
    /// The length a player sees for a Bubble ("Endless", "10 rounds", "60 seconds", "3 lives"),
    /// or nil when the manifest doesn't say.
    static func display(for bubble: Bubble) -> BubbleLength? {
        effective(for: bubble.manifest)
    }

    /// The length a shared play locks everyone to (challenges, group-chat sessions, game nights):
    /// the Bubble's own length, else what its concepts say, else the formula's default with its
    /// suggested number. Put it on `BubbleChatCard.length` and `BubblePlayRequest.length`, so every
    /// player and every friend's bot run plays the same mode and numbers.
    static func locked(for bubble: Bubble) -> BubbleLength {
        if let own = bubble.manifest.length { return effective(for: bubble.manifest) ?? own }
        let spec = BubbleLengthCatalog.shared.spec(for: bubble.formula.rawValue)
        if let shown = effective(for: bubble.manifest), spec?.supports(shown.mode) ?? true { return shown }
        let def = defaultLength(for: bubble.manifest)
        return spec?.suggested(def.mode) ?? def
    }

    /// The label for a run: the length it recorded (`replay.length`), else the Bubble's.
    static func of(run replay: BubbleInputLog?, in bubble: Bubble) -> BubbleLength? {
        if let locked = replay?.length { return locked.normalized }
        return display(for: bubble)
    }
}

/// Brand tints for length chips: Facebook blue to purple (docs/STYLE_GUIDE.md, no pinks).
enum LengthTint {
    static let blue = FBColor.brandBlue
    static let purple = FBColor.savedPurple
}

/// A capsule with the mode's symbol and its label ("⏱ 60 seconds").
struct LengthChip: View {
    enum Style {
        /// White on a dark scrim (feed pages).
        case onDark
        /// Light tinted pill (Bubble page, result sheet).
        case tinted
    }

    let length: BubbleLength
    var text: String? = nil
    var style: Style = .tinted
    /// A small lock: everyone in this play has the same length.
    var locked = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: locked ? "lock.fill" : length.symbol)
                .font(.system(size: FBIconSize.xs, weight: .bold))
            Text(text ?? length.label)
                .font(.fbCaptionEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(style == .onDark ? Color.white : FBColor.accent)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(style == .onDark ? Color.black.opacity(0.32) : FBColor.tintedBlueBackground, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LengthCopy.accessibility(text ?? length.label, locked: locked))
    }
}
