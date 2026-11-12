import SwiftUI

/// Keys for values stored with `@AppStorage`. Defaults are registered in `FacebookCloneApp.init`.
enum SettingsKey {
    static let appearance = "settings.appearance"
    static let autoplayVideos = "settings.autoplayVideos"
    static let haptics = "settings.haptics"
    static let soundEffects = "settings.soundEffects"
    static let dataSaver = "settings.dataSaver"
    static let activeStatus = "settings.activeStatus"
    static let pushNotifications = "settings.pushNotifications"
    static let showReactionCounts = "settings.showReactionCounts"
    /// Scroll Games server address (see `SGConfig`).
    static let scrollGamesBaseURL = "sg.baseURL"
}

enum AppearanceMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    /// Facebook labels dark mode as On / Off / System.
    var title: String {
        switch self {
        case .system: return "Use system settings"
        case .light: return "Off"
        case .dark: return "On"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
