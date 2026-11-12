import SwiftUI

// The live agent timeline: one row per `StudioEvent`, with the Muse model that did the step,
// the concepts it picked and the problems it found and fixed.

enum StudioRowState {
    case done
    case active
    case failed
}

enum StudioFormat {
    /// Step times: "0.8s", "12s", "1:04".
    static func elapsed(_ seconds: TimeInterval) -> String {
        let value = max(0, seconds)
        if value < 10 { return String(format: "%.1fs", value) }
        if value < 60 { return "\(Int(value.rounded()))s" }
        return clock(value)
    }

    /// A running clock: "0:23".
    static func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }
}

// MARK: - Row

struct StudioTimelineRow: View {
    let event: StudioEvent
    let state: StudioRowState
    let showsConnector: Bool

    var body: some View {
        HStack(alignment: .top, spacing: FBSpacing.m) {
            StudioStepIcon(step: event.step, state: state)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: FBSpacing.s) {
                    Text(event.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Text(StudioFormat.elapsed(event.elapsed))
                        .font(.fbMicro)
                        .monospacedDigit()
                        .foregroundStyle(FBColor.tertiaryText)
                }
                if let detail = event.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // Offline steps aren't labeled one by one; the header says "Offline composer".
                if let info = StudioModelInfo(model: event.model, isOffline: false, step: event.step) {
                    StudioModelChip(info: info)
                }
                if let concepts = event.concepts, !concepts.isEmpty {
                    StudioConceptCloud(concepts: concepts)
                }
                if let issues = event.issues, !issues.isEmpty {
                    StudioIssueList(issues: issues, isFixed: event.step == .repair)
                }
                if let used = event.sourcesUsed, !used.isEmpty {
                    StudioSourcesUsedLabel(names: used)
                }
            }
            .padding(.top, 5)
        }
        .padding(.horizontal, FBSpacing.m)
        .padding(.vertical, FBSpacing.s)
        .background {
            if state == .active {
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                    .fill(StudioGlow.cardFill)
                    .overlay {
                        RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                            .strokeBorder(BubbleGlow.iridescent, lineWidth: 1)
                            .opacity(0.8)
                    }
                    .shadow(color: BubbleGlow.pink.opacity(0.25), radius: 12, y: 4)
            }
        }
        .background(alignment: .topLeading) {
            if showsConnector {
                Capsule()
                    .fill(StudioGlow.track)
                    .frame(width: 2)
                    .padding(.top, 44)
                    .padding(.bottom, -6)
                    .padding(.leading, FBSpacing.m + 15)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        let status: String
        switch state {
        case .done: status = "Done"
        case .active: status = "In progress"
        case .failed: status = "Problem"
        }
        return [event.title, event.detail, status].compactMap { $0 }.joined(separator: ". ")
    }
}

/// The step's symbol in a circle. The current step glows and its rim turns.
struct StudioStepIcon: View {
    let step: StudioStep
    let state: StudioRowState

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        ZStack {
            switch state {
            case .active:
                Circle().fill(BubbleGlow.brandGradient)
                Circle()
                    .strokeBorder(BubbleGlow.iridescent, lineWidth: 2)
                    .rotationEffect(.degrees(pulse ? 360 : 0))
            case .done:
                Circle().fill(StudioGlow.cardFill)
                Circle().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75)
            case .failed:
                Circle().fill(StudioGlow.issue.opacity(0.25))
                Circle().strokeBorder(StudioGlow.issue.opacity(0.6), lineWidth: 1)
            }
            Image(systemName: state == .failed ? StudioStep.failed.symbol : step.symbol)
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(iconColor)
        }
        .frame(width: 32, height: 32)
        .overlay(alignment: .bottomTrailing) {
            if state == .done && step != .done {
                Image(systemName: "checkmark")
                    .font(.system(size: 7, weight: .bold)) // Tiny glyph inside a 14 pt badge
                    .foregroundStyle(.white)
                    .frame(width: 14, height: 14)
                    .background(StudioGlow.fixed, in: Circle())
                    .overlay(Circle().strokeBorder(StudioGlow.base, lineWidth: 1.5))
                    .offset(x: 3, y: 3)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .scaleEffect(state == .active && pulse && !reduceMotion ? 1.06 : 1)
        .shadow(color: BubbleGlow.pink.opacity(state == .active ? (pulse ? 0.7 : 0.3) : 0), radius: 10)
        .onAppear(perform: startPulse)
        .onChange(of: state) { startPulse() }
        .animation(.spring(response: 0.35, dampingFraction: 0.7), value: state)
        .accessibilityHidden(true)
    }

    private var iconColor: Color {
        switch state {
        case .active: return BubbleGlow.ink
        case .done: return step == .done ? StudioGlow.fixed : FBColor.secondaryText
        case .failed: return StudioGlow.issue
        }
    }

    private func startPulse() {
        guard state == .active, !reduceMotion else {
            pulse = false
            return
        }
        pulse = false
        withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
            pulse = true
        }
    }
}

