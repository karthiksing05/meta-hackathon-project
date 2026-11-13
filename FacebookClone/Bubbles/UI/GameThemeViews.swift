import CoreText
import SwiftUI
import UIKit

// The app side of a game's theme (docs/BUBBLES.md, "App theme"): the resolved cover and wordmark
// images, the registered display font, palette colors, the wordmark view and the cover-to-game
// handoff. Facebook chrome (nav bar, tab bar) never reads any of this.

/// A game's theme, ready to draw.
struct GameThemeResolved {
    var theme: GameAppTheme
    var cover: UIImage?
    var wordmark: UIImage?
    /// PostScript names of the registered fonts, nil when the game names none or it failed to load.
    var displayFontName: String?
    var bodyFontName: String?

    static let empty = GameThemeResolved(theme: .empty)

    /// The game's display font at `size`, or a heavy rounded system face.
    func displayFont(size: CGFloat) -> Font {
        if let displayFontName { return .custom(displayFontName, fixedSize: size) }
        return .system(size: size, weight: .heavy, design: .rounded) // Display text: game title fallback
    }

    /// The display font for numbers (scores): hairline and blackletter faces that don't read as
    /// digits at a glance use a heavy rounded system face instead.
    func numberFont(size: CGFloat) -> Font {
        let family = theme.displayFont?.family ?? ""
        if Self.hardToReadDigits.contains(family) {
            return .system(size: size, weight: .heavy, design: .rounded) // Display text: score
        }
        return displayFont(size: size)
    }

    private static let hardToReadDigits: Set<String> = [
        "Monoton", "Poiret One", "Creepster", "UnifrakturMaguntia", "Uncial Antiqua", "Pacifico", "Lobster",
    ]

    func bodyFont(size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        if let bodyFontName { return .custom(bodyFontName, fixedSize: size) }
        return .system(size: size, weight: weight, design: .rounded) // Display text: game body fallback
    }
}

/// Resolves and caches each game's theme off the main thread. Views ask `resolved(for:)`; the
/// first ask starts the work and the view redraws when it lands.
@MainActor
@Observable
final class GameThemeCenter {
    static let shared = GameThemeCenter()

    private(set) var cache: [String: GameThemeResolved] = [:]
    @ObservationIgnored private var pending: Set<String> = []

    static func key(for bubble: Bubble) -> String {
        "\(bubble.id)#\(bubble.manifest.version)#\(bubble.manifest.title)"
    }

    /// The game's resolved theme, or nil while it loads (callers draw their fallback).
    func resolved(for bubble: Bubble) -> GameThemeResolved? {
        let key = Self.key(for: bubble)
        if let hit = cache[key] { return hit }
        load(bubble.manifest, key: key)
        return nil
    }

    /// Resolves now and waits (the handoff and the result card want the art before they draw).
    func prepare(_ bubble: Bubble) async -> GameThemeResolved {
        let key = Self.key(for: bubble)
        if let hit = cache[key] { return hit }
        let value = await Self.build(bubble.manifest)
        cache[key] = value
        return value
    }

    private func load(_ manifest: BubbleManifest, key: String) {
        guard !pending.contains(key) else { return }
        pending.insert(key)
        Task { @MainActor in
            let value = await Self.build(manifest)
            cache[key] = value
            pending.remove(key)
        }
    }

    nonisolated private static func build(_ manifest: BubbleManifest) async -> GameThemeResolved {
        let theme = await Task.detached(priority: .userInitiated) { GameAppTheme.resolve(manifest: manifest) }.value
        async let cover = image(theme.cover, maxPixel: 1400)
        async let wordmark = image(theme.wordmark, maxPixel: 900)
        let display = await GameFontRegistry.shared.register(theme.displayFont)
        let body = await GameFontRegistry.shared.register(theme.bodyFont)
        return GameThemeResolved(theme: theme, cover: await cover, wordmark: await wordmark, displayFontName: display, bodyFontName: body)
    }

