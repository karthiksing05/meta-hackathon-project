import SwiftUI
import WebKit

/// Hosts the wasm game player (`<base>/player/index.html`) in a web view and relays its `scrollGames` messages.
struct GamePlayerView: UIViewRepresentable {
    let gameID: String
    let seed: Int
    var challengeID: String? = nil
    var onReady: () -> Void = {}
    var onResult: (SGPlayResult) -> Void
    var onError: (String) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let coordinator = context.coordinator
        let entry = SGWebViewPool.shared.take()
        coordinator.entry = entry
        entry.bridge.onMessage = { [weak coordinator] type, body in
            coordinator?.handle(type: type, body: body)
        }
        entry.webView.navigationDelegate = coordinator
        entry.webView.load(URLRequest(url: SGConfig.playerURL(gameID: gameID, seed: seed, challengeID: challengeID)))
        return entry.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        if let entry = coordinator.entry {
            SGWebViewPool.shared.release(entry)
            coordinator.entry = nil
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: GamePlayerView
        var entry: (webView: WKWebView, bridge: SGScriptBridge)?

        init(_ parent: GamePlayerView) {
            self.parent = parent
        }

        func handle(type: String, body: [String: Any]) {
            switch type {
            case "ready":
                parent.onReady()
            case "result":
                let json = JSONValue(any: body["result"] ?? body)
                parent.onResult(SGPlayResult(json: json))
            case "haptic":
                playHaptic(style: body["style"] as? String)
            case "error":
                parent.onError(body["message"] as? String ?? "The game hit an error")
            default:
                break
            }
        }

        private func playHaptic(style: String?) {
            switch style {
            case "heavy": Haptics.heavy()
            case "medium": Haptics.medium()
            case "soft": Haptics.soft()
            case "rigid": Haptics.rigid()
            case "success": Haptics.success()
            case "warning": Haptics.warning()
            case "error": Haptics.error()
            default: Haptics.light()
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.onError("Can't load the game player. Is the server running?")
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            if let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
                parent.onError("The game player returned \(http.statusCode)")
            }
            decisionHandler(.allow)
        }
    }
}

/// The player with a loading veil and error state, shared by play and preview.
struct SGPlayerSurface: View {
    let gameID: String
    let seed: Int
    var challengeID: String? = nil
    let onResult: (SGPlayResult) -> Void

    @State private var isReady = false
    @State private var errorMessage: String?
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            FBColor.darkCanvas
            GamePlayerView(
                gameID: gameID,
                seed: seed,
                challengeID: challengeID,
                onReady: { withAnimation(.easeOut(duration: 0.2)) { isReady = true } },
                onResult: onResult,
                onError: { errorMessage = $0 }
            )
            .id(reloadToken)
            .opacity(isReady ? 1 : 0)

            if let errorMessage {
                ContentUnavailableView {
                    Label("Couldn't start the game", systemImage: "gamecontroller")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Try again") {
                        self.errorMessage = nil
                        isReady = false
                        reloadToken += 1
                    }
                    .buttonStyle(.fb(.secondary, expand: false))
                }
                .foregroundStyle(.white)
            } else if !isReady {
                ProgressView()
                    .tint(.white)
            }
        }
    }
}
