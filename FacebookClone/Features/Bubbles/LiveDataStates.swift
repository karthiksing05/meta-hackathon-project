import SwiftUI

/// What a screen shows while server data loads, when it fails, when there is none, or when the
/// server can't serve it yet. Never stands in for content.
struct LiveDataStateView: View {
    enum Kind {
        case loading
        case failed(String)
        case empty(String)
        /// The server has no endpoint for this yet (docs/APP_LIVE_DATA_PLAN.md, Stage 4).
        case notAvailable(String)
    }

    let kind: Kind
    var title: String?
    var retry: (() -> Void)?
    /// Light text on dark backgrounds (the games tab).
    var onDark = false

    var body: some View {
        VStack(spacing: 10) {
            switch kind {
            case .loading:
                ProgressView()
                    .tint(onDark ? .white : nil)
                Text(title ?? "Loading…")
                    .font(.fbBody)
                    .foregroundStyle(secondary)
            case .failed(let message):
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(secondary)
                Text(title ?? "Couldn't load this")
                    .font(.fbHeadline)
                    .foregroundStyle(primary)
                Text(message)
                    .font(.fbMeta)
                    .foregroundStyle(secondary)
                    .multilineTextAlignment(.center)
                if let retry {
                    Button("Try again", action: retry)
                        .buttonStyle(.fb(.primary, expand: false, height: 36))
                }
            case .empty(let message):
                Text(title ?? "Nothing here yet")
                    .font(.fbHeadline)
                    .foregroundStyle(primary)
                Text(message)
                    .font(.fbBody)
                    .foregroundStyle(secondary)
                    .multilineTextAlignment(.center)
                if let retry {
                    Button("Refresh", action: retry)
                        .buttonStyle(.fb(.secondary, expand: false, height: 36))
                }
            case .notAvailable(let message):
                Image(systemName: "hourglass")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(secondary)
                Text(title ?? "Not available yet")
                    .font(.fbHeadline)
                    .foregroundStyle(primary)
                Text(message)
                    .font(.fbMeta)
                    .foregroundStyle(secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }

    private var primary: Color { onDark ? .white : FBColor.primaryText }
    private var secondary: Color { onDark ? .white.opacity(0.75) : FBColor.secondaryText }
}