// MARK: - Model chip

/// The Muse model behind a step, with its own tint.
struct StudioModelInfo {
    let name: String
    let tint: Color
    let symbol: String

    init(name: String, tint: Color, symbol: String) {
        self.name = name
        self.tint = tint
        self.symbol = symbol
    }

    /// Nil when there is nothing worth labeling.
    init?(model: String?, isOffline: Bool, step: StudioStep? = nil) {
        let id = (model ?? "").lowercased()
        if id.contains("wonder") {
            self.init(name: "Wonder", tint: StudioGlow.wonder, symbol: "sparkles")
        } else if id.contains("ember") {
            self.init(name: "Ember", tint: StudioGlow.ember, symbol: "flame")
        } else if id.contains("image") {
            self.init(name: "Image", tint: StudioGlow.image, symbol: "paintbrush.pointed")
        } else if id.contains("spark") {
            self.init(name: "Spark", tint: StudioGlow.spark, symbol: "bolt")
        } else if let model, !model.isEmpty {
            self.init(name: model, tint: StudioGlow.device, symbol: "cpu")
        } else if step == .validate || step == .playtest {
            self.init(name: "On device", tint: StudioGlow.device, symbol: "iphone")
        } else if isOffline {
            self.init(name: "Offline composer", tint: StudioGlow.offline, symbol: "bolt.horizontal.circle")
        } else {
            return nil
        }
    }
}

struct StudioModelChip: View {
    let info: StudioModelInfo

    init(info: StudioModelInfo) {
        self.info = info
    }

    /// A chip for a Muse model id such as "muse-wonder-1.0". Draws nothing when unknown.
    init?(model: String?, isOffline: Bool) {
        guard let info = StudioModelInfo(model: model, isOffline: isOffline) else { return nil }
        self.info = info
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: info.symbol)
                .font(.system(size: 9, weight: .bold)) // Tiny glyph inside an 11 pt chip
            Text(info.name)
                .font(.fbMicroEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(FBColor.primaryText)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(info.tint.opacity(0.28), in: Capsule())
        .overlay(Capsule().strokeBorder(info.tint.opacity(0.7), lineWidth: 0.75))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Model: \(info.name)")
    }
}

// MARK: - Concepts

/// A concept id like `behavior.spawn_stream`, made readable.
struct StudioConceptInfo {
    let id: String

    var kind: String {
        id.split(separator: ".").first.map(String.init) ?? ""
    }

    var name: String {
        let tail = id.split(separator: ".", maxSplits: 1).dropFirst().first.map(String.init) ?? id
        let words = tail.replacingOccurrences(of: "_", with: " ")
        guard let first = words.first else { return words }
        return first.uppercased() + words.dropFirst()
    }

