import SwiftUI
import UIKit

/// A finished run waiting on the result sheet.
struct BubbleResultContext: Identifiable {
    let id = UUID()
    let bubbleID: String
    let result: BubbleRunResult
    /// Your best before this run, to tell a new best.
    let previousBest: Int?
    /// False for DEBUG fake results, which never reach the board.
    var isRecorded = true
}

/// Runs the Bubbles tab (docs/BUBBLES.md, 4.8): one runtime host leased from the pool, the live
/// session on the settled page, the prepare window around it, poster frames, and takeover.
///
/// - The settled page hosts the only live session: a friend's Burst when there is one,
///   otherwise the bot's demo. Muted until you unmute.
/// - +1 and +2 are prepared ahead and −1 stays prepared, so switching pages is a warm
///   `activate`. Everything further away is evicted. Pages that aren't live show poster frames.
/// - A tap takes over: the same Bubble restarts in play mode on that page.
/// - Pauses when the tab isn't on screen; gives the host back after a few seconds away.
@MainActor
@Observable
final class BubbleFeedModel {
    /// The page the pager is on (its scroll position).
    var currentID: String?
    /// The page that hosts the live session.
    private(set) var liveItemID: String?
    private(set) var host: BubbleRuntimeHost?
    /// The live session has drawn, so the host's web view can show over the poster.
    private(set) var isLiveRevealed = false
    private(set) var isTakenOver = false
    /// Your score while you play.
    private(set) var liveScore = 0
    /// Shows the result sheet.
    var result: BubbleResultContext?
    /// The app-wide game mute (`GameSound`). Sound is on by default.
    var isMuted: Bool { GameSound.isMuted }
    /// Poster frames by session key.
    private(set) var posters: [String: UIImage] = [:]
    /// The live page whose game didn't start (an error, a timeout or no engine), and why. The
    /// page shows `EngineErrorCard`; `retry()` starts it again.
    private(set) var failedItemID: String?
    private(set) var failure: EngineFailure?

    /// Size of one page. Posters (for every surface) are drawn at this size.
    @ObservationIgnored var pageSize: CGSize = .zero {
        didSet { BubbleRuntimePool.shared.posterSize = pageSize }
    }
    /// Space the runtime keeps clear at the top (status bar and header).
    @ObservationIgnored var insetTop: CGFloat = 0

    @ObservationIgnored private weak var store: BubbleStore?
    @ObservationIgnored private var isVisible = false
    @ObservationIgnored private var liveKey: String?
    @ObservationIgnored private var activationToken = 0
    @ObservationIgnored private var pendingTakeover = false
    @ObservationIgnored private var settleTask: Task<Void, Never>?
    @ObservationIgnored private var windowTask: Task<Void, Never>?
    @ObservationIgnored private var releaseTask: Task<Void, Never>?
    @ObservationIgnored private var lastResultAt = Date.distantPast
    @ObservationIgnored private var didPrewarm = false
    @ObservationIgnored private var stallTask: Task<Void, Never>?

    func configure(store: BubbleStore) {
        guard self.store == nil else { return }
        self.store = store
        if currentID == nil {
            currentID = store.feedItems.first?.id
        }
        prewarmFirstPage()
    }

    // MARK: Lookups

    var currentItem: BubbleFeedItem? {
        item(id: currentID) ?? store?.feedItems.first
    }

    func item(id: String?) -> BubbleFeedItem? {
        guard let id else { return nil }
        return store?.feedItems.first { $0.id == id }
    }

    /// Whose run plays on this page. The server sends no runs yet, so pages play the bot's demo.
    func run(for item: BubbleFeedItem, in bubble: Bubble) -> BubbleScore? {
        guard let store, let userID = item.runUserID else { return nil }
        return store.bestScore(ofUserID: userID, in: bubble)
    }

    /// The first page arrived after the tab was set up: settle on it and start it.
    func feedDidLoad() {
        guard let store, currentID == nil, let first = store.feedItems.first else { return }
        currentID = first.id
        prewarmFirstPage()
        activateCurrent()
    }

    func poster(for bubble: Bubble) -> UIImage? {
        let key = BubbleRuntimeHost.sessionKey(for: bubble.manifest)
        return posters[key] ?? BubbleRuntimePool.shared.cachedPoster(forKey: key)
    }

