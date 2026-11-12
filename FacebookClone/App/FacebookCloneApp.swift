import SwiftUI

@main
struct FacebookCloneApp: App {
    @State private var store = AppStore()
    @State private var router = Router()
    @AppStorage(SettingsKey.appearance) private var appearance: AppearanceMode = .system

    init() {
        UserDefaults.standard.register(defaults: [
            SettingsKey.autoplayVideos: true,
            SettingsKey.haptics: true,
            SettingsKey.soundEffects: true,
            SettingsKey.dataSaver: false,
            SettingsKey.activeStatus: true,
            SettingsKey.pushNotifications: true,
            SettingsKey.showReactionCounts: true,
        ])
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(router)
                .preferredColorScheme(appearance.colorScheme)
                .tint(FBColor.accent)
        }
    }
}
