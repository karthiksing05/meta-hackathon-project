import SwiftUI
import UIKit

/// System chrome that SwiftUI doesn't style for us.
///
/// iOS 26 draws navigation bars as Liquid Glass with no background of their own, which already
/// reads as Facebook's flat chrome. iOS 17 and 18 draw the older bar instead: transparent while
/// the content rests at the top (a grouped screen's gray `background` shows through as a band
/// under the clock) and a translucent gray material once content scrolls under it. On those
/// versions every navigation bar (pushed screens and sheets) gets Facebook's opaque `surface`
/// bar, with a hairline only while content is scrolled under it.
///
/// Screens that set `.toolbarBackground(...)` themselves (Messenger chats) keep their own look.
///
/// DEBUG: `FB_LEGACY_BARS=1` applies the iOS 17/18 bars on iOS 26 too. Together with
/// `UIDesignRequiresCompatibility` in the built app's Info.plist, that shows on an iOS 26
/// simulator what iOS 18 users see.
enum FBSystemBars {
    private static var isConfigured = false

    /// Call once, before the first `NavigationStack` is created. `RootView` does this.
    @MainActor
    static func configure() {
        guard !isConfigured else { return }
        isConfigured = true
        if #available(iOS 26, *), DebugLaunch.value("FB_LEGACY_BARS") == nil { return }

        let resting = UINavigationBarAppearance()
        resting.configureWithOpaqueBackground()
        resting.backgroundColor = FBUIColor.surface
        resting.shadowColor = .clear
        resting.titleTextAttributes = [.foregroundColor: FBUIColor.primaryText]
        resting.largeTitleTextAttributes = [.foregroundColor: FBUIColor.primaryText]

        let scrolled = resting.copy()
        scrolled.shadowColor = FBUIColor.divider

        let bar = UINavigationBar.appearance()
        bar.standardAppearance = scrolled
        bar.compactAppearance = scrolled
        bar.scrollEdgeAppearance = resting
        bar.compactScrollEdgeAppearance = resting
    }
}

extension View {
    /// Paints the status bar area of a screen that hides its navigation bar, so content that
    /// scrolls under the clock is covered. Adds no inset and doesn't change layout.
    func fbStatusBarBackdrop(_ color: Color = FBColor.surface) -> some View {
        safeAreaInset(edge: .top, spacing: 0) {
            Color.clear
                .frame(height: 0)
                .background(color.ignoresSafeArea(edges: .top))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}
