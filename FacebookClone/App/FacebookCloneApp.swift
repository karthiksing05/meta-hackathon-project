import SwiftUI

@main
struct FacebookCloneApp: App {
    @State private var store: AppStore
    @State private var bubbleStore: BubbleStore
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
        let store = AppStore()
        let bubbleStore = BubbleStore(appStore: store)
        bubbleStore.studio = BubbleStudioFactory.make()
        BubbleSurfaceHooks.install(appStore: store, bubbleStore: bubbleStore)
        // Audio session, the persisted game mute and social cues from notifications.
        GameSound.install(appStore: store)
        // BubbleStore warms the runtime pool itself, right after the first frame.
        _store = State(initialValue: store)
        _bubbleStore = State(initialValue: bubbleStore)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(bubbleStore)
                .environment(router)
                .preferredColorScheme(appearance.colorScheme)
                .tint(FBColor.accent)
        }
    }
}
