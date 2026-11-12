import SwiftUI

// MARK: - Looks

/// A Bubble's look: its render family (LOOKS.md). Every Bubble has its own look inside the same
/// Bubble frame. Studio itself keeps the Glow brand because it's app chrome.
///
/// Studio sends the person's pick to Muse as `StudioRequest.paletteHint`, set to the look id
/// (for example "paper"). nil means Muse picks.
enum StudioLook: String, CaseIterable, Identifiable, Sendable {
    case glow, paper, pixel, neon, ink, clay, riso, chalk

    var id: String { rawValue }

    /// Reads a manifest's `style.look` or a hint. nil for anything Studio doesn't know.
    init?(id: String?) {
        guard let id = id?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              let look = StudioLook(rawValue: id) else { return nil }
        self = look
    }

    /// "Paper cutout".
    var title: String {
        switch self {
        case .glow: return "Glow"
        case .paper: return "Paper cutout"
        case .pixel: return "Pixel arcade"
        case .neon: return "Neon night"
        case .ink: return "Ink sketch"
        case .clay: return "Clay toy"
        case .riso: return "Riso print"
        case .chalk: return "Chalkboard"
        }
    }

    /// The tile label: "Paper".
    var shortTitle: String {
        switch self {
        case .glow: return "Glow"
        case .paper: return "Paper"
        case .pixel: return "Pixel"
        case .neon: return "Neon"
        case .ink: return "Ink"
        case .clay: return "Clay"
        case .riso: return "Riso"
        case .chalk: return "Chalk"
        }
    }

    var feel: String {
        switch self {
        case .glow: return "Dreamy, soft and pastel"
        case .paper: return "Crafty, warm and tactile"
        case .pixel: return "Retro arcade, chunky pixels"
        case .neon: return "Electric lines on a night sky"
        case .ink: return "Hand-drawn and whimsical"
        case .clay: return "Chunky, cute and toy-like"
        case .riso: return "Zine print in spot colors"
        case .chalk: return "Calm and brainy, on a slate"
        }
    }

    var symbol: String {
        switch self {
        case .glow: return "sparkles"
        case .paper: return "scissors"
        case .pixel: return "square.grid.3x3.fill"
        case .neon: return "bolt.fill"
        case .ink: return "pencil.and.scribble"
        case .clay: return "teddybear.fill"
        case .riso: return "circle.hexagongrid.fill"
        case .chalk: return "pencil.tip"
        }
    }

    /// What "Tweak it" asks Muse for when the look changes.
    var tweakPrompt: String { "Redraw it in the \(title.lowercased()) look" }

    /// Example colors: what the preview tiles show, and what Studio uses when a composer doesn't
    /// pick colors for this look. Glow uses its preset palettes instead.
    var exampleColors: BubbleColors? {
        switch self {
        case .glow:
            return nil
        case .paper:
            return BubbleColors(bgTop: "#FFF4E3", bgBottom: "#F7DFC4", ink: "#3B2A20", primary: "#F2895B", secondary: "#F2C14E", accent: "#6FA37A", danger: "#D9534F")
        case .pixel:
            return BubbleColors(bgTop: "#1B1F4B", bgBottom: "#3A2F6B", ink: "#FFFFFF", primary: "#FFD84A", secondary: "#4AD6FF", accent: "#FF5FA2", danger: "#FF4D4D")
        case .neon:
            return BubbleColors(bgTop: "#0B0820", bgBottom: "#1A0F3A", ink: "#F5F3FF", primary: "#FF3EA5", secondary: "#33E1FF", accent: "#B6FF3B", danger: "#FF5A5A")
        case .ink:
            return BubbleColors(bgTop: "#FBF8F1", bgBottom: "#F1ECDF", ink: "#23211E", primary: "#2F4B7C", secondary: "#C8553D", accent: "#E2B33C", danger: "#B23A48")
        case .clay:
            return BubbleColors(bgTop: "#FDE8EC", bgBottom: "#F5D3DC", ink: "#3A2B33", primary: "#FF8FA3", secondary: "#7FC8F8", accent: "#FFD166", danger: "#EF476F")
        case .riso:
            return BubbleColors(bgTop: "#FBF3E4", bgBottom: "#F4E7CF", ink: "#1F2A44", primary: "#FF5C8A", secondary: "#1F6FEB", accent: "#FFC93C", danger: "#E4572E")
        case .chalk:
            return BubbleColors(bgTop: "#24352E", bgBottom: "#1B2A24", ink: "#F4F1E8", primary: "#F7E8A4", secondary: "#A8D8EA", accent: "#F4B6C2", danger: "#FF8C82")
        }
    }

