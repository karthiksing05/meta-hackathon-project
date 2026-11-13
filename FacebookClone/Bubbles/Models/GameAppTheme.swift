import Foundation

/// How a game dresses the app around it: its cover, its wordmark, its palette and its fonts
/// (docs/BUBBLES.md, "App theme: presentation.app"). The feed card, the handoff into the player
/// and the result card read it; the Facebook chrome (nav bar, tab bar) never does.
///
/// Everything is optional. A game without `presentation.app` still gets a theme: its engine
/// look tokens (`presentation.tokens`), its `backdrop` image asset and the font families its text
/// nodes use; a game with none of those falls back to its manifest `style` (`BubbleGlow`).
struct GameAppTheme: Hashable, Sendable {
    /// `#RRGGBB` colors. Any of them may be missing; views fall back to the Glow palette.
    struct Palette: Hashable, Sendable {
        var bg: UInt32?
        var surface: UInt32?
        var ink: UInt32?
        var primary: UInt32?
        var accent: UInt32?
        /// Text drawn on `primary` (buttons).
        var onPrimary: UInt32?

        var isEmpty: Bool { bg == nil && primary == nil && accent == nil && ink == nil }
    }

    /// A font the game names: a family (one of the bundled game fonts, `authoring/fonts`) and
    /// optionally where its file is (an asset id, a `data:font/woff2;base64,` URI or an https URL).
    struct FontRef: Hashable, Sendable {
        var family: String
        var source: String?
    }

    /// Where an image comes from: an asset id in the game's `assets`, a `data:` URI or a URL.
    enum ImageRef: Hashable, Sendable {
        case data(Data)
        case url(URL)
    }

    var cover: ImageRef?
    var wordmark: ImageRef?
    var palette = Palette()
    var displayFont: FontRef?
    var bodyFont: FontRef?
    /// True when the game declared `presentation.app` itself (not derived from its look).
    var isDeclared = false
    /// True when `cover` came from `presentation.app.cover` (it then wins over the server cover).
    var hasDeclaredCover = false

    static let empty = GameAppTheme()
}

// MARK: - Parsing

extension GameAppTheme {
    /// Resolves a manifest's theme. `presentation.app` on the manifest wins, then the engine game's
    /// own `presentation.app`, then the game's look tokens, backdrop asset and text fonts.
    /// Pure and synchronous: call it off the main thread (it may parse `content.game_json`).
    static func resolve(manifest: BubbleManifest) -> GameAppTheme {
        let game = engineGame(in: manifest.content)
        let presentation = game?["presentation"] as? [String: Any]
        let assets = game?["assets"] as? [String: Any] ?? [:]
        let declared = (manifest.presentation?["app"]).flatMap(foundationObject) as? [String: Any]
            ?? presentation?["app"] as? [String: Any]

        var theme = GameAppTheme()
        if let app = declared {
            theme.isDeclared = true
            theme.cover = imageRef(app["cover"], assets: assets)
            theme.wordmark = imageRef(app["wordmark"], assets: assets)
            theme.palette = palette(app["palette"] as? [String: Any])
            if let fonts = app["fonts"] as? [String: Any] {
                theme.displayFont = fontRef(fonts["display"])
                theme.bodyFont = fontRef(fonts["body"])
            }
        }
        theme.hasDeclaredCover = theme.cover != nil
        // Fallbacks from the game's own look.
        if theme.cover == nil {
            theme.cover = imageRef("backdrop", assets: assets)
        }
        let tokens = palette(presentation?["tokens"] as? [String: Any])
        theme.palette.bg = theme.palette.bg ?? tokens.bg
        theme.palette.surface = theme.palette.surface ?? tokens.surface
        theme.palette.ink = theme.palette.ink ?? tokens.ink
        theme.palette.primary = theme.palette.primary ?? tokens.primary
        theme.palette.accent = theme.palette.accent ?? tokens.accent
        theme.palette.onPrimary = theme.palette.onPrimary ?? tokens.onPrimary
        if theme.palette.isEmpty, let colors = manifest.style.colors {
            theme.palette.bg = BubbleGlow.hex(colors.bgTop)
            theme.palette.ink = BubbleGlow.hex(colors.ink)
            theme.palette.primary = BubbleGlow.hex(colors.primary)
            theme.palette.accent = BubbleGlow.hex(colors.accent)
        }
        if theme.displayFont == nil || theme.bodyFont == nil, let root = presentation?["root"] {
            let families = usedFamilies(in: root)
            let display = families.first { GameFontCatalog.role(of: $0) == .display }
            let body = families.first { GameFontCatalog.role(of: $0) == .text }
            if theme.displayFont == nil, let family = display ?? body {
                theme.displayFont = FontRef(family: family)
            }
            if theme.bodyFont == nil, let family = body {
                theme.bodyFont = FontRef(family: family)
            }
        }
        return theme
    }

