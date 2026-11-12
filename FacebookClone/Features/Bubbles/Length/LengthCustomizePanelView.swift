import SwiftUI
import UIKit

// Studio's Customize panel (docs/BUBBLES.md 7.9). Owner: length.
//
// The creator picks the length mode (only the formula's modes), its number, and the formula's
// tuning knobs (speed, difficulty, timer). Every change re-validates and re-playtests the level
// with the real runtime after a short pause; the level keeps the change only if it validates and
// the bots can play it. Choices land in StudioModel.length and .tuning, so a later "Tweak it"
// (Muse) keeps them.
//
// DEBUG: FB_STUDIO_SCROLL=customize (or FB_OPEN=feature:length/customize/<bubbleID>) scrolls the
// panel into view.

/// Runs Customize checks on its own headless runtime, one at a time.
@MainActor
@Observable
final class LengthCustomizer {
    static let shared = LengthCustomizer()

    enum Status: Equatable {
        case idle
        case checking
        /// Kept: the playtest line, and an optional heads-up from the playtest.
        case kept(String, note: String?)
        /// Not kept: why.
        case rejected(String)
    }

    var status: Status = .idle
    /// Scroll the panel into view when it next appears (FB_OPEN, the Bubble page's Customize).
    var scrollPending = false

    @ObservationIgnored private var runtime: StudioRuntime?
    @ObservationIgnored private var catalogLoaded = false
    @ObservationIgnored private var task: Task<Void, Never>?

    private init() {}

    func requestScroll() { scrollPending = true }

    private func headless() -> StudioRuntime {
        if let runtime { return runtime }
        let made = StudioRuntime.bundled()
        runtime = made
        return made
    }

    /// Loads the runtime catalog once, so knobs and suggestions come from the kits themselves.
    func loadCatalog() async {
        guard !catalogLoaded else { return }
        catalogLoaded = true
        if let catalog = try? await headless().catalog(), !catalog.isEmpty {
            BubbleLengthCatalog.shared.register(catalog: catalog.raw)
        }
    }

    func reset() {
        task?.cancel()
        status = .idle
    }

    /// Applies a length and tuning to the selected level: validate, playtest, then keep it.
    func apply(_ length: BubbleLength, tuning: [String: JSONValue], to model: StudioModel) {
        task?.cancel()
        let index = model.selectedLevel
        guard model.levels.indices.contains(index) else { return }
        let base = model.levels[index].manifest
        let spec = BubbleLengthCatalog.shared.spec(for: base.formula.rawValue)
        var manifest = base
        manifest.length = LengthStudio.completed(length, spec: spec)
        LengthStudio.apply(tuning: tuning, to: &manifest)
        manifest.version = base.version + 1
        status = .checking
        let runtime = headless()
        task = Task { [weak self] in
            let validation = await runtime.validate(manifest)
            guard !Task.isCancelled, let self else { return }
            guard validation.ok else {
                self.status = .rejected(validation.errors.first?.message ?? LengthCopy.didntValidate)
                return
            }
            let report = await runtime.playtest(manifest)
            guard !Task.isCancelled else { return }
            if let broken = report.flags.first(where: { $0.code == "runtime_error" }) {
                self.status = .rejected(broken.message)
                return
            }
            // The creator may have switched levels while the bots played.
            guard model.levels.indices.contains(index), model.levels[index].manifest.id == base.id else {
                self.status = .idle
                return
            }
            model.levels[index].manifest = manifest
            model.length = manifest.length
            model.tuning = tuning.isEmpty ? nil : tuning
            Haptics.light()
            self.status = .kept(LengthCopy.playtestLine(report), note: report.blocking.first?.message ?? report.flags.first?.message)
        }
    }
}

struct LengthCustomizePanelView: View {
    let model: StudioModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var mode: BubbleLengthMode = .endless
    @State private var numbers: [BubbleLengthMode: Int] = [:]
    @State private var positions: [String: Double] = [:]
    @State private var touched: Set<String> = []
    @State private var loadedID = ""
    @State private var isLoading = false
    @State private var pending: Task<Void, Never>?
    @State private var scrollNow = false

    private var customizer: LengthCustomizer { .shared }

