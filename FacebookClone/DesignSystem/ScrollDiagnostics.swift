import SwiftUI
import UIKit

/// DEBUG-only scroll forensics. Turn it on for the Home feed with `FB_HOME_AUTOSCROLL_LOG=1`
/// (Xcode: Edit Scheme > Run > Arguments > Environment Variables; simulator:
/// `SIMCTL_CHILD_FB_HOME_AUTOSCROLL_LOG=1 xcrun simctl launch ...`).
///
/// Every line goes to the Xcode console (prefixed `[HomeScroll]`) and to `tmp/home-autoscroll.log`
/// in the app's data container (`xcrun simctl get_app_container <udid> com.karthiksing05.fbclone data`).
/// It records:
/// - offset changes no finger caused (not tracking, dragging or decelerating), with the call stack
///   of the first change in each burst, so a programmatic or system scroll names its caller;
/// - content height and inset changes (a navigation bar appearing shows up as a top inset jump);
/// - the tab's navigation bar, the status bar, and every navigation bar visible on screen;
/// - what the feed reports: posts arriving, held back and revealed, the "New posts" pill,
///   scroll-to-top requests, the keyboard, tab switches and ambient activity.
///
/// Release builds compile all of it to nothing.
final class FBScrollLog {
    static let home = FBScrollLog(name: "home-autoscroll", environmentKey: "FB_HOME_AUTOSCROLL_LOG")

    let isEnabled: Bool

    #if DEBUG
    let fileURL: URL
    private let startTime = CACurrentMediaTime()
    private let queue = DispatchQueue(label: "FBScrollLog")
    private let handle: FileHandle?
    #endif

    init(name: String, environmentKey: String) {
        #if DEBUG
        let enabled = DebugLaunch.value(environmentKey) != nil
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).log")
        if enabled {
            // One file per launch.
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        isEnabled = enabled
        fileURL = url
        handle = enabled ? try? FileHandle(forWritingTo: url) : nil
        #else
        isEnabled = false
        #endif
    }

    func log(_ message: @autoclosure () -> String) {
        #if DEBUG
        guard isEnabled else { return }
        let line = String(format: "[%8.3f] ", CACurrentMediaTime() - startTime) + message()
        print("[HomeScroll] " + line)
        let data = Data((line + "\n").utf8)
        queue.async { [handle] in
            handle?.seekToEndOfFile()
            handle?.write(data)
        }
        #endif
    }
}

#if DEBUG

/// Sits in the background of a view inside a ScrollView's content, finds the UIScrollView that
/// hosts it and logs what moves it. Draws nothing and takes no touches.
struct FBScrollProbe: UIViewRepresentable {
    let log: FBScrollLog

    func makeUIView(context: Context) -> FBScrollProbeView {
        FBScrollProbeView(log: log)
    }

    func updateUIView(_ uiView: FBScrollProbeView, context: Context) {}

    static func dismantleUIView(_ uiView: FBScrollProbeView, coordinator: ()) {
        uiView.detach()
    }
}

final class FBScrollProbeView: UIView {
    private struct Burst {
        var byUser: Bool
        var from: CGFloat
        var to: CGFloat
        var count: Int
    }

    private let log: FBScrollLog
    private weak var scrollView: UIScrollView?
    private var observations: [NSKeyValueObservation] = []
    private var chromeTimer: Timer?
    private var lastChrome = ""
    private var lastInset = UIEdgeInsets.zero

    private var offsetBurst: Burst?
    private var offsetSettle: DispatchWorkItem?
    private var heightBurst: Burst?
    private var heightSettle: DispatchWorkItem?

