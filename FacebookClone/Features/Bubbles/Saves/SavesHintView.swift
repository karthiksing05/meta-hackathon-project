import SwiftUI
import Observation

/// The first-run hint that frames saves as the like. Shown once (a UserDefaults flag), on the
/// feed caption and in the player, near the Save control. Dismissed by tapping it, by saving, or
/// after a few seconds.
@MainActor
@Observable
final class SavesHintCenter {
    static let shared = SavesHintCenter()
    private static let key = "bubbles.saves.hintSeen"

    private(set) var isVisible: Bool

    private init() {
        isVisible = !(UserDefaults.standard.bool(forKey: Self.key))
    }

    func dismiss() {
        guard isVisible else { return }
        isVisible = false
        UserDefaults.standard.set(true, forKey: Self.key)
    }

    /// DEBUG `FB_OPEN=feature:saves/hint`: show it again even if it was seen.
    func reset() {
        UserDefaults.standard.set(false, forKey: Self.key)
        isVisible = true
    }
}

/// A small dark tip with a pointer, sitting on a game or a feed page.
struct SavesHintView: View {
    var onDark = true
    let onDismiss: () -> Void

    var body: some View {
        Button(action: onDismiss) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "bookmark.fill")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(Color(hex: 0x6EA8FF))
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(SavesCopy.hintTitle)
                        .font(.fbCaptionEmphasized)
                    Text(SavesCopy.hintBody)
                        .font(.fbCaption)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.leading)
                Image(systemName: "xmark")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                    .opacity(0.7)
                    .padding(.top, 3)
            }
            .foregroundStyle(Color.white)
            .padding(10)
            .background(Color(hex: 0x1F2B66).opacity(0.92), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).strokeBorder(Color.white.opacity(0.3), lineWidth: 0.5))
            .shadow(color: Color.black.opacity(0.3), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(SavesCopy.hintTitle) \(SavesCopy.hintBody)")
        .accessibilityHint("Double tap to dismiss")
        .accessibilityAddTraits(.isButton)
    }
}
