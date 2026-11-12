import SwiftUI

// "Muse at work": the Build step's storyboard. Every beat lights up only when Studio receives a
// real event for it (`StudioEvent`, or `MicrogameComposer.Event` through `StudioMicrogameBridge`).
// Between events the current beat breathes; it never advances on its own.

/// One beat of the storyboard.
enum ShowcaseBeat: String, CaseIterable, Identifiable {
    case read
    case draft
    case write
    case check
    case fix
    case playtest
    case cover
    case ready

    var id: String { rawValue }

    var title: String {
        switch self {
        case .read: return "Read"
        case .draft: return "Draft"
        case .write: return "Write"
        case .check: return "Check"
        case .fix: return "Fix"
        case .playtest: return "Playtest"
        case .cover: return "Cover"
        case .ready: return "Ready"
        }
    }

    var symbol: String {
        switch self {
        case .read: return "text.magnifyingglass"
        case .draft: return "square.stack.3d.up"
        case .write: return "text.word.spacing"
        case .check: return "checkmark.shield"
        case .fix: return "wrench.and.screwdriver"
        case .playtest: return "gamecontroller"
        case .cover: return "paintpalette"
        case .ready: return "sparkles"
        }
    }

    /// The beat a Studio step belongs to.
    init?(step: StudioStep) {
        switch step {
        case .understand, .brief: self = .read
        case .compose, .glue: self = .draft
        case .content, .polish: self = .write
        case .validate: self = .check
        case .repair: self = .fix
        case .playtest: self = .playtest
        case .cover: self = .cover
        case .done: self = .ready
        case .failed: return nil
        }
    }

    /// The beats a run usually goes through, in order. "Fix" only joins when a real repair
    /// happens, so the plan never promises a problem.
    static func expected(microgame: Bool, kind: StudioComposeKind) -> [ShowcaseBeat] {
        if microgame { return [.draft, .check, .playtest, .ready] }
        switch kind {
        case .create, .nextLevel: return [.read, .draft, .write, .check, .playtest, .cover, .ready]
        case .tweak: return [.read, .draft, .check, .playtest, .ready]
        }
    }
}

/// The storyboard strip: Draft → Check → Fix → Playtest → Ready (or the formula pipeline's beats),
/// lit by real events.
struct ShowcaseBuildStage: View {
    let events: [StudioEvent]
    let isMicrogame: Bool
    let kind: StudioComposeKind
    let isWorking: Bool
    let failed: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    private struct Item: Identifiable {
        let beat: ShowcaseBeat
        let count: Int
        let state: State
        var id: String { beat.id }
    }

    enum State {
        case done
        case active
        case pending
        case failed
    }

    private static let breath = GameMotion.loop(period: 2.4)

