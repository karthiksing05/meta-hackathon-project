import Foundation

/// Turns Muse's drafts into complete manifests ("compiled at publish", docs/BUBBLES.md 4.8): the
/// identity each mode needs (ids, versions, lineage, chains, seeds), every param default filled in
/// and `engine_version` pinned. Also the last-resort deterministic repairs.
struct StudioManifestBuilder {
    struct Identity: Sendable {
        var id: String
        var version: Int
        var lineage: BubbleLineage
        var chain: BubbleChainLink?
        var structure: BubbleStructure
        var seed: Int
    }

    enum BuildError: Error, LocalizedError {
        case notAnObject
        case unknownFormula(String)
        case noConcepts
        case decode(String)

        var errorDescription: String? {
            switch self {
            case .notAnObject: return "The draft must be a JSON object."
            case .unknownFormula(let id): return "Unknown formula \"\(id)\"."
            case .noConcepts: return "The draft has no concepts."
            case .decode(let message): return "The draft doesn't fit the manifest shape: \(message)"
            }
        }
    }

    let request: StudioRequest
    let catalog: StudioCatalog
    /// Random per Studio run, so ids stay stable while Muse revises the title.
    let suffix: String
    let randomSeed: Int
    let today: String

    init(request: StudioRequest, catalog: StudioCatalog, suffix: String? = nil, seed: Int? = nil, today: String? = nil) {
        self.request = request
        self.catalog = catalog
        self.suffix = suffix ?? Self.randomSuffix()
        self.randomSeed = seed ?? Int.random(in: 1_000...2_000_000_000)
        self.today = today ?? Self.dayKey(Date())
    }

    /// The mode's base, when the mode needs one and the request has it.
    var base: BubbleManifest? {
        switch request.mode {
        case .edit, .remix, .nextLevel: return request.base
        case .create, .daily: return nil
        }
    }

    /// The mode actually used: edit, remix and next level need a base.
    var effectiveMode: StudioMode {
        switch request.mode {
        case .edit, .remix, .nextLevel: return request.base == nil ? .create : request.mode
        case .create, .daily: return request.mode
        }
    }

    // MARK: - Identity

    func identity(title: String, operators: [String]) -> Identity {
        let ops = Self.unique(operators)
        switch effectiveMode {
        case .create:
            return Identity(
                id: newID(title: title),
                version: 1,
                lineage: BubbleLineage(parent: nil, operators: ops, remixOf: nil),
                chain: nil,
                structure: BubbleStructure(cadence: "endless", scope: request.scope, setter: "ai"),
                seed: randomSeed
            )
        case .edit:
            let base = request.base!
            return Identity(
                id: base.id,
                version: base.version + 1,
                lineage: BubbleLineage(parent: base.id, operators: ops.isEmpty ? ["edit"] : ops, remixOf: base.lineage.remixOf),
                chain: base.chain,
                structure: base.structure,
                seed: base.seed
            )
        case .remix:
            let base = request.base!
            let cadence = base.structure.cadence == "daily" ? "endless" : base.structure.cadence
            return Identity(
                id: newID(title: title),
                version: 1,
                lineage: BubbleLineage(parent: base.id, operators: Self.unique(["remix"] + ops), remixOf: base.id),
                chain: nil,
                structure: BubbleStructure(cadence: cadence, scope: request.scope, setter: "ai"),
                seed: randomSeed
            )
        case .nextLevel:
            let base = request.base!
            return Identity(
                id: newID(title: title),
                version: 1,
                lineage: BubbleLineage(parent: base.id, operators: Self.unique(["next-level"] + ops), remixOf: nil),
                chain: nextChainLink(after: base, title: title),
                structure: base.structure,
                seed: randomSeed
            )
        case .daily:
            let day = request.date ?? today
            return Identity(
                id: "\(dailyPrefix)-daily-\(day)",
                version: 1,
                lineage: BubbleLineage(parent: nil, operators: ops, remixOf: nil),
                chain: nil,
                structure: BubbleStructure(cadence: "daily", scope: request.scope, setter: "ai"),
                seed: Int(day.filter(\.isNumber)) ?? randomSeed
            )
        }
    }