    var defaultFont: String {
        switch self {
        case .glow, .paper, .clay: return "rounded"
        case .pixel: return "pixel"
        case .neon, .riso: return "condensed"
        case .ink, .chalk: return "hand"
        }
    }

    /// `style` redrawn in this look: the look's example colors and type. Keeps the motif, emoji,
    /// mood and cover prompt.
    func applied(to style: BubbleStyle) -> BubbleStyle {
        var style = style
        style.look = rawValue
        if let colors = exampleColors {
            style.palette = "custom"
            style.colors = colors
        } else {
            if !BubbleGlow.palettes.contains(where: { $0.id == style.palette }) { style.palette = BubbleGlow.lilacHaze.id }
            style.colors = nil
        }
        style.font = defaultFont
        return style
    }

    /// The colors a preview of this look uses on its own.
    var examplePalette: BubblePalette {
        BubbleGlow.palette(for: applied(to: BubbleStyle()))
    }
}

// MARK: - Words

/// A Bubble's look in words, from its real style: "Warm sunset colors · hand-drawn type · hills".
enum StudioLookWords {
    static func detail(for style: BubbleStyle) -> String {
        var parts = [colors(for: style)]
        if let font = font(style.font) { parts.append(font) }
        if let motif = motif(style.motif) { parts.append(motif) }
        // No-break spaces keep "·" off the start of a wrapped line.
        let text = parts.joined(separator: "\u{00A0}·\u{00A0}")
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    /// "warm sunset colors". Presets use their names; custom colors are read from their hues.
    static func colors(for style: BubbleStyle) -> String {
        let palette = BubbleGlow.palette(for: style)
        guard palette.id == "custom" else { return "\(palette.name.lowercased()) colors" }
        let primary = HSB(hex: palette.accentHexes.first ?? palette.inkHex)
        if palette.isDark {
            if primary.saturation > 0.55 && primary.brightness > 0.8 { return "electric night colors" }
            switch Band(hue: HSB(hex: palette.topHex).hue) {
            case .green: return "dark slate colors"
            case .warm, .pink: return "glowing ember colors"
            case .blue, .purple: return "midnight blue colors"
            }
        }
        if primary.saturation < 0.15 { return "quiet neutral colors" }
        switch Band(hue: primary.hue) {
        case .pink: return "candy pink colors"
        case .warm: return "warm sunset colors"
        case .green: return "fresh green colors"
        case .blue: return primary.brightness < 0.6 ? "inky blue colors" : "cool sky colors"
        case .purple: return "soft violet colors"
        }
    }

    static func font(_ font: String?) -> String? {
        switch font?.lowercased() {
        case "serif": return "serif type"
        case "mono": return "mono type"
        case "hand": return "hand-drawn type"
        case "condensed": return "condensed type"
        case "pixel": return "pixel type"
        default: return nil
        }
    }

    static func motif(_ motif: String?) -> String? {
        switch motif?.lowercased() {
        case "hills": return "rolling hills"
        case "waves": return "waves"
        case "city": return "city skyline"
        case "stars": return "starry sky"
        case "clouds": return "soft clouds"
        case "grid": return "grid lines"
        case "dots": return "polka dots"
        case "leaves": return "leaves"
        default: return nil
        }
    }

    private enum Band {
        case pink, warm, green, blue, purple

        init(hue: Double) {
            switch hue {
            case 10..<65: self = .warm
            case 65..<170: self = .green
            case 170..<255: self = .blue
            case 255..<320: self = .purple
            default: self = .pink
            }
        }
    }

    private struct HSB {
        let hue: Double
        let saturation: Double
        let brightness: Double

        init(hex: UInt32) {
            let r = Double((hex >> 16) & 0xFF) / 255
            let g = Double((hex >> 8) & 0xFF) / 255
            let b = Double(hex & 0xFF) / 255
            let maxValue = max(r, g, b)
            let delta = maxValue - min(r, g, b)
            brightness = maxValue
            saturation = maxValue == 0 ? 0 : delta / maxValue
            var degrees = 0.0
            if delta > 0 {
                if maxValue == r {
                    degrees = ((g - b) / delta).truncatingRemainder(dividingBy: 6)
                } else if maxValue == g {
                    degrees = (b - r) / delta + 2
                } else {
                    degrees = (r - g) / delta + 4
                }
                degrees *= 60
                if degrees < 0 { degrees += 360 }
            }
            hue = degrees
        }
    }
}

// MARK: - Previews

/// The colors a look preview draws with: a look's example colors, or a Bubble's own.
struct StudioLookColors {
    var bgTop: Color
    var bgBottom: Color
    var ink: Color
    var primary: Color
    var secondary: Color
    var accent: Color

