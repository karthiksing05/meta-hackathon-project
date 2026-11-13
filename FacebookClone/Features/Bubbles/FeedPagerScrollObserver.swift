import SwiftUI
import UIKit

/// Watches the feed pager's own `UIScrollView` (iOS 17 and 18 alike: `onScrollPhaseChange` is
/// iOS 18 only) and reports two things to the feed:
///
/// - `onBegin`: the pager started moving (a drag, a fling, or a programmatic scroll).
/// - `onSettle(index)`: the pager stopped. Nobody is touching it, it isn't decelerating, and the
///   offset has held still for a moment. `index` is the page more than half on screen.
///
/// When the pager comes to rest between two pages (a lazy stack's estimated heights, or a cover
/// closing, can leave a paged ScrollView off its page), it snaps to the nearest page first and
/// settles after that.
///
/// Placed in the background of the pager's content, so the first `UIScrollView` above it is the
/// pager.
struct FeedPagerScrollObserver: UIViewRepresentable {
    /// True when a finger moved it (a drag), false for a programmatic scroll.
    var onBegin: (Bool) -> Void
    var onSettle: (Int) -> Void
    /// Hands the feed a way to turn one page (+1 next, -1 previous), once the pager is found.
    var onAttach: (@escaping (Int) -> Void) -> Void = { _ in }
    /// While set, the pager is held on this page: no pan, and any drift snaps back here.
    var lockedIndex: Int? = nil

    func makeUIView(context: Context) -> ObserverView {
        let view = ObserverView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.onBegin = onBegin
        view.onSettle = onSettle
        view.onAttach = onAttach
        view.lockedIndex = lockedIndex
        return view
    }

    func updateUIView(_ view: ObserverView, context: Context) {
        view.onBegin = onBegin
        view.onSettle = onSettle
        view.onAttach = onAttach
        view.lockedIndex = lockedIndex
    }

    static func dismantleUIView(_ view: ObserverView, coordinator: ()) {
        view.detach()
    }

    final class ObserverView: UIView {
        var onBegin: (Bool) -> Void = { _ in }
        var onSettle: (Int) -> Void = { _ in }
        var onAttach: (@escaping (Int) -> Void) -> Void = { _ in }
        var lockedIndex: Int? {
            didSet {
                guard lockedIndex != oldValue else { return }
                scrollView?.panGestureRecognizer.isEnabled = lockedIndex == nil
                FeedScrollLog.log("lock page \(lockedIndex.map(String.init) ?? "off")")
            }
        }

        private weak var scrollView: UIScrollView?
        private var observation: NSKeyValueObservation?
        private var isMoving = false
        private var settleWork: DispatchWorkItem?
        private var lastOffset: CGFloat = .nan

        /// How long the offset has to hold still before the pager counts as settled.
        private static let quietInterval: TimeInterval = 0.06

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil else {
                detach()
                return
            }
            attachIfNeeded()
        }

        func detach() {
            observation?.invalidate()
            observation = nil
            settleWork?.cancel()
            settleWork = nil
            scrollView = nil
            isMoving = false
        }

        private func attachIfNeeded() {
            var candidate = superview
            while let view = candidate, !(view is UIScrollView) {
                candidate = view.superview
            }
            guard let found = candidate as? UIScrollView, found !== scrollView else { return }
            observation?.invalidate()
            scrollView = found
            found.panGestureRecognizer.isEnabled = lockedIndex == nil
            // Snap like Reels: the page lands quickly instead of drifting.
            found.decelerationRate = .fast
            lastOffset = found.contentOffset.y
            FeedScrollLog.log("observer attached height=\(Int(found.bounds.height)) offset=\(Int(found.contentOffset.y))")
            FeedScrollLog.watchMemoryWarnings()
            onAttach { [weak self] direction in
                self?.page(by: direction)
            }
            observation = found.observe(\.contentOffset, options: [.new]) { [weak self] scrollView, _ in
                let y = scrollView.contentOffset.y
                MainActor.assumeIsolated {
                    self?.offsetChanged(y)
                }
            }
        }

        private func offsetChanged(_ y: CGFloat) {
            guard abs(y - lastOffset) > 0.5 else { return }
            lastOffset = y
            if !isMoving {
                isMoving = true
                FeedScrollLog.log("move began offset=\(Int(y)) tracking=\(scrollView?.isTracking ?? false)")
                onBegin(scrollView?.isTracking ?? false)
            }
            scheduleSettleCheck()
        }