    /// The engine game object: `content.game` or the JSON text `content.game_json`.
    private static func engineGame(in content: JSONValue) -> [String: Any]? {
        if let text = content["game_json"]?.string, let data = text.data(using: .utf8) {
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }
        if let game = content["game"] {
            return foundationObject(game) as? [String: Any]
        }
        return nil
    }

    private static func foundationObject(_ value: JSONValue) -> Any? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    static func imageRef(_ value: Any?, assets: [String: Any]) -> ImageRef? {
        guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        if let data = dataURI(text) { return .data(data) }
        if text.hasPrefix("https://"), let url = URL(string: text) { return .url(url) }
        // An asset id: `{ "image": "data:..." | "https://..." }`.
        if let asset = assets[text] as? [String: Any], let source = asset["image"] as? String, source != text {
            return imageRef(source, assets: [:])
        }
        return nil
    }

    /// The bytes of a base64 `data:` URI.
    static func dataURI(_ text: String) -> Data? {
        guard text.hasPrefix("data:"), let comma = text.firstIndex(of: ",") else { return nil }
        let header = text[..<comma]
        guard header.hasSuffix(";base64") else { return nil }
        return Data(base64Encoded: String(text[text.index(after: comma)...]), options: .ignoreUnknownCharacters)
    }

    private static func palette(_ object: [String: Any]?) -> Palette {
        guard let object else { return Palette() }
        func color(_ keys: String...) -> UInt32? {
            for key in keys {
                if let value = BubbleGlow.hex(object[key] as? String) { return value }
            }
            return nil
        }
        return Palette(
            bg: color("bg", "background", "bg_top"),
            surface: color("surface"),
            ink: color("ink", "on_bg"),
            primary: color("primary"),
            accent: color("accent", "secondary"),
            onPrimary: color("on_primary")
        )
    }

    private static func fontRef(_ value: Any?) -> FontRef? {
        if let family = value as? String, !family.isEmpty { return FontRef(family: family) }
        if let object = value as? [String: Any], let family = object["family"] as? String, !family.isEmpty {
            return FontRef(family: family, source: object["src"] as? String)
        }
        return nil
    }

    /// Font families the game's text nodes use, most used first.
    private static func usedFamilies(in root: Any) -> [String] {
        var counts: [String: Int] = [:]
        var order: [String] = []
        func walk(_ node: Any) {
            if let object = node as? [String: Any] {
                for key in ["font", "font_family", "family"] {
                    if let family = object[key] as? String, GameFontCatalog.role(of: family) != nil {
                        if counts[family] == nil { order.append(family) }
                        counts[family, default: 0] += 1
                    }
                }
                object.values.forEach(walk)
            } else if let array = node as? [Any] {
                array.forEach(walk)
            }
        }
        walk(root)
        return order.enumerated().sorted { a, b in
            let ca = counts[a.element] ?? 0, cb = counts[b.element] ?? 0
            return ca != cb ? ca > cb : a.offset < b.offset
        }.map(\.element)
    }
}

// MARK: - Bundled game fonts

