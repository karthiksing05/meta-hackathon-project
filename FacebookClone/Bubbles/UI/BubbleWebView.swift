import SwiftUI
import WebKit

/// Runs one Bubble in a warm runtime host leased from `BubbleRuntimePool` (docs/BUBBLES.md,
/// 4.3 and 4.8). The host page is already loaded, so a Bubble starts as a session (`prepare`,
/// then `activate`) instead of loading a page; runtimes with only `boot` (the stub) still work.
///
/// Changing `manifest` or `mode` restarts the game. `isActive` pauses and resumes it.
/// Bump `restartToken` to restart the run in play mode without the intro ("Play again").
/// `insetTop` and `insetBottom` (points) keep the score HUD and playfield clear of your chrome.
/// Haptic messages are played with `Haptics` while you play; `onMessage` gets every message.
struct BubbleWebView: UIViewRepresentable {
    let manifest: BubbleManifest
    var mode: BubbleRunMode = .play
    var playerName: String = ""
    var bestScore: Int? = nil
    var isActive: Bool = true
    var isMuted: Bool = true
    var reducedMotion: Bool = false
    var restartToken: Int = 0
    var insetTop: CGFloat = 0
    var insetBottom: CGFloat = 0
    var onMessage: (BubbleBridgeMessage) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> BubbleHostContainerView {
        let container = BubbleHostContainerView()
        let coordinator = context.coordinator
        coordinator.container = container
        coordinator.onMessage = onMessage
        coordinator.isActive = isActive
        coordinator.isMuted = isMuted
        coordinator.restartToken = restartToken
        coordinator.leaseHost()
        coordinator.start(manifest: manifest, options: options, bootKey: bootKey)
        return container
    }

    func updateUIView(_ container: BubbleHostContainerView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onMessage = onMessage
        if coordinator.bootKey != bootKey {
            coordinator.isMuted = isMuted
            coordinator.restartToken = restartToken
            coordinator.start(manifest: manifest, options: options, bootKey: bootKey)
        }
        if coordinator.isActive != isActive {
            coordinator.isActive = isActive
            coordinator.host?.command(isActive ? "resume" : "pause")
        }
        if coordinator.isMuted != isMuted {
            coordinator.isMuted = isMuted
            coordinator.host?.command(isMuted ? "mute" : "unmute")
        }
        if coordinator.restartToken != restartToken {
            coordinator.restartToken = restartToken
            coordinator.host?.restartInPlay()
        }
    }

    static func dismantleUIView(_ container: BubbleHostContainerView, coordinator: Coordinator) {
        coordinator.returnHost()
    }

    /// Identity of what's running. A change restarts the runtime.
    private var bootKey: String {
        let replay = mode.replayLog.map { "\($0.seed)-\($0.totalTicks)-\($0.inputs.count)" } ?? "-"
        return "\(BubbleRuntimeHost.sessionKey(for: manifest))#\(mode.name)#\(replay)"
    }

    private var options: BubbleSessionOptions {
        BubbleSessionOptions(
            mode: mode,
            playerName: playerName,
            bestScore: bestScore,
            isMuted: isMuted,
            reducedMotion: reducedMotion,
            insetTop: insetTop,
            insetBottom: insetBottom
        )
    }

    @MainActor
    final class Coordinator {
        weak var container: BubbleHostContainerView?
        private(set) var host: BubbleRuntimeHost?
        var onMessage: (BubbleBridgeMessage) -> Void = { _ in }
        var bootKey = ""
        var isActive = true
        var isMuted = true
        var restartToken = 0
        private var sessionKey: String?
        private var startCount = 0

        func leaseHost() {
            let host = BubbleRuntimePool.shared.lease()
            self.host = host
            if let container {
                host.attach(to: container)
            }
        }

        func start(manifest: BubbleManifest, options: BubbleSessionOptions, bootKey: String) {
            self.bootKey = bootKey
            guard let host else { return }
            if let old = sessionKey {
                host.removeHandler(for: old)
            }
            let key = BubbleRuntimeHost.sessionKey(for: manifest)
            sessionKey = key
            host.setHandler(for: key) { [weak self] message in
                self?.onMessage(message)
            }
            startCount += 1
            let count = startCount
            container?.setRevealed(false, animated: false)
            Task { @MainActor [weak self] in
                let outcome = await host.start(key: key, manifest: manifest, options: options)
                guard let self, self.startCount == count, self.host === host, !outcome.superseded else { return }
                if !outcome.ok {
                    self.onMessage(.error(outcome.error ?? "This bubble popped"))
                }
                if !self.isActive {
                    host.command("pause")
                }
                self.container?.setRevealed(true, animated: true)
            }
        }

        func returnHost() {
            guard let host else { return }
            if let key = sessionKey {
                host.removeHandler(for: key)
            }
            if let container {
                host.detach(from: container)
            }
            BubbleRuntimePool.shared.giveBack(host)
            self.host = nil
        }
    }
}