    init(log: FBScrollLog) {
        self.log = log
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            attach()
        }
    }

    func detach() {
        observations.forEach { $0.invalidate() }
        observations = []
        chromeTimer?.invalidate()
        chromeTimer = nil
    }

    // MARK: Attaching

    private func attach() {
        guard scrollView == nil else { return }
        var candidate = superview
        while let view = candidate, !(view is UIScrollView) {
            candidate = view.superview
        }
        guard let scrollView = candidate as? UIScrollView else {
            log.log("probe: found no UIScrollView above the probe")
            return
        }
        self.scrollView = scrollView
        lastInset = scrollView.adjustedContentInset
        let device = UIDevice.current
        log.log("probe: \(device.systemName) \(device.systemVersion) on \(Self.modelIdentifier), scale \(Self.format(window?.screen.scale ?? 0))")
        log.log("probe: attached to \(type(of: scrollView)) y=\(Self.format(scrollView.contentOffset.y)) inset=\(Self.format(scrollView.adjustedContentInset)) contentH=\(Self.format(scrollView.contentSize.height)) refreshControl=\(scrollView.refreshControl != nil)")

        observations = [
            scrollView.observe(\.contentOffset, options: [.old, .new]) { [weak self] view, change in
                MainActor.assumeIsolated {
                    self?.offsetChanged(view, from: change.oldValue, to: change.newValue)
                }
            },
            scrollView.observe(\.contentSize, options: [.old, .new]) { [weak self] view, change in
                MainActor.assumeIsolated {
                    self?.heightChanged(view, from: change.oldValue?.height, to: change.newValue?.height)
                }
            },
            scrollView.observe(\.contentInset, options: [.old, .new]) { [weak self] view, _ in
                MainActor.assumeIsolated {
                    self?.checkInsets(view)
                }
            },
        ]
        logChrome(reason: "attach", force: true)
        chromeTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let scrollView = self.scrollView else { return }
                self.checkInsets(scrollView)
                self.logChrome(reason: "changed")
            }
        }
    }

    // MARK: Offset

    private func offsetChanged(_ scrollView: UIScrollView, from old: CGPoint?, to new: CGPoint?) {
        guard let old, let new, abs(new.y - old.y) > 0.25 else { return }
        checkInsets(scrollView)
        let byUser = scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating
        if var burst = offsetBurst, burst.byUser == byUser {
            burst.to = new.y
            burst.count += 1
            offsetBurst = burst
        } else {
            flushOffsetBurst()
            offsetBurst = Burst(byUser: byUser, from: old.y, to: new.y, count: 1)
            if byUser {
                log.log("user scroll starts at y=\(Self.format(old.y))")
            } else {
                let rest = -scrollView.adjustedContentInset.top
                log.log("NOT USER offset \(Self.format(old.y)) -> \(Self.format(new.y)) (delta \(Self.format(new.y - old.y))), rest y=\(Self.format(rest)), contentH=\(Self.format(scrollView.contentSize.height)), refreshing=\(scrollView.refreshControl?.isRefreshing ?? false)\n\(Self.callers())")
            }
        }
        offsetSettle?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.flushOffsetBurst() }
        }
        offsetSettle = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    private func flushOffsetBurst() {
        guard let burst = offsetBurst else { return }
        offsetBurst = nil
        let kind = burst.byUser ? "user scroll" : "NOT USER scroll"
        log.log("\(kind) settled: y \(Self.format(burst.from)) -> \(Self.format(burst.to)) over \(burst.count) changes")
    }

    // MARK: Content height and insets

    private func heightChanged(_ scrollView: UIScrollView, from old: CGFloat?, to new: CGFloat?) {
        guard let old, let new, abs(new - old) > 0.5 else { return }
        if var burst = heightBurst {
            burst.to = new
            burst.count += 1
            heightBurst = burst
        } else {
            heightBurst = Burst(byUser: false, from: old, to: new, count: 1)
        }
        heightSettle?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.flushHeightBurst() }
        }
        heightSettle = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    private func flushHeightBurst() {
        guard let burst = heightBurst, let scrollView else { return }
        heightBurst = nil
        log.log("content height \(Self.format(burst.from)) -> \(Self.format(burst.to)) (delta \(Self.format(burst.to - burst.from)), \(burst.count) changes) at y=\(Self.format(scrollView.contentOffset.y))")
    }

    private func checkInsets(_ scrollView: UIScrollView) {
        let inset = scrollView.adjustedContentInset
        guard inset != lastInset else { return }
        log.log("inset \(Self.format(lastInset)) -> \(Self.format(inset)) at y=\(Self.format(scrollView.contentOffset.y))")
        lastInset = inset
        logChrome(reason: "inset changed", force: true)
    }

    // MARK: Chrome

    /// The tab's navigation bar, the status bar, and any navigation bar drawn on screen.
    private func logChrome(reason: String, force: Bool = false) {
        guard let window, let scrollView else { return }
        var parts: [String] = []
        if let navigation = owningViewController()?.navigationController {
            let bar = navigation.navigationBar
            parts.append("tabNavBarHidden=\(navigation.isNavigationBarHidden)")
            parts.append("tabNavBar=\(Self.format(bar.convert(bar.bounds, to: window))) alpha=\(Self.format(bar.alpha))")
        } else {
            parts.append("tabNavBar=none")
        }
        parts.append("safeTop=\(Self.format(window.safeAreaInsets.top))")
        parts.append("statusBar=\(Self.format(window.windowScene?.statusBarManager?.statusBarFrame ?? .zero))")
        parts.append("inset=\(Self.format(scrollView.adjustedContentInset))")
        parts.append("visibleNavBars=[\(Self.visibleNavigationBars(in: window).joined(separator: "; "))]")
        let line = parts.joined(separator: " ")
        guard force || line != lastChrome else { return }
        lastChrome = line
        log.log("chrome (\(reason)): \(line) y=\(Self.format(scrollView.contentOffset.y))")
    }

    private func owningViewController() -> UIViewController? {
        var responder: UIResponder? = self
        while let current = responder {
            if let controller = current as? UIViewController {
                return controller
            }
            responder = current.next
        }
        return nil
    }

    private static func visibleNavigationBars(in window: UIWindow) -> [String] {
        var found: [String] = []
        func visit(_ view: UIView) {
            if view.isHidden || view.alpha < 0.01 { return }
            if let bar = view as? UINavigationBar {
                let frame = bar.convert(bar.bounds, to: window)
                if frame.height > 0, frame.intersects(window.bounds) {
                    let top = bar.topItem?.title ?? ""
                    found.append("\(format(frame)) title=\"\(top)\"")
                }
                return
            }
            view.subviews.forEach(visit)
        }
        visit(window)
        return found
    }

    // MARK: Formatting

    private static func callers() -> String {
        Thread.callStackSymbols
            .dropFirst(4)
            .prefix(26)
            .map { line in
                // "12  UIKitCore  0x0000000184f1c2a8 -[UIScrollView setContentOffset:] + 120"
                let fields = line.split(separator: " ", omittingEmptySubsequences: true)
                guard fields.count > 3 else { return "    " + line }
                return "    " + fields[1] + " " + fields[3...].joined(separator: " ")
            }
            .joined(separator: "\n")
    }

    private static var modelIdentifier: String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated + " (simulator)"
        }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }

    static func format(_ value: CGFloat) -> String {
        String(format: "%.1f", Double(value))
    }

    static func format(_ insets: UIEdgeInsets) -> String {
        "(\(format(insets.top)),\(format(insets.left)),\(format(insets.bottom)),\(format(insets.right)))"
    }

    static func format(_ rect: CGRect) -> String {
        "(\(format(rect.minX)),\(format(rect.minY)) \(format(rect.width))x\(format(rect.height)))"
    }
}

#endif
