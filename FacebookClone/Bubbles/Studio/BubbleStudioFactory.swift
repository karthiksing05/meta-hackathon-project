import Foundation

/// Builds the Muse Studio service the app uses: the Muse harness when a key is configured
/// (`MuseConfig.json` in the bundle or `MUSE_API_KEY`), the offline composer otherwise. Both
/// validate and playtest with the bundled runtime.
enum BubbleStudioFactory {
    static func make() -> BubbleStudioService {
        let runtime = StudioRuntime.bundled()
        let world = StudioDemoWorld.load()
        if let config = MuseConfig.load() {
            return MuseStudioService(config: config, runtime: runtime, world: world)
        }
        return OfflineStudioService(runtime: runtime, world: world)
    }
}

/// Kept for code written against the placeholder: the offline service.
typealias PlaceholderStudioService = OfflineStudioService