    init(palette: BubblePalette) {
        bgTop = palette.top
        bgBottom = palette.bottom
        ink = palette.ink
        let accents = palette.accents
        primary = accents.first ?? palette.ink
        secondary = accents.count > 1 ? accents[1] : primary
        accent = accents.count > 2 ? accents[2] : secondary
    }

    /// A Bubble's real colors (custom colors win over the preset).
    init(style: BubbleStyle) {
        self.init(palette: BubbleGlow.palette(for: style))
    }
}

/// A small picture of a look, drawn in that look's spirit. Rendering only.
struct StudioLookPreview: View {
    let look: StudioLook
    /// The Bubble's own colors; the look's example colors when nil.
    var colors: StudioLookColors? = nil

    var body: some View {
        let colors = colors ?? StudioLookColors(palette: look.examplePalette)
        Canvas { context, size in
            StudioLookArt.draw(look, in: &context, size: size, colors: colors)
        }
        .accessibilityHidden(true)
    }
}

/// "Muse picks": four looks at once, with Muse's sparkle on top.
struct StudioMusePicksPreview: View {
    var body: some View {
        GeometryReader { proxy in
            let badge = min(proxy.size.width, proxy.size.height) * 0.46
            ZStack {
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        StudioLookPreview(look: .paper)
                        StudioLookPreview(look: .neon)
                    }
                    HStack(spacing: 0) {
                        StudioLookPreview(look: .clay)
                        StudioLookPreview(look: .pixel)
                    }
                }
                Circle()
                    .fill(Color.white)
                    .frame(width: badge, height: badge)
                    .shadow(color: .black.opacity(0.2), radius: 4, y: 1)
                Image(systemName: "sparkles")
                    .font(.system(size: badge * 0.5, weight: .bold)) // Scales with the tile
                    .foregroundStyle(BubbleGlow.brandGradient)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityHidden(true)
    }
}

/// Draws the look previews: a few shapes in each look's spirit (LOOKS.md, Looks table).
enum StudioLookArt {
    static func draw(_ look: StudioLook, in context: inout GraphicsContext, size: CGSize, colors: StudioLookColors) {
        switch look {
        case .glow: glow(&context, size, colors)
        case .paper: paper(&context, size, colors)
        case .pixel: pixel(&context, size, colors)
        case .neon: neon(&context, size, colors)
        case .ink: ink(&context, size, colors)
        case .clay: clay(&context, size, colors)
        case .riso: riso(&context, size, colors)
        case .chalk: chalk(&context, size, colors)
        }
    }

    // MARK: Glow: gradient, soap bubbles with halos

    private static let iridescent = Gradient(colors: [
        Color(hex: 0xFF9EC9), Color(hex: 0xFFE59A), Color(hex: 0x9EF0DA),
        Color(hex: 0x9AD4FF), Color(hex: 0xC9B8FF), Color(hex: 0xFF9EC9),
    ])

    private static func glow(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        background(&context, size, colors)
        let w = size.width, h = size.height
        var halo = context
        halo.addFilter(.blur(radius: w * 0.09))
        halo.fill(circle(CGPoint(x: w * 0.52, y: h * 0.42), w * 0.32), with: .color(.white.opacity(0.6)))
        soapBubble(&context, CGPoint(x: w * 0.52, y: h * 0.42), w * 0.27)
        soapBubble(&context, CGPoint(x: w * 0.22, y: h * 0.76), w * 0.11)
        soapBubble(&context, CGPoint(x: w * 0.8, y: h * 0.8), w * 0.075)
    }

