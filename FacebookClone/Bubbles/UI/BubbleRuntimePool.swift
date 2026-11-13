import Observation
import QuartzCore
import SwiftUI
import UIKit
import WebKit

// Warm Bubble runtimes (docs/BUBBLES.md, 4.8).
//
// `BubbleRuntimePool` keeps a few `WKWebView`s that load `bubble-host.html` once and are never
// reloaded. Surfaces lease a host, run Bubbles in it as sessions (`prepare`, then `activate`),
// and give it back. A new Bubble is data sent to a warm page, not a new page.
//
// Hosts from runtimes without sessions (the stub only has `boot`) still work: `start` falls back
// to `BubbleHost.boot`, and posters are simply unavailable.
//
// Posters: every Bubble looks like itself (LOOKS.md), so surfaces show its poster frame, drawn
// by the runtime in the Bubble's own look. Use `BubblePosterView(bubble:)`, or
// `BubbleRuntimePool.shared.cachedPoster(for:)` / `poster(for:)` for the UIImage. Posters are
// cached in memory and on disk (Caches/BubblePosters) per manifest and runtime build.

/// How one session starts: the boot payload fields of docs/BUBBLES.md, 4.3.
struct BubbleSessionOptions: Hashable {
    var mode: BubbleRunMode = .play
    var playerName: String = ""
    var bestScore: Int? = nil
    var isMuted: Bool = true
    /// A library sound plays behind the game (natively): the game's own music stays off and its
    /// effects play a little quieter (docs/BUBBLES.md 4.3, `backing`).
    var hasBacking: Bool = false
    var reducedMotion: Bool = false
    /// Space at the top and bottom the runtime keeps clear for app chrome, in points.
    var insetTop: CGFloat = 0
    var insetBottom: CGFloat = 0
    /// Play mode: a saved partial run to fast-forward through and continue (docs/BUBBLES.md 4.8).
    var resume: BubbleInputLog? = nil

    /// The `activate` options (and the non-manifest part of the `prepare`/`boot` payload).
    var jsonObject: [String: JSONValue] {
        var object: [String: JSONValue] = [
            "mode": .string(mode.name),
            "muted": .bool(isMuted),
            "backing": .bool(hasBacking),
            "reduced_motion": .bool(reducedMotion),
            "player": .object([
                "name": .string(playerName),
                "best": bestScore.map { .number(Double($0)) } ?? .null,
            ]),
            "insets": .object([
                "top": .number(Double(insetTop.rounded())),
                "bottom": .number(Double(insetBottom.rounded())),
            ]),
        ]
        if let log = mode.replayLog, let replay = try? JSONValue.encode(log) {
            object["replay"] = replay
        }
        if let resume, let saved = try? JSONValue.encode(resume) {
            object["resume"] = saved
        }
        return object
    }
}

/// What happened when a session started.
struct BubbleStartOutcome {
    var ok: Bool
    var error: String? = nil
    /// The session was already prepared, so this was a warm switch.
    var wasPrepared = false
    /// The runtime only has `boot` (the stub): no sessions, no posters.
    var usedBoot = false
    /// A newer `start` on the same host replaced this one before it ran.
    var superseded = false
    /// Reported by the runtime.
    var prepareMs: Double? = nil
    var activateMs: Double? = nil
    /// Measured in Swift, from the call to the page being ready.
    var totalMs: Double = 0
}

// MARK: - Pool

/// A small pool of warm Bubble hosts. Call `warmUp()` early; lease a host for as long as a
/// Bubble is on screen and give it back when it leaves. Leasing never fails: when every warm
/// host is busy the pool makes another (cold) one.
@MainActor
final class BubbleRuntimePool: NSObject, WKScriptMessageHandler {
    static let shared = BubbleRuntimePool()

    /// Hosts loaded by `warmUp()`.
    static let warmCount = 2
    /// Idle hosts kept loaded after they come back. More are released.
    static let maxIdle = 2
    /// The pool tops up a spare idle host while it has fewer than this many hosts in total.
    static let spareLimit = 3

    /// One configuration for every host: one user content controller (and so one "bubble"
    /// message handler) and WebKit's shared web content process pool.
    ///
    /// `WKProcessPool` has been deprecated and a no-op since iOS 15 (all web views already share
    /// one), so sharing the configuration is how hosts share it now.
    let configuration: WKWebViewConfiguration

    private(set) var hosts: [BubbleRuntimeHost] = []
    private var idleHosts: [BubbleRuntimeHost] = []
    private var serialCounter = 0
    private var isTopUpScheduled = false
    private let posterCache = NSCache<NSString, UIImage>()
    private var posterTasks: [String: Task<UIImage?, Never>] = [:]
    /// Bumped each time a still is found to have been drawn before its images loaded. A draw that began under an older
    /// number is stale: it is not cached or written, so an artless still can never replace the redraw.
    private var posterGenerations: [String: Int] = [:]
    /// Poster files are written and deleted here, one at a time in the order they were asked, so a delete is never
    /// overtaken by the write it was meant to remove.
    private let posterIO = DispatchQueue(label: "bubble.poster.io", qos: .utility)
    private var explicitPosterSize: CGSize?

    /// The top inset posters are drawn with: the Bubbles tab's. The runtime keeps the HUD and the playfield clear of the
    /// app's header by this much, so a still drawn with the same inset is the live game's first frame. It is part of the
    /// cache key, so a still drawn before the inset was known, or at another one, is never reused.
    var posterInsetTop: CGFloat = 0
    /// Told the session key of a cached poster that was dropped for being drawn before its images loaded, so the surface
    /// showing it can draw it again. The Bubbles feed sets it.
    var onPosterStale: ((String) -> Void)?