    nonisolated private static func image(_ ref: GameAppTheme.ImageRef?, maxPixel: CGFloat) async -> UIImage? {
        guard let ref else { return nil }
        let data: Data?
        switch ref {
        case .data(let bytes): data = bytes
        case .url(let url): data = try? await URLSession.shared.data(from: url).0
        }
        guard let data else { return nil }
        return await Task.detached(priority: .userInitiated) {
            guard let image = UIImage(data: data) else { return nil }
            let longest = max(image.size.width, image.size.height) * image.scale
            if longest > maxPixel {
                let scale = maxPixel / longest
                let size = CGSize(width: image.size.width * image.scale * scale, height: image.size.height * image.scale * scale)
                return await image.byPreparingThumbnail(ofSize: size) ?? image
            }
            return await image.byPreparingForDisplay() ?? image
        }.value
    }
}

/// Registers game fonts with Core Text once each: the bundled game fonts by family name
/// (`gamefont-*.woff2` in the app bundle), or a game's own font file (`data:` URI or https URL).
actor GameFontRegistry {
    static let shared = GameFontRegistry()
    private var names: [String: String?] = [:]

    /// The registered font's PostScript name, or nil when it isn't available.
    func register(_ ref: GameAppTheme.FontRef?) async -> String? {
        guard let ref else { return nil }
        let key = ref.source ?? ref.family
        if let known = names[key] { return known }
        var data: Data?
        if let source = ref.source {
            if let bytes = GameAppTheme.dataURI(source) {
                data = bytes
            } else if source.hasPrefix("https://"), let url = URL(string: source) {
                data = try? await URLSession.shared.data(from: url).0
            }
        }
        if data == nil, let file = GameFontCatalog.file(of: ref.family),
           let url = Bundle.main.url(forResource: file, withExtension: "woff2") {
            data = try? Data(contentsOf: url)
        }
        var name: String?
        if let data, let provider = CGDataProvider(data: data as CFData), let font = CGFont(provider) {
            let postScript = font.postScriptName as String?
            var error: Unmanaged<CFError>?
            // Already registered (same name from another game) counts as success.
            if CTFontManagerRegisterGraphicsFont(font, &error) || postScript.map({ UIFont(name: $0, size: 12) != nil }) == true {
                name = postScript
            }
        }
        names[key] = name
        return name
    }
}

// MARK: - Palette

extension Bubble {
    /// The game's accent for app surfaces around it (buttons, borders, chips): its theme's
    /// primary, else its Glow palette's first accent.
    func themeAccent(_ resolved: GameThemeResolved?) -> Color {
        if let hex = resolved?.theme.palette.primary ?? resolved?.theme.palette.accent { return Color(hex: hex) }
        return palette.accents.first ?? palette.top
    }

    /// Text on `themeAccent`: the theme's own, else black or white by contrast.
    func themeOnAccent(_ resolved: GameThemeResolved?) -> Color {
        if let hex = resolved?.theme.palette.onPrimary { return Color(hex: hex) }
        let hex = resolved?.theme.palette.primary ?? resolved?.theme.palette.accent ?? palette.accentHexes.first ?? palette.topHex
        return GameThemeColor.luminance(hex) > 0.55 ? Color(hex: 0x141414) : .white
    }
}

enum GameThemeColor {
    static func luminance(_ hex: UInt32) -> Double {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
}

// MARK: - Wordmark

/// The game's name as the game draws it: its Muse Image wordmark when it has one, else its title
/// set in its own display font. Falls back to a heavy rounded title while the theme loads.
struct GameWordmark: View {
    let bubble: Bubble
    var size: CGFloat = 26
    var color: Color = .white
    var alignment: HorizontalAlignment = .leading
    var maxHeight: CGFloat? = nil