    private static func soapBubble(_ context: inout GraphicsContext, _ center: CGPoint, _ radius: CGFloat) {
        let shape = circle(center, radius)
        context.fill(shape, with: .radialGradient(Gradient(colors: [.white.opacity(0.06), .white.opacity(0.4)]), center: center, startRadius: 0, endRadius: radius))
        context.stroke(shape, with: .conicGradient(iridescent, center: center, angle: .degrees(-40)), lineWidth: max(1, radius * 0.13))
        let highlight = CGRect(x: center.x - radius * 0.62, y: center.y - radius * 0.66, width: radius * 0.52, height: radius * 0.3)
        context.fill(Path(ellipseIn: highlight), with: .color(.white.opacity(0.9)))
    }

    // MARK: Paper: grain, cutout shapes with offset shadows

    private static func paper(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        background(&context, size, colors)
        let w = size.width, h = size.height
        grain(&context, size, color: colors.ink.opacity(0.1), count: 70, salt: 3)
        cutout(&context, circle(CGPoint(x: w * 0.7, y: h * 0.26), w * 0.14), color: colors.secondary)
        cutout(&context, hill(size, from: h * 0.62, peak: CGPoint(x: w * 0.3, y: h * 0.36), to: h * 0.7, seed: 1), color: colors.primary)
        cutout(&context, hill(size, from: h * 0.86, peak: CGPoint(x: w * 0.78, y: h * 0.52), to: h * 0.74, seed: 2), color: colors.accent)
    }

    private static func cutout(_ context: inout GraphicsContext, _ path: Path, color: Color) {
        context.fill(path.offsetBy(dx: 1.2, dy: 1.8), with: .color(.black.opacity(0.2)))
        context.fill(path, with: .color(color))
    }

    /// A hill across the tile with slightly uneven, hand-cut edges.
    private static func hill(_ size: CGSize, from startY: CGFloat, peak: CGPoint, to endY: CGFloat, seed: Int) -> Path {
        var path = Path()
        let start = CGPoint(x: -2, y: startY)
        let end = CGPoint(x: size.width + 2, y: endY)
        path.move(to: CGPoint(x: -2, y: size.height + 2))
        path.addLine(to: start)
        let steps = 16
        for step in 1...steps {
            let t = CGFloat(step) / CGFloat(steps)
            let x = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * peak.x + t * t * end.x
            let y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * peak.y + t * t * end.y
            let jitter = step == steps ? 0 : (noise(step, seed) - 0.5) * 1.4
            path.addLine(to: CGPoint(x: x, y: y + jitter))
        }
        path.addLine(to: CGPoint(x: size.width + 2, y: size.height + 2))
        path.closeSubpath()
        return path
    }

    // MARK: Pixel: dithered sky, pixel circle with a 1 px outline, blocks

    private static func pixel(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        let w = size.width, h = size.height
        let unit = max(2, (w / 16).rounded(.down))
        let columns = Int((w / unit).rounded(.up))
        let rows = Int((h / unit).rounded(.up))
        func cell(_ column: Int, _ row: Int) -> Path {
            Path(CGRect(x: CGFloat(column) * unit, y: CGFloat(row) * unit, width: unit, height: unit))
        }

        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(colors.bgTop))
        let bands = 4
        for band in 1..<bands {
            let top = rows * band / bands
            let shade = colors.bgBottom.opacity(Double(band) / Double(bands - 1))
            context.fill(Path(CGRect(x: 0, y: CGFloat(top) * unit, width: w, height: h)), with: .color(shade))
            for column in stride(from: band % 2, to: columns, by: 2) {
                context.fill(cell(column, top - 1), with: .color(shade))
            }
        }
        for index in 0..<7 {
            let column = Int(noise(index, 11) * CGFloat(columns))
            let row = Int(noise(index, 12) * CGFloat(rows) * 0.4)
            context.fill(cell(column, row), with: .color(colors.ink.opacity(index % 3 == 0 ? 0.9 : 0.5)))
        }

        let centerColumn = Double(columns) / 2
        let centerRow = Double(rows) * 0.42
        let radius = Double(columns) * 0.25
        for row in 0..<rows {
            for column in 0..<columns {
                let dx = Double(column) + 0.5 - centerColumn
                let dy = Double(row) + 0.5 - centerRow
                let distance = (dx * dx + dy * dy).squareRoot()
                guard distance <= radius else { continue }
                context.fill(cell(column, row), with: .color(distance > radius - 1 ? .black.opacity(0.55) : colors.primary))
            }
        }
        context.fill(cell(Int(centerColumn - radius * 0.45), Int(centerRow - radius * 0.45)), with: .color(.white.opacity(0.9)))