    var symbol: String {
        switch kind {
        case "input": return "hand.tap"
        case "space": return "square.dashed"
        case "entity": return "smallcircle.filled.circle"
        case "behavior": return "wind"
        case "rule": return "checklist"
        case "feedback": return "waveform"
        case "score": return "number"
        case "flow": return "arrow.triangle.2.circlepath"
        case "content": return "text.quote"
        case "share": return "square.and.arrow.up"
        case "social": return "person.2"
        case "feel": return "sparkles"
        case "glue": return "chevron.left.forwardslash.chevron.right"
        default: return "puzzlepiece"
        }
    }

    var tint: Color {
        let accents = BubbleGlow.lilacHaze.accents + BubbleGlow.peachFizz.accents
        let kinds = ["input", "space", "entity", "behavior", "rule", "feedback", "score", "flow", "content", "share", "social", "feel"]
        let index = kinds.firstIndex(of: kind) ?? 7
        return accents[index % accents.count]
    }
}

struct StudioConceptChip: View {
    let concept: StudioConceptInfo

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: concept.symbol)
                .font(.system(size: 10, weight: .semibold)) // Tiny glyph inside a 12 pt chip
            Text(concept.name)
                .font(.fbCaptionEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(FBColor.primaryText)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(concept.tint.opacity(0.3), in: Capsule())
        .overlay(Capsule().strokeBorder(concept.tint.opacity(0.75), lineWidth: 0.75))
        .accessibilityLabel(concept.name)
    }
}

/// Concept chips that pop in one by one as they're chosen.
struct StudioConceptCloud: View {
    let concepts: [String]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = 0

    var body: some View {
        FlowLayout(spacing: 6, lineSpacing: 6) {
            ForEach(Array(concepts.prefix(shown).enumerated()), id: \.offset) { _, concept in
                StudioConceptChip(concept: StudioConceptInfo(id: concept))
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .task(id: concepts) {
            guard !reduceMotion else {
                shown = concepts.count
                return
            }
            while shown < concepts.count {
                try? await Task.sleep(nanoseconds: 90_000_000)
                if Task.isCancelled { break }
                withAnimation(.spring(response: 0.35, dampingFraction: 0.65)) {
                    shown += 1
                }
            }
            shown = concepts.count
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Concepts: " + concepts.map { StudioConceptInfo(id: $0).name }.joined(separator: ", "))
    }
}

// MARK: - Sources

/// "From Maya, Diego and Priya's posts": the opted-in posts Muse actually used.
struct StudioSourcesUsedLabel: View {
    let names: [String]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "text.bubble.fill")
                .font(.system(size: FBIconSize.xs, weight: .semibold))
                .foregroundStyle(BubbleGlow.pink)
            Text(Self.text(for: names))
                .font(.fbCaptionEmphasized)
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(BubbleGlow.pink.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(BubbleGlow.pink.opacity(0.4), lineWidth: 0.75))
        .accessibilityElement(children: .combine)
    }

    static func text(for names: [String]) -> String {
        let shown = Array(names.prefix(3))
        let list: String
        switch shown.count {
        case 0: return "No posts used"
        case 1: list = shown[0]
        case 2: list = "\(shown[0]) and \(shown[1])"
        default: list = "\(shown[0]), \(shown[1]) and \(shown[2])"
        }
        let more = names.count > 3 ? " and \(names.count - 3) more" : ""
        return "From \(list)'s posts\(more)"
    }
}

// MARK: - Issues

/// Validation problems (amber) or the fixes for them (green).
struct StudioIssueList: View {
    let issues: [String]
    let isFixed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(issues.enumerated()), id: \.offset) { _, issue in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: isFixed ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: FBIconSize.xs, weight: .semibold))
                        .foregroundStyle(isFixed ? StudioGlow.fixed : StudioGlow.issue)
                    Text(issue)
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((isFixed ? StudioGlow.fixed : StudioGlow.issue).opacity(0.13), in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                .strokeBorder((isFixed ? StudioGlow.fixed : StudioGlow.issue).opacity(0.35), lineWidth: 0.75)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel((isFixed ? "Fixed: " : "Problems: ") + issues.joined(separator: ". "))
    }
}
