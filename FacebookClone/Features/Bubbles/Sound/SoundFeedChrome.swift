import SwiftUI

// The TikTok part of library sounds on a feed page: a scrolling "♫ Title · creator" line under the
// caption and a spinning disc at the bottom of the rail. Both open the sound's page. They show
// only when the server says the game has a sound.

/// "♫ Title · creator", scrolling when it's wider than its space. Holds still under Reduce Motion.
struct SoundTicker: View {
    let sound: RemoteGameSound
    var maxWidth: CGFloat = 200

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var textWidth: CGFloat = 0

    private var text: String {
        sound.creator.isEmpty ? sound.title : "\(sound.title) · \(sound.creator)"
    }

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "music.note")
                .font(.system(size: FBIconSize.xs, weight: .bold))
            marquee
        }
        .foregroundStyle(Color.white)
        .frame(minHeight: 28)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sound: \(text)")
        .accessibilityHint("Opens the sound")
        .accessibilityAddTraits(.isButton)
    }

    private var marquee: some View {
        let scrolls = !reduceMotion && textWidth > maxWidth
        let gap: CGFloat = 32
        return TimelineView(.animation(paused: !scrolls)) { context in
            let period = Double(textWidth + gap) / 28
            let phase = scrolls ? context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period : 0
            HStack(spacing: gap) {
                label
                if scrolls { label }
            }
            .offset(x: -CGFloat(phase) * (textWidth + gap))
            .frame(width: min(maxWidth, max(textWidth, 1)), alignment: .leading)
            .clipped()
        }
        .mask(
            LinearGradient(stops: [
                .init(color: .black, location: 0),
                .init(color: .black, location: scrolls ? 0.85 : 1),
                .init(color: .black.opacity(scrolls ? 0 : 1), location: 1),
            ], startPoint: .leading, endPoint: .trailing)
        )
    }

    private var label: some View {
        Text(text)
            .font(.fbMetaEmphasized)
            .lineLimit(1)
            .fixedSize()
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { textWidth = $0 }
    }
}

/// The record at the bottom of the rail: the sound's cover in a dark ring, turning while it plays.
struct SoundDisc: View {
    let sound: RemoteGameSound
    var size: CGFloat = 40
    var isSpinning = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: !isSpinning || reduceMotion)) { context in
            let turn = isSpinning && !reduceMotion ? context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 6) / 6 : 0
            disc
                .rotationEffect(.degrees(turn * 360))
        }
        .frame(width: size, height: size)
        .shadow(color: Color.black.opacity(0.35), radius: 3, y: 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sound: \(sound.title)")
        .accessibilityHint("Opens the sound")
        .accessibilityAddTraits(.isButton)
    }

    private var disc: some View {
        ZStack {
            Circle()
                .fill(AngularGradient(colors: [Color(hex: 0x1C1C1E), Color(hex: 0x3A3A3C), Color(hex: 0x1C1C1E), Color(hex: 0x2C2C2E), Color(hex: 0x1C1C1E)], center: .center))
            SoundCoverArt(url: sound.coverURL, seed: sound.id)
                .frame(width: size * 0.56, height: size * 0.56)
                .clipShape(Circle())
        }
    }
}

/// A sound's cover, or a gradient with a note when it has none (stable per sound).
struct SoundCoverArt: View {
    let url: URL?
    let seed: String
    var cornerRadius: CGFloat? = nil

    private static let palettes: [[Color]] = [
        [Color(hex: 0xFF6A88), Color(hex: 0xFF99AC)],
        [Color(hex: 0x6A82FB), Color(hex: 0xFC5C7D)],
        [Color(hex: 0x43E97B), Color(hex: 0x38F9D7)],
        [Color(hex: 0xFA709A), Color(hex: 0xFEE140)],
        [Color(hex: 0x30CFD0), Color(hex: 0x330867)],
        [Color(hex: 0xA18CD1), Color(hex: 0xFBC2EB)],
    ]

    var body: some View {
        ZStack {
            placeholder
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    }
                }
            }
        }
        .clipped()
    }

    private var placeholder: some View {
        let colors = Self.palettes[Int(SeededGenerator.stableHash("sound|\(seed)") % UInt64(Self.palettes.count))]
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay {
                Image(systemName: "music.note")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.9))
                    .minimumScaleFactor(0.3)
            }
    }
}
