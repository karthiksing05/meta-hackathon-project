import SwiftUI

/// Screens and launch hooks for the "length" feature (docs/BUBBLES.md 7.9). Owner: length.
///
/// Length has no screens of its own: it lives in Studio's Customize panel, the player's intro card
/// (drawn by the runtime), the result sheet, feed pages and the Bubble page. Its routes open those.
///
/// QA targets, `FB_OPEN=feature:length/<screen>[/<arg>]` (with `FB_SKIP_SPLASH=1`):
///   customize/<bubbleID>          Studio editing <bubbleID>, scrolled to the Customize panel
///   intro/<bubbleID>/<mode>       the player on <bubbleID> locked to a mode, showing the intro card:
///                                 timed (60 seconds), rounds (10 rounds), lives (3 lives), endless
///   e.g. customize/hill-hopper, intro/hill-hopper/timed, intro/newinsf-fog-or-sun/rounds,
///        intro/cable-car-catch/lives (short ids work in FB_OPEN: intro/fog-or-sun/rounds)
enum LengthScreens {
    /// A pushed screen (`Route.bubbleFeature`): length opens other screens instead (see `open`).
    @MainActor
    @ViewBuilder
    static func destination(_ route: BubbleFeatureRoute) -> some View {
        BubbleFeaturePlaceholder(route: route)
    }

    /// A sheet over the tabs (`router.bubbleSheet`).
    @MainActor
    @ViewBuilder
    static func sheet(_ route: BubbleFeatureRoute) -> some View {
        BubbleFeaturePlaceholder(route: route)
    }

    /// Opens a route: `customize/<id>` opens Studio on the Customize panel; `intro/<id>/<mode>`
    /// plays the Bubble locked to that mode. Return false to push `destination`.
    @MainActor
    static func open(_ route: BubbleFeatureRoute, router: Router) -> Bool {
        switch route.screen {
        case "customize":
            guard !route.arg.isEmpty else { return false }
            LengthCustomizer.shared.requestScroll()
            router.openStudio(StudioLaunch(mode: .edit, baseBubbleID: route.arg))
            return true
        case "intro":
            let parts = route.arg.split(separator: "/", maxSplits: 1).map(String.init)
            guard let id = parts.first, !id.isEmpty else { return false }
            let length = parts.count > 1 ? demoLength(parts[1]) : nil
            router.play(BubblePlayRequest(bubbleID: id, length: length))
            return true
        default:
            return false
        }
    }

    /// `FB_OPEN=feature:length/...` (DEBUG): the routes open real screens with seed data, so there
    /// is nothing to stage.
    @MainActor
    static func debugOpen(_ route: BubbleFeatureRoute, router: Router, appStore: AppStore, bubbleStore: BubbleStore) -> Bool {
        guard route.screen == "intro" || route.screen == "customize" else { return open(route, router: router) }
        var parts = route.arg.split(separator: "/", maxSplits: 1).map(String.init)
        guard let id = parts.first, !id.isEmpty else { return false }
        // Short ids work too ("fog-or-sun" finds "newinsf-fog-or-sun").
        guard let bubble = bubbleStore.bubble(id: id) ?? bubbleStore.bubbles.first(where: { $0.id.hasSuffix("-" + id) }) else { return false }
        parts[0] = bubble.id
        return open(BubbleFeatureRoute(route.feature, route.screen, parts.joined(separator: "/")), router: router)
    }

    /// Once at launch: a little later, on the runtime worker's queue, take every formula's length
    /// declaration from the runtime catalog (labels use the built-in copy until then).
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        let worker = bubbleStore.runtimeWorker
        worker.queue.asyncAfter(deadline: .now() + 3) {
            if let catalog = worker.loadRuntime()?.catalog() {
                BubbleLengthCatalog.shared.register(catalog: catalog)
            }
        }
    }

    /// After the player records one of your runs (the replay already carries the locked length).
    @MainActor
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest, appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// After Muse Studio publishes new Bubbles. The length is in the manifest already.
    @MainActor
    static func didPublish(_ bubbles: [Bubble], appStore: AppStore, bubbleStore: BubbleStore) {
    }

    /// The demo lengths for `intro/<id>/<mode>`.
    static func demoLength(_ mode: String) -> BubbleLength? {
        switch BubbleLengthMode(rawValue: mode.lowercased()) {
        case .timed: return .timed(60)
        case .rounds: return .rounds(10)
        case .lives: return .lives(3)
        case .endless: return .endless
        case nil: return nil
        }
    }
}

