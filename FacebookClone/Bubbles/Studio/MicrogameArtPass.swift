import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// A second Muse pass that redraws a finished microgame's art (palette, backdrop and every sprite
/// role) after the game has passed the gate. In the blind tests in `authoring/harness/style/`, art
/// drawn this way, with Muse looking at the game's real layout, beat the art Muse writes inside the
/// manifest on 4 of 5 games judged by a person (run 3, 2026-11-12).
///
/// Steps:
/// 1. The page lists the art roles the game draws (fragment roles plus named sprites) and builds a
///    copy of the game with no art.
/// 2. The runtime draws that copy's poster: the real layout with placeholder shapes.
/// 3. Muse (JSON mode, with the poster attached) returns finished SVG for every role and a palette.
/// 4. The page puts the art into the authoring manifest and the expander checks it again.
///
/// Gameplay isn't touched, so the gate isn't rerun. Any failure leaves the game's own art as it was.
/// Off with `FB_STUDIO_ART_PASS=0`.
@MainActor
struct MicrogameArtPass {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.environment["FB_STUDIO_ART_PASS"] != "0"
    }

    struct Result {
        var expansion: MicrogameExpansion
        var model: String
        var seconds: Double
        /// Whether Muse saw the layout poster (false when the runtime couldn't draw one).
        var sawLayout: Bool
        var roles: [String]
    }

    enum ArtPassError: Error, LocalizedError {
        case badPage(String)
        case badReply(String)
        case rejected(String)

        var errorDescription: String? {
            switch self {
            case .badPage(let s): return "Art pass: the page returned \(s)"
            case .badReply(let s): return "Art pass: \(s)"
            case .rejected(let s): return "Art pass: the new art didn't validate: \(s)"
            }
        }
    }

    let muse: MuseClient
    let studio: MicrogameStudio
    var model: String

    func run(_ expansion: MicrogameExpansion, request: String, brief: BubbleBrief?) async throws -> Result {
        let started = Date()
        let authoring = expansion.authoringJSON.isEmpty ? (expansion.authoring.string ?? expansion.authoring.jsonString()) : expansion.authoringJSON

        // 1. Roles, the art-free copy and the prompt.
        let prepText = try await studio.run(Self.prepScript, arguments: ["authoring": authoring, "request": request], operation: "prepare the art pass")
        guard let prep = try? JSONValue.parse(prepText),
              let bare = prep["bare"]?.string, let system = prep["system"]?.string, let user = prep["user"]?.string,
              let roles = prep["roles"] else {
            throw ArtPassError.badPage(String(prepText.prefix(200)))
        }

        // 2. The layout: the art-free copy drawn by the runtime.
        var layout: Data?
        let bareExpansion = try await studio.expand(text: bare)
        if bareExpansion.ok {
            let id = "artpass-layout-\(StudioManifestBuilder.randomSuffix())"
            let manifest = try await studio.wrap(bareExpansion, id: id, brief: brief, emoji: nil, seed: 1)
            #if canImport(UIKit)
            // The app's runtime draws the poster; the macOS CLI has no runtime, so Muse goes without.
            // The pool draws on an idle warm host only; when every host is leased (Studio's own
            // preview, the feed), lease one for the still and give it back.
            let pool = BubbleRuntimePool.shared
            var poster = await pool.poster(for: manifest)
            if poster == nil {
                let host = pool.lease()
                let key = BubbleRuntimeHost.sessionKey(for: manifest)
                poster = await host.poster(key: key, manifest: manifest, size: pool.posterSize)
                host.evict(key)
                pool.giveBack(host)
            }
            layout = poster?.jpegData(compressionQuality: 0.8)
            #else
            _ = manifest
            #endif
        }

        // 3. Muse draws.
        var messages: [JSONValue] = [
            ["role": "system", "content": .string(system)],
            ["role": "user", "content": .string(user)],
        ]
        if let layout {
            messages.append([
                "role": "user",
                "content": [
                    ["type": "text", "text": "The game's layout with placeholder shapes:"],
                    ["type": "image_url", "image_url": ["url": .string("data:image/jpeg;base64," + layout.base64EncodedString())]],
                ],
            ])
        }
        var options = MuseClient.ChatOptions()
        options.maxTokens = 16_000
        options.json = true
        options.reasoningEffort = "low"
        options.timeout = 150
        options.maxAttempts = 2
        options.purpose = "microgame art"
        let reply = try await muse.chat(model: model, messages: messages, options: options)
        guard let art = MuseJSON.object(in: reply.content) else {
            throw ArtPassError.badReply("\(reply.model) didn't return a JSON object")
        }

        // 4. Into the manifest, and checked again.
        let drawnText = try await studio.run(Self.applyScript, arguments: ["authoring": authoring, "art": art.jsonString(), "roles": roles.jsonString()],
                                             operation: "apply the art")
        let drawn = try await studio.expand(text: drawnText)
        guard drawn.ok else {
            throw ArtPassError.rejected(drawn.errors.first?.line ?? "unknown error")
        }
        let seconds = Date().timeIntervalSince(started)
        let roleIDs = roles.array?.compactMap { $0["id"]?.string } ?? []
        Self.keepForDebugging(layout: layout, art: art, before: authoring, after: drawn.authoringJSON, roles: roleIDs, model: reply.model, seconds: seconds)
        return Result(expansion: drawn, model: reply.model, seconds: seconds, sawLayout: layout != nil, roles: roleIDs)
    }

    /// Debug builds keep the last pass's layout and Muse's reply in tmp/artpass/ for inspection.
    private static func keepForDebugging(layout: Data?, art: JSONValue, before: String, after: String, roles: [String], model: String, seconds: Double) {
        #if DEBUG
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("artpass", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let layout { try? layout.write(to: dir.appendingPathComponent("layout.jpg")) }
        try? Data(art.jsonString(pretty: true).utf8).write(to: dir.appendingPathComponent("art.json"))
        try? Data(before.utf8).write(to: dir.appendingPathComponent("authoring-before.json"))
        try? Data(after.utf8).write(to: dir.appendingPathComponent("authoring-after.json"))
        print("[MicrogameArtPass] layout \(layout == nil ? "missing" : "\(layout!.count) bytes"); \(model) drew \(roles.joined(separator: ", ")) in \(Int(seconds)) s; saved to \(dir.path)")
        #endif
    }

    // MARK: - Page scripts (ported from authoring/harness/style/engine-experiment.mjs)

    /// Arguments: `authoring` (text), `request`. Returns {roles, bare, system, user} as JSON text.
    static let prepScript = #"""
    const a = JSON.parse(authoring);
    const FRAGMENT_ROLES = { player_drag: ['avatar'], lanes: ['avatar'], gravity_jump: ['avatar', 'ground'], spawn_wave: ['hazard'], pickups: ['pickup'], lives: ['life'], grid_board: ['cell'], match_pairs: ['card'], tile_slide: ['tile'], sort_bins: ['bin'], sequence_memory: ['pad'], quiz: ['button'], choice_story: ['scene', 'button'] };
    const vbSize = (svg) => {
      const m = /viewBox\s*=\s*['"]\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg || '');
      return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : [64, 64];
    };
    const roles = [{ id: 'backdrop', kind: 'backdrop', width: 360, height: 640, play: 360, frames: 1, purpose: 'the full-screen backdrop behind everything' }];
    const seen = new Set();
    const sprites = (a.art && a.art.sprites) || {};
    const add = (id, purpose, svg) => {
      if (seen.has(id)) return; seen.add(id);
      const first = Array.isArray(svg) ? svg[0] : svg;
      const [w, h] = vbSize(first);
      roles.push({ id, kind: 'sprite', width: w, height: h, play: Math.min(72, Math.max(w, h)), frames: Array.isArray(svg) ? svg.length : 1, purpose });
    };
    for (const use of a.uses || []) {
      for (const role of FRAGMENT_ROLES[use.fragment] || []) {
        const name = (use.art && use.art[role]) || role;
        if (name === false) continue;
        add(name, `drawn by the ${use.fragment} fragment as its ${role}${use.params && use.params.kind ? ` (${use.params.kind})` : ''}`, sprites[name] && sprites[name].svg);
      }
    }
    for (const [name, s] of Object.entries(sprites)) add(name, 'a sprite the game draws by name', s && s.svg);

    const bare = Object.assign({}, a, { art: { palette: (a.art && a.art.palette) || {} } });
    const P = ['ink', 'surface', 'accent', 'primary', 'secondary', 'bg', 'danger'];
    const frames = (r) => r.frames > 1 ? ` Return a JSON array of ${r.frames} SVGs for this role, one per frame (variants such as different card faces or values), all the same size.` : '';
    const meta = a.meta || {};
    const system = [
      `Art-direct and draw a small phone game. Return one JSON object: ${roles.map((r) => r.id).join(', ')} as standalone SVG strings (each starts with <svg and has xmlns and the exact viewBox), plus "palette": {${P.map((r) => `"${r}"`).join(', ')}} as #RRGGBB (ink = text color, bg = background, surface = cards and panels, primary/secondary/accent = game colors, danger = warnings). The engine uses the palette for its HUD, text and controls.`,
      ...roles.map((r) => `${r.id}: viewBox "0 0 ${r.width} ${r.height}", ${r.kind === 'backdrop' ? 'opaque, full bleed' : `transparent, shown about ${r.play} px, subject centred and filling the box`}. ${r.purpose}${frames(r)}`),
      'Carry the requested style fully: palette, line, shading, texture, lighting and shape language. Any SVG drawing feature is fine: shapes, gradients, patterns, clip paths, masks, filters with local url(#id). No text, scripts, images, external references, links or animation. Sprites under 16 KB, backdrop under 40 KB.',
      "The attached image, when there is one, is this game rendered by the engine with placeholder shapes: it shows where each sprite sits and how big it is. The engine draws the HUD, score, text, buttons and controls on top of your art. Keep the backdrop calm wherever the game puts text, HUD or controls, and keep detail out of the play area so moving sprites stay readable. Use bg for the backdrop's main color.",
    ].join('\n');
    const user = `Game: ${meta.title || 'microgame'}: ${meta.instructions || ''} (The player asked for: ${request})`;
    return JSON.stringify({ roles, bare: JSON.stringify(bare), system, user });
    """#

    /// Arguments: `authoring` (text), `art` (Muse's reply, JSON text), `roles` (JSON text). Returns
    /// the authoring manifest with the new art, as text (key order kept).
    static let applyScript = #"""
    const a = JSON.parse(authoring);
    const pieces = JSON.parse(art);
    const rs = JSON.parse(roles);
    const asList = (v, n) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string').slice(0, Math.max(1, n));
    const old = a.art || {};
    const next = Object.assign({}, old);
    delete next.style;
    const palette = pieces.palette || {};
    next.palette = Object.fromEntries(['primary', 'secondary', 'accent', 'ink', 'bg', 'danger', 'surface']
      .filter((k) => /^#[0-9a-fA-F]{6}$/.test(palette[k] || '')).map((k) => [k, palette[k].toUpperCase()]));
    const back = pieces.backdrop && asList(pieces.backdrop, 1)[0];
    if (back) next.backdrop = { svg: back }; else delete next.backdrop;
    const sprites = {};
    for (const r of rs) {
      if (r.kind === 'backdrop' || !pieces[r.id]) continue;
      const list = asList(pieces[r.id], r.frames);
      const was = (old.sprites && old.sprites[r.id]) || {};
      const s = { svg: r.frames > 1 ? list : list[0] };
      if (was.w) s.w = was.w;
      if (was.h) s.h = was.h;
      if (was.fps) s.fps = was.fps;
      sprites[r.id] = s;
    }
    next.sprites = sprites;
    a.art = next;
    return JSON.stringify(a);
    """#
}