        let groundRow = rows - 3
        let groundY = CGFloat(groundRow) * unit
        context.fill(Path(CGRect(x: 0, y: groundY, width: w, height: h - groundY)), with: .color(colors.secondary))
        for row in groundRow..<rows {
            for column in 0..<columns where (row + column) % 2 == 0 {
                context.fill(cell(column, row), with: .color(.black.opacity(0.14)))
            }
        }
        context.fill(Path(CGRect(x: 0, y: groundY, width: w, height: unit / 2)), with: .color(colors.accent))
        context.fill(Path(CGRect(x: 0, y: groundY - 1, width: w, height: 1)), with: .color(.black.opacity(0.45)))
    }

    // MARK: Neon: near-black sky, outline sun with bloom, grid floor

    private static func neon(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        background(&context, size, colors)
        let w = size.width, h = size.height
        let horizon = h * 0.6
        for index in 0..<10 {
            let point = CGPoint(x: noise(index, 21) * w, y: noise(index, 22) * horizon * 0.8)
            context.fill(circle(point, 0.4 + noise(index, 23) * 0.5), with: .color(colors.ink.opacity(0.7)))
        }
        var sky = context
        sky.clip(to: Path(CGRect(x: 0, y: 0, width: w, height: horizon)))
        neonStroke(&sky, circle(CGPoint(x: w * 0.5, y: horizon - w * 0.06), w * 0.24), color: colors.secondary, width: 1.6)

        var lines = Path()
        lines.move(to: CGPoint(x: 0, y: horizon))
        lines.addLine(to: CGPoint(x: w, y: horizon))
        let vanishing = CGPoint(x: w / 2, y: horizon)
        for index in -5...5 {
            lines.move(to: vanishing)
            lines.addLine(to: CGPoint(x: w / 2 + CGFloat(index) * w * 0.2, y: h))
        }
        var y = horizon
        var gap: CGFloat = 2.5
        while y < h {
            y += gap
            gap *= 1.5
            lines.move(to: CGPoint(x: 0, y: y))
            lines.addLine(to: CGPoint(x: w, y: y))
        }
        var ground = context
        ground.clip(to: Path(CGRect(x: 0, y: horizon - 2, width: w, height: h - horizon + 2)))
        neonStroke(&ground, lines, color: colors.primary, width: 0.8)
    }

    /// An outline with bloom.
    private static func neonStroke(_ context: inout GraphicsContext, _ path: Path, color: Color, width: CGFloat) {
        var bloom = context
        bloom.addFilter(.blur(radius: width * 2))
        bloom.stroke(path, with: .color(color), lineWidth: width * 3)
        context.stroke(path, with: .color(color), lineWidth: width)
        context.stroke(path, with: .color(.white.opacity(0.6)), lineWidth: width * 0.35)
    }

    // MARK: Ink: off-white paper, wobbly outlines, hatching