/// Every new user-facing string for the "length" feature, in one place so a rename is easy.
enum LengthCopy {
    // Customize panel
    static let customizeTitle = "Customize"
    static let customizeDetail = "How a run plays"
    static let lengthPicker = "Length"
    static let idle = "Every change is re-checked and playtested before it's kept."
    static let checking = "Re-checking and playtesting with bots…"
    static let didntValidate = "The game didn't pass its checks."
    static let sharedPromise = "Challenges, group chats and game nights lock everyone to this length, so it's a fair fight."

    static func rejected(_ why: String) -> String {
        "Kept the last version. \(why)"
    }

    static func modeExplainer(_ mode: BubbleLengthMode) -> String {
        switch mode {
        case .endless: return "Play until you pop. Beat your best."
        case .rounds: return "A set number of rounds, then the score is final."
        case .timed: return "Score as much as you can before the clock runs out."
        case .lives: return "Every miss costs a life. Out of lives, the run ends."
        }
    }

    /// "Playtest: a typical player lasts 60 s, 34 points"
    static func playtestLine(_ report: StudioPlaytest.Report) -> String {
        guard let run = report.typical, run.ok else { return "Playtest: the bots couldn't play it." }
        let seconds = Int(run.seconds.rounded())
        let points = run.score == 1 ? "1 point" : "\(run.score) points"
        if run.outcome == "timeout" { return "Playtest: a typical player is still going at \(seconds) s, \(points)" }
        return "Playtest: a typical player lasts \(seconds) s, \(points)"
    }

    static func knobEnds(_ knob: BubbleLengthKnob) -> (low: String, high: String) {
        switch knob.id {
        case "speed": return ("Slower", "Faster")
        case "difficulty": return ("Easier", "Harder")
        default: return (format(knob.value(at: 0)), format(knob.value(at: 1)))
        }
    }

    static func knobValue(_ knob: BubbleLengthKnob, position: Double) -> String {
        if knob.id == "timer" { return "\(format(knob.value(at: position))) s each" }
        let notch = Int((position * 10).rounded())
        let word: String
        switch knob.id {
        case "speed": word = position < 0.34 ? "Relaxed" : position < 0.67 ? "Lively" : "Zippy"
        default: word = position < 0.34 ? "Gentle" : position < 0.67 ? "Fair" : "Tough"
        }
        return "\(word) · \(notch)/10"
    }

    // Labels

    /// "60 seconds · 41"
    static func resultLine(_ length: BubbleLength, score: Int) -> String {
        "\(length.label) · \(score.withCommas)"
    }

    /// "Same for everyone: 10 rounds" / "You and Maya both played 10 rounds"
    static func sharedLine(_ length: BubbleLength, with name: String?) -> String {
        let what = length.mode == .endless ? "endless run" : length.label.lowercased()
        if let name, !name.isEmpty { return "You and \(name) played the same \(what)" }
        return "Same for everyone: \(what)"
    }

    static func detailSubtitle(_ length: BubbleLength) -> String {
        "\(modeExplainer(length.mode)) Challenges and group chats play it the same way."
    }

    static let customize = "Customize"
    static let customizeHint = "Opens Muse Studio to change how long a run lasts"

    static func accessibility(_ label: String, locked: Bool) -> String {
        locked ? "Length, same for everyone: \(label)" : "Length: \(label)"
    }

    private static func format(_ v: Double) -> String {
        v.rounded() == v ? "\(Int(v)) s" : String(format: "%.1f s", v)
    }
}