    func nextChainLink(after base: BubbleManifest, title: String) -> BubbleChainLink {
        BubbleChainLink(
            id: base.chain?.id ?? "chain-\(base.id)",
            index: (base.chain?.index ?? 1) + 1,
            title: base.chain?.title ?? base.title,
            prev: base.id,
            next: nil
        )
    }

    /// next_level: the base with its chain link pointing at the new level.
    func baseUpdate(for manifest: BubbleManifest) -> BubbleManifest? {
        guard effectiveMode == .nextLevel, var base = request.base, let link = manifest.chain else { return nil }
        base.chain = BubbleChainLink(
            id: link.id,
            index: base.chain?.index ?? max(link.index - 1, 1),
            title: base.chain?.title ?? link.title ?? base.title,
            prev: base.chain?.prev,
            next: manifest.id
        )
        return base
    }

    private var dailyPrefix: String {
        var scope = request.scope
        if scope.hasPrefix("group:") { scope = String(scope.dropFirst("group:".count)) }
        if scope.hasPrefix("group-") { scope = String(scope.dropFirst("group-".count)) }
        let slug = Self.slug(scope)
        return slug.isEmpty ? "group" : slug
    }

    private func newID(title: String) -> String {
        let slug = Self.slug(title)
        var id = "\(slug.isEmpty ? "bubble" : slug)-\(suffix)"
        if let base = request.base, base.id == id {
            id += "-2"
        }
        return id
    }

    // MARK: - Draft → manifest