    private static func ink(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        background(&context, size, colors)
        let w = size.width, h = size.height
        let center = CGPoint(x: w * 0.5, y: h * 0.42)
        let radius = w * 0.27
        var wash = context
        wash.addFilter(.blur(radius: 1.5))
        wash.fill(circle(CGPoint(x: center.x + 2, y: center.y + 2), radius * 0.9), with: .color(colors.primary.opacity(0.25)))

        let outline = wobblyCircle(center, radius, seed: 1.3)
        var shade = context
        shade.clip(to: outline)
        shade.clip(to: Path(CGRect(x: center.x - radius * 0.05, y: center.y - radius * 0.05, width: radius * 1.2, height: radius * 1.2)))
        var hatching = Path()
        var offset = -h
        while offset < w + h {
            hatching.move(to: CGPoint(x: offset, y: h))
            hatching.addLine(to: CGPoint(x: offset + h, y: 0))
            offset += 3
        }
        shade.stroke(hatching, with: .color(colors.ink.opacity(0.55)), lineWidth: 0.6)
        context.stroke(outline, with: .color(colors.ink), style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
        context.stroke(wobblyCircle(CGPoint(x: center.x + 0.8, y: center.y - 0.6), radius * 1.03, seed: 4.2), with: .color(colors.ink.opacity(0.45)), lineWidth: 0.7)

        var squiggle = Path()
        let baseline = h * 0.82
        squiggle.move(to: CGPoint(x: w * 0.12, y: baseline))
        for step in 1...20 {
            let x = w * 0.12 + CGFloat(step) * w * 0.76 / 20
            squiggle.addLine(to: CGPoint(x: x, y: baseline + sin(CGFloat(step) * 1.4) * 1.8))
        }
        context.stroke(squiggle, with: .color(colors.ink.opacity(0.85)), style: StrokeStyle(lineWidth: 1.1, lineCap: .round, lineJoin: .round))
        asterisk(&context, CGPoint(x: w * 0.8, y: h * 0.17), radius: w * 0.06, color: colors.secondary)
    }

    private static func asterisk(_ context: inout GraphicsContext, _ center: CGPoint, radius: CGFloat, color: Color) {
        var path = Path()
        for index in 0..<3 {
            let angle = Double(index) * .pi / 3
            let dx = CGFloat(cos(angle)) * radius
            let dy = CGFloat(sin(angle)) * radius
            path.move(to: CGPoint(x: center.x - dx, y: center.y - dy))
            path.addLine(to: CGPoint(x: center.x + dx, y: center.y + dy))
        }
        context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
    }

    // MARK: Clay: studio backdrop, soft 3D blobs, contact shadows

    private static func clay(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        let w = size.width, h = size.height
        let full = Path(CGRect(origin: .zero, size: size))
        context.fill(full, with: .radialGradient(Gradient(colors: [colors.bgTop, colors.bgBottom]), center: CGPoint(x: w * 0.5, y: h * 0.35), startRadius: 0, endRadius: h * 0.8))
        context.fill(full, with: .radialGradient(Gradient(colors: [.clear, .black.opacity(0.12)]), center: CGPoint(x: w * 0.5, y: h * 0.45), startRadius: w * 0.4, endRadius: h * 0.75))
        blob(&context, CGRect(x: w * 0.18, y: h * 0.26, width: w * 0.58, height: w * 0.54), color: colors.primary)
        blob(&context, CGRect(x: w * 0.6, y: h * 0.6, width: w * 0.27, height: w * 0.25), color: colors.secondary)
    }

    private static func blob(_ context: inout GraphicsContext, _ rect: CGRect, color: Color) {
        var shadow = context
        shadow.addFilter(.blur(radius: 2))
        let contact = CGRect(x: rect.minX + rect.width * 0.1, y: rect.maxY - rect.height * 0.1, width: rect.width * 0.8, height: rect.height * 0.18)
        shadow.fill(Path(ellipseIn: contact), with: .color(.black.opacity(0.25)))
        let shape = Path(ellipseIn: rect)
        let light = CGPoint(x: rect.minX + rect.width * 0.34, y: rect.minY + rect.height * 0.3)
        context.fill(shape, with: .color(color))
        context.fill(shape, with: .radialGradient(Gradient(colors: [.white.opacity(0.5), .white.opacity(0)]), center: light, startRadius: 0, endRadius: rect.width * 0.5))
        context.fill(shape, with: .radialGradient(Gradient(colors: [.black.opacity(0), .black.opacity(0.22)]), center: light, startRadius: rect.width * 0.35, endRadius: rect.width * 0.85))
        let specular = CGRect(x: light.x - rect.width * 0.08, y: light.y - rect.height * 0.08, width: rect.width * 0.14, height: rect.height * 0.1)
        context.fill(Path(ellipseIn: specular), with: .color(.white.opacity(0.9)))
    }

    // MARK: Riso: cream stock, halftone, spot colors off register

    private static func riso(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        background(&context, size, colors)
        let w = size.width, h = size.height
        var press = context
        press.blendMode = .multiply
        let center = CGPoint(x: w * 0.4, y: h * 0.4)
        let radius = w * 0.36
        let pitch: CGFloat = 3.2
        var row = 0
        var y: CGFloat = 0
        while y < h {
            var x: CGFloat = row % 2 == 0 ? 0 : pitch / 2
            while x < w {
                let distance = hypot(x - center.x, y - center.y)
                if distance < radius {
                    press.fill(circle(CGPoint(x: x, y: y), 0.35 + 1.15 * (1 - distance / radius)), with: .color(colors.primary))
                }
                x += pitch
            }
            y += pitch
            row += 1
        }
        let spot = circle(CGPoint(x: w * 0.58, y: h * 0.58), w * 0.22)
        press.fill(spot, with: .color(colors.secondary.opacity(0.9)))
        press.stroke(spot.offsetBy(dx: 1.5, dy: -1), with: .color(colors.primary), lineWidth: 1)
        context.fill(Path(CGRect(x: w * 0.12, y: h * 0.85, width: w * 0.5, height: 3)), with: .color(colors.ink.opacity(0.9)))
        context.fill(Path(CGRect(x: w * 0.12, y: h * 0.91, width: w * 0.32, height: 2)), with: .color(colors.ink.opacity(0.55)))
        grain(&context, size, color: colors.ink.opacity(0.12), count: 60, salt: 7)
    }

    // MARK: Chalk: slate with smudges, chalky strokes, dust

    private static func chalk(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        background(&context, size, colors)
        let w = size.width, h = size.height
        var smudge = context
        smudge.addFilter(.blur(radius: 5))
        smudge.fill(Path(ellipseIn: CGRect(x: w * 0.02, y: h * 0.58, width: w * 0.66, height: h * 0.18)), with: .color(.white.opacity(0.08)))
        smudge.fill(Path(ellipseIn: CGRect(x: w * 0.48, y: h * 0.08, width: w * 0.5, height: h * 0.14)), with: .color(.white.opacity(0.07)))

        let center = CGPoint(x: w * 0.5, y: h * 0.44)
        context.stroke(wobblyCircle(center, w * 0.25, seed: 2.1), with: .color(colors.ink.opacity(0.85)), style: StrokeStyle(lineWidth: 1.9, lineCap: .round, dash: [2.8, 1.1]))
        context.stroke(wobblyCircle(center, w * 0.26, seed: 5.3), with: .color(colors.ink.opacity(0.3)), style: StrokeStyle(lineWidth: 1.1, lineCap: .round, dash: [1.4, 2.2]))

        var plus = Path()
        let mark = CGPoint(x: w * 0.2, y: h * 0.17)
        plus.move(to: CGPoint(x: mark.x - 3.5, y: mark.y))
        plus.addLine(to: CGPoint(x: mark.x + 3.5, y: mark.y))
        plus.move(to: CGPoint(x: mark.x, y: mark.y - 3.5))
        plus.addLine(to: CGPoint(x: mark.x, y: mark.y + 3.5))
        context.stroke(plus, with: .color(colors.primary.opacity(0.9)), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))

        var underline = Path()
        underline.move(to: CGPoint(x: w * 0.18, y: h * 0.82))
        underline.addQuadCurve(to: CGPoint(x: w * 0.82, y: h * 0.8), control: CGPoint(x: w * 0.5, y: h * 0.88))
        context.stroke(underline, with: .color(colors.secondary.opacity(0.85)), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [3.5, 1.2]))
        grain(&context, size, color: .white.opacity(0.25), count: 30, salt: 9)
    }

    // MARK: Helpers

    private static func background(_ context: inout GraphicsContext, _ size: CGSize, _ colors: StudioLookColors) {
        context.fill(
            Path(CGRect(origin: .zero, size: size)),
            with: .linearGradient(
                Gradient(colors: [colors.bgTop, colors.bgBottom]),
                startPoint: .zero,
                endPoint: CGPoint(x: size.width * 0.35, y: size.height)
            )
        )
    }

    private static func circle(_ center: CGPoint, _ radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    }

    /// A hand-drawn circle: the radius wobbles a little, the same way every time.
    private static func wobblyCircle(_ center: CGPoint, _ radius: CGFloat, seed: Double) -> Path {
        var path = Path()
        let steps = 44
        for step in 0...steps {
            let angle = Double(step) / Double(steps) * 2 * .pi
            let wobble = 1 + 0.035 * sin(angle * 3 + seed) + 0.02 * sin(angle * 7 + seed * 2)
            let point = CGPoint(x: center.x + CGFloat(cos(angle) * wobble) * radius, y: center.y + CGFloat(sin(angle) * wobble) * radius)
            if step == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }

    private static func grain(_ context: inout GraphicsContext, _ size: CGSize, color: Color, count: Int, salt: Int) {
        for index in 0..<count {
            let dot = CGRect(x: noise(index, salt) * size.width, y: noise(index, salt + 1) * size.height, width: 0.9, height: 0.9)
            context.fill(Path(ellipseIn: dot), with: .color(color))
        }
    }

    /// Deterministic 0...1 noise, so previews look the same on every render.
    private static func noise(_ index: Int, _ salt: Int) -> CGFloat {
        let value = sin(Double(index) * 12.9898 + Double(salt) * 78.233) * 43_758.5453
        return CGFloat(value - value.rounded(.down))
    }
}

