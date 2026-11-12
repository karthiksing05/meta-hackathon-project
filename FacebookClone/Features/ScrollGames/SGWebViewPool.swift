import UIKit
import WebKit

/// Forwards `scrollGames` script messages to whoever currently owns the web view.
final class SGScriptBridge: NSObject, WKScriptMessageHandler {
    var onMessage: ((_ type: String, _ body: [String: Any]) -> Void)?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        onMessage?(type, body)
    }
}

/// Keeps one player web view loaded ahead of time so the first game starts faster
/// (web process spawned, JS engine up, player assets and wasm in the HTTP cache).
@MainActor
final class SGWebViewPool {
    static let shared = SGWebViewPool()

    private var warm: (webView: WKWebView, bridge: SGScriptBridge)?

    private func makeEntry() -> (webView: WKWebView, bridge: SGScriptBridge) {
        let bridge = SGScriptBridge()
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(bridge, name: "scrollGames")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.bounces = false
        return (webView, bridge)
    }

    /// Creates and loads the spare web view if there isn't one yet.
    func warmUp() {
        guard warm == nil else { return }
        let entry = makeEntry()
        entry.webView.load(URLRequest(url: SGConfig.playerShellURL))
        warm = entry
    }

    /// Hands out the warm web view (or a fresh one). The pool refills itself after the caller is done.
    func take() -> (webView: WKWebView, bridge: SGScriptBridge) {
        let entry = warm ?? makeEntry()
        warm = nil
        return entry
    }

    /// Call when a handed-out web view is finished with.
    func release(_ entry: (webView: WKWebView, bridge: SGScriptBridge)) {
        entry.bridge.onMessage = nil
        entry.webView.stopLoading()
        entry.webView.configuration.userContentController.removeScriptMessageHandler(forName: "scrollGames")
        warmUp()
    }
}