    var body: some View {
        let resolved = GameThemeCenter.shared.resolved(for: bubble)
        Group {
            if let image = resolved?.wordmark {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: maxHeight ?? size * 2.2, alignment: Alignment(horizontal: alignment, vertical: .center))
            } else {
                Text(bubble.title)
                    .font((resolved ?? .empty).displayFont(size: size))
                    .foregroundStyle(color)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .multilineTextAlignment(alignment == .center ? .center : .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(bubble.title)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Cover

/// A game's cover for cards and the handoff: its image art (declared cover, server cover or
/// backdrop image) when it has one, else an exact still of its first frame (`BubblePosterView`),
/// so a game whose backdrop is vector art still shows itself instead of a placeholder.
struct GameCoverArt: View {
    let bubble: Bubble

    var body: some View {
        let resolved = GameThemeCenter.shared.resolved(for: bubble)
        if bubble.coverImageData != nil || resolved?.cover != nil || resolved == nil {
            BubbleCoverView(bubble: bubble, showsEmoji: false)
        } else {
            BubblePosterView(bubble: bubble, showsEmoji: false)
        }
    }
}

// MARK: - Handoff

/// The cover a tap started from, so the player can zoom it into the game
/// (`GameHandoffZoom`). Set by the card just before `router.play`; taken once by the player.
@MainActor
enum GameHandoff {
    struct Source {
        var bubbleID: String
        /// In global (window) coordinates.
        var frame: CGRect
        var cornerRadius: CGFloat
        var at = Date()
    }

    private(set) static var source: Source?

    static func begin(_ bubbleID: String, frame: CGRect, cornerRadius: CGFloat) {
        guard frame.width > 1, frame.height > 1 else { source = nil; return }
        source = Source(bubbleID: bubbleID, frame: frame, cornerRadius: cornerRadius)
    }

    /// True when the next play request for `bubbleID` should present without the slide.
    static func isPending(for bubbleID: String) -> Bool {
        guard let source, source.bubbleID == bubbleID else { return false }
        return Date().timeIntervalSince(source.at) < 2
    }

    static func take(for bubbleID: String) -> Source? {
        defer { source = nil }
        return isPending(for: bubbleID) ? source : nil
    }
}

/// Zooms the tapped cover from its card to full screen over the presenting screen, then fades it
/// into the game underneath (its poster, then the live game): no slide, no flash, no blank frame.
/// Without a source (any other way into the player) it does nothing.
struct GameHandoffZoom: ViewModifier {
    let bubble: Bubble?
    let source: GameHandoff.Source?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded = false
    @State private var isContentShown = false
    @State private var isOverlayFaded = false
    @State private var isOverlayGone = false

    func body(content: Content) -> some View {
        if let source, let bubble {
            ZStack {
                content
                    .opacity(isContentShown ? 1 : 0)
                if !isOverlayGone {
                    overlay(bubble, source: source)
                        .opacity(isOverlayFaded ? 0 : 1)
                }
            }
            .task { await run() }
        } else {
            content
        }
    }

    private func overlay(_ bubble: Bubble, source: GameHandoff.Source) -> some View {
        GeometryReader { proxy in
            let screen = proxy.frame(in: .global)
            let frame = isExpanded ? screen : source.frame
            GameCoverArt(bubble: bubble)
                .frame(width: frame.width, height: frame.height)
                .clipShape(RoundedRectangle(cornerRadius: isExpanded ? 0 : source.cornerRadius, style: .continuous))
                .position(x: frame.midX - screen.minX, y: frame.midY - screen.minY)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func run() async {
        if let bubble { _ = await GameThemeCenter.shared.prepare(bubble) }
        if reduceMotion {
            isExpanded = true
        } else {
            await withCheckedContinuation { done in
                withAnimation(.spring(duration: 0.42, bounce: 0.08), completionCriteria: .logicallyComplete) {
                    isExpanded = true
                } completion: {
                    done.resume()
                }
            }
        }
        // The game shows at full opacity under the full-screen cover first, then the cover fades,
        // so nothing behind the player ever shows through.
        isContentShown = true
        await withCheckedContinuation { done in
            withAnimation(.easeOut(duration: reduceMotion ? 0.2 : 0.35)) {
                isOverlayFaded = true
            } completion: {
                done.resume()
            }
        }
        isOverlayGone = true
    }
}

/// Records a card's global frame so a tap can start the cover-to-game zoom.
struct GameHandoffSource: ViewModifier {
    @Binding var frame: CGRect

    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
    }
}
