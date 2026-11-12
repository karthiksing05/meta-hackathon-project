import UIKit

/// Haptic feedback that respects the "Haptics" switch in Settings. Call from views only.
@MainActor
enum Haptics {
    private static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: SettingsKey.haptics) as? Bool ?? true
    }

    static func light() { impact(.light) }
    static func medium() { impact(.medium) }
    static func heavy() { impact(.heavy) }
    static func soft() { impact(.soft) }
    static func rigid() { impact(.rigid) }

    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        guard isEnabled else { return }
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    static func selection() {
        guard isEnabled else { return }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    static func success() { notify(.success) }
    static func warning() { notify(.warning) }
    static func error() { notify(.error) }

    private static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        guard isEnabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }
}