    private override init() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // On, so a microgame's text field (bubble-kit-microgame.js) can take focus and type. The
        // game surface stays unselectable through CSS (`user-select: none`, no touch callout).
        configuration.preferences.isTextInteractionEnabled = true
        configuration.userContentController = WKUserContentController()
        self.configuration = configuration
        super.init()
        configuration.userContentController.add(BubbleWeakScriptHandler(self), name: "bubble")
        // Full-screen stills, decoded: about 5 MB each at 2x. The disk cache backs evictions.
        posterCache.countLimit = 16
        posterCache.totalCostLimit = 64 * 1024 * 1024
    }

    /// Loads the warm hosts in the background. Safe to call more than once and from any thread.
    nonisolated static func warmUp() {
        if Thread.isMainThread {
            MainActor.assumeIsolated { shared.fillWarmHosts() }
        } else {
            DispatchQueue.main.async {
                MainActor.assumeIsolated { shared.fillWarmHosts() }
            }
        }
    }

    /// A host for one surface. Prefers an idle host that already prepared `key` (see
    /// `prewarm`), then any idle host that has finished loading.
    func lease(preferring key: String? = nil) -> BubbleRuntimeHost {
        let host: BubbleRuntimeHost
        let prepared = key.flatMap { key in idleHosts.firstIndex { $0.isPrepared(key) || $0.isPreparing(key) } }
        if let index = prepared ?? idleHosts.firstIndex(where: { $0.isLoaded }) ?? idleHosts.indices.first {
            host = idleHosts.remove(at: index)
        } else {
            host = makeHost()
        }
        host.isLeased = true
        scheduleTopUp()
        return host
    }

    /// Prepares a session in an idle warm host so the surface that leases it next with
    /// `lease(preferring:)` starts with a warm switch. A no-op on runtimes without sessions.
    func prewarm(manifest: BubbleManifest, options: BubbleSessionOptions) {
        fillWarmHosts()
        guard let host = idleHosts.first else { return }
        let key = BubbleRuntimeHost.sessionKey(for: manifest)
        Task { @MainActor in
            await host.prepare(key: key, manifest: manifest, options: options)
        }
    }

    /// Returns a host. Its sessions are paused and stay prepared for whoever leases it next.
    func giveBack(_ host: BubbleRuntimeHost) {
        guard host.isLeased else { return }
        host.isLeased = false
        host.resetForPool()
        if idleHosts.count < Self.maxIdle {
            idleHosts.append(host)
        } else {
            host.shutDown()
            hosts.removeAll { $0 === host }
        }
    }

    /// Hosts that are loaded and idle right now.
    var idleCount: Int { idleHosts.filter(\.isLoaded).count }

    // MARK: Posters

    /// The size posters are drawn at: one Bubbles tab page (the screen above the tab bar). The
    /// Bubbles tab sets it to its exact page size; other surfaces show the same still scaled to
    /// fill.
    var posterSize: CGSize {
        get { explicitPosterSize ?? Self.defaultPosterSize() }
        set { explicitPosterSize = newValue.width > 1 && newValue.height > 1 ? newValue : nil }
    }

    /// A Bubble's poster frame if one is cached (memory, then disk). Never renders; pair it with
    /// `poster(for:)`, or use `BubblePosterView`, which does both.
    func cachedPoster(for bubble: Bubble) -> UIImage? {
        cachedPoster(forKey: BubbleRuntimeHost.sessionKey(for: bubble.manifest))
    }

    /// A Bubble's poster frame: its first frame drawn by the runtime in the Bubble's own look.
    /// Cached, or rendered now in an idle warm host. Nil on runtimes without posters (the stub);
    /// show the cover then.
    func poster(for bubble: Bubble) async -> UIImage? {
        await poster(for: bubble.manifest)
    }

    /// - Parameter fallback: a leased host to draw on when no idle warm host is free.
    func poster(for manifest: BubbleManifest, fallback: BubbleRuntimeHost? = nil) async -> UIImage? {
        let key = BubbleRuntimeHost.sessionKey(for: manifest)
        if let cached = cachedPoster(forKey: key) { return cached }
        if let running = posterTasks[key] { return await running.value }
        let task = Task { @MainActor () -> UIImage? in
            await self.renderPoster(key: key, manifest: manifest, fallback: fallback)
        }
        posterTasks[key] = task
        let image = await task.value
        posterTasks[key] = nil
        return image
    }

    /// Renders the posters these Bubbles don't have yet, one at a time in the background, so
    /// cards, stories and feed pages find them cached.
    func preparePosters(for bubbles: [Bubble]) {
        let manifests = bubbles.map(\.manifest)
        Task { @MainActor in
            for manifest in manifests {
                let key = BubbleRuntimeHost.sessionKey(for: manifest)
                guard cachedPoster(forKey: key) == nil else { continue }
                guard await poster(for: manifest) != nil else { return }
                // Leave the web process free for whatever is on screen between stills.
                try? await Task.sleep(nanoseconds: 30_000_000)
            }
        }
    }

    /// Where a session's still is kept: its key and the inset it is drawn with.
    private func posterCacheKey(_ key: String) -> String {
        "\(key)@t\(Int(posterInsetTop.rounded()))"
    }

    func cachedPoster(forKey key: String) -> UIImage? {
        let cacheKey = posterCacheKey(key)
        if let image = posterCache.object(forKey: cacheKey as NSString) {
            return image
        }
        guard let url = Self.posterFileURL(forKey: cacheKey),
              let data = try? Data(contentsOf: url),
              let image = UIImage(data: data, scale: Self.posterScale) else { return nil }
        cache(image, forKey: cacheKey)
        return image
    }

    /// A still was drawn while some of its images were still loading, and they have loaded since (the runtime says so
    /// with `poster_update`). The cached still is missing art the live game has, so forget it and tell whoever shows it
    /// to draw it again. Without this the incomplete still stayed, on disk too, and the page jumped to the live game.
    fileprivate func invalidatePoster(forKey key: String) {
        posterGenerations[key, default: 0] += 1
        posterTasks[key] = nil // a draw already running began under the old number; the redraw starts fresh
        let cacheKey = posterCacheKey(key)
        posterCache.removeObject(forKey: cacheKey as NSString)
        if let url = Self.posterFileURL(forKey: cacheKey) {
            posterIO.async { try? FileManager.default.removeItem(at: url) }
        }
        onPosterStale?(key)
    }

    /// The number a draw of this session's still starts under (see `posterGenerations`).
    fileprivate func posterGeneration(forKey key: String) -> Int {
        posterGenerations[key, default: 0]
    }

    /// Keeps a poster rendered by a host (JPEG data) in memory and on disk.
    /// Nil for a stale draw (one that began before its still was found to be incomplete): nothing is kept.
    fileprivate func storePoster(_ data: Data, forKey key: String, generation: Int) -> UIImage? {
        guard generation == posterGenerations[key, default: 0] else { return nil }
        guard let image = UIImage(data: data, scale: Self.posterScale) else { return nil }
        let cacheKey = posterCacheKey(key)
        cache(image, forKey: cacheKey)
        if let url = Self.posterFileURL(forKey: cacheKey) {
            posterIO.async {
                Self.writePoster(data, to: url)
            }
        }
        return image
    }

    private func cache(_ image: UIImage, forKey key: String) {
        let cost = Int(image.size.width * image.scale * image.size.height * image.scale * 4)
        posterCache.setObject(image, forKey: key as NSString, cost: cost)
    }

    /// Renders on an idle warm host without leasing it, so surfaces keep leasing warm hosts and
    /// the live game isn't interrupted. The session it prepares for the still is evicted again
    /// unless something else wants it.
    private func renderPoster(key: String, manifest: BubbleManifest, fallback: BubbleRuntimeHost?) async -> UIImage? {
        fillWarmHosts()
        let candidates = idleHosts.filter { $0.capability == .sessions || $0.capability == .unknown }
        guard let host = candidates.min(by: { $0.preparedSessionKeys.count < $1.preparedSessionKeys.count }) else {
            return await fallback?.poster(key: key, manifest: manifest, size: posterSize)
        }
        let wasPrepared = host.isPrepared(key) || host.isPreparing(key)
        let image = await host.poster(key: key, manifest: manifest, size: posterSize)
        if !wasPrepared && !host.isLeased {
            host.evict(key)
        }
        return image
    }

    static let posterScale: CGFloat = 2

    private static func defaultPosterSize() -> CGSize {
        let window = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first
        guard let window, window.bounds.width > 1 else { return CGSize(width: 393, height: 769) }
        // FBTabBar is 49 pt above the home indicator.
        let bottom = window.safeAreaInsets.bottom + 49
        return CGSize(width: window.bounds.width, height: max(window.bounds.height - bottom, window.bounds.width))
    }

    /// Caches/BubblePosters/<runtime build>-<session key>.jpg. The session key already changes
    /// with every manifest edit; the runtime build changes when the engine or a kit does.
    private static func posterFileURL(forKey key: String) -> URL? {
        guard let directory = posterDirectory else { return nil }
        let safe = String(key.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" })
        return directory.appendingPathComponent("\(runtimeBuild)-\(safe).jpg")
    }

    private static let posterDirectory: URL? = FileManager.default
        .urls(for: .cachesDirectory, in: .userDomainMask)
        .first?
        .appendingPathComponent("BubblePosters", isDirectory: true)

    private static let runtimeBuild = BubbleRuntimeWorker.runtimeFingerprint()

    private nonisolated static func writePoster(_ data: Data, to url: URL) {
        let directory = url.deletingLastPathComponent()
        let manager = FileManager.default
        if !manager.fileExists(atPath: directory.path) {
            try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        // Stills from older runtime builds are stale.
        let prefix = url.lastPathComponent.components(separatedBy: "-").first ?? ""
        if let names = try? manager.contentsOfDirectory(atPath: directory.path) {
            for name in names where !name.hasPrefix(prefix + "-") {
                try? manager.removeItem(at: directory.appendingPathComponent(name))
            }
        }
        try? data.write(to: url, options: .atomic)
    }

    // MARK: Messages

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let webView = message.webView,
              let host = hosts.first(where: { $0.webView === webView }) else { return }
        host.deliver(message.body)
    }

    // MARK: Private

    private func fillWarmHosts() {
        while hosts.count < Self.warmCount {
            idleHosts.append(makeHost())
        }
    }

    private func makeHost() -> BubbleRuntimeHost {
        serialCounter += 1
        let host = BubbleRuntimeHost(serial: serialCounter, configuration: configuration)
        hosts.append(host)
        host.load()
        return host
    }

    /// Keeps one loaded spare after a lease so the next surface also starts warm.
    private func scheduleTopUp() {
        guard !isTopUpScheduled else { return }
        isTopUpScheduled = true
        // Wait until the surface that just leased has started its Bubble.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            MainActor.assumeIsolated {
                let pool = BubbleRuntimePool.shared
                pool.isTopUpScheduled = false
                if pool.idleHosts.isEmpty && pool.hosts.count < Self.spareLimit {
                    pool.idleHosts.append(pool.makeHost())
                }
            }
        }
    }
}