    var body: some View {
        let items = self.items
        ScrollView(.horizontal, showsIndicators: false) {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion || !isWorking)) { context in
                let wave = reduceMotion || !isWorking ? 0.5 : Self.breath.wave(at: context.date)
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 {
                            connector(lit: item.state != .pending)
                        }
                        beatView(item, wave: wave)
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.vertical, 4)
            }
        }
        .animation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion), value: items.map(\.beat))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Muse at work")
        .accessibilityValue(accessibilitySummary(items))
    }

    // MARK: Items

    private var items: [Item] {
        var counts: [ShowcaseBeat: Int] = [:]
        var reached: [ShowcaseBeat] = []
        for event in events {
            guard let beat = ShowcaseBeat(step: event.step) else { continue }
            counts[beat, default: 0] += 1
            if !reached.contains(beat) { reached.append(beat) }
        }
        let current = events.last.flatMap { ShowcaseBeat(step: $0.step) }
        let finished = !isWorking

        // The expected plan, plus any beat that really happened (in pipeline order). Once the run
        // is over, beats that never happened drop out.
        var beats = ShowcaseBeat.expected(microgame: isMicrogame, kind: kind)
        for beat in reached where !beats.contains(beat) { beats.append(beat) }
        beats.sort { ShowcaseBeat.allCases.firstIndex(of: $0)! < ShowcaseBeat.allCases.firstIndex(of: $1)! }
        if finished { beats = beats.filter { reached.contains($0) } }

        return beats.map { beat in
            let state: State
            if failed && beat == current {
                state = .failed
            } else if isWorking && beat == current {
                state = .active
            } else if reached.contains(beat) {
                state = .done
            } else {
                state = .pending
            }
            return Item(beat: beat, count: counts[beat] ?? 0, state: state)
        }
    }

    // MARK: Pieces

    private func beatView(_ item: Item, wave: Double) -> some View {
        let size: CGFloat = typeSize.isAccessibilitySize ? 44 : 36
        return VStack(spacing: 4) {
            ZStack {
                switch item.state {
                case .active:
                    Circle()
                        .fill(GameColor.periwinkle.opacity(0.35))
                        .scaleEffect(1.1 + 0.25 * wave)
                        .opacity(0.4 + 0.5 * wave)
                    Circle().fill(GameColor.gradient)
                    Circle().strokeBorder(GameColor.rim, lineWidth: 2)
                case .done:
                    Circle().fill(GameColor.gradient)
                case .pending:
                    Circle().strokeBorder(GameColor.skeleton, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                case .failed:
                    Circle().fill(StudioGlow.issue.opacity(0.25))
                    Circle().strokeBorder(StudioGlow.issue.opacity(0.7), lineWidth: 1.5)
                }
                Image(systemName: item.state == .failed ? "exclamationmark.triangle" : item.beat.symbol)
                    .font(.system(size: size * 0.4, weight: .semibold)) // Glyph sized to its circle
                    .foregroundStyle(iconColor(item.state))
            }
            .frame(width: size, height: size)
            .overlay(alignment: .topTrailing) {
                if item.count > 1 && (item.beat == .fix || item.beat == .playtest || item.beat == .check) {
                    Text("×\(item.count)")
                        .font(.fbMicroEmphasized)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(GameColor.deepFill, in: Capsule())
                        .offset(x: 8, y: -4)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            Text(item.beat.title)
                .font(item.state == .active ? .fbCaptionEmphasized : .fbCaption)
                .foregroundStyle(item.state == .pending ? FBColor.tertiaryText : FBColor.primaryText)
                .lineLimit(1)
                .fixedSize()
        }
        .frame(minWidth: size + 8)
        .transition(.scale(scale: 0.6).combined(with: .opacity))
    }

    private func connector(lit: Bool) -> some View {
        Capsule()
            .fill(lit ? AnyShapeStyle(GameColor.gradient) : AnyShapeStyle(GameColor.skeleton))
            .frame(width: 14, height: 2)
            .padding(.top, (typeSize.isAccessibilitySize ? 44 : 36) / 2 - 1)
    }

    private func iconColor(_ state: State) -> Color {
        switch state {
        case .active, .done: return GameColor.ink
        case .pending: return FBColor.tertiaryText
        case .failed: return StudioGlow.issue
        }
    }

    private func accessibilitySummary(_ items: [Item]) -> String {
        let done = items.filter { $0.state == .done }.map(\.beat.title)
        var parts: [String] = []
        if let active = items.first(where: { $0.state == .active }) { parts.append("Now: \(active.beat.title)") }
        if let failed = items.first(where: { $0.state == .failed }) { parts.append("Stopped at \(failed.beat.title)") }
        if !done.isEmpty { parts.append("Done: " + done.joined(separator: ", ")) }
        if let fixes = items.first(where: { $0.beat == .fix }), fixes.count > 0 {
            parts.append("\(fixes.count) fix \(fixes.count == 1 ? "round" : "rounds")")
        }
        return parts.joined(separator: ". ")
    }
}

// MARK: - Bot lanes

/// The playtest, one lane per bot: how long each run lasted (on a 0–150 s bot-time scale), how it
/// ended and what it scored. Real runs from the playtest report; nothing is simulated here.
struct ShowcaseBotLanes: View {
    let lanes: [MakeRecord.Lane]
    /// Lanes grow out once when they appear (they show results that are already in).
    var animatesIn = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var grown = false

    private static let scale = StudioPlaytest.maxSeconds

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Bot time")
                Spacer()
                Text("\(Int(Self.scale)) s")
            }
            .font(.fbMicro)
            .foregroundStyle(FBColor.tertiaryText)
            .accessibilityHidden(true)
            ForEach(Array(lanes.enumerated()), id: \.offset) { index, lane in
                laneRow(lane, index: index)
            }
        }
        .padding(10)
        .background(GameColor.wash, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .task {
            guard animatesIn, !reduceMotion else {
                grown = true
                return
            }
            withAnimation(.easeOut(duration: 0.6)) { grown = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Playtest by \(lanes.count) bots")
        .accessibilityValue(lanes.map(Self.describe).joined(separator: ". "))
    }

    @ViewBuilder
    private func laneRow(_ lane: MakeRecord.Lane, index: Int) -> some View {
        let fraction = min(1, max(0.03, lane.seconds / Self.scale))
        if typeSize.isAccessibilitySize {
            Text(Self.describe(lane))
                .font(.fbMeta)
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            HStack(spacing: 8) {
                Text(Self.shortName(lane.bot))
                    .font(.fbMicroEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(width: 58, alignment: .leading)
                    .lineLimit(1)
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(GameColor.skeleton.opacity(0.6)).frame(height: 4)
                        Capsule()
                            .fill(GameColor.gradient)
                            .frame(width: max(4, proxy.size.width * fraction * (grown ? 1 : 0)), height: 6)
                            .animation(reduceMotion ? nil : .easeOut(duration: 0.6).delay(Double(index) * 0.08), value: grown)
                    }
                    .frame(maxHeight: .infinity)
                }
                .frame(height: 14)
                Image(systemName: Self.symbol(lane.outcome))
                    .font(.system(size: 11, weight: .bold)) // Tiny outcome glyph next to a 14 pt lane
                    .foregroundStyle(lane.outcome == "success" ? StudioGlow.fixed : FBColor.secondaryText)
                    .frame(width: 14)
                Text("\(lane.score)")
                    .font(.fbMicroEmphasized)
                    .monospacedDigit()
                    .foregroundStyle(FBColor.primaryText)
                    .frame(minWidth: 24, alignment: .trailing)
            }
        }
    }

    static func shortName(_ bot: String) -> String {
        if bot.hasPrefix("new") { return "New" }
        if bot.hasPrefix("pro") { return "Pro" }
        if bot.hasPrefix("regular") { return "Regular" }
        return bot.capitalized
    }

    static func symbol(_ outcome: String) -> String {
        switch outcome {
        case "success": return "star.fill"
        case "fail": return "xmark"
        case "timeout": return "clock"
        default: return "exclamationmark"
        }
    }

    static func describe(_ lane: MakeRecord.Lane) -> String {
        let outcome: String
        switch lane.outcome {
        case "success": outcome = "cleared it"
        case "fail": outcome = "lost"
        case "timeout": outcome = "still going at the time limit"
        default: outcome = "couldn't play"
        }
        return "\(lane.bot.prefix(1).uppercased() + lane.bot.dropFirst()) bot \(outcome) after \(Int(lane.seconds.rounded())) s, score \(lane.score)"
    }
}