    /// Builds a complete manifest from Muse's draft plus content Ember wrote.
    func manifest(fromDraft rawDraft: JSONValue, brief: BubbleBrief, contentStore: [String: JSONValue], fallbackFormula: String?, models: [String]) throws -> BubbleManifest {
        guard let draft = Self.unwrapDraft(rawDraft).object else { throw BuildError.notAnObject }

        let formulaID = (draft["formula"]?.string ?? fallbackFormula ?? base?.formula.rawValue ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        guard BubbleFormula(rawValue: formulaID) != nil, catalog.isEmpty || catalog.formula(formulaID) != nil else {
            throw BuildError.unknownFormula(formulaID)
        }

        let concepts = Self.normalizeConcepts(draft["concepts"])
        guard !concepts.isEmpty else { throw BuildError.noConcepts }

        let example = catalog.formula(formulaID)?.example
        let title = Self.cleanTitle(draft["title"]?.string) ?? base?.title ?? example?["title"]?.string ?? "New bubble"
        var rule = (draft["one_line_rule"]?.string ?? draft["rule"]?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if rule.isEmpty { rule = base?.oneLineRule ?? example?["one_line_rule"]?.string ?? "Tap to play." }

        let operators = draft["operators"]?.strings ?? []
        let identity = identity(title: title, operators: operators)

        let style = style(fromDraft: draft, brief: brief, formula: formulaID, example: example)

        var content = (draft["content"]?.object) ?? [:]
        for (key, value) in contentStore {
            Self.setIfMissing(&content, path: key, value: value)
        }

        var briefOut = brief
        if briefOut.audience.isEmpty { briefOut.audience = request.scope }
        if request.mode == .daily && briefOut.occasion == nil { briefOut.occasion = "daily" }

        var object: [String: JSONValue] = [
            "id": .string(identity.id),
            "version": .number(Double(identity.version)),
            "engine_version": .number(Double(catalog.engineVersion)),
            "title": .string(title),
            "one_line_rule": .string(rule),
            "formula": .string(formulaID),
            "brief": (try? JSONValue.encode(briefOut)) ?? .object([:]),
            "structure": (try? JSONValue.encode(identity.structure)) ?? .object([:]),
            "lineage": (try? JSONValue.encode(identity.lineage)) ?? .object([:]),
            "chain": identity.chain.flatMap { try? JSONValue.encode($0) } ?? .null,
            "style": .object(style),
            "concepts": .array(concepts),
            "glue": Self.normalizeGlue(draft["glue"]),
            "content": .object(content),
            "seed": .number(Double(identity.seed)),
        ]
        object["studio"] = [
            "models": .array(models.map { .string($0) }),
            "created_at": .string(Self.timestamp(Date())),
            "offline": false,
        ]
        do {
            return try JSONValue.object(object).decode(BubbleManifest.self)
        } catch {
            throw BuildError.decode(String(describing: error).prefix(200).description)
        }
    }

    /// Fills every param default from the catalog and pins `engine_version`. Returns how many
    /// params were filled.
    func compiled(_ manifest: BubbleManifest) -> (manifest: BubbleManifest, filled: Int) {
        var out = manifest
        var filled = 0
        for index in out.concepts.indices {
            guard let concept = catalog.concept(out.concepts[index].use) else { continue }
            var params = out.concepts[index].params ?? [:]
            for (name, spec) in concept.params where params[name] == nil {
                if let value = spec["default"], !value.isNull {
                    params[name] = value
                    filled += 1
                }
            }
            out.concepts[index].params = params.isEmpty ? nil : params
        }
        if !catalog.isEmpty {
            out.engineVersion = catalog.engineVersion
        }
        return (out, filled)
    }

    func stamped(_ manifest: BubbleManifest, models: [String], started: Date, offline: Bool, coverPrompt: String?) -> BubbleManifest {
        var out = manifest
        out.studio = StudioStamp(
            models: models,
            createdAt: Self.timestamp(Date()),
            durationSec: (Date().timeIntervalSince(started) * 10).rounded() / 10,
            offline: offline
        )
        if let coverPrompt { out.style.coverPrompt = coverPrompt }
        if !catalog.isEmpty { out.engineVersion = catalog.engineVersion }
        return out
    }

    // MARK: - Look (LOOKS.md)

    /// The creator's look choice. Studio sends it in `paletteHint`: a look id there means the look,
    /// anything else is a palette. Next levels keep the chain's look, so they ignore it.
    var lookHint: BubbleLookSpec? {
        guard effectiveMode != .nextLevel, let hint = request.paletteHint else { return nil }
        return catalog.look(hint)
    }

    /// `paletteHint` when it names a preset palette.
    var paletteHintPreset: String? {
        guard let hint = request.paletteHint, catalog.isPreset(hint) else { return nil }
        return hint
    }

    /// True when an edit, remix or next level keeps the base's look: no look picked in Studio and the
    /// request doesn't ask for a new look or theme ("How Muse picks").
    var keepsBaseLook: Bool {
        guard let base else { return false }
        if let hint = lookHint { return hint.id == base.style.look }
        return !BubbleLookSpec.changeRequested(request.prompt, looks: catalog.looks)
    }

    /// The look Studio picks from the request alone: the base's when it is kept, otherwise the best
    /// fit for the words, mood and formula. `avoid` (recent looks) loses ties, so new Bubbles vary.
    func defaultLook(brief: BubbleBrief, formula: String?, avoid: [String] = []) -> BubbleLookSpec {
        if let base, keepsBaseLook, let look = catalog.look(base.style.look) { return look }
        if let hint = lookHint { return hint }
        let text = [request.prompt, brief.intent, brief.mood.joined(separator: " "), brief.occasion ?? ""].joined(separator: " ")
        return BubbleLookSpec.pick(text: text, brief: brief, formula: formula, available: catalog.looks,
                               salt: request.prompt + request.scope, avoid: avoid)
    }

    /// A draft's style as a complete, legible manifest `style`:
    /// - edits, remixes and next levels keep the base's look unless the request asks for a new one;
    /// - an unknown look becomes the closest fit; fonts and motifs must be ones the runtime knows;
    /// - `palette` is a preset, or `custom` with every color role filled and ink at 4.5:1 on both
    ///   backgrounds. Custom colors need a runtime that lists looks; older ones get a preset.
    func style(fromDraft draft: [String: JSONValue], brief: BubbleBrief, formula: String, example: JSONValue?) -> [String: JSONValue] {
        let given = draft["style"]?.object ?? [:]
        func text(_ key: String) -> String? {
            let value = (given[key]?.string ?? draft[key]?.string)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return value?.isEmpty == false ? value : nil
        }
        var out: [String: JSONValue] = [:]
        if let emoji = text("emoji").flatMap(Self.firstEmoji) ?? base?.style.emoji ?? example?["style"]?["emoji"]?.string {
            out["emoji"] = .string(emoji)
        }
        if let preset = text("mood_preset") ?? brief.mood.first ?? base?.style.moodPreset {
            out["mood_preset"] = .string(preset)
        }

        if let base, keepsBaseLook {
            let kept = Self.styleJSON(base.style)
            for key in ["look", "palette", "colors", "font", "motif"] {
                if let value = kept[key], !value.isNull { out[key] = value }
            }
            return out
        }

        let lookText = text("look")
        let look: BubbleLookSpec
        if let hint = lookHint {
            look = hint
        } else if let named = catalog.look(lookText) {
            look = named
        } else if let lookText {
            look = BubbleLookSpec.pick(text: "\(lookText) \(request.prompt) \(brief.intent)", brief: brief, formula: formula,
                                   available: catalog.looks, salt: request.prompt)
        } else if let base, let baseLook = catalog.look(base.style.look) {
            look = baseLook
        } else {
            look = defaultLook(brief: brief, formula: formula)
        }
        out["look"] = .string(look.id)
        let sameLookAsBase = base?.style.look == look.id

        let palette = text("palette")?.lowercased()
        let colors = StudioColors.colors(from: given["colors"] ?? draft["colors"])
        if request.mode == .create, let hint = paletteHintPreset {
            out["palette"] = .string(hint)
        } else if let palette, catalog.isPreset(palette) {
            out["palette"] = .string(palette)
        } else if palette == "custom" || colors != nil {
            out.merge(customPalette(colors, look: look, brief: brief)) { _, new in new }
        } else if let base, sameLookAsBase {
            let kept = Self.styleJSON(base.style)
            out["palette"] = kept["palette"] ?? .string(base.style.palette)
            if let keptColors = kept["colors"], !keptColors.isNull { out["colors"] = keptColors }
        } else {
            out.merge(defaultPalette(look: look, brief: brief)) { _, new in new }
        }

        let font = text("font")?.lowercased()
        out["font"] = .string(font.flatMap { catalog.fontIDs.contains($0) ? $0 : nil }
                              ?? (sameLookAsBase ? base?.style.font : nil) ?? look.fonts.first ?? "rounded")
        let motif = text("motif")?.lowercased()
        if let motif = motif.flatMap({ catalog.motifIDs.contains($0) ? $0 : nil }) ?? base?.style.motif {
            out["motif"] = .string(motif)
        }
        return out
    }

    /// An early stand-in for the Bubble, so Studio can preview its identity (title, emoji, look and
    /// colors) while Muse composes: the base, or the formula's example, dressed in them.
    func preview(title: String, emoji: String?, look: BubbleLookSpec, formula: String?, brief: BubbleBrief) -> BubbleManifest? {
        var out: BubbleManifest
        if let base {
            out = base
        } else if let formula, let example = exampleManifest(for: formula) {
            out = example
        } else if let example = catalog.formulas.lazy.compactMap({ exampleManifest(for: $0.id) }).first {
            out = example
        } else {
            return nil
        }
        let identity = identity(title: title, operators: [])
        out.id = identity.id
        out.version = identity.version
        out.lineage = identity.lineage
        out.chain = identity.chain
        out.structure = identity.structure
        out.seed = identity.seed
        out.title = title
        out.brief = brief
        var draftStyle: [String: JSONValue] = ["look": .string(look.id)]
        if let emoji { draftStyle["emoji"] = .string(emoji) }
        let style = style(fromDraft: ["style": .object(draftStyle)], brief: brief, formula: out.formula.rawValue, example: nil)
        if let decoded = try? JSONValue.object(style).decode(BubbleStyle.self) {
            out.style = decoded
        }
        out.studio = nil
        return compiled(out).manifest
    }

    /// `custom` colors, completed from the look's example colors and made legible; a preset when
    /// the runtime doesn't take custom colors.
    func customPalette(_ colors: BubbleColors?, look: BubbleLookSpec, brief: BubbleBrief) -> [String: JSONValue] {
        guard catalog.supportsCustomColors else {
            return ["palette": .string(Self.nearestPreset(colors, among: catalog.paletteIDs) ?? defaultPreset(look: look, brief: brief))]
        }
        let template = look.exampleColors.first ?? StudioPalette.named(defaultPreset(look: look, brief: brief))?.colors
        let legible = StudioColors.legible(StudioColors.complete(colors, template: template))
        return ["palette": "custom", "colors": StudioColors.json(legible.colors)]
    }

    /// Glow wears its pastel presets; other looks start from their own example colors.
    func defaultPalette(look: BubbleLookSpec, brief: BubbleBrief) -> [String: JSONValue] {
        guard look.id != "glow", catalog.supportsCustomColors, !look.exampleColors.isEmpty else {
            return ["palette": .string(defaultPreset(look: look, brief: brief))]
        }
        let index = Int(BubbleLookSpec.stableHash(request.prompt + request.scope + look.id) % UInt64(look.exampleColors.count))
        return ["palette": "custom", "colors": StudioColors.json(StudioColors.legible(look.exampleColors[index]).colors)]
    }

    /// The preset for a look when only presets are available: the dark one for dark looks.
    func defaultPreset(look: BubbleLookSpec, brief: BubbleBrief) -> String {
        if let colors = look.exampleColors.first, let top = colors.bgTop, StudioColors.luminance(top) < 0.1,
           catalog.isPreset("night-bloom") {
            return "night-bloom"
        }
        return resolvePalette(nil, brief: brief)
    }

    static func nearestPreset(_ colors: BubbleColors?, among ids: [String]) -> String? {
        guard let colors, let top = colors.bgTop ?? colors.bgBottom, let a = StudioColors.rgb(top) else { return nil }
        let bottom = StudioColors.rgb(colors.bgBottom ?? top) ?? a
        return StudioPalette.all.filter { ids.contains($0.id) }.min { x, y in
            func distance(_ palette: StudioPalette) -> Double {
                guard let t = StudioColors.rgb(palette.top), let b = StudioColors.rgb(palette.bottom) else { return .infinity }
                return pow(t.r - a.r, 2) + pow(t.g - a.g, 2) + pow(t.b - a.b, 2) + pow(b.r - bottom.r, 2) + pow(b.g - bottom.g, 2) + pow(b.b - bottom.b, 2)
            }
            return distance(x) < distance(y)
        }?.id
    }

    static func styleJSON(_ style: BubbleStyle) -> [String: JSONValue] {
        (try? JSONValue.encode(style))?.object ?? [:]
    }

    /// The colors a style shows, in words ("cream, tomato red and teal").
    func colorWords(_ style: BubbleStyle) -> String {
        if style.palette == "custom", let colors = style.colors {
            return StudioColors.words(colors)
        }
        return StudioPalette.named(style.palette)?.words ?? StudioPalette.all[0].words
    }

    func resolvePalette(_ requested: String?, brief: BubbleBrief) -> String {
        if let hint = paletteHintPreset, request.mode == .create {
            return hint
        }
        if let requested, StudioPalette.named(requested) != nil { return requested }
        if let base = base, StudioPalette.named(base.style.palette) != nil { return base.style.palette }
        return Self.palette(forMood: brief.mood + [brief.intent])
    }

    // MARK: - Deterministic repairs

    /// Last-resort fixes when Muse's repairs ran out: clamp params, drop unknown concepts and
    /// broken glue, add missing core concepts, then fall back to the formula example's concepts
    /// (keeping Muse's params) and finally its content.
    func autofix(_ manifest: BubbleManifest, validate: (BubbleManifest) async -> BubbleJSRuntime.Validation) async -> (manifest: BubbleManifest, fixes: [String])? {
        var current = manifest
        var fixes: [String] = []
        var result = await validate(current)
        if result.ok { return (current, fixes) }

        // Pass 1: targeted fixes.
        for issue in result.errors {
            let index = Self.conceptIndex(in: issue.path ?? "") ?? Self.conceptIndex(fromMessage: issue.message, in: current)
            let param = Self.paramName(in: issue.path ?? "") ?? Self.paramName(fromMessage: issue.message)
            switch issue.code {
            case "unknown_concept", "formula_mismatch":
                if let index, current.concepts.indices.contains(index) {
                    fixes.append("dropped \(current.concepts[index].use)")
                    current.concepts[index].use = "__drop__"
                }
            case "param_range", "param_type":
                if let index, let param, current.concepts.indices.contains(index),
                   let spec = catalog.concept(current.concepts[index].use)?.params[param] {
                    var params = current.concepts[index].params ?? [:]
                    if issue.code == "param_range", let value = params[param]?.double {
                        let low = spec["min"]?.double ?? value
                        let high = spec["max"]?.double ?? value
                        var clamped = min(max(value, low), high)
                        if spec["type"]?.string == "integer" { clamped = clamped.rounded() }
                        params[param] = .number(clamped)
                    } else if let fallback = spec["default"] {
                        params[param] = fallback
                    } else {
                        params.removeValue(forKey: param)
                    }
                    current.concepts[index].params = params
                    fixes.append("reset \(param)")
                }
            case "glue_compile", "glue_forbidden", "glue_slot":
                if let key = current.glue.keys.first(where: { (issue.path ?? "").contains($0) || issue.message.contains($0) }) {
                    current.glue.removeValue(forKey: key)
                    fixes.append("removed glue \(key)")
                } else if !current.glue.isEmpty {
                    current.glue = [:]
                    fixes.append("removed glue")
                }
            case "missing_core", "requires":
                let formula = catalog.formula(current.formula.rawValue)
                let exampleIDs = exampleManifest(for: current.formula.rawValue)?.conceptIDs ?? []
                let core = (formula?.missingCore(in: current.conceptIDs) ?? []).compactMap { entry -> String? in
                    let options = entry.split(separator: "|").map(String.init)
                    return options.first { exampleIDs.contains($0) } ?? options.first
                }
                let named = issue.code == "requires" ? catalog.concepts.keys.filter { issue.message.contains($0) }.sorted() : []
                for id in core + named where !current.uses(id) && catalog.concept(id) != nil {
                    current.concepts.append(ConceptUse(id, params: exampleParams(for: id, formula: current.formula.rawValue)))
                    fixes.append("added \(id)")
                }
            case "style", "style_contrast":
                let look = catalog.look(current.style.look) ?? catalog.look("glow") ?? catalog.looks.first
                if let look, current.style.look != look.id {
                    current.style.look = look.id
                    fixes.append("switched to the \(look.id) look")
                }
                if current.style.palette == "custom" || current.style.colors != nil {
                    if catalog.supportsCustomColors {
                        current.style.palette = "custom"
                        current.style.colors = StudioColors.legible(StudioColors.complete(current.style.colors, template: look?.exampleColors.first)).colors
                        fixes.append("made the colors legible")
                    } else {
                        current.style.palette = Self.nearestPreset(current.style.colors, among: catalog.paletteIDs) ?? "lilac-haze"
                        current.style.colors = nil
                        fixes.append("used the \(current.style.palette) palette")
                    }
                } else if !catalog.isPreset(current.style.palette) {
                    current.style.palette = catalog.paletteIDs.first ?? "lilac-haze"
                }
                if let font = current.style.font, !catalog.fontIDs.contains(font) { current.style.font = look?.fonts.first }
                if let motif = current.style.motif, !catalog.motifIDs.contains(motif) { current.style.motif = nil }
            case "wiring", "conflicts":
                // A concept that listens for an event nothing emits, or clashes with another:
                // drop it unless the formula needs it.
                if let index, current.concepts.indices.contains(index), !isCore(current.concepts[index].use, formula: current.formula.rawValue) {
                    fixes.append("dropped \(current.concepts[index].use)")
                    current.concepts[index].use = "__drop__"
                }
            default:
                break
            }
        }
        current.concepts.removeAll { $0.use == "__drop__" }
        current = compiled(current).manifest
        result = await validate(current)
        if result.ok { return (current, fixes) }

        // Pass 2: the example's concepts, keeping Muse's params where the concept matches.
        if let example = exampleManifest(for: current.formula.rawValue) {
            let draftParams = Dictionary(current.concepts.map { ($0.use, $0.params) }, uniquingKeysWith: { first, _ in first })
            current.concepts = example.concepts.map { use in
                var merged = use.params ?? [:]
                for (key, value) in (draftParams[use.use] ?? nil) ?? [:] { merged[key] = value }
                return ConceptUse(use.use, params: merged.isEmpty ? nil : merged)
            }
            current.glue = [:]
            current = compiled(current).manifest
            fixes.append("rebuilt the concept list from the \(current.formula.rawValue) template")
            result = await validate(current)
            if result.ok { return (current, fixes) }

            // Pass 3: the example's params and content too.
            current.concepts = example.concepts
            current = compiled(current).manifest
            result = await validate(current)
            if result.ok { return (current, fixes + ["used the template's params"]) }
            current.content = example.content
            result = await validate(current)
            if result.ok { return (current, fixes + ["used the template's params and content"]) }
        }
        return nil
    }

    func isCore(_ concept: String, formula: String) -> Bool {
        catalog.formula(formula)?.coreIDs.contains(concept) ?? false
    }

    func exampleManifest(for formula: String) -> BubbleManifest? {
        guard let example = catalog.formula(formula)?.example else { return nil }
        return try? example.decode(BubbleManifest.self)
    }

    private func exampleParams(for concept: String, formula: String) -> [String: JSONValue]? {
        exampleManifest(for: formula)?.concepts.first { $0.use == concept }?.params
    }

    // MARK: - Draft form (what Muse reads and writes)

    /// The editable part of a manifest: what the composer reads for a base and writes back.
    static func draftForm(_ manifest: BubbleManifest) -> JSONValue {
        draftForm(json: (try? JSONValue.encode(manifest)) ?? .object([:]))
    }

    static func draftForm(json manifest: JSONValue) -> JSONValue {
        var out: [String: JSONValue] = [:]
        for key in ["formula", "title", "one_line_rule", "concepts", "glue", "content"] {
            if let value = manifest[key], !value.isNull { out[key] = value }
        }
        if let style = manifest["style"]?.object {
            var trimmed: [String: JSONValue] = [:]
            for key in ["look", "palette", "colors", "font", "motif", "emoji", "mood_preset"] where style[key] != nil && style[key]?.isNull == false {
                trimmed[key] = style[key]
            }
            out["style"] = .object(trimmed)
        }
        return .object(out)
    }

    /// Accepts `{"manifest": {...}}`, `{"manifest": "<json>"}` or the draft itself.
    static func unwrapDraft(_ value: JSONValue) -> JSONValue {
        if let inner = value["manifest"] {
            if inner.object != nil { return inner }
            if let text = inner.string, let parsed = MuseJSON.object(in: text) { return parsed }
        }
        if let inner = value["draft"], inner.object != nil { return inner }
        return value
    }

    static func normalizeConcepts(_ value: JSONValue?) -> [JSONValue] {
        var seen = Set<String>()
        var out: [JSONValue] = []
        for item in value?.array ?? [] {
            var use: String?
            var params: JSONValue?
            if let text = item.string {
                use = text
            } else if let object = item.object {
                use = object["use"]?.string ?? object["id"]?.string ?? object["concept"]?.string
                params = object["params"]
            }
            guard let id = use?.trimmingCharacters(in: .whitespaces), !id.isEmpty, seen.insert(id).inserted else { continue }
            var entry: [String: JSONValue] = ["use": .string(id)]
            if let params, let object = params.object, !object.isEmpty {
                entry["params"] = .object(object)
            }
            out.append(.object(entry))
        }
        return out
    }

    static func normalizeGlue(_ value: JSONValue?) -> JSONValue {
        var out: [String: JSONValue] = [:]
        if let object = value?.object {
            for (key, entry) in object {
                guard let slot = entry["slot"]?.string, let source = entry["source"]?.string, !source.isEmpty else { continue }
                var item: [String: JSONValue] = ["slot": .string(slot), "source": .string(source)]
                if let describe = entry["describe"]?.string { item["describe"] = .string(describe) }
                out[key.hasPrefix("glue.") ? key : "glue.\(key)"] = .object(item)
            }
        } else if let list = value?.array {
            for (index, entry) in list.enumerated() {
                guard let slot = entry["slot"]?.string, let source = entry["source"]?.string, !source.isEmpty else { continue }
                let name = entry["id"]?.string ?? entry["name"]?.string ?? "glue.\(slot)_\(index + 1)"
                var item: [String: JSONValue] = ["slot": .string(slot), "source": .string(source)]
                if let describe = entry["describe"]?.string { item["describe"] = .string(describe) }
                out[name.hasPrefix("glue.") ? name : "glue.\(name)"] = .object(item)
            }
        }
        return .object(out)
    }

    /// Sets `content[path]` (dotted for nested objects) unless something is already there.
    static func setIfMissing(_ content: inout [String: JSONValue], path: String, value: JSONValue) {
        let parts = path.split(separator: ".").map(String.init)
        guard let first = parts.first else { return }
        if parts.count == 1 {
            if content[first] == nil || content[first]?.isNull == true || content[first]?.string?.hasPrefix("@") == true {
                content[first] = value
            }
            return
        }
        var child = content[first]?.object ?? [:]
        setIfMissing(&child, path: parts.dropFirst().joined(separator: "."), value: value)
        content[first] = .object(child)
    }

    // MARK: - Text helpers

    static func cleanTitle(_ raw: String?) -> String? {
        guard var title = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else { return nil }
        title = title.trimmingCharacters(in: CharacterSet(charactersIn: "\"“”'"))
        title = title.unicodeScalars.filter { !($0.properties.isEmojiPresentation) }.map(String.init).joined()
        title = title.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if title.count > 32 { title = String(title.prefix(32)).trimmingCharacters(in: .whitespaces) }
        return title.isEmpty ? nil : title
    }

    static func firstEmoji(_ raw: String) -> String? {
        raw.first { character in
            character.unicodeScalars.contains { $0.properties.isEmojiPresentation || ($0.properties.isEmoji && $0.value > 0x238C) }
        }.map(String.init)
    }

    static func slug(_ text: String) -> String {
        var out = ""
        for character in text.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US")) {
            if character.isASCII && (character.isLetter || character.isNumber) {
                out.append(character)
            } else if !out.isEmpty && !out.hasSuffix("-") {
                out.append("-")
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        if out.count > 32 {
            out = String(out.prefix(32))
            while out.hasSuffix("-") { out.removeLast() }
        }
        return out
    }

    static func unique(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    static func palette(forMood words: [String]) -> String {
        let text = words.joined(separator: " ").lowercased()
        let table: [(String, [String])] = [
            ("night-bloom", ["night", "dark", "neon", "spooky", "late", "moon", "star", "music", "party"]),
            ("peach-fizz", ["warm", "sun", "food", "picnic", "cozy food", "bake", "taco", "summer", "hype", "silly"]),
            ("mint-pop", ["fresh", "park", "run", "green", "garden", "outdoor", "bike", "energetic"]),
            ("sky-glow", ["chill", "calm", "hill", "ocean", "beach", "sky", "fog", "dreamy", "relaxed"]),
            ("lilac-haze", ["cozy", "nostalgic", "daily", "soft", "playful", "word"]),
        ]
        for (palette, keys) in table where keys.contains(where: { text.contains($0) }) {
            return palette
        }
        return "lilac-haze"
    }

    static func randomSuffix() -> String {
        let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")
        return String((0..<4).map { _ in alphabet.randomElement()! })
    }

    static func dayKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    // MARK: - Issue paths

    /// `concepts[3]...`, `concepts.3...` or `/concepts/3/...` → 3.
    static func conceptIndex(in path: String) -> Int? {
        guard let range = path.range(of: "concepts") else { return nil }
        let rest = path[range.upperBound...].drop { !$0.isNumber && ($0 == "[" || $0 == "." || $0 == "/") }
        let digits = rest.prefix { $0.isNumber }
        return Int(digits)
    }

    static func conceptIndex(fromMessage message: String, in manifest: BubbleManifest) -> Int? {
        manifest.concepts.firstIndex { message.contains($0.use) }
    }

    /// `...params.strength`, `...params[strength]`, `.../params/strength` → "strength".
    static func paramName(in path: String) -> String? {
        guard let range = path.range(of: "params") else { return nil }
        let rest = path[range.upperBound...].drop { $0 == "." || $0 == "[" || $0 == "/" || $0 == "\"" || $0 == "'" }
        let name = rest.prefix { $0.isLetter || $0.isNumber || $0 == "_" }
        return name.isEmpty ? nil : String(name)
    }

    static func paramName(fromMessage message: String) -> String? {
        // e.g. "param speed is 9, above max 6" or "strength must be ≤ 0.9"
        let words = message.split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "_" && $0 != "." })
        for (index, word) in words.enumerated() where word == "param" || word == "parameter" {
            if index + 1 < words.count { return String(words[index + 1]).split(separator: ".").last.map(String.init) }
        }
        return nil
    }
}
