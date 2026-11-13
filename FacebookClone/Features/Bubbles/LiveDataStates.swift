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

/// A sheet for a feature the server can't serve yet.
struct LiveDataUnavailableSheet: View {
    let title: String
    let message: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            LiveDataStateView(kind: .notAvailable(message))
                .frame(maxHeight: .infinity)
                .background(FBColor.surface)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                }
        }
        .presentationDetents([.medium])
    }
}

/// Why a feature is off until the server serves it (docs/APP_LIVE_DATA_PLAN.md, Stage 4).
enum LiveDataCopy {
    static let challenges = "Challenges need the server to send them and to bring back your friends' runs. They come when it can."
    static let sessions = "Playing together needs the server to share the session and everyone's runs. It comes when it can."
    static let quizNight = "Quiz nights need the server to run the night and collect everyone's answers. They come when it can."
    static let moments = "Your friends' plays, remixes and replies come from the server's moments inbox, which isn't there yet."
    static let groupBoards = "The server keeps one board for everyone. Friends and Group boards come when it serves them."
    static let anatomy = "\"How the game works\" needs the server to ask Muse. It comes when the server has it."
    static let revise = "Changing a game needs the server to revise it. For now, make a new one."
}