// MARK: - Controls

/// One tile in the Ask step's look picker.
struct StudioLookTile: View {
    /// nil is "Muse picks".
    let look: StudioLook?
    let isSelected: Bool
    let action: () -> Void

    private let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                preview
                    .frame(width: 64, height: 80)
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(Color.white.opacity(0.55), lineWidth: 0.75))
                    .padding(3)
                    .overlay {
                        RoundedRectangle(cornerRadius: 17, style: .continuous)
                            .strokeBorder(isSelected ? AnyShapeStyle(BubbleGlow.iridescent) : AnyShapeStyle(Color.clear), lineWidth: 2.5)
                    }
                    .shadow(color: .black.opacity(isSelected ? 0.14 : 0.06), radius: isSelected ? 8 : 4, y: 3)
                    .scaleEffect(isSelected ? 1.04 : 1)
                Text(look?.shortTitle ?? "Muse picks")
                    .font(isSelected ? .fbCaptionEmphasized : .fbCaption)
                    .foregroundStyle(isSelected ? FBColor.primaryText : FBColor.secondaryText)
                    .lineLimit(1)
            }
            .frame(width: 74)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .animation(.spring(response: 0.3, dampingFraction: 0.65), value: isSelected)
        .accessibilityLabel(look.map { "\($0.title) look" } ?? "Muse picks the look")
        .accessibilityHint(look?.feel ?? "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    private var preview: some View {
        if let look {
            StudioLookPreview(look: look)
        } else {
            StudioMusePicksPreview()
        }
    }
}