    var body: some View {
        if let result = model.currentResult, let spec = BubbleLengthCatalog.shared.spec(for: result.manifest.formula.rawValue) {
            card(result: result, spec: spec)
                .id("customize")
                .background(LengthScrollIntoView(trigger: scrollNow))
                .task(id: result.manifest.id) {
                    await customizer.loadCatalog()
                    load(from: result.manifest)
                }
                .onAppear {
                    if customizer.scrollPending || DebugLaunch.value("FB_STUDIO_SCROLL") == "customize" {
                        customizer.scrollPending = false
                        model.focusTweak = false
                        scrollNow = true
                    }
                }
        }
    }

    // MARK: Card

    private func card(result: StudioResult, spec: BubbleLengthSpec) -> some View {
        let knobs = (BubbleLengthCatalog.shared.spec(for: result.manifest.formula.rawValue) ?? spec).knobs
            .filter { $0.concept(in: result.manifest) != nil }
        return VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(title: LengthCopy.customizeTitle, detail: LengthCopy.customizeDetail, symbol: "slider.horizontal.3")
            Picker(LengthCopy.lengthPicker, selection: modeBinding(spec)) {
                ForEach(spec.modes, id: \.self) { m in
                    Text(m.title).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(LengthCopy.lengthPicker)

            numberRow(spec)

            if !knobs.isEmpty {
                VStack(alignment: .leading, spacing: FBSpacing.s) {
                    ForEach(knobs) { knob in
                        knobRow(knob)
                    }
                }
                .padding(.top, 2)
            }

            statusRow
            sharedNote
        }
        .studioCard()
    }

    @ViewBuilder
    private func numberRow(_ spec: BubbleLengthSpec) -> some View {
        let draft = draftLength(spec)
        HStack(spacing: FBSpacing.m) {
            ZStack {
                Circle().fill(GameColor.accentGradient)
                Image(systemName: draft.symbol)
                    .font(.system(size: FBIconSize.small, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 32, height: 32)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(draft.label)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .contentTransition(.numericText())
                Text(LengthCopy.modeExplainer(draft.mode))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            if draft.mode != .endless, let value = draft.number, let range = BubbleLength.range(for: draft.mode) {
                Stepper {
                    Text(draft.mode.numberTitle)
                } onIncrement: {
                    setNumber(min(range.upperBound, value + BubbleLength.step(for: draft.mode, at: value)), spec: spec)
                } onDecrement: {
                    setNumber(max(range.lowerBound, value - BubbleLength.step(for: draft.mode, at: value - 1)), spec: spec)
                }
                .labelsHidden()
                .fixedSize()
                .accessibilityLabel(draft.mode.numberTitle)
                .accessibilityValue(draft.label)
            }
        }
    }

    private func knobRow(_ knob: BubbleLengthKnob) -> some View {
        let position = positions[knob.id] ?? 0.5
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(knob.label)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer(minLength: 8)
                Text(LengthCopy.knobValue(knob, position: position))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .monospacedDigit()
            }
            Slider(value: knobBinding(knob), in: 0...1, step: 0.1) {
                Text(knob.label)
            } minimumValueLabel: {
                Text(LengthCopy.knobEnds(knob).low)
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
            } maximumValueLabel: {
                Text(LengthCopy.knobEnds(knob).high)
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
            }
            .tint(LengthTint.purple)
            .accessibilityValue(LengthCopy.knobValue(knob, position: position))
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            switch customizer.status {
            case .idle:
                Image(systemName: "checkmark.shield")
                    .foregroundStyle(FBColor.secondaryText)
                Text(LengthCopy.idle)
                    .foregroundStyle(FBColor.secondaryText)
            case .checking:
                ProgressView()
                    .controlSize(.mini)
                Text(LengthCopy.checking)
                    .foregroundStyle(FBColor.secondaryText)
            case .kept(let line, let note):
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(StudioGlow.fixed)
                VStack(alignment: .leading, spacing: 2) {
                    Text(line)
                        .foregroundStyle(FBColor.primaryText)
                    if let note {
                        Text(note)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
            case .rejected(let why):
                Image(systemName: "arrow.uturn.backward.circle.fill")
                    .foregroundStyle(StudioGlow.issue)
                Text(LengthCopy.rejected(why))
                    .foregroundStyle(FBColor.primaryText)
            }
        }
        .font(.fbMeta)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: customizer.status)
    }

    private var sharedNote: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "person.2.fill")
                .font(.system(size: FBIconSize.xs, weight: .semibold))
                .foregroundStyle(LengthTint.blue)
            Text(LengthCopy.sharedPromise)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(FBSpacing.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.tintedBlueBackground.opacity(0.7), in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: State

    private func draftLength(_ spec: BubbleLengthSpec) -> BubbleLength {
        var out = spec.suggested(mode)
        if mode != .endless, let n = numbers[mode] { out.number = BubbleLength.clamp(n, mode: mode) }
        return out
    }

    private func modeBinding(_ spec: BubbleLengthSpec) -> Binding<BubbleLengthMode> {
        Binding(get: { mode }, set: { newValue in
            guard newValue != mode else { return }
            Haptics.selection()
            mode = newValue
            if numbers[newValue] == nil, let n = spec.suggested(newValue).number { numbers[newValue] = n }
            schedule(spec)
        })
    }

    private func setNumber(_ value: Int, spec: BubbleLengthSpec) {
        Haptics.selection()
        withAnimation(reduceMotion ? nil : .snappy) { numbers[mode] = value }
        schedule(spec)
    }

    private func knobBinding(_ knob: BubbleLengthKnob) -> Binding<Double> {
        Binding(get: { positions[knob.id] ?? 0.5 }, set: { newValue in
            guard abs((positions[knob.id] ?? 0.5) - newValue) > 0.001 else { return }
            positions[knob.id] = newValue
            touched.insert(knob.id)
            if let spec = model.currentResult.flatMap({ BubbleLengthCatalog.shared.spec(for: $0.manifest.formula.rawValue) }) {
                schedule(spec)
            }
        })
    }

    /// Re-checks after a short pause, so a slider drag or a few stepper taps make one playtest.
    private func schedule(_ spec: BubbleLengthSpec) {
        guard !isLoading else { return }
        pending?.cancel()
        let length = draftLength(spec)
        let knobs = spec.knobs
        var tuning: [String: JSONValue] = [:]
        for knob in knobs where touched.contains(knob.id) {
            tuning[knob.id] = .number(knob.value(at: positions[knob.id] ?? 0.5))
        }
        // Keep knobs tuned earlier in this Studio session.
        for (key, value) in model.tuning ?? [:] where tuning[key] == nil { tuning[key] = value }
        pending = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 550_000_000)
            guard !Task.isCancelled else { return }
            customizer.apply(length, tuning: tuning, to: model)
        }
    }

