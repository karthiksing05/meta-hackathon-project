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
    var onBegin: () -> Void
    var onSettle: (Int) -> Void

    func makeUIView(context: Context) -> ObserverView {
        let view = ObserverView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.onBegin = onBegin
        view.onSettle = onSettle
        return view
    }

    func updateUIView(_ view: ObserverView, context: Context) {
        view.onBegin = onBegin
        view.onSettle = onSettle
    }

    static func dismantleUIView(_ view: ObserverView, coordinator: ()) {
        view.detach()
    }

    final class ObserverView: UIView {
        var onBegin: () -> Void = {}
        var onSettle: (Int) -> Void = { _ in }

        private weak var scrollView: UIScrollView?
        private var observation: NSKeyValueObservation?
        private var isMoving = false
        private var settleWork: DispatchWorkItem?
        private var lastOffset: CGFloat = .nan

        /// How long the offset has to hold still before the pager counts as settled.
        private static let quietInterval: TimeInterval = 0.12

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
            lastOffset = found.contentOffset.y
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
                onBegin()
            }
            scheduleSettleCheck()
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
            let index = min(max(0, Int((position / height).rounded())), maxIndex)
            let target = CGFloat(index) * height - top
            if abs(scrollView.contentOffset.y - target) > 1 {
                // Resting between pages: snap onto the nearest one; that scroll settles again.
                scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: target), animated: true)
                scheduleSettleCheck()
                return
            }
            isMoving = false
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
    static let flickVelocity: CGFloat = 0.5
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
            } else if abs(dragged) > height / 2 {
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
