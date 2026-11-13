import SwiftUI

/// Full-screen Bubble player (`router.play(_:replay:)`).
///
/// With `request.replay` it plays that run as a Burst first; tapping takes over and you play
/// the same seed. Otherwise it starts with the Bubble's intro card. When a run ends the result
/// sheet shows your score, best and rank, and offers play again, float, story and next level.
///
/// Closing mid-run (or backgrounding the app) keeps the run: the runtime posts `checkpoint`s and
/// `RunResumeStores.current` saves the latest, so the next open offers Resume or Start over
/// (`ResumePromptCard`). Resume replays the saved log at full speed and continues it.
///
/// DEBUG: `FB_FAKE_RESULT=1` shows the result card without playing (`player` does it only here,
/// not also on the games tab underneath); `FB_ENGINE_FAIL=1` shows the
/// engine error card. `FB_RESUME_DEMO=<seconds>` saves a run that many seconds into the game's
/// featured run (so the Resume prompt shows); `FB_RESUME_AUTO=1` then taps Resume.
struct BubblePlayerView: View {
    let request: BubblePlayRequest

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var bubbleID: String
    @State private var mode: BubbleRunMode
    @State private var isWatchingBurst: Bool
    @State private var hasStarted = false
    @State private var score = 0
    @State private var result: BubbleResultContext?
    @State private var lastResult: BubbleResultContext?
    @State private var lastResultAt = Date.distantPast
    @State private var restartToken = 0
    /// The game's session has drawn (`ready` or later from the runtime).
    @State private var isLive = false
    /// Set when the game didn't start; shows `EngineErrorCard`.
    @State private var failure: EngineFailure?
    /// Bumped by "Try again": a new web view, so a fresh host lease and a fresh start.
    @State private var attempt = 0
    /// Leaving for another screen (`exitPlayer`): later taps are ignored.
    @State private var isExiting = false
    /// A run of this game left mid-play: shows the Resume / Start over prompt.
    @State private var resumeOffer: SavedRun?
    /// The saved run the next start fast-forwards through (cleared once the runtime resumed it).
    @State private var resumeLog: BubbleInputLog?
    private let resumeStore = RunResumeStores.current

    init(request: BubblePlayRequest) {
        self.request = request
        _bubbleID = State(initialValue: request.bubbleID)
        _mode = State(initialValue: request.replay.map { .replay($0) } ?? .play)
        _isWatchingBurst = State(initialValue: request.replay != nil)
    }

    private var bubble: Bubble? { bubbleStore.bubble(id: bubbleID) }