    /// Starts from the level as it is: its length (or what it plays like) and its knob values.
    private func load(from manifest: BubbleManifest) {
        guard loadedID != manifest.id else { return }
        isLoading = true
        defer { isLoading = false }
        loadedID = manifest.id
        customizer.reset()
        guard let spec = BubbleLengthCatalog.shared.spec(for: manifest.formula.rawValue) else { return }
        let current = [model.length, manifest.length, BubbleLength.effective(for: manifest), spec.defaultLength]
            .compactMap { $0 }
            .first { spec.supports($0.mode) } ?? spec.suggested(spec.modes[0])
        mode = current.mode
        var nums: [BubbleLengthMode: Int] = [:]
        for m in spec.modes where m != .endless {
            if let n = spec.suggested(m).number { nums[m] = n }
        }
        if let n = current.number { nums[current.mode] = n }
        numbers = nums
        var pos: [String: Double] = [:]
        for knob in spec.knobs {
            guard let concept = knob.concept(in: manifest) else { continue }
            let fallback = BubbleLengthCatalog.shared.conceptDefault("\(concept).\(knob.param)")
            if let value = LengthStudio.value(of: knob, in: manifest, fallback: fallback) {
                pos[knob.id] = (knob.position(of: value) * 10).rounded() / 10
            }
        }
        positions = pos
        touched = []
    }
}

/// Scrolls the enclosing scroll view so this view is visible (the Customize panel on launch).
private struct LengthScrollIntoView: UIViewRepresentable {
    let trigger: Bool

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        guard trigger, !context.coordinator.done else { return }
        context.coordinator.done = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            // The tweak field may have taken focus on open; the panel is what this launch is for.
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            var next = view.superview
            while let current = next, !(current is UIScrollView) { next = current.superview }
            guard let scroll = next as? UIScrollView else { return }
            let rect = view.convert(view.bounds, to: scroll)
            scroll.scrollRectToVisible(rect.insetBy(dx: 0, dy: -16), animated: true)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var done = false
    }
}