/// A look in words beside a small preview: "Paper cutout" over "Warm sunset colors · hills".
struct StudioLookRow<Accessory: View>: View {
    /// nil is "Muse picks".
    let look: StudioLook?
    /// The Bubble's own colors, when it has them.
    var colors: StudioLookColors? = nil
    let title: String
    let detail: String
    @ViewBuilder var accessory: Accessory

    private let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)

    var body: some View {
        HStack(spacing: FBSpacing.m) {
            preview
                .frame(width: 40, height: 50)
                .clipShape(shape)
                .overlay(shape.strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(detail)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            accessory
        }
    }

    @ViewBuilder
    private var preview: some View {
        if let look {
            StudioLookPreview(look: look, colors: colors)
        } else {
            StudioMusePicksPreview()
        }
    }
}

/// A chip that opens the list of looks.
struct StudioLookMenu: View {
    let title: String
    var header: String? = nil
    /// Checked in the list.
    let current: StudioLook?
    var includesMusePicks = false
    let onSelect: (StudioLook?) -> Void

    var body: some View {
        Menu {
            Section {
                if includesMusePicks {
                    item(nil)
                }
                ForEach(StudioLook.allCases) { look in
                    item(look)
                }
            } header: {
                if let header {
                    Text(header)
                }
            }
        } label: {
            StudioChipLabel(title: title, trailingSymbol: "chevron.down")
        }
        .accessibilityLabel("\(title) look")
    }

    private func item(_ look: StudioLook?) -> some View {
        Button {
            Haptics.selection()
            onSelect(look)
        } label: {
            Label(look?.title ?? "Muse picks", systemImage: look == current ? "checkmark" : (look?.symbol ?? "sparkles"))
        }
    }
}

#Preview("Looks") {
    ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView(.horizontal) {
                HStack(spacing: 12) {
                    StudioLookTile(look: nil, isSelected: true) {}
                    ForEach(StudioLook.allCases) { look in
                        StudioLookTile(look: look, isSelected: false) {}
                    }
                }
                .padding()
            }
            ForEach(StudioLook.allCases) { look in
                let style = look.applied(to: BubbleStyle(motif: "hills"))
                StudioLookRow(look: look, colors: StudioLookColors(style: style), title: look.title, detail: StudioLookWords.detail(for: style)) {
                    StudioLookMenu(title: "Change", current: look) { _ in }
                }
                .padding(.horizontal)
            }
        }
    }
    .background(StudioBackdrop())
}
