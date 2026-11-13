import SwiftUI

/// One moment of a game's sound set: what it is, which sound it plays, and a tap to hear it.
struct SoundPreviewRow: View {
    let moment: SoundMoment
    /// The sound the moment plays, already scaled by the game's volume. Nil when it's silent.
    let tone: SoundTone?
    /// The preset's name ("chirp"), "custom", or nil when silent.
    let soundName: String?
    /// The game picked this moment's sound itself instead of taking the set's.
    var isCustom = false

    @State private var bump = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: play) {
            HStack(spacing: FBSpacing.m) {
                Image(systemName: moment.symbol)
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(GameColor.ink)
                    .frame(width: 36, height: 36)
                    .background(GameColor.gradient, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(moment.title)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        if isCustom {
                            Text("Custom")
                                .font(.fbMicroEmphasized)
                                .foregroundStyle(GameColor.deep)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(GameColor.wash, in: Capsule())
                        }
                    }
                    Text(moment.detail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                if let tone {
                    SoundWaveGlyph(tone: tone)
                        .frame(width: 44, height: 22)
                        .accessibilityHidden(true)
                }
                Image(systemName: tone == nil ? "speaker.slash" : "play.circle.fill")
                    .font(.system(size: 26, weight: .regular))
                    .foregroundStyle(tone == nil ? FBColor.tertiaryText : GameColor.deep)
                    .scaleEffect(bump % 2 == 1 && !reduceMotion ? 1.18 : 1)
                    .animation(GameMotion.tap, value: bump)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, FBSpacing.s)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(tone == nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(moment.title). \(soundName.map { "\($0.capitalized) sound" } ?? "Silent")")
        .accessibilityHint(tone == nil ? "" : "Plays the sound")
        .accessibilityAddTraits(.playsSound)
    }

    private func play() {
        guard let tone else { return }
        GameSound.preview(tone)
        bump += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { bump += 1 }
    }
}

/// A small static picture of a sound, drawn from its recipe (not from audio): one bar per note,
/// height by pitch, width by length, with a curve for a slide.
struct SoundWaveGlyph: View {
    let tone: SoundTone

    var body: some View {
        Canvas { context, size in
            let notes = tone.frequencies
            guard !notes.isEmpty else { return }
            func y(_ hz: Double) -> CGFloat {
                // 100 Hz at the bottom, 3.2 kHz at the top, on a log scale.
                let t = (log2(max(100, min(3200, hz))) - log2(100)) / 5
                return size.height * (1 - CGFloat(t)) * 0.8 + size.height * 0.1
            }
            let step = size.width / CGFloat(notes.count)
            var path = Path()
            for (index, hz) in notes.enumerated() {
                let x0 = CGFloat(index) * step + 1
                let x1 = x0 + step - 2
                let start = y(hz)
                path.move(to: CGPoint(x: x0, y: start))
                if index == notes.count - 1, let slide = tone.slide {
                    path.addQuadCurve(to: CGPoint(x: x1, y: y(slide)), control: CGPoint(x: (x0 + x1) / 2, y: start))
                } else {
                    path.addLine(to: CGPoint(x: x1, y: start))
                }
            }
            context.stroke(path, with: .linearGradient(
                Gradient(colors: [GameColor.deepFill, GameColor.violet]),
                startPoint: .zero, endPoint: CGPoint(x: size.width, y: 0)
            ), style: StrokeStyle(lineWidth: 3, lineCap: .round))
        }
    }
}

#Preview("Rows") {
    let section = GameSoundSection(setName: "soft")
    return VStack(spacing: 0) {
        ForEach(SoundMoment.allCases) { moment in
            SoundPreviewRow(moment: moment, tone: section.tone(for: moment), soundName: section.soundName(for: moment), isCustom: moment == .win)
            Divider()
        }
    }
    .padding()
}
