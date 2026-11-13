import Foundation

/// The headless runtime on its own serial queue (`BubbleJSRuntime` isn't thread-safe), for the
/// length catalog and headless runs. Everything here runs off the main thread.
final class BubbleRuntimeWorker {
    /// Internal (not private) so `BubbleOpponentRuns.swift` can queue one-off bot runs here too.
    let queue = DispatchQueue(label: "com.karthiksing05.fbclone.bubbles.runtime", qos: .utility)
    /// Touched only on `queue`.
    private var runtime: BubbleJSRuntime?
    private var didFailToLoad = false

    /// Longest headless run, in ticks (60 per second).
    static let botMaxTicks = 60 * 60

    /// Call on `queue` only.
    func loadRuntime() -> BubbleJSRuntime? {
        if let runtime { return runtime }
        guard !didFailToLoad else { return nil }
        do {
            runtime = try BubbleJSRuntime(bundle: .main)
        } catch {
            didFailToLoad = true
        }
        return runtime
    }

    /// Identifies this build of the runtime scripts (name, size and date of every `.js` file), so
    /// cached poster frames are never reused across runtime builds.
    static func runtimeFingerprint() -> String {
        let urls = (Bundle.main.urls(forResourcesWithExtension: "js", subdirectory: nil) ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var parts: [String] = []
        for url in urls {
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
            let date = (attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            parts.append("\(url.lastPathComponent):\(size):\(Int(date))")
        }
        return String(SeededGenerator.stableHash(parts.joined(separator: "|")), radix: 36)
    }
}