// MARK: - Host

/// One warm `WKWebView` running `bubble-host.html`. Holds up to four prepared sessions, one of
/// them active. Messages are routed to the handler registered for the session's `key`.
@MainActor
final class BubbleRuntimeHost: NSObject, WKNavigationDelegate {
    enum Capability {
        /// Still loading.
        case unknown
        /// `prepare`, `activate`, `poster`, `evict` (docs/BUBBLES.md, 4.8).
        case sessions
        /// Only `boot` (the stub runtime).
        case bootOnly
        /// The page loaded without a runtime.
        case missing
    }

    let serial: Int
    let webView: WKWebView
    private(set) var isLoaded = false
    private(set) var capability: Capability = .unknown
    /// `Bubble.version` from the page, e.g. "0.0-stub".
    private(set) var runtimeVersion: String?
    /// The session on screen, or the last one started.
    private(set) var activeKey: String?
    private(set) var activeMode: BubbleRunMode?
    fileprivate(set) var isLeased = false

    /// Sessions the page holds, least recently used first. Mirrors the page's own LRU.
    private var preparedKeys: [String] = []
    private static let pageSessionLimit = 4
    private var handlers: [String: (BubbleBridgeMessage) -> Void] = [:]
    /// Prepares in flight, so the same session is never prepared twice at once.
    private var preparing: [String: Task<(ok: Bool, ms: Double?, error: String?), Never>] = [:]
    private var loadWaiters: [CheckedContinuation<Void, Never>] = []
    private var startChain: Task<Void, Never>?
    private var startGeneration = 0
    /// Restarted after a web content process crash.
    private var lastStart: (key: String, manifest: BubbleManifest, options: BubbleSessionOptions)?
    /// The active session's sound, as last told to the page. While it is audible the host holds
    /// the audio session in `.playback` (`GameSound.beginGamePlayback`), so the silent switch
    /// doesn't silence the game.
    private var soundMuted = true
    private var soundPaused = true

