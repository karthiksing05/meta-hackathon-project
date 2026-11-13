import UIKit

/// Waits for sheets and covers to finish moving before presenting the next one.
///
/// UIKit drops a presentation that starts while another sheet or cover is still animating in or
/// out ("Attempt to present … while a presentation is in progress"), and SwiftUI then leaves the
/// item set with nothing on screen. A fixed delay after `dismiss()` loses that race on a slow
/// frame, so "Next level" or "Make level 2" from a result sheet did nothing now and then.
/// `whenIdle` runs the action as soon as nothing is moving (right away when nothing is).
@MainActor
enum PresentationGate {
    /// True while any view controller in the key window is being presented or dismissed.
    static var isTransitioning: Bool {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .filter(\.isKeyWindow)
        for window in windows {
            var controller = window.rootViewController
            while let current = controller {
                if current.isBeingPresented || current.isBeingDismissed || current.transitionCoordinator != nil {
                    return true
                }
                controller = current.presentedViewController
            }
        }
        return false
    }

    /// Runs `action` now if nothing is moving, otherwise once the current transitions end (or
    /// after `timeout` seconds, whichever comes first).
    static func whenIdle(timeout: TimeInterval = 1.5, _ action: @escaping @MainActor () -> Void) {
        guard isTransitioning else {
            action()
            return
        }
        poll(deadline: Date().addingTimeInterval(timeout), action)
    }

    /// For "close this, then open that": waits a beat so the dismissal just requested has begun,
    /// then for every transition to end, then runs `action`.
    static func afterDismissal(timeout: TimeInterval = 1.5, _ action: @escaping @MainActor () -> Void) {
        let deadline = Date().addingTimeInterval(timeout)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            MainActor.assumeIsolated {
                poll(deadline: deadline, action)
            }
        }
    }

    private static func poll(deadline: Date, _ action: @escaping @MainActor () -> Void) {
        if !isTransitioning || Date() >= deadline {
            action()
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            MainActor.assumeIsolated {
                poll(deadline: deadline, action)
            }
        }
    }
}