        /// Turns one page from the nearest whole page, animated. The move settles like a drag.
        func page(by direction: Int) {
            guard let scrollView else { return }
            let height = scrollView.bounds.height
            guard height > 1 else { return }
            let top = scrollView.adjustedContentInset.top
            let maxIndex = max(0, Int(((scrollView.contentSize.height - height) / height).rounded()))
            let current = Int(((scrollView.contentOffset.y + top) / height).rounded())
            let index = min(max(0, current + direction), maxIndex)
            FeedScrollLog.log("page by \(direction): \(current) -> \(index)")
            guard index != current else {
                // Already at the end: nothing moves, so settle here (the page starts again).
                onSettle(index)
                return
            }
            scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: CGFloat(index) * height - top), animated: true)
        }

        private func scheduleSettleCheck() {
            settleWork?.cancel()
            let work = DispatchWorkItem { [weak self] in
                self?.checkSettled()
            }
            settleWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.quietInterval, execute: work)
        }

        private func checkSettled() {
            guard isMoving, let scrollView else { return }
            if scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating {
                // A finger still holds the page (a partial drag held in place): keep waiting.
                scheduleSettleCheck()
                return
            }
            let height = scrollView.bounds.height
            guard height > 1 else {
                isMoving = false
                return
            }
            let top = scrollView.adjustedContentInset.top
            let position = scrollView.contentOffset.y + top
            let maxIndex = max(0, Int(((scrollView.contentSize.height - height) / height).rounded()))
            let nearest = min(max(0, Int((position / height).rounded())), maxIndex)
            // Held on the game's page: whatever moved the pager (a keyboard, a cover, a reset to
            // the top), it goes back to that page, not the nearest one.
            let index = lockedIndex.map { min(max(0, $0), maxIndex) } ?? nearest
            let target = CGFloat(index) * height - top
            if abs(scrollView.contentOffset.y - target) > 1 {
                // Resting between pages: snap onto the nearest one; that scroll settles again.
                FeedScrollLog.log("snap offset=\(Int(scrollView.contentOffset.y)) -> \(Int(target)) index=\(index)")
                scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: target), animated: true)
                scheduleSettleCheck()
                return
            }
            isMoving = false
            FeedScrollLog.log("settled index=\(index) offset=\(Int(scrollView.contentOffset.y)) height=\(Int(height))")
            onSettle(index)
        }
    }
}

/// Snap paging for the feed: always lands on a whole page, at most one page from where the
/// gesture began.
///
/// `.paging` was moving on to the next page after a slow partial drag (a third of a page, then let
/// go). Here a release moves one page only when the finger let go past half a page, or flicked
/// (faster than `flickVelocity`) in that direction; otherwise the pager goes back to its page. A
/// long fling still moves only one page, like Reels.
struct FeedPagingBehavior: ScrollTargetBehavior {
    /// Points per millisecond (the units of `context.velocity`).
    static let flickVelocity: CGFloat = 0.25
    /// A slow drag turns the page once it has moved this share of the screen (Reels-like).
    static let dragShare: CGFloat = 0.22
    /// How far the scroll view coasts per unit of release velocity: the natural target sits about
    /// this many milliseconds of velocity past the release point (measured on iOS 26.5).
    static let coastMilliseconds: CGFloat = 660

    func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
        let height = context.containerSize.height
        guard height > 1 else { return }
        let maxY = max(0, context.contentSize.height - height)
        let startY = context.originalTarget.rect.minY
        let proposedY = target.rect.minY
        let velocity = context.velocity.dy
        var page = (proposedY / height).rounded()
        if velocity != 0 {
            // A gesture: where the finger let go, without the coast.
            let coast = velocity * Self.coastMilliseconds
            let releaseY = abs(coast) < abs(proposedY - startY) ? proposedY - coast : startY
            let startPage = (startY / height).rounded()
            let dragged = releaseY - startPage * height
            if abs(velocity) > Self.flickVelocity {
                page = startPage + (velocity > 0 ? 1 : -1)
            } else if abs(dragged) > height * Self.dragShare {
                page = startPage + (dragged > 0 ? 1 : -1)
            } else {
                page = startPage
            }
        }
        #if DEBUG
        if BubbleRuntimePerf.isEnabled {
            NSLog("[BubblePerf] paging target start=%.1f proposed=%.1f v=%.2f -> page %.0f", startY, proposedY, velocity, page)
        }
        #endif
        target.rect.origin.y = min(max(0, page * height), maxY)
    }
}

/// DEBUG-only log of the feed's scrolling and web view lifecycle (begin, settle, snap, activate,
/// reveal, host moves, web process crashes, memory warnings). On with `FB_SCROLL_LOG=1`; written
/// to stderr so `devicectl device process launch --console` shows it.
enum FeedScrollLog {
    static let isEnabled: Bool = {
        #if DEBUG
        return ProcessInfo.processInfo.environment["FB_SCROLL_LOG"] == "1"
        #else
        return false
        #endif
    }()

    private static var memoryObserver: NSObjectProtocol?

    @MainActor
    static func watchMemoryWarnings() {
        #if DEBUG
        guard isEnabled, memoryObserver == nil else { return }
        memoryObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { _ in
            log("MEMORY WARNING")
        }
        #endif
    }

    static func log(_ text: @autoclosure () -> String) {
        #if DEBUG
        guard isEnabled else { return }
        let line = String(format: "[FeedScroll %.3f] ", CACurrentMediaTime()) + text() + "\n"
        FileHandle.standardError.write(Data(line.utf8))
        #endif
    }
}
