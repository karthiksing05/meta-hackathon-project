import SwiftUI

/// DEBUG-only launch routing so screens can be opened and screenshotted without tapping.
///
/// Pass environment variables when launching on a simulator, e.g.
/// `SIMCTL_CHILD_FB_TAB=bubbles SIMCTL_CHILD_FB_OPEN=board:fog-words xcrun simctl launch booted com.karthiksing05.fbclone`
///
/// - `FB_TAB`: `home`, `video`, `bubbles`, `friends`, `notifications`, `menu`
/// - `FB_BEST_OF_5=<userID>`: show the best-of-5 offer for that friend (as after adding them)
/// - `FB_AUTH=screen|guest`: force the sign-in screen, or continue as a guest
/// - `FB_OPEN`: one of
///   `bubble:<id>`, `board:<id>`, `library`, `challenges`, `find-friends`, `sound:<id>`, `chain:<id>`, `marketplace`, `play:<id>`, `burst:<id>`,
///   `card:<id>` (a game's feed card in a post; `FB_HANDOFF_AUTOTAP=1` taps it), `play-file:<path>` (a game manifest JSON file on the Mac running the simulator: added for this session and played),
///   `studio`, `studio:<prompt>`, `edit:<id>`, `remix:<id>`, `next:<id>`, `daily:<groupID>`,
///   `group:<id>`, `event:<id>`, `profile:<userID>`, `reels`, `story:<userID>`,
///   `feature:<key>/<screen>[/<arg>]` for the collaboration features' screens (docs/BUBBLES.md 7.1;
///   keys: challenge, groups-search, together, remix, story, nextline, learn, length, saves)
///   `messenger`, `chat:<id prefix>` (or `chat:` for the latest chat)
/// - `FB_API=mock|live`: the feed, Reels, Stories and Messenger from the built-in mock world or the
///   server (`/v1/fb`, the default). See `FacebookAPI.swift`.
/// - `FB_SKIP_SPLASH=1`: no splash delay.
/// - `FB_LOGIN_EMAIL` + `FB_LOGIN_PASSWORD`: sign in as that (test) account at launch (`GamesAccount`).
/// - `FB_AUTOPLAY=1`: the player starts the run without the intro tap.
/// - `FB_OPEN=feature:challenge/play-round/<roundID>`: the player on a server round; `.../round/<id>` its results;
///   `.../rounds/group:<id>` a Group's rounds.
/// - `FB_STUDIO_PLAN=normal|questions|gap|opinion|story|loading|failed|off`: Studio's Plan step answers
///   with a preview plan (`GamePlanFixtures`) instead of the server, for screenshots.
/// - `FB_STUDIO_MEDIA_DEMO=1|error`: Studio's Describe step starts with mock photos and a video
///   (`StudioMediaModel.debugFill`; `error` adds a failed upload). Uploads use the mock. Pair with
///   `FB_STUDIO_SCROLL=media`.
/// - `FB_API_URL`: overrides the games API base URL (default `https://api.ol4ol.com`). Point it at an
///   unreachable host to see the loading and error states.
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
        case "challenges": router.push(.challengesInbox)
        case "find-friends": router.push(.findFriends)
        case "sound": router.push(.sound(arg))
        case "chain": router.push(.bubbleChain(arg))
        case "marketplace": router.push(.marketplace)
        case "play":
            // A server id or slug the app hasn't fetched yet: load it first (FB_OPEN=play:<server id>).
            Task { @MainActor in
                let bubble = await bubbleStore.loadGame(id: arg)
                router.play(bubble?.id ?? arg)
            }
        case "card":
            // A game's feed card as a post (FB_OPEN=card:<server id>); FB_HANDOFF_AUTOTAP=1 taps it
            // after 2.5 s to show the cover-to-game zoom (GameHandoffZoom).
            Task { @MainActor in
                guard let bubble = await bubbleStore.loadGame(id: arg) else { return }
                let post = Post(author: bubble.creator, text: "Try this one")
                post.bubbleID = bubble.id
                router.push(.post(post))
            }
        case "play-file":
            if let data = FileManager.default.contents(atPath: arg), let manifest = try? BubbleManifest.decode(data) {
                router.play(bubbleStore.publish(manifest).id)
            }
        case "burst":
            let replay = bubbleStore.bubble(id: arg)?.featuredRun?.replay
            router.play(arg, replay: replay)
        case "studio": router.openStudio(StudioLaunch(prompt: arg))
        case "edit": router.openStudio(StudioLaunch(mode: .edit, baseBubbleID: arg))
        case "remix": router.openStudio(StudioLaunch(mode: .remix, baseBubbleID: arg))
        case "next": router.openStudio(StudioLaunch(mode: .nextLevel, baseBubbleID: arg))
        case "daily": router.openStudio(StudioLaunch(mode: .daily, groupID: arg))
        case "group":
            if let group = appStore.group(id: arg) ?? bubbleStore.serverGroups[arg] {
                router.push(.group(group))
            } else {
                // A server Group the app hasn't fetched yet.
                Task { @MainActor in
                    if let detail = try? await bubbleStore.api.group(id: arg) {
                        router.push(.group(bubbleStore.adopt(detail)))
                    }
                }
            }
        case "event":
            if let event = appStore.event(id: arg) { router.push(.event(event)) }
        case "profile":
            if let user = arg == "me" ? appStore.me : appStore.user(id: arg) {
                router.push(.profile(user))
            } else if GameIDMap.isServerID(arg) {
                router.push(.profile(bubbleStore.resolvePerson(arg)))
            }
        case "reels": router.openReels()
        case "messenger": router.openMessenger()
        case "chat":
            // A chat by id, or the most recent one ("chat:" alone). Waits for the live chats to load.
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                let chat = arg.isEmpty ? appStore.inboxConversations.first : appStore.conversations.first { $0.id.hasPrefix(arg) }
                if let chat { router.openChat(chat) }
            }
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