    init(serial: Int, configuration: WKWebViewConfiguration) {
        self.serial = serial
        // Screen-sized from the start, so the page lays out once at roughly its final size.
        webView = WKWebView(frame: UIScreen.main.bounds, configuration: configuration)
        super.init()
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        webView.navigationDelegate = self
        webView.accessibilityElementsHidden = true
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
    }

    // MARK: Loading

    func load() {
        guard let page = Bundle.main.url(forResource: "bubble-host", withExtension: "html") else {
            capability = .missing
            markLoaded()
            return
        }
        webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    /// Waits until the host page and its scripts have loaded.
    func whenLoaded() async {
        if isLoaded { return }
        await withCheckedContinuation { continuation in
            loadWaiters.append(continuation)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            await detectCapability()
            markLoaded()
            if let last = lastStart, capability != .unknown {
                // Back from a web content process crash: bring the active session back.
                lastStart = nil
                await start(key: last.key, manifest: last.manifest, options: last.options)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        capability = .missing
        markLoaded()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        capability = .missing
        markLoaded()
    }

    /// The system ended the page's process (memory pressure). Reload it; the active session
    /// restarts when the page is back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        FeedScrollLog.log("host \(serial) WEB CONTENT PROCESS TERMINATED, reloading")
        isLoaded = false
        capability = .unknown
        preparedKeys.removeAll()
        load()
    }

    private func markLoaded() {
        isLoaded = true
        let waiters = loadWaiters
        loadWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    private func detectCapability() async {
        let script = """
        const H = window.BubbleHost;
        const B = window.Bubble;
        return JSON.stringify({
          host: !!H,
          sessions: !!(H && typeof H.prepare === "function" && typeof H.activate === "function"),
          version: B && B.version ? String(B.version) : null
        });
        """
        let reply = await callJSON(script)
        runtimeVersion = reply?["version"]?.string
        if reply?["sessions"]?.bool == true {
            capability = .sessions
        } else if reply?["host"]?.bool == true {
            capability = .bootOnly
        } else {
            capability = .missing
        }
    }

    // MARK: Sessions

    /// The default session key: `"<id>#<version>"` plus a short content hash, so an edited
    /// manifest never reuses a stale prepared session.
    static func sessionKey(for manifest: BubbleManifest) -> String {
        let base = "\(manifest.id)#\(manifest.version)"
        if let cached = keyCache[base], cached.manifest == manifest {
            return cached.key
        }
        let hash = SeededGenerator.stableHash(manifest.jsonString())
        let key = base + "#" + String(hash & 0xFFFF_FFFF, radix: 36)
        keyCache[base] = (manifest, key)
        return key
    }

    private static var keyCache: [String: (manifest: BubbleManifest, key: String)] = [:]

    func isPrepared(_ key: String) -> Bool {
        preparedKeys.contains(key)
    }

    func isPreparing(_ key: String) -> Bool {
        preparing[key] != nil
    }

    /// Sessions the page holds, least recently used first.
    var preparedSessionKeys: [String] {
        preparedKeys
    }

    /// Prepares (if needed) and activates a session, or boots it on runtimes without sessions.
    /// Starts on one host run one at a time; a start that is overtaken by a newer one is skipped.
    @discardableResult
    func start(key: String, manifest: BubbleManifest, options: BubbleSessionOptions) async -> BubbleStartOutcome {
        startGeneration += 1
        let generation = startGeneration
        let previous = startChain
        let task = Task { @MainActor () -> BubbleStartOutcome in
            await previous?.value
            guard generation == self.startGeneration else {
                return BubbleStartOutcome(ok: false, superseded: true)
            }
            return await self.performStart(key: key, manifest: manifest, options: options)
        }
        startChain = Task { _ = await task.value }
        return await task.value
    }

    private func performStart(key: String, manifest: BubbleManifest, options: BubbleSessionOptions) async -> BubbleStartOutcome {
        await whenLoaded()
        let began = CACurrentMediaTime()
        lastStart = (key, manifest, options)
        activeKey = key
        activeMode = options.mode
        soundMuted = options.isMuted
        soundPaused = false
        updateSoundHold()
        var outcome: BubbleStartOutcome
        switch capability {
        case .sessions:
            outcome = await prepareAndActivate(key: key, manifest: manifest, options: options)
        case .bootOnly:
            let booted = await boot(manifest: manifest, options: options)
            outcome = BubbleStartOutcome(ok: booted, error: booted ? nil : "The game runtime didn't load", usedBoot: true)
        case .missing, .unknown:
            outcome = BubbleStartOutcome(ok: false, error: "The game runtime didn't load")
        }
        outcome.totalMs = (CACurrentMediaTime() - began) * 1000
        return outcome
    }

    private func prepareAndActivate(key: String, manifest: BubbleManifest, options: BubbleSessionOptions) async -> BubbleStartOutcome {
        let wasPrepared = isPrepared(key)
        var prepareMs: Double?
        if !wasPrepared {
            let prepared = await prepare(key: key, manifest: manifest, options: options)
            guard prepared.ok else {
                return BubbleStartOutcome(ok: false, error: prepared.error ?? "This \(ProductName.singular) couldn't start")
            }
            prepareMs = prepared.ms
        }
        var activated = await activate(key: key, options: options)
        if !activated.ok && wasPrepared {
            // The page dropped the session on its own; prepare it again once.
            forget(key)
            let prepared = await prepare(key: key, manifest: manifest, options: options)
            guard prepared.ok else {
                return BubbleStartOutcome(ok: false, error: prepared.error ?? "This \(ProductName.singular) couldn't start")
            }
            prepareMs = prepared.ms
            activated = await activate(key: key, options: options)
        }
        touch(key)
        return BubbleStartOutcome(
            ok: activated.ok,
            error: activated.ok ? nil : (activated.error ?? "This \(ProductName.singular) couldn't start"),
            wasPrepared: wasPrepared,
            prepareMs: prepareMs,
            activateMs: activated.ms
        )
    }

    /// `BubbleHost.prepare`: parse, set up and draw the first frame offscreen, without showing it.
    /// A no-op that reports failure on runtimes without sessions.
    @discardableResult
    func prepare(key: String, manifest: BubbleManifest, options: BubbleSessionOptions) async -> (ok: Bool, ms: Double?, error: String?) {
        await whenLoaded()
        guard capability == .sessions else { return (false, nil, "prepare is unavailable") }
        if isPrepared(key) { return (true, nil, nil) }
        if let inFlight = preparing[key] {
            return await inFlight.value
        }
        let task = Task { @MainActor in
            await self.sendPrepare(key: key, manifest: manifest, options: options)
        }
        preparing[key] = task
        let outcome = await task.value
        preparing[key] = nil
        return outcome
    }

    private func sendPrepare(key: String, manifest: BubbleManifest, options: BubbleSessionOptions) async -> (ok: Bool, ms: Double?, error: String?) {
        var payload = options.jsonObject
        payload["key"] = .string(key)
        payload["manifest"] = (try? JSONValue.encode(manifest)) ?? .null
        let script = """
        const H = window.BubbleHost;
        if (!H || typeof H.prepare !== "function") return JSON.stringify({ ok: false, error: "prepare is unavailable" });
        try {
          const r = await H.prepare(payload);
          return typeof r === "string" ? r : JSON.stringify(r || { ok: true });
        } catch (e) {
          return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
        }
        """
        let reply = await callJSON(script, arguments: ["payload": JSONValue.object(payload).jsonString()])
        let ok = reply?["ok"]?.bool ?? false
        if ok {
            touch(key)
        }
        return (ok, reply?["ms"]?.double, reply?["error"]?.string)
    }

    private func activate(key: String, options: BubbleSessionOptions) async -> (ok: Bool, ms: Double?, error: String?) {
        let script = """
        const H = window.BubbleHost;
        if (!H || typeof H.activate !== "function") return JSON.stringify({ ok: false, error: "activate is unavailable" });
        try {
          const r = await H.activate(key, options);
          return typeof r === "string" ? r : JSON.stringify(r || { ok: true });
        } catch (e) {
          return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
        }
        """
        let reply = await callJSON(script, arguments: [
            "key": key,
            "options": JSONValue.object(options.jsonObject).jsonString(),
        ])
        return (reply?["ok"]?.bool ?? false, reply?["ms"]?.double, reply?["error"]?.string)
    }

    private func boot(manifest: BubbleManifest, options: BubbleSessionOptions) async -> Bool {
        var payload = options.jsonObject
        payload["manifest"] = (try? JSONValue.encode(manifest)) ?? .null
        let script = """
        if (!window.BubbleHost) return "missing";
        BubbleHost.boot(payload);
        return "ok";
        """
        let reply = await call(script, arguments: ["payload": JSONValue.object(payload).jsonString()])
        return reply == "ok"
    }

    /// `BubbleHost.poster`: the session's first frame, drawn in the Bubble's look. Prepares the
    /// session first if needed. Cached in the pool (memory and disk) by key.
    func poster(key: String, manifest: BubbleManifest, size: CGSize) async -> UIImage? {
        if let cached = BubbleRuntimePool.shared.cachedPoster(forKey: key) { return cached }
        let generation = BubbleRuntimePool.shared.posterGeneration(forKey: key)
        let scale = BubbleRuntimePool.posterScale
        await whenLoaded()
        guard capability == .sessions, size.width > 1, size.height > 1 else { return nil }
        if !isPrepared(key) {
            let prepared = await prepare(key: key, manifest: manifest, options: BubbleSessionOptions(mode: .poster))
            guard prepared.ok else { return nil }
        }
        let options: JSONValue = [
            "width": .number(Double(size.width.rounded())),
            "height": .number(Double(size.height.rounded())),
            "scale": .number(Double(scale)),
            "type": "image/jpeg",
            "quality": 0.82,
            // The same inset the live feed page runs with (the runtime lets this win over the session's own).
            "insets": .object([
                "top": .number(Double(BubbleRuntimePool.shared.posterInsetTop.rounded())),
                "bottom": .number(0),
            ]),
        ]
        let script = """
        const H = window.BubbleHost;
        if (!H || typeof H.poster !== "function") return "";
        try {
          const r = await H.poster(key, options);
          return typeof r === "string" ? r : "";
        } catch (e) {
          return "";
        }
        """
        let began = CACurrentMediaTime()
        guard let dataURL = await call(script, arguments: ["key": key, "options": options.jsonString()]),
              let data = Self.data(fromDataURL: dataURL),
              let image = BubbleRuntimePool.shared.storePoster(data, forKey: key, generation: generation) else { return nil }
        BubbleRuntimePerf.note(String(format: "poster %@ %.1fms", key, (CACurrentMediaTime() - began) * 1000))
        return image
    }

    /// Waits until the page has painted twice (two animation frames), or 250 ms at most, so a
    /// just-activated session is on screen before its web view is shown. Without it the web view
    /// could fade in still showing the last game's frame (a stale snapshot) for a frame or two.
    func waitForPaint() async {
        guard isLoaded else { return }
        _ = await call("""
        await Promise.race([
          new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
          new Promise(r => setTimeout(r, 250))
        ]);
        return "";
        """)
    }

    /// `BubbleHost.evict`: frees a prepared session.
    func evict(_ key: String) {
        guard capability == .sessions, isPrepared(key), key != activeKey else { return }
        forget(key)
        webView.callAsyncJavaScript(
            "if (window.BubbleHost && typeof BubbleHost.evict === 'function') { BubbleHost.evict(key) } return ''",
            arguments: ["key": key],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// `BubbleHost.command`: `pause`, `resume`, `restart`, `mute` or `unmute`, for the active session.
    func command(_ type: String) {
        switch type {
        case "mute": soundMuted = true
        case "unmute": soundMuted = false
        case "pause": soundPaused = true
        case "resume", "restart": soundPaused = false
        default: break
        }
        updateSoundHold()
        guard isLoaded, capability == .sessions || capability == .bootOnly else { return }
        webView.callAsyncJavaScript(
            "if (window.BubbleHost && typeof BubbleHost.command === 'function') { BubbleHost.command({ type: type }) } return ''",
            arguments: ["type": type],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// `BubbleHost.command({type: "backing", on})`: a library sound plays behind the active session,
    /// so its own music stays off (docs/BUBBLES.md 4.3).
    func setBacking(_ on: Bool) {
        guard isLoaded, capability == .sessions || capability == .bootOnly else { return }
        webView.callAsyncJavaScript(
            "if (window.BubbleHost && typeof BubbleHost.command === 'function') { BubbleHost.command({ type: 'backing', on: on }) } return ''",
            arguments: ["on": on],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Restarts the active session from its first tick in play mode, without the intro card.
    /// Used to take over a Burst or demo, and for "Play again".
    func restartInPlay() {
        activeMode = .play
        command("restart")
    }

    // MARK: Messages

    /// Routes this session's messages to `handler`. Haptics are played here, for every surface.
    func setHandler(for key: String, _ handler: @escaping (BubbleBridgeMessage) -> Void) {
        handlers[key] = handler
    }

    func removeHandler(for key: String) {
        handlers[key] = nil
    }

    fileprivate func deliver(_ body: Any) {
        let message = BubbleBridgeMessage(body: body)
        let key = BubbleBridgeMessage.sessionKey(in: body) ?? activeKey
        let isActiveSession = key == activeKey
        switch message {
        case .takeover where isActiveSession:
            activeMode = .play
        case .haptic(let style) where isActiveSession && activeMode == .play:
            Self.playHaptic(style)
        case .perf(let perf):
            BubbleRuntimePerf.shared.record(perf, key: key ?? "", runtime: runtimeVersion)
        case .unknown("poster_update"):
            if let key { BubbleRuntimePool.shared.invalidatePoster(forKey: key) }
        default:
            break
        }
        guard let key, let handler = handlers[key] else { return }
        handler(message)
    }

    /// The runtime's haptic styles, played with the app's `Haptics` (which honors Settings).
    static func playHaptic(_ style: String) {
        switch style {
        case "selection": Haptics.selection()
        case "medium": Haptics.medium()
        case "heavy": Haptics.heavy()
        case "soft": Haptics.soft()
        case "rigid": Haptics.rigid()
        case "success": Haptics.success()
        case "warning": Haptics.warning()
        case "error": Haptics.error()
        default: Haptics.light()
        }
    }

    // MARK: Placement

    /// Moves the web view into `container`. Only one container shows a host at a time.
    func attach(to container: UIView) {
        guard webView.superview !== container else { return }
        FeedScrollLog.log("host \(serial) attach (from \(webView.superview == nil ? "none" : "another view"))")
        webView.removeFromSuperview()
        webView.frame = container.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(webView)
    }

    func detach(from container: UIView) {
        if webView.superview === container {
            webView.removeFromSuperview()
        }
    }

    /// Holds `.playback` while this host's game is audible, and gives it back otherwise.
    private func updateSoundHold() {
        let audible = isLeased && activeKey != nil && !soundMuted && !soundPaused
        if audible {
            GameSound.beginGamePlayback(self)
        } else {
            GameSound.endPlayback(self)
        }
    }

    fileprivate func resetForPool() {
        command("pause")
        handlers.removeAll()
        lastStart = nil
        activeMode = nil
        webView.removeFromSuperview()
    }

    fileprivate func shutDown() {
        soundPaused = true
        updateSoundHold()
        handlers.removeAll()
        lastStart = nil
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
    }

    // MARK: Helpers

    private func touch(_ key: String) {
        preparedKeys.removeAll { $0 == key }
        preparedKeys.append(key)
        while preparedKeys.count > Self.pageSessionLimit {
            preparedKeys.removeFirst()
        }
    }

    private func forget(_ key: String) {
        preparedKeys.removeAll { $0 == key }
    }

    /// Runs `script` as an async function body in the page and returns its string result.
    private func call(_ script: String, arguments: [String: Any] = [:]) async -> String? {
        await withCheckedContinuation { continuation in
            webView.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? String)
                case .failure:
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private func callJSON(_ script: String, arguments: [String: Any] = [:]) async -> JSONValue? {
        guard let text = await call(script, arguments: arguments) else { return nil }
        return try? JSONValue.parse(text)
    }

    private static func data(fromDataURL dataURL: String) -> Data? {
        guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
    }
}

// MARK: - SwiftUI

/// Holds a host's web view in SwiftUI. Several containers may name the same host over time;
/// the web view lives in whichever attached it last.
final class BubbleHostContainerView: UIView, UIGestureRecognizerDelegate {
    /// Called with +1 (swiped up: next) or -1 (swiped down: previous) for a clearly vertical swipe
    /// over the game. The game still gets every touch (the recognizer never cancels them).
    var onVerticalSwipe: ((Int) -> Void)? {
        didSet { swipeRecognizer.isEnabled = onVerticalSwipe != nil }
    }

    private lazy var swipeRecognizer: UIPanGestureRecognizer = {
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleSwipe(_:)))
        pan.cancelsTouchesInView = false
        pan.delaysTouchesBegan = false
        pan.delaysTouchesEnded = false
        pan.delegate = self
        pan.isEnabled = false
        return pan
    }()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        clipsToBounds = true
        addGestureRecognizer(swipeRecognizer)
    }

    @objc private func handleSwipe(_ pan: UIPanGestureRecognizer) {
        guard pan.state == .ended, let onVerticalSwipe else { return }
        let move = pan.translation(in: self)
        let speed = pan.velocity(in: self)
        // Clearly vertical: mostly up or down, and either far (a quarter of the page) or a quick
        // flick that still travelled a little.
        let isVertical = abs(move.y) > 2 * abs(move.x)
        let isFar = abs(move.y) > max(120, bounds.height * 0.25)
        let isFlick = abs(speed.y) > 900 && abs(move.y) > 50 && (speed.y < 0) == (move.y < 0)
        guard isVertical, isFar || isFlick else { return }
        onVerticalSwipe(move.y < 0 ? 1 : -1)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// Hidden until a session has drawn, so a reused host never flashes its previous Bubble.
    func setRevealed(_ revealed: Bool, animated: Bool) {
        let target: CGFloat = revealed ? 1 : 0
        guard alpha != target else { return }
        if animated {
            UIView.animate(withDuration: 0.15, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                self.alpha = target
            }
        } else {
            alpha = target
        }
    }

    fileprivate func releaseWebViews() {
        for case let webView as WKWebView in subviews {
            webView.removeFromSuperview()
        }
    }
}

/// Shows a leased `BubbleRuntimeHost` inside a SwiftUI view. The feed moves one host between
/// pages with this; most surfaces should use `BubbleWebView` instead.
struct BubbleRuntimeHostView: UIViewRepresentable {
    let host: BubbleRuntimeHost
    /// False hides the web view until its session has drawn a frame.
    var isRevealed = true
    /// False lets touches fall through to SwiftUI (the feed's tap to take over).
    var isInteractive = true
    /// While interactive: a clearly vertical swipe over the game (see `BubbleHostContainerView`).
    var onVerticalSwipe: ((Int) -> Void)? = nil

    func makeUIView(context: Context) -> BubbleHostContainerView {
        let container = BubbleHostContainerView()
        host.attach(to: container)
        container.setRevealed(isRevealed, animated: false)
        container.isUserInteractionEnabled = isInteractive
        container.onVerticalSwipe = isInteractive ? onVerticalSwipe : nil
        return container
    }

    func updateUIView(_ container: BubbleHostContainerView, context: Context) {
        host.attach(to: container)
        container.setRevealed(isRevealed, animated: true)
        container.isUserInteractionEnabled = isInteractive
        container.onVerticalSwipe = isInteractive ? onVerticalSwipe : nil
    }

    static func dismantleUIView(_ container: BubbleHostContainerView, coordinator: ()) {
        container.releaseWebViews()
    }
}

/// A Bubble's picture in its own look (LOOKS.md): the runtime's poster frame, else its Muse
/// cover, else the `BubbleCoverView` gradient in its colors. Fills exactly the frame it is
/// given. For cards, stories, Bursts and anywhere else a Bubble needs to look like itself.
struct BubblePosterView: View {
    let bubble: Bubble
    var showsEmoji = true

    @State private var rendered: (key: String, image: UIImage)?

    var body: some View {
        let key = BubbleRuntimeHost.sessionKey(for: bubble.manifest)
        let image = rendered?.key == key ? rendered?.image : BubbleRuntimePool.shared.cachedPoster(forKey: key)
        Color.clear
            .overlay {
                if let image {
                    ZStack {
                        bubble.palette.gradient
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                    }
                    .transition(.opacity)
                } else {
                    BubbleCoverView(bubble: bubble, showsEmoji: showsEmoji)
                }
            }
            .animation(.easeOut(duration: 0.2), value: image != nil)
            .clipped()
            .accessibilityHidden(true)
            .task(id: key) {
                guard BubbleRuntimePool.shared.cachedPoster(forKey: key) == nil,
                      let image = await BubbleRuntimePool.shared.poster(for: bubble) else { return }
                rendered = (key, image)
            }
    }
}

/// WKUserContentController retains its handlers; this keeps the pool's lifetime its own.
final class BubbleWeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

// MARK: - Perf

/// The latest speed numbers: `perf` messages from hosts plus warm-switch times measured in
/// Swift. Shown by the DEBUG perf overlay (`FB_PERF=1`) and logged to the console then.
@MainActor
@Observable
final class BubbleRuntimePerf {
    static let shared = BubbleRuntimePerf()

    struct Switch: Identifiable {
        let id = UUID()
        var title: String
        var totalMs: Double
        var wasPrepared: Bool
        var usedBoot: Bool
        var prepareMs: Double?
        var activateMs: Double?
    }

    private(set) var lastPerf: BubblePerf?
    private(set) var lastPerfKey: String?
    private(set) var runtimeVersion: String?
    private(set) var recentSwitches: [Switch] = []

    /// DEBUG only: `FB_PERF=1`.
    nonisolated static var isEnabled: Bool { DebugLaunch.value("FB_PERF") == "1" }

    /// Logs a line from any thread (bot runs, verification) when `FB_PERF=1`.
    nonisolated static func note(_ text: String) {
        #if DEBUG
        if isEnabled {
            NSLog("[BubblePerf] %@", text)
        }
        #endif
    }

    func record(_ perf: BubblePerf, key: String, runtime: String?) {
        var merged = lastPerfKey == key ? (lastPerf ?? perf) : perf
        merged.prepareMs = perf.prepareMs ?? merged.prepareMs
        merged.activateMs = perf.activateMs ?? merged.activateMs
        merged.firstFrameMs = perf.firstFrameMs ?? merged.firstFrameMs
        merged.fps = perf.fps ?? merged.fps
        merged.heapMB = perf.heapMB ?? merged.heapMB
        lastPerf = merged
        lastPerfKey = key
        runtimeVersion = runtime ?? runtimeVersion
        log("perf key=\(key) prepare=\(Self.ms(perf.prepareMs)) activate=\(Self.ms(perf.activateMs)) first_frame=\(Self.ms(perf.firstFrameMs)) fps=\(perf.fps.map { String(format: "%.0f", $0) } ?? "-") heap=\(perf.heapMB.map { String(format: "%.1f", $0) } ?? "-")MB")
    }

    func recordSwitch(title: String, outcome: BubbleStartOutcome, runtime: String?) {
        let entry = Switch(
            title: title,
            totalMs: outcome.totalMs,
            wasPrepared: outcome.wasPrepared,
            usedBoot: outcome.usedBoot,
            prepareMs: outcome.prepareMs,
            activateMs: outcome.activateMs
        )
        recentSwitches.append(entry)
        if recentSwitches.count > 12 {
            recentSwitches.removeFirst(recentSwitches.count - 12)
        }
        runtimeVersion = runtime ?? runtimeVersion
        let kind = outcome.usedBoot ? "boot" : (outcome.wasPrepared ? "warm" : "cold")
        log("switch \(kind) \"\(title)\" total=\(String(format: "%.1f", outcome.totalMs))ms prepare=\(Self.ms(outcome.prepareMs)) activate=\(Self.ms(outcome.activateMs)) runtime=\(runtime ?? "?")")
    }

    private func log(_ text: String) {
        #if DEBUG
        if Self.isEnabled {
            NSLog("[BubblePerf] %@", text)
        }
        #endif
    }

    private static func ms(_ value: Double?) -> String {
        value.map { String(format: "%.1fms", $0) } ?? "-"
    }
}
