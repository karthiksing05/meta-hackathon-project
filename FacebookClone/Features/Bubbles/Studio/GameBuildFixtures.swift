#if DEBUG
import SwiftUI

/// DEBUG-only screenshot fixtures for the build dock (`GameBuildDock`). Nothing here exists in
/// release builds, and fixture builds are never polled or saved.
///
/// - `FB_BUILDS=building|ready|failed|two|two-open|mixed`: show those builds in the dock
///   (`two`: two building, collapsed; `two-open`: the same, opened; `mixed`: one ready, one building).
/// - `FB_BUILDS_SCREEN=feed|groups|chat`: open that screen under the dock (Home, the Groups screen,
///   or Messenger's chats).
@MainActor
enum GameBuildFixtures {
    private static var didApply = false

    static func applyIfRequested(router: Router, bubbleStore: BubbleStore) {
        guard !didApply, let name = DebugLaunch.value("FB_BUILDS") else { return }
        didApply = true
        GameBuildTracker.shared.debugShow(builds(name, poster: nil))
        switch DebugLaunch.value("FB_BUILDS_SCREEN") {
        case "groups":
            router.selectedTab = .home
            router.push(.groups)
        case "chat":
            router.openMessenger()
        default:
            router.selectedTab = .home
        }
        // The ready poster: a game's cover, once the games have loaded.
        guard ["ready", "mixed"].contains(name) else { return }
        Task { @MainActor in
            for _ in 0..<10 {
                if let cover = bubbleStore.bubbles.lazy.compactMap(\.coverImageData).first {
                    GameBuildTracker.shared.debugShow(builds(name, poster: cover))
                    return
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
    }

    private static func builds(_ name: String, poster: Data?) -> [GameBuild] {
        let now = Date()
        func build(_ title: String, _ status: GameBuild.Status, _ step: String, _ progress: Double) -> GameBuild {
            GameBuild(id: UUID(), jobID: "fixture", request: title, title: title, status: status, stepText: step,
                      progress: progress, startedAt: now, poster: status == .ready ? poster : nil, isMinimized: true)
        }
        let pancake = build("Pancake rush", .building, "Muse is playtesting…", 0.72)
        switch name {
        case "ready":
            return [build("Pancake Rush", .ready, "", 1)]
        case "failed":
            return [build("Pancake rush", .failed, "Muse took too long to answer.", 0.5)]
        case "two", "two-open":
            return [pancake, build("Hill sprint trivia", .building, "Muse is drafting…", 0.2)]
        case "mixed":
            return [build("Pancake Rush", .ready, "", 1), build("Hill sprint trivia", .building, "Muse is drafting…", 0.2)]
        default:
            return [pancake]
        }
    }

    /// `two-open` starts with the stack opened.
    static var startsExpanded: Bool { DebugLaunch.value("FB_BUILDS") == "two-open" }
}
#endif