    func isLive(_ item: BubbleFeedItem) -> Bool {
        liveItemID == item.id && host != nil
    }

    // MARK: Visibility

    /// The tab is on screen with nothing covering it, and the app is active.
    func setVisible(_ visible: Bool) {
        guard visible != isVisible else { return }
        isVisible = visible
        noteVisibility(visible)
        if visible {
            releaseTask?.cancel()
            if host != nil, liveItemID != nil, liveItemID == currentID {
                host?.command("resume")
                playSound(for: currentItem)
            } else {
                activateCurrent()
            }
        } else {
            host?.command("pause")
            LibrarySoundPlayer.shared.hold(.feed)
            guard !isTakenOver else { return }
            releaseTask?.cancel()
            releaseTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                guard let self, !Task.isCancelled, !self.isVisible, !self.isTakenOver else { return }
                self.releaseHost()
            }
        }
    }

    /// The pager moved. The live session follows once the page settles.
    func pageDidChange(to id: String?) {
        guard let store, let id, let index = store.feedItems.firstIndex(where: { $0.id == id }) else { return }
        store.noteFeedPosition(index)
        if isVisible {
            FeedEventReporter.shared.pageShown(store.feedItems[index], position: index, sessionID: store.feedSessionID)
        }
        settleTask?.cancel()
        settleTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 90_000_000)
            guard let self, !Task.isCancelled, self.currentID == id else { return }
            if self.liveItemID != id || self.host == nil {
                self.activateCurrent()
            }
        }
    }

    /// Tells the live game about the app-wide mute after it changes.
    func applyMute() {
        host?.command(isMuted ? "mute" : "unmute")
    }

    // MARK: Takeover

    /// Starts playing the Bubble on the current page, in place.
    func takeOver() {
        guard let host, let liveItemID, liveItemID == currentID, isLiveRevealed else {
            pendingTakeover = true
            if host == nil || liveItemID != currentID {
                activateCurrent()
            }
            return
        }
        guard !isTakenOver else { return }
        pendingTakeover = false
        liveScore = 0
        withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
            isTakenOver = true
        }
        host.restartInPlay()
        noteRecs(.runStarted)
        Haptics.light()
    }

    /// Back to watching: chrome returns and the page plays its Burst again.
    func endTakeover() {
        result = nil
        guard isTakenOver else { return }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
            isTakenOver = false
        }
        liveScore = 0
        if let item = item(id: liveItemID) {
            activate(item)
        }
    }

    /// Starts the failed page's game again. A host whose runtime page never loaded goes back to
    /// the pool and a different one is leased.
    func retry() {
        guard let item = item(id: failedItemID) ?? currentItem else { return }
        failedItemID = nil
        failure = nil
        pendingTakeover = false
        if isTakenOver {
            isTakenOver = false
        }
        if let host, host.capability != .sessions && host.capability != .bootOnly {
            releaseHost()
        }
        activate(item)
    }

    private func fail(_ itemID: String, _ failure: EngineFailure) {
        guard itemID == liveItemID else { return }
        stallTask?.cancel()
        isLiveRevealed = false
        pendingTakeover = false
        failedItemID = itemID
        self.failure = failure
    }

    func playAgain() {
        result = nil
        liveScore = 0
        if !isTakenOver {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                isTakenOver = true
            }
        }
        host?.restartInPlay()
        noteRecs(.runStarted)
    }

    #if DEBUG
    /// `FB_FAKE_RESULT=1`: the result sheet for the current page without playing.
    func showFakeResult() {
        guard let store, let item = currentItem, let bubble = store.bubble(id: item.bubbleID) else { return }
        let previous = store.bestScore(of: store.appStore.me, in: bubble)?.score
        let base = previous ?? run(for: item, in: bubble)?.score ?? 20
        let score = base + 3
        let fake = BubbleRunResult(
            outcome: .success,
            score: score,
            durationSec: 34,
            replay: BubbleInputLog(seed: bubble.manifest.seed, totalTicks: 34 * 60),
            share: BubbleShareArtifact(headline: bubble.title, scoreText: "\(score) points")
        )
        isTakenOver = true
        result = BubbleResultContext(bubbleID: bubble.id, result: fake, previousBest: previous, isRecorded: false)
    }
    #endif

    // MARK: Runtime

    private func activateCurrent() {
        guard isVisible, let item = currentItem else { return }
        activate(item)
    }

    private func activate(_ item: BubbleFeedItem) {
        guard let store, let bubble = store.bubble(id: item.bubbleID) else { return }
        let host = ensureHost()
        activationToken += 1
        let token = activationToken
        let key = BubbleRuntimeHost.sessionKey(for: bubble.manifest)
        if let old = liveKey, old != key {
            host.removeHandler(for: old)
        }
        let itemID = item.id
        host.setHandler(for: key) { [weak self] message in
            self?.handle(message, itemID: itemID)
        }
        liveKey = key
        liveItemID = itemID
        isLiveRevealed = false
        failedItemID = nil
        failure = nil
        stallTask?.cancel()
        stallTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: EngineFailure.startTimeout)
            guard let self, !Task.isCancelled, token == self.activationToken, !self.isLiveRevealed else { return }
            self.fail(itemID, EngineFailure(kind: .timedOut))
        }
        var options = sessionOptions(for: bubble, mode: burstMode(for: item, in: bubble))
        // The page's sound starts as the page settles (crossfading from the last one), and the
        // game's own music stays off under it.
        let sound = store.librarySound(for: bubble)
        options.hasBacking = sound != nil
        LibrarySoundPlayer.shared.play(sound, for: .feed)
        let manifest = bubble.manifest
        let title = bubble.title
        Task { @MainActor [weak self] in
            let outcome = await host.start(key: key, manifest: manifest, options: options)
            guard let self, token == self.activationToken, self.host === host, !outcome.superseded else { return }
            BubbleRuntimePerf.shared.recordSwitch(title: title, outcome: outcome, runtime: host.runtimeVersion)
            self.stallTask?.cancel()
            guard outcome.ok else {
                let kind: EngineFailure.Kind = host.capability == .sessions || host.capability == .bootOnly ? .failed : .unavailable
                self.fail(itemID, EngineFailure(kind: kind, message: outcome.error))
                return
            }
            if !self.isVisible {
                host.command("pause")
            }
            self.isLiveRevealed = true
            if self.pendingTakeover {
                self.pendingTakeover = false
                self.takeOver()
            }
            self.updateWindow(around: itemID, token: token)
        }
    }

    /// A friend's Burst when their run has a replay, otherwise the bot's demo.
    private func burstMode(for item: BubbleFeedItem, in bubble: Bubble) -> BubbleRunMode {
        if let replay = run(for: item, in: bubble)?.replay {
            return .replay(replay)
        }
        return .demo
    }

    private func sessionOptions(for bubble: Bubble, mode: BubbleRunMode) -> BubbleSessionOptions {
        let me = store?.appStore.me
        return BubbleSessionOptions(
            mode: mode,
            playerName: me?.firstName ?? "",
            bestScore: me.flatMap { store?.bestScore(of: $0, in: bubble)?.score },
            isMuted: isMuted,
            reducedMotion: UIAccessibility.isReduceMotionEnabled,
            insetTop: insetTop,
            insetBottom: 0
        )
    }

    /// Prepares +1, −1 and +2 (in that order) and fetches their posters; evicts the rest.
    private func updateWindow(around itemID: String, token: Int) {
        windowTask?.cancel()
        guard let store, let host, host.capability == .sessions else { return }
        windowTask = Task { @MainActor [weak self] in
            let items = store.feedItems
            guard let index = items.firstIndex(where: { $0.id == itemID }) else { return }
            var keep = Set<String>()
            for offset in [0, 1, -1, 2] {
                let position = index + offset
                guard items.indices.contains(position), let bubble = store.bubble(id: items[position].bubbleID) else { continue }
                guard let self, !Task.isCancelled, token == self.activationToken else { return }
                let key = BubbleRuntimeHost.sessionKey(for: bubble.manifest)
                keep.insert(key)
                if offset != 0 {
                    let options = self.sessionOptions(for: bubble, mode: self.burstMode(for: items[position], in: bubble))
                    await host.prepare(key: key, manifest: bubble.manifest, options: options)
                }
                if self.poster(for: bubble) == nil,
                   let image = await BubbleRuntimePool.shared.poster(for: bubble.manifest, fallback: host) {
                    self.posters[key] = image
                }
            }
            guard let self, !Task.isCancelled, token == self.activationToken else { return }
            for key in host.preparedSessionKeys where !keep.contains(key) {
                host.evict(key)
            }
        }
    }

    /// Before the tab is ever opened, an idle warm host prepares the first page, so opening the
    /// tab is a warm switch rather than a cold start.
    private func prewarmFirstPage() {
        guard !didPrewarm, let store, let item = currentItem, let bubble = store.bubble(id: item.bubbleID) else { return }
        didPrewarm = true
        let options = sessionOptions(for: bubble, mode: burstMode(for: item, in: bubble))
        BubbleRuntimePool.shared.prewarm(manifest: bubble.manifest, options: options)
    }

    private func ensureHost() -> BubbleRuntimeHost {
        if let host { return host }
        let preferred = currentItem.flatMap { store?.bubble(id: $0.bubbleID) }.map { BubbleRuntimeHost.sessionKey(for: $0.manifest) }
        let leased = BubbleRuntimePool.shared.lease(preferring: preferred)
        host = leased
        return leased
    }

    /// The settled page's library sound, if it has one.
    private func playSound(for item: BubbleFeedItem?) {
        guard let store, let item, let bubble = store.bubble(id: item.bubbleID) else { return }
        LibrarySoundPlayer.shared.play(store.librarySound(for: bubble), for: .feed)
    }

    private func releaseHost() {
        LibrarySoundPlayer.shared.stop(.feed)
        guard let host else { return }
        windowTask?.cancel()
        if let liveKey {
            host.removeHandler(for: liveKey)
        }
        BubbleRuntimePool.shared.giveBack(host)
        self.host = nil
        liveKey = nil
        liveItemID = nil
        isLiveRevealed = false
        stallTask?.cancel()
        failedItemID = nil
        failure = nil
    }

    // MARK: Recommender

    /// Tells the server's recommender (through `FeedEventReporter`) about the live page.
    private func noteRecs(_ signal: FeedEventReporter.Signal) {
        guard let bubbleID = item(id: liveItemID)?.bubbleID else { return }
        FeedEventReporter.shared.note(signal, gameID: bubbleID)
    }

    /// Leaving the tab pauses the page; coming back resumes it (or starts a new session).
    private func noteVisibility(_ visible: Bool) {
        if visible {
            let index = currentItem.flatMap { item in store?.feedItems.firstIndex { $0.id == item.id } } ?? 0
            FeedEventReporter.shared.feedVisible(currentItem, position: index, sessionID: store?.feedSessionID ?? "")
        } else {
            FeedEventReporter.shared.feedHidden()
        }
    }

    // MARK: Messages

    private func handle(_ message: BubbleBridgeMessage, itemID: String) {
        guard itemID == liveItemID else { return }
        switch message {
        case .score(let value):
            if isTakenOver {
                liveScore = value
            }
        case .takeover:
            if !isTakenOver {
                liveScore = 0
                noteRecs(.runStarted)
                withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                    isTakenOver = true
                }
            }
        case .result(let runResult):
            guard isTakenOver else { return }
            finish(runResult, itemID: itemID)
        case .error(let message) where EngineFailure.stopsGame(message):
            // The runtime stopped the game (its own error page is up); cover it and offer a retry.
            fail(itemID, EngineFailure(kind: .failed, message: message))
        default:
            break
        }
    }

    private func finish(_ runResult: BubbleRunResult, itemID: String) {
        // One result per run, even if the runtime repeats itself.
        guard Date().timeIntervalSince(lastResultAt) > 1, let store,
              let item = item(id: itemID), let bubble = store.bubble(id: item.bubbleID) else { return }
        lastResultAt = Date()
        liveScore = runResult.score
        let previous = store.bestScore(of: store.appStore.me, in: bubble)?.score
        store.record(runResult, in: bubble)
        FeedEventReporter.shared.note(.runFinished, gameID: bubble.id)
        result = BubbleResultContext(bubbleID: bubble.id, result: runResult, previousBest: previous)
    }
}
