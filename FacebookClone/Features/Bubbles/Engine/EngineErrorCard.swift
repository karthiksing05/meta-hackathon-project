import SwiftUI
import UIKit

/// Shown when a game fails to start or its engine is unavailable: a still orb, "This Whim didn't
/// load" (from `ProductName`), a plain reason and "Try again", which calls `onRetry` to start the
/// game again for real (a fresh session on a freshly leased host).
///
/// Put it over the game's poster so the runtime's own error page never shows through.
struct EngineErrorCard: View {
    /// Why it happened, in plain words. Defaults to a generic line.
    var detail: String = EngineErrorCard.genericDetail
    /// The runtime's own message. Shown in DEBUG builds only, small, for the team.
    var technical: String? = nil
    /// Nil hides "Try again" (for content that's gone for good).
    var onRetry: (() -> Void)? = nil
    /// An optional way out under "Try again", for example "Close".
    var secondaryTitle: String? = nil
    var onSecondary: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let title = "This \(ProductName.singular) didn't load"
    static let genericDetail = "Something went wrong while it was starting."
    static let timedOutDetail = "It's taking too long to start."
    static let unavailableDetail = "The game engine isn't available right now."
    static let goneDetail = "It isn't available anymore."

    var body: some View {
        VStack(spacing: 14) {
            ZStack(alignment: .bottomTrailing) {
                GameOrb(size: 52)
                    .saturation(0.4)
                    .opacity(0.8)
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color.white, GameColor.deepFill)
                    .offset(x: 4, y: 4)
                    .accessibilityHidden(true)
            }
            VStack(spacing: 6) {
                Text(Self.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text(detail)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                #if DEBUG
                if let technical, !technical.isEmpty {
                    Text(technical)
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .accessibilityHidden(true)
                }
                #endif
            }
            if onRetry != nil || onSecondary != nil {
                VStack(spacing: 8) {
                    if let onRetry {
                        Button {
                            Haptics.light()
                            onRetry()
                        } label: {
                            Label("Try again", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.fb(.primary, height: 40))
                    }
                    if let secondaryTitle, let onSecondary {
                        Button(secondaryTitle, action: onSecondary)
                            .buttonStyle(.fb(.secondary, height: 40))
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(20)
        .frame(maxWidth: 320)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
        .shadow(color: Color.black.opacity(0.14), radius: 16, y: 6)
        .padding(.horizontal, 24)
        .gameAppear(offset: reduceMotion ? 0 : 12)
        .accessibilityElement(children: .contain)
        .onAppear {
            Haptics.warning()
            UIAccessibility.post(notification: .announcement, argument: "\(Self.title). \(detail)")
        }
    }
}

/// Why a game didn't start, for `EngineErrorCard`.
struct EngineFailure: Equatable {
    enum Kind: Equatable {
        /// The runtime reported an error (prepare, activate or a crash mid-run).
        case failed
        /// No `ready` within `startTimeout`.
        case timedOut
        /// The runtime page itself didn't load, so no game can run on that host.
        case unavailable
    }

    var kind: Kind
    /// The runtime's own message, for DEBUG builds.
    var message: String? = nil

    /// How long a start may take before the card offers a retry. A cold host plus a first
    /// microgame takes about a second on the phone; this is far past that.
    static let startTimeout: Duration = .seconds(15)

    /// The plain line under the card's title.
    var detail: String {
        switch kind {
        case .failed: EngineErrorCard.genericDetail
        case .timedOut: EngineErrorCard.timedOutDetail
        case .unavailable: EngineErrorCard.unavailableDetail
        }
    }

    /// False for bridge errors that don't stop the game. Today that's only a run result Swift
    /// couldn't decode (`BubbleBridgeMessage.init`); the runtime's own `error` message always
    /// means it stopped the game and drew its error page.
    static func stopsGame(_ message: String) -> Bool {
        message != "Couldn't read the run result"
    }
}

extension EngineErrorCard {
    init(failure: EngineFailure, onRetry: (() -> Void)?, secondaryTitle: String? = nil, onSecondary: (() -> Void)? = nil) {
        self.init(detail: failure.detail, technical: failure.message, onRetry: onRetry, secondaryTitle: secondaryTitle, onSecondary: onSecondary)
    }
}

#Preview {
    ZStack {
        GameColor.gradient.ignoresSafeArea()
        EngineErrorCard(technical: "prepare timed out", onRetry: {}, secondaryTitle: "Close", onSecondary: {})
    }
}
