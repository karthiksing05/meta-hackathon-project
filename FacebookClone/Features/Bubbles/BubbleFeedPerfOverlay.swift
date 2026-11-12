import SwiftUI

/// DEBUG perf overlay for the Bubbles tab (`FB_PERF=1`): the runtime build, the last warm
/// switch measured in Swift, and the host's own `perf` numbers (prepare, activate, first frame,
/// fps, heap). See docs/BUBBLES.md, 4.8, for the targets.
struct BubbleFeedPerfOverlay: View {
    private var perf: BubbleRuntimePerf { BubbleRuntimePerf.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("runtime \(perf.runtimeVersion ?? "loading")")
            if let last = perf.recentSwitches.last {
                Text("switch \(Self.ms(last.totalMs)) \(kind(last)) · avg \(Self.ms(averageWarm))")
                Text("prepare \(Self.ms(last.prepareMs)) · activate \(Self.ms(last.activateMs))")
            } else {
                Text("switch -")
            }
            if let host = perf.lastPerf {
                Text("host: prepare \(Self.ms(host.prepareMs)) · activate \(Self.ms(host.activateMs)) · frame \(Self.ms(host.firstFrameMs))")
                Text("fps \(host.fps.map { String(format: "%.0f", $0) } ?? "-") · heap \(host.heapMB.map { String(format: "%.1f MB", $0) } ?? "-")")
            }
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced)) // DEBUG overlay text
        .foregroundStyle(Color.green)
        .padding(8)
        .background(Color.black.opacity(0.66), in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
        .accessibilityHidden(true)
    }

    private var averageWarm: Double? {
        let warm = perf.recentSwitches.filter { $0.wasPrepared || $0.usedBoot }
        guard !warm.isEmpty else { return nil }
        return warm.map(\.totalMs).reduce(0, +) / Double(warm.count)
    }

    private func kind(_ entry: BubbleRuntimePerf.Switch) -> String {
        entry.usedBoot ? "boot" : (entry.wasPrepared ? "warm" : "cold")
    }

    private static func ms(_ value: Double?) -> String {
        value.map { String(format: "%.1f ms", $0) } ?? "-"
    }
}
