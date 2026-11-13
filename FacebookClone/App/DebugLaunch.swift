import SwiftUI

/// DEBUG-only launch routing so screens can be opened and screenshotted without tapping.
///
/// Pass environment variables when launching on a simulator, e.g.
/// `SIMCTL_CHILD_FB_TAB=bubbles SIMCTL_CHILD_FB_OPEN=board:fog-words xcrun simctl launch booted com.karthiksing05.fbclone`
///
/// - `FB_TAB`: `home`, `video`, `bubbles`, `friends`, `notifications`, `menu`
/// - `FB_OPEN`: one of
///   `bubble:<id>`, `board:<id>`, `library`, `chain:<id>`, `marketplace`, `play:<id>`, `burst:<id>`,
///   `studio`, `studio:<prompt>`, `edit:<id>`, `remix:<id>`, `next:<id>`, `daily:<groupID>`,
///   `group:<id>`, `event:<id>`, `profile:<userID>`, `reels`, `story:<userID>`,
///   `feature:<key>/<screen>[/<arg>]` for the collaboration features' screens (docs/BUBBLES.md 7.1;
///   keys: challenge, groups-search, together, remix, story, nextline, learn, length, saves)
/// - `FB_SKIP_SPLASH=1`: no splash delay.
/// - `FB_API`: `mock` (default) or `live`; picks the games API client (`GamesAPIFactory.current`).
/// - `FB_API_URL`: overrides the live API base URL (default `https://api.ol4ol.com`).
/// - `FB_GENERATE`: where Studio makes new microgames (`GameGeneratorFactory.current`):
///   `mock` replays a recorded real run as server jobs (queue, fix rounds, playtest, done; no network),
///   `mock-plain` the same without the optional fields (`data`, `position`, `code`), `mock-fail` fails
///   after the second fix round (`FB_GENERATE_FAIL_CODE=gate_failed|muse_timeout|rate_limited|capped|…`
///   picks the code), `device` forces the on-device composer. Unset: the server with `FB_API=live`,
///   otherwise on-device (the default until the server's `/v1/generate` is live).
/// - `FB_GENERATE_SPEED=4`: replays the mock 4× faster (for screenshots).
/// - `FB_BRACKET=<userID>[:played]`: starts a get-to-know bracket with that person at launch
///   (`played` also records your round 1); see it on their profile (`FB_OPEN=profile:<userID>`).
/// - `FB_RESUME_DEMO=<seconds>` / `FB_RESUME_AUTO=1`: the Resume prompt in the player (see
///   `BubblePlayerView`). `FB_FAKE_RESULT=player`: the result card in the player only.
///
/// Screens can read their own `FB_*` variables for extra DEBUG-only state (keep them documented
/// at the top of that screen's file).
enum DebugLaunch {
    static var environment: [String: String] {
        #if DEBUG
        return ProcessInfo.processInfo.environment
        #else
        return [:]
        #endif
    }

    static func value(_ key: String) -> String? {
        guard let value = environment[key], !value.isEmpty else { return nil }
        return value
    }

    /// Applies `FB_TAB` and `FB_OPEN` once, shortly after the tabs appear.
    @MainActor
    static func apply(router: Router, appStore: AppStore, bubbleStore: BubbleStore) {
        #if DEBUG
        if let tab = value("FB_TAB").flatMap(AppTab.init(rawValue:)) {
            router.selectedTab = tab
        }
        guard let open = value("FB_OPEN") else { return }
        let parts = open.split(separator: ":", maxSplits: 1).map(String.init)
        let kind = parts[0]
        let arg = parts.count > 1 ? parts[1] : ""
        switch kind {
        case "bubble": router.push(.bubble(arg))
        case "board": router.push(.bubbleBoard(arg))
        case "library": router.push(.bubbleLibrary)
        case "chain": router.push(.bubbleChain(arg))
        case "marketplace": router.push(.marketplace)
        case "play": router.play(arg)
        case "burst":
            let replay = bubbleStore.bubble(id: arg)?.featuredRun?.replay
            router.play(arg, replay: replay)
        case "studio": router.openStudio(StudioLaunch(prompt: arg))
        case "edit": router.openStudio(StudioLaunch(mode: .edit, baseBubbleID: arg))
        case "remix": router.openStudio(StudioLaunch(mode: .remix, baseBubbleID: arg))
        case "next": router.openStudio(StudioLaunch(mode: .nextLevel, baseBubbleID: arg))
        case "daily": router.openStudio(StudioLaunch(mode: .daily, groupID: arg))
        case "group":
            if let group = appStore.group(id: arg) { router.push(.group(group)) }
        case "event":
            if let event = appStore.event(id: arg) { router.push(.event(event)) }
        case "profile":
            if let user = arg == "me" ? appStore.me : appStore.user(id: arg) { router.push(.profile(user)) }
        case "reels": router.openReels()
        case "story":
            break // Stories: the stories surface reads FB_OPEN=story:<userID> itself.
        case "feature":
            if let route = BubbleFeatureRoute(debugPath: arg) {
                BubbleFeatureRouter.debugOpen(route, router: router, appStore: appStore, bubbleStore: bubbleStore)
            }
        default:
            break
        }
        #endif
    }
}
