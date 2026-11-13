import SwiftUI

/// What a screen shows while server data loads, when it fails, when there is none, or when the
/// server can't serve it yet. Never stands in for content.
///
/// Every state ends in a next step: a failed state offers Try again (`retry`), and an empty or
/// unavailable state offers one `action` that takes you somewhere useful ("Make one", "Find
/// friends", "Join the Group"). On a failed state the action shows as a quieter link under Try
/// again; on an empty state `retry` becomes a quiet "Refresh" link under the action.
struct LiveDataStateView: View {
    enum Kind {
        case loading
        case failed(String)
        case empty(String)
        /// The server has no endpoint for this (docs/APP_LIVE_DATA_PLAN.md, Stage 4).
        case notAvailable(String)
    }

    /// The one next step a state offers.
    struct Action {
        let title: String
        var symbol: String? = nil
        let perform: () -> Void
    }

    let kind: Kind
    var title: String?
    var retry: (() -> Void)?
    /// Light text on dark backgrounds (the games tab).
    var onDark = false
    var action: Action? = nil

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
                    .multilineTextAlignment(.center)
                Text(Self.friendly(message))
                    .font(.fbMeta)
                    .foregroundStyle(secondary)
                    .multilineTextAlignment(.center)
                if let retry {
                    Button {
                        Haptics.light()
                        retry()
                    } label: {
                        Label("Try again", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.fb(.primary, expand: false, height: 36))
                    .padding(.top, 4)
                }
                if let action {
                    link(action)
                }
            case .empty(let message):
                Text(title ?? "Nothing here yet")
                    .font(.fbHeadline)
                    .foregroundStyle(primary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(.fbBody)
                    .foregroundStyle(secondary)
                    .multilineTextAlignment(.center)
                if let action {
                    button(action)
                    if let retry {
                        link(Action(title: "Refresh", perform: retry))
                    }
                } else if let retry {
                    Button("Refresh", action: retry)
                        .buttonStyle(.fb(.secondary, expand: false, height: 36))
                        .padding(.top, 4)
                }
            case .notAvailable(let message):
                Image(systemName: "hourglass")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(secondary)
                Text(title ?? "Not here yet")
                    .font(.fbHeadline)
                    .foregroundStyle(primary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(.fbMeta)
                    .foregroundStyle(secondary)
                    .multilineTextAlignment(.center)
                if let action {
                    button(action)
                }
            }
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }

    private func button(_ action: Action) -> some View {
        Button {
            Haptics.light()
            action.perform()
        } label: {
            if let symbol = action.symbol {
                Label(action.title, systemImage: symbol)
            } else {
                Text(action.title)
            }
        }
        .buttonStyle(.fb(.primary, expand: false, height: 36))
        .padding(.top, 4)
    }

    private func link(_ action: Action) -> some View {
        Button {
            Haptics.light()
            action.perform()
        } label: {
            Text(action.title)
                .font(.fbButton)
                .foregroundStyle(onDark ? Color.white : FBColor.accent)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var primary: Color { onDark ? .white : FBColor.primaryText }
    private var secondary: Color { onDark ? .white.opacity(0.75) : FBColor.secondaryText }

    /// The server's error in plain words. Network errors arrive as "Could not reach the server:
    /// <system text>", which reads like a log line.
    static func friendly(_ message: String) -> String {
        if message.hasPrefix("Could not reach the server") || message.localizedCaseInsensitiveContains("offline") {
            return "Check your connection and try again."
        }
        return message
    }
}

/// A sheet for a feature the server can't serve yet, with one thing you can do instead.
struct LiveDataUnavailableSheet: View {
    let title: String
    let message: String
    var action: LiveDataStateView.Action? = nil

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            LiveDataStateView(kind: .notAvailable(message), action: action.map { action in
                // Close the sheet first, so the next screen isn't under it.
                LiveDataStateView.Action(title: action.title, symbol: action.symbol) {
                    dismiss()
                    action.perform()
                }
            })
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
        .presentationDragIndicator(.visible)
    }
}

/// Why a feature is off until the server serves it (docs/APP_LIVE_DATA_PLAN.md, Stage 4). Each
/// says what you can do instead; the screen offers that as its button.
enum LiveDataCopy {
    static let sessions = "Making a game together isn't on the server yet. You can make one for the Group now, and everyone can play it."
    static let revise = "Muse can't change this kind of game yet. Make a new one from your idea instead."
}