    var body: some View {
        ZStack {
            backdrop
            if let bubble {
                GeometryReader { proxy in
                    game(bubble, safeArea: proxy.safeAreaInsets)
                        .id(attempt)
                }
                // The poster (an exact still of the first frame) stays over the game until it has
                // drawn, then fades: no pop from blank. It comes back over a failed runtime page.
                PosterReveal(poster: nil, isLive: isLive && failure == nil, showsLoader: false) {
                    BubblePosterView(bubble: bubble, showsEmoji: false)
                }
                .ignoresSafeArea()
                .accessibilityHidden(true)
                EngineLoadingView(
                    isLoading: !isLive && failure == nil,
                    label: EngineLoadingView.label(for: bubble.manifest)
                )
                if let failure {
                    EngineErrorCard(failure: failure, onRetry: retry, secondaryTitle: "Close", onSecondary: { dismiss() })
                    .transition(.opacity)
                }
                VStack(spacing: 0) {
                    topBar(bubble)
                    Spacer(minLength: 0)
                    bottomBar(bubble)
                }
                // The finished game stays in view behind the result card, dimmed and softened;
                // tapping it closes the card (Play again stays at the bottom).
                ResultBackdropScrim(isShown: result != nil, onTap: closeResult)
                if let context = result {
                    resultCard(context)
                }
                if let offer = resumeOffer {
                    ResumePromptCard(
                        saved: offer,
                        gameTitle: bubble.title,
                        rival: resumeRival(in: bubble),
                        onResume: { resume(offer) },
                        onStartOver: { startOver(bubble) }
                    )
                    .transition(.opacity)
                }
            } else {
                missing
            }
        }
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 24)
        }
        .animation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion), value: failure)
        .animation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion), value: result?.id)
        .onAppear(perform: appear)
        .onDisappear { LibrarySoundPlayer.shared.stop(.player) }
        .onChange(of: bubbleID) {
            LibrarySoundPlayer.shared.play(bubble.flatMap { bubbleStore.librarySound(for: $0) }, for: .player)
        }
        .task(id: "\(bubbleID)#\(attempt)") {
            // A start that never reports `ready` gets the error card and a retry, not an endless loader.
            try? await Task.sleep(for: EngineFailure.startTimeout)
            guard !Task.isCancelled, !isLive, failure == nil, bubble != nil else { return }
            failure = EngineFailure(kind: .timedOut)
        }
    }

    // MARK: Layers

    /// The game in its own look while the runtime starts: its poster frame, else its cover.
    @ViewBuilder
    private var backdrop: some View {
        if let bubble {
            BubblePosterView(bubble: bubble, showsEmoji: false)
                .ignoresSafeArea()
        } else {
            GameColor.gradient
                .ignoresSafeArea()
        }
    }

    /// Space the top bar (close, title) and bottom bar (Burst pill, Play again) take.
    private static let topBarHeight: CGFloat = 58
    private static let bottomBarHeight: CGFloat = 68

    private func game(_ bubble: Bubble, safeArea: EdgeInsets) -> some View {
        BubbleWebView(
            manifest: effectiveManifest(bubble),
            mode: mode,
            playerName: appStore.me.firstName,
            bestScore: bubbleStore.bestScore(of: appStore.me, in: bubble)?.score,
            isActive: scenePhase == .active,
            isMuted: GameSound.isMuted,
            hasBacking: bubbleStore.librarySound(for: bubble) != nil,
            reducedMotion: reduceMotion,
            restartToken: restartToken,
            insetTop: safeArea.top + Self.topBarHeight,
            insetBottom: safeArea.bottom + Self.bottomBarHeight,
            resume: resumeLog
        ) { message in
            handle(message, in: bubble)
        }
        .ignoresSafeArea()
        .accessibilityLabel("\(bubble.title). \(bubble.rule)")
    }

    /// The Bubble's manifest, with the request's seed and length for the Bubble it was opened on
    /// (challenges, sessions, game nights). Next levels play their own.
    private func effectiveManifest(_ bubble: Bubble) -> BubbleManifest {
        bubble.id == request.bubbleID ? request.effectiveManifest(bubble.manifest) : bubble.manifest
    }

    /// The request that applies to `bubble`: the launch request, or a plain one after a level change.
    private func activeRequest(for bubble: Bubble) -> BubblePlayRequest {
        bubble.id == request.bubbleID ? request : BubblePlayRequest(bubbleID: bubble.id)
    }

    private func topBar(_ bubble: Bubble) -> some View {
        VStack(spacing: 8) {
            topBarRow(bubble)
            if !isWatchingBurst {
                BubblePlayerBannerSlots(bubble: bubble, request: activeRequest(for: bubble), score: score)
                    .environment(\.bubblePlayerStarted, hasStarted)
            }
        }
    }

    private func topBarRow(_ bubble: Bubble) -> some View {
        HStack(spacing: 10) {
            circleButton("xmark", label: "Close") {
                dismiss()
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(bubble.title)
                    .font(.fbName)
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                if isWatchingBurst, let owner = burstOwner(in: bubble) {
                    Text(owner.isMe ? "Your replay" : "\(owner.firstName)'s replay")
                        .font(.fbMeta)
                        .foregroundStyle(Color.white.opacity(0.85))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.28), in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
            Spacer(minLength: 8)
            if hasStarted && !isWatchingBurst {
                BubbleScorePill(score: score)
                    .transition(.scale.combined(with: .opacity))
            }
            BubblePlayerTopBarSlots(bubble: bubble, request: activeRequest(for: bubble))
            circleButton(GameSound.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill", label: GameSound.isMuted ? "Turn sound on" : "Turn sound off") {
                Haptics.light()
                GameSound.toggleMute()
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .shadow(color: Color.black.opacity(0.2), radius: 3, y: 1)
        .animation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion), value: hasStarted)
    }

    @ViewBuilder
    private func bottomBar(_ bubble: Bubble) -> some View {
        if isWatchingBurst {
            HStack(spacing: 8) {
                Image(systemName: "hand.tap.fill")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                Text(burstScoreText(in: bubble))
                    .font(.fbButton)
                    .lineLimit(1)
            }
            .foregroundStyle(BubbleGlow.ink)
            .padding(.horizontal, 16)
            .frame(height: 40)
            .background(BubbleGlow.brandGradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
            .bubbleGlow(BubbleGlow.pink, radius: 8, opacity: 0.4)
            .padding(.bottom, 24)
            .allowsHitTesting(false)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if lastResult != nil && result == nil {
            Button(action: playAgain) {
                Label("Play again", systemImage: "arrow.counterclockwise")
            }
            .buttonStyle(.fb(.primary, expand: false, height: 44))
            .padding(.bottom, 24)
            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
        }
    }

    /// The result card over the game's final frame (inline, not a sheet: see `BubbleResultSheet`).
    private func resultCard(_ context: BubbleResultContext) -> some View {
        GeometryReader { proxy in
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                BubbleResultSheet(
                    context: context,
                    onPlayAgain: playAgain,
                    onSeeBoard: openBoard,
                    onNextLevel: playNextLevel,
                    request: request,
                    exitPlayer: exitPlayer,
                    onClose: closeResult
                )
                .frame(height: proxy.size.height * 0.72)
            }
        }
        .id(context.id)
        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
        .zIndex(2)
    }

    private func closeResult() {
        withAnimation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion)) {
            result = nil
        }
    }

    private var missing: some View {
        EngineErrorCard(detail: EngineErrorCard.goneDetail, secondaryTitle: "Close", onSecondary: { dismiss() })
    }

    private func circleButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.medium, weight: .bold))
                .foregroundStyle(Color.white)
                .frame(width: 36, height: 36)
                .background(Color.black.opacity(0.32), in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .gamePress(scale: 0.9)
        .accessibilityLabel(label)
    }

    // MARK: Burst

    /// Whose run the Burst is: the score that recorded this replay.
    private func burstOwner(in bubble: Bubble) -> User? {
        guard let replay = mode.replayLog else { return nil }
        return bubble.scores.first { $0.replay == replay }?.user
    }

    private func burstScoreText(in bubble: Bubble) -> String {
        if let replay = mode.replayLog, let run = bubble.scores.first(where: { $0.replay == replay }) {
            return run.user.isMe ? "Tap to beat your \(run.score.withCommas)" : "Tap to beat \(run.user.firstName)'s \(run.score.withCommas)"
        }
        return "Tap to play"
    }

    // MARK: Messages

    private func handle(_ message: BubbleBridgeMessage, in bubble: Bubble) {
        switch message {
        case .ready, .phase, .score, .takeover:
            if !isLive && failure == nil {
                isLive = true
            }
        case .error(let message) where EngineFailure.stopsGame(message):
            // The runtime stopped the game and drew its own error page; cover it and offer a retry.
            failure = EngineFailure(kind: .failed, message: message)
            isLive = false
            return
        default:
            break
        }
        switch message {
        case .takeover:
            withAnimation(.easeInOut(duration: 0.2)) {
                isWatchingBurst = false
                hasStarted = true
            }
            score = 0
        case .phase(let phase):
            if phase == .playing && !isWatchingBurst {
                withAnimation(.easeInOut(duration: 0.2)) {
                    hasStarted = true
                }
            }
        case .score(let value):
            if !isWatchingBurst {
                score = value
            }
        case .result(let runResult):
            guard !isWatchingBurst else { return }
            finish(runResult, in: bubble)
        case .checkpoint(let log, let checkpointScore):
            guard !isWatchingBurst, result == nil else { return }
            let key = BubbleRuntimeHost.sessionKey(for: effectiveManifest(bubble))
            resumeStore.save(SavedRun(gameID: bubble.id, sessionKey: key, log: log, score: checkpointScore, savedAt: Date()))
        case .unknown("resumed"):
            resumeLog = nil
        default:
            break
        }
    }

    private func finish(_ runResult: BubbleRunResult, in bubble: Bubble) {
        // One result per run, even if the runtime repeats itself.
        guard Date().timeIntervalSince(lastResultAt) > 1 else { return }
        lastResultAt = Date()
        score = runResult.score
        let previous = bubbleStore.bestScore(of: appStore.me, in: bubble)?.score
        let played = activeRequest(for: bubble)
        var runResult = runResult
        if runResult.replay.length == nil, let length = played.length {
            // The replay says which length it was played with, so verification replays it exactly.
            runResult.replay.length = length
        }
        resumeStore.clear(gameID: bubble.id)
        let entry = bubbleStore.record(runResult, in: bubble)
        BubbleFeatureRouter.didFinish(entry, in: bubble, request: played, appStore: appStore, bubbleStore: bubbleStore)
        let context = BubbleResultContext(bubbleID: bubble.id, result: runResult, previousBest: previous)
        lastResult = context
        result = context
    }

    // MARK: Actions

    private func appear() {
        offerResume()
        // The game's library sound keeps playing from the feed (or starts here).
        if let bubble { LibrarySoundPlayer.shared.play(bubbleStore.librarySound(for: bubble), for: .player) }
        #if DEBUG
        // FB_ENGINE_FAIL=1 shows the engine error card; "Try again" then starts the game for real.
        if DebugLaunch.value("FB_ENGINE_FAIL") == "1", attempt == 0 {
            failure = EngineFailure(kind: .failed, message: "Simulated by FB_ENGINE_FAIL")
        }
        if ["1", "player"].contains(DebugLaunch.value("FB_FAKE_RESULT") ?? ""), let bubble {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                showFakeResult(for: bubble)
            }
        }
        #endif
    }

    /// "Try again" on the error card: a new web view leases a host and starts the game afresh.
    private func retry() {
        failure = nil
        isLive = false
        hasStarted = false
        score = 0
        attempt += 1
    }

    private func playAgain() {
        resumeStore.clear(gameID: bubbleID)
        result = nil
        withAnimation(.easeInOut(duration: 0.2)) {
            lastResult = nil
            isWatchingBurst = false
            hasStarted = true
        }
        score = 0
        restartToken += 1
    }

    // MARK: Resume

    /// Offers the run left mid-play on this exact game (same manifest, seed and length), if any.
    /// Not over a Burst: watching someone's replay first is its own start.
    private func offerResume() {
        guard request.replay == nil, resumeOffer == nil, resumeLog == nil, let bubble else { return }
        let key = BubbleRuntimeHost.sessionKey(for: effectiveManifest(bubble))
        #if DEBUG
        if let seconds = DebugLaunch.value("FB_RESUME_DEMO").flatMap(Double.init) {
            let manifest = effectiveManifest(bubble)
            let ticks = Int(seconds * 60)
            let featured = bubble.featuredRun?.replay
            let inputs = featured?.seed == manifest.seed ? (featured?.inputs ?? []).filter { $0.t < ticks } : []
            let log = BubbleInputLog(seed: manifest.seed, totalTicks: ticks, inputs: inputs, length: manifest.length)
            resumeStore.save(SavedRun(gameID: bubble.id, sessionKey: key, log: log, score: bubble.featuredRun.map { $0.score / 2 } ?? 0, savedAt: Date().addingTimeInterval(-180)))
        }
        #endif
        guard let saved = resumeStore.saved(gameID: bubble.id, sessionKey: key) else { return }
        resumeOffer = saved
        #if DEBUG
        if DebugLaunch.value("FB_RESUME_AUTO") == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { resume(saved) }
        }
        #endif
    }

    /// Starts a fresh web view that fast-forwards through the saved run, then waits for a tap.
    private func resume(_ saved: SavedRun) {
        guard resumeOffer != nil else { return }
        withAnimation(GameMotion.resolved(GameMotion.reveal, reduceMotion: reduceMotion)) {
            resumeOffer = nil
        }
        resumeLog = saved.log
        score = saved.score
        failure = nil
        isLive = false
        hasStarted = true
        attempt += 1
    }

    private func startOver(_ bubble: Bubble) {
        resumeStore.clear(gameID: bubble.id)
        withAnimation(GameMotion.resolved(GameMotion.reveal, reduceMotion: reduceMotion)) {
            resumeOffer = nil
        }
    }

    /// The best friend's score on this game, so the prompt is about someone.
    private func resumeRival(in bubble: Bubble) -> (name: String, score: Int)? {
        let me = appStore.me.id
        guard let top = bubbleStore.leaderboard(for: bubble, scope: .friends).first(where: { $0.user.id != me }) else { return nil }
        return (top.user.firstName, top.score)
    }

    private func openBoard(_ bubble: Bubble) {
        let id = bubble.id
        exitPlayer { [router] in
            router.push(.bubbleBoard(id))
        }
    }

    /// Closes the result sheet and the player, then runs `action` (open Studio, a chat, a page).
    /// One step at a time: dismissing the player while its sheet is still closing (or presenting
    /// Studio while the player is) can be dropped by UIKit, which left the button doing nothing.
    private func exitPlayer(_ action: @escaping () -> Void) {
        guard !isExiting else { return }
        isExiting = true
        result = nil
        let dismiss = dismiss
        PresentationGate.afterDismissal {
            dismiss()
            PresentationGate.afterDismissal {
                action()
            }
        }
    }

    private func playNextLevel(_ next: Bubble) {
        result = nil
        lastResult = nil
        score = 0
        hasStarted = false
        isWatchingBurst = false
        isLive = false
        failure = nil
        mode = .play
        bubbleID = next.id
    }

    #if DEBUG
    private func showFakeResult(for bubble: Bubble) {
        let previous = bubbleStore.bestScore(of: appStore.me, in: bubble)?.score
        let base = previous ?? bubble.featuredRun?.score ?? 20
        let fake = BubbleRunResult(
            outcome: .success,
            score: base + 3,
            durationSec: 34,
            replay: BubbleInputLog(seed: bubble.manifest.seed, totalTicks: 34 * 60),
            share: BubbleShareArtifact(headline: bubble.title, scoreText: "\(base + 3) points")
        )
        isWatchingBurst = false
        hasStarted = true
        score = fake.score
        let context = BubbleResultContext(bubbleID: bubble.id, result: fake, previousBest: previous, isRecorded: false)
        lastResult = context
        result = context
    }
    #endif
}