/// The game fonts shipped with the runtime (`FacebookClone/Bubbles/Runtime/web/gamefont-*.woff2`,
/// `authoring/fonts/fonts.json`): family name to the file of its heaviest upright weight.
enum GameFontCatalog {
    enum Role: Sendable { case display, text }

    static func role(of family: String) -> Role? { files[family]?.role }
    static func file(of family: String) -> String? { files[family]?.file }

    private static let files: [String: (file: String, role: Role)] = [
        "Abril Fatface": ("gamefont-abril-400", .display),
        "Alfa Slab One": ("gamefont-alfa_slab-400", .display),
        "Archivo": ("gamefont-archivo-700", .text),
        "Archivo Black": ("gamefont-archivo_black-400", .display),
        "Audiowide": ("gamefont-audiowide-400", .display),
        "Baloo 2": ("gamefont-baloo-700", .text),
        "Bangers": ("gamefont-bangers-400", .display),
        "Barlow Condensed": ("gamefont-barlow_cond-700", .text),
        "Barlow Condensed Italic": ("gamefont-barlow_cond_italic-700i", .display),
        "Bowlby One": ("gamefont-bowlby-400", .display),
        "Bungee": ("gamefont-bungee-400", .display),
        "Caveat": ("gamefont-caveat-700", .text),
        "Chewy": ("gamefont-chewy-400", .display),
        "Cinzel": ("gamefont-cinzel-700", .display),
        "Cormorant Garamond": ("gamefont-cormorant-700", .text),
        "Courier Prime": ("gamefont-courier_prime-700", .text),
        "Creepster": ("gamefont-creepster-400", .display),
        "DM Sans": ("gamefont-dm_sans-700", .text),
        "DM Serif Display": ("gamefont-dm_serif-400", .display),
        "Dela Gothic One": ("gamefont-dela_gothic-400", .display),
        "Fredoka": ("gamefont-fredoka-700", .text),
        "IM Fell English": ("gamefont-im_fell-400", .text),
        "Josefin Sans": ("gamefont-josefin-700", .text),
        "Libre Baskerville": ("gamefont-libre_baskerville-700", .text),
        "Lobster": ("gamefont-lobster-400", .display),
        "Lora": ("gamefont-lora-700", .text),
        "M PLUS Rounded 1c": ("gamefont-mplus_rounded-700", .text),
        "Michroma": ("gamefont-michroma-400", .display),
        "Monoton": ("gamefont-monoton-400", .display),
        "Nunito": ("gamefont-nunito-700", .text),
        "Orbitron": ("gamefont-orbitron-800", .display),
        "Oswald": ("gamefont-oswald-700", .text),
        "Outfit": ("gamefont-outfit-700", .text),
        "Pacifico": ("gamefont-pacifico-400", .display),
        "Patrick Hand": ("gamefont-patrick_hand-400", .text),
        "Playfair Display": ("gamefont-playfair-800", .display),
        "Poiret One": ("gamefont-poiret-400", .display),
        "Press Start 2P": ("gamefont-press_start-400", .display),
        "Righteous": ("gamefont-righteous-400", .display),
        "Rubik": ("gamefont-rubik-700", .text),
        "Rye": ("gamefont-rye-400", .display),
        "Share Tech Mono": ("gamefont-share_tech_mono-400", .text),
        "Silkscreen": ("gamefont-silkscreen-700", .display),
        "Space Grotesk": ("gamefont-space_grotesk-700", .text),
        "Space Mono": ("gamefont-space_mono-700", .text),
        "Special Elite": ("gamefont-special_elite-400", .display),
        "Syne": ("gamefont-syne-800", .display),
        "Teko": ("gamefont-teko-600", .display),
        "Uncial Antiqua": ("gamefont-uncial-400", .display),
        "UnifrakturMaguntia": ("gamefont-unifraktur-400", .display),
        "VT323": ("gamefont-vt323-400", .display),
        "Work Sans": ("gamefont-work_sans-700", .text),
    ]
}
