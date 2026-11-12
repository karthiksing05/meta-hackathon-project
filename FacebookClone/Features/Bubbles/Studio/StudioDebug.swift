#if DEBUG
import Foundation
import SwiftUI

// DEBUG-only Studio helpers for screenshots and end-to-end runs (documented in StudioView.swift):
// `FB_STUDIO_STEP`, `FB_STUDIO_LOOK`, `FB_STUDIO_SERVICE=scripted`, `FB_STUDIO_SPEED`,
// `FB_STUDIO_FAIL`, `FB_STUDIO_AUTOPILOT`.

extension StudioModel {
    /// Applies `FB_STUDIO_STEP` and `FB_STUDIO_AUTOPILOT`. Called once from `attach`.
    func applyDebugLaunch() {
        if let look = StudioLook(id: DebugLaunch.value("FB_STUDIO_LOOK")) {
            lookHint = look
        }
        if let value = DebugLaunch.value("FB_STUDIO_STEP") {
            // "compose:4" shows the first 4 events.
            let parts = value.lowercased().split(separator: ":").map(String.init)
            applyDebugStep(parts[0], eventCount: parts.count > 1 ? Int(parts[1]) : nil)
        }
        if DebugLaunch.value("FB_STUDIO_AUTOPILOT") != nil {
            runAutopilot()
        }
    }

    // MARK: Fake steps

    private func applyDebugStep(_ step: String, eventCount: Int? = nil) {
        if trimmedPrompt.isEmpty && (mode == .create || mode == .daily) {
            prompt = mode == .daily ? "A daily word game for \(audienceName)" : "A chill game about SF hills for my running club"
        }
        guard step != "ask" else { return }

        if case .everyone = audience, mode == .create, let group = defaultGroup {
            setAudience(.group(group.id))
        }
        if sources.isEmpty, let group = audienceGroup {
            sources = StudioDebugData.sources(in: group).map { StudioSourceItem(post: $0, isIncluded: true) }
            if sources.count > 2 { sources[2].isIncluded = false }
        }
        brief = StudioDebugData.brief(scope: audience.scope, mode: mode)

        switch step {
        case "brief":
            stage = .brief
        case "compose", "error":
            let request = makeRequest(mode: mode, prompt: effectivePrompt, base: baseBubble?.manifest, brief: brief, look: lookHint)
            let script = StudioScript.events(for: request, template: StudioDebugData.template(from: bubbleStore))
            let shown = Array(script.prefix(eventCount ?? (step == "error" ? 6 : 8)))
            events = shown
            concepts = shown.compactMap(\.concepts).flatMap { $0 }
            draftManifest = shown.compactMap(\.manifest).last
            composeKind = .create
            let elapsed = (shown.last?.elapsed ?? 20) + 3
            composeStartedAt = Date().addingTimeInterval(-elapsed)
            lastEventAt = Date().addingTimeInterval(-3)
            lastRequest = request
            if step == "error" {
                isComposing = false
                composeEndedAt = Date()
                failure = StudioFailure(message: "Muse couldn't be reached. Check your connection and try again.", detail: nil)
            } else {
                isComposing = true
            }
            stage = .compose
        case "try", "float":
            if levels.isEmpty {
                let request = makeRequest(mode: mode, prompt: effectivePrompt, base: baseBubble?.manifest, brief: brief, look: lookHint)
                let script = StudioScript.events(for: request, template: StudioDebugData.template(from: bubbleStore))
                if let done = script.last, let manifest = done.manifest {
                    levels = [StudioResult(
                        manifest: manifest,
                        cover: nil,
                        isOffline: false,
                        duration: done.elapsed,
                        models: ["muse-wonder-1.0", "muse-ember-1.0", "muse-image-1.0"],
                        isExisting: false
                    )]
                }
            }
            stage = step == "try" ? .tryIt : .float
        default:
            break
        }
    }

    // MARK: Autopilot

    /// Drives the whole flow through the model, as a person would with taps.
    private func runAutopilot() {
        Task { @MainActor [weak self] in
            func log(_ text: String) {
                NSLog("[Studio autopilot] %@", text)
                StudioDebugLog.append("[Studio autopilot] " + text)
            }
            func pause(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            func wait(for condition: @escaping () -> Bool, timeout: Double = 180) async -> Bool {
                let deadline = Date().addingTimeInterval(timeout)
                while Date() < deadline {
                    if condition() { return true }
                    try? await Task.sleep(nanoseconds: 200_000_000)
                }
                return false
            }
            guard let model = self else { return }
            StudioDebugLog.reset()
            log("start mode=\(model.mode.rawValue) stage=\(model.stage) service=\(type(of: model.service))")
            await pause(1.5)

            if model.stage == .ask {
                if model.trimmedPrompt.isEmpty { model.prompt = model.examples.first ?? "A chill game about SF hills" }
                log("ask: \(model.effectivePrompt)")
                model.draftBrief()
                guard await wait(for: { model.stage == .brief }) else { return log("FAILED waiting for brief") }
                await pause(2.5)
            }
            if model.stage == .brief {
                log("brief: \(model.museReading) \(model.musePlan)")
                model.startCompose(.create)
                guard await wait(for: { model.stage == .tryIt || model.failure != nil }) else { return log("FAILED waiting for compose") }
                if let failure = model.failure { return log("compose failed: \(failure.message)") }
            }
            log("try: \(model.currentResult?.manifest.title ?? "?") id=\(model.currentResult?.id ?? "?") look=\(model.currentResult?.manifest.style.look ?? "?") events=\(model.events.count)")
            await pause(4)

            model.tweakText = "Make it a little slower"
            log("tweak: \(model.tweakText)")
            model.startCompose(.tweak)
            _ = await wait(for: { model.stage == .compose })
            guard await wait(for: { model.stage == .tryIt || model.failure != nil }) else { return log("FAILED waiting for tweak") }
            log("tweaked: version=\(model.currentResult?.manifest.version ?? 0)")
            await pause(3)

            if model.currentResultTakesLooks {
            let lookBefore = StudioLook(id: model.currentResult?.manifest.style.look) ?? .glow
            let newLook: StudioLook = lookBefore == .pixel ? .clay : .pixel
            log("new look: \(lookBefore.rawValue) -> \(newLook.rawValue)")
            model.changeLook(to: newLook)
            _ = await wait(for: { model.stage == .compose })
            guard await wait(for: { model.stage == .tryIt || model.failure != nil }) else { return log("FAILED waiting for look change") }
            let style = model.currentResult?.manifest.style
            log("look now: \(style?.look ?? "?") palette=\(style?.palette ?? "?") font=\(style?.font ?? "-") version=\(model.currentResult?.manifest.version ?? 0) words=\(style.map(StudioLookWords.detail(for:)) ?? "?")")
            await pause(3)
            }

            if model.canMakeNextLevel {
                log("next level: \(model.levelButtonNumber)")
                model.startCompose(.nextLevel)
                _ = await wait(for: { model.stage == .compose })
                guard await wait(for: { model.stage == .tryIt || model.failure != nil }) else { return log("FAILED waiting for level") }
                log("levels: \(model.levels.map { "\($0.manifest.title)#\($0.manifest.chain?.index ?? 0)" })")
                await pause(4)
            }

            model.go(to: .float)
            model.pickDefaultFriendsIfNeeded()
            log("share to \(model.destinationName), challenge \(model.challengedPeople.map(\.firstName))")
            await pause(3)
            let made = model.levels
            let countBefore = model.bubbleStore?.bubbles.count ?? 0
            model.requestFloat()
            await pause(2)
            guard let store = model.bubbleStore else { return log("FAILED no store") }
            log("store bubbles \(countBefore) -> \(store.bubbles.count)")
            for level in made {
                guard let bubble = store.bubble(id: level.id) else {
                    log("MISSING \(level.id)")
                    continue
                }
                let chain = bubble.manifest.chain.map { "\($0.id)#\($0.index) prev=\($0.prev ?? "-") next=\($0.next ?? "-")" } ?? "none"
                log("published \(bubble.id) v\(bubble.manifest.version) \"\(bubble.title)\" scope=\(bubble.manifest.structure.scope) group=\(bubble.group?.name ?? "-") event=\(bubble.event?.title ?? "-") chain=\(chain) cover=\(bubble.coverImageData != nil) look=\(bubble.manifest.style.look)/\(bubble.manifest.style.palette)")
            }
            if let first = made.first, let record = MakeRecordStore.shared.record(for: first.id) {
                log("make record: microgame=\(record.isMicrogame) blocks=\(record.concepts.count) repairs=\(record.repairs.count) playtest=\(record.playtest?.title ?? "-") lanes=\(record.playtest?.lanes.count ?? 0) sentTo=\(record.sentTo.map(\.name))")
            }
                        if !store.dailyBubbleIDs.isEmpty {
                log("daily bubbles: \(store.dailyBubbleIDs)")
            }
            log("done")
        }
    }
}

/// Appends autopilot lines to Documents/studio-autopilot.log (read it with
/// `xcrun simctl get_app_container <udid> com.karthiksing05.fbclone data`).
enum StudioDebugLog {
    static var url: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("studio-autopilot.log")
    }

    static func reset() {
        try? FileManager.default.removeItem(at: url)
    }

    static func append(_ line: String) {
        let data = Data((line + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }
}

// MARK: - Fake data

enum StudioDebugData {
    /// A real seed to build fake results from, so they play with the real runtime.
    @MainActor
    static func template(from store: BubbleStore?) -> [BubbleFormula: BubbleManifest] {
        var templates: [BubbleFormula: BubbleManifest] = [:]
        for bubble in store?.bubbles ?? [] where templates[bubble.formula] == nil {
            templates[bubble.formula] = bubble.manifest
        }
        if let hills = store?.bubble(id: "hill-hopper")?.manifest {
            templates[.dodge] = hills
        }
        return templates
    }

    static func brief(scope: String, mode: StudioMode) -> BubbleBrief {
        BubbleBrief(
            intent: mode == .daily ? "learn the city with your new group" : "a chill game about SF hills for a running club",
            audience: scope,
            mood: ["calm", "nostalgic"],
            energy: "low",
            competition: "friendly",
            occasion: mode == .daily ? "daily" : nil
        )
    }

    /// Opted-in posts for screenshots: the group's real ones, or synthetic intros from the demo world.
    @MainActor
    static func sources(in group: FBGroup) -> [Post] {
        let intros: [(String, String, String)] = [
            ("Maya", "Okafor", "Hi! Moved from Austin three weeks ago for a lab job. Looking for people to run Lands End with on Saturday mornings."),
            ("Diego", "Ramírez", "Chicago transplant in the Mission. I bake way too much sourdough and need people to give it to."),
            ("Priya", "Natarajan", "New nurse in town from Toronto. Night shifts, so I'm free weekday afternoons for coffee walks."),
            ("Sam", "Whitfield", "Middle school science teacher, new to Bernal Heights. Who wants to hike Bernal Hill at sunset?"),
        ]
        return intros.enumerated().map { index, intro in
            let author = User(id: "studio-debug-\(index)", firstName: intro.0, lastName: intro.1)
            let post = Post(author: author, group: group, text: intro.2)
            post.allowsBubbles = true
            return post
        }
    }
}

// MARK: - Scripted service

/// A realistic Muse run with no network: the same events, pacing and fields the real harness
/// sends (models, details, concepts, problems, fixes, a draft manifest, then the result).
final class StudioScriptedService: BubbleStudioService, StudioOfflineComposing {
    let speed: Double
    let templates: [BubbleFormula: BubbleManifest]
    let failsHalfway: Bool

    var isMuseConnected: Bool { true }

    init(speed: Double, templates: [BubbleFormula: BubbleManifest], failsHalfway: Bool) {
        self.speed = speed
        self.templates = templates
        self.failsHalfway = failsHalfway
    }

    /// The scripted service when `FB_STUDIO_SERVICE=scripted`.
    @MainActor
    static func fromLaunchEnvironment(store: BubbleStore?) -> StudioScriptedService? {
        guard DebugLaunch.value("FB_STUDIO_SERVICE") == "scripted" else { return nil }
        let speed = DebugLaunch.value("FB_STUDIO_SPEED").flatMap(Double.init) ?? 1
        return StudioScriptedService(
            speed: max(0.25, speed),
            templates: StudioDebugData.template(from: store),
            failsHalfway: DebugLaunch.value("FB_STUDIO_FAIL") != nil
        )
    }

    func draftBrief(_ request: StudioRequest) async throws -> BubbleBrief {
        try await Task.sleep(nanoseconds: UInt64(1_800_000_000 / speed))
        return StudioScript.brief(for: request)
    }

    func compose(_ request: StudioRequest) -> AsyncThrowingStream<StudioEvent, Error> {
        play(StudioScript.events(for: request, template: templates), failing: failsHalfway)
    }

    func composeOffline(_ request: StudioRequest) -> AsyncThrowingStream<StudioEvent, Error> {
        let events = StudioScript.events(for: request, template: templates).enumerated().compactMap { index, event -> StudioEvent? in
            guard event.step != .cover, event.step != .repair, event.issues == nil else { return nil }
            var offline = event
            offline.model = nil
            offline.isOffline = true
            offline.issues = nil
            offline.elapsed = Double(index + 1) * 0.7
            return offline
        }
        return play(events, failing: false)
    }

    private func play(_ events: [StudioEvent], failing: Bool) -> AsyncThrowingStream<StudioEvent, Error> {
        let speed = speed
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var last: TimeInterval = 0
                    for (index, event) in events.enumerated() {
                        let gap = max(0.05, event.elapsed - last) / speed
                        last = event.elapsed
                        try await Task.sleep(nanoseconds: UInt64(gap * 1_000_000_000))
                        if failing && index == events.count / 2 {
                            throw URLError(.networkConnectionLost)
                        }
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// What a realistic run looks like, for each kind of request.
enum StudioScript {
    static let wonder = "muse-wonder-1.0"
    static let ember = "muse-ember-1.0"
    static let image = "muse-image-1.0"

    static func brief(for request: StudioRequest) -> BubbleBrief {
        let text = request.prompt.lowercased()
        var moods: [String] = []
        if text.contains("chill") || text.contains("calm") { moods.append("calm") }
        if text.contains("daily") || text.contains("word") { moods.append("cozy") }
        if text.contains("icebreaker") || text.contains("picnic") { moods.append("playful") }
        if text.contains("hill") || text.contains("fog") { moods.append("nostalgic") }
        if moods.isEmpty { moods = ["playful", "cozy"] }
        return BubbleBrief(
            intent: request.prompt,
            audience: request.scope,
            mood: moods,
            energy: text.contains("chill") ? "low" : "medium",
            competition: request.scope.hasPrefix("event:") ? "light" : "friendly",
            occasion: request.mode == .daily ? "daily" : (request.scope.hasPrefix("event:") ? "icebreaker" : nil),
            contentSources: request.sources.isEmpty ? nil : ["\(request.scopeName ?? "Group") posts (opted in)"]
        )
    }

    static func events(for request: StudioRequest, template: [BubbleFormula: BubbleManifest]) -> [StudioEvent] {
        switch request.mode {
        case .edit:
            return tweakEvents(for: request)
        case .nextLevel:
            return levelEvents(for: request, template: template)
        case .create, .remix, .daily:
            return createEvents(for: request, template: template)
        }
    }

    private static func createEvents(for request: StudioRequest, template: [BubbleFormula: BubbleManifest]) -> [StudioEvent] {
        let final = manifest(for: request, template: template)
        var draft = final
        draft.title = "Untitled"
        let concepts = final.conceptIDs
        let brief = request.brief ?? self.brief(for: request)
        let who = request.scopeName ?? (request.scope == "friends" ? "your friends" : "everyone")
        let sources = request.sources.isEmpty ? "" : " and \(request.sources.count) opted-in posts"
        let events: [StudioEvent?] = [
            StudioEvent(step: .understand, title: "Read your request", detail: "“\(request.prompt.prefix(70))” for \(who)\(sources)", model: wonder, elapsed: 1.8),
            StudioEvent(step: .brief, title: "Wrote the brief", detail: "\(brief.mood.joined(separator: ", ")) · \(brief.energy) energy · \(brief.competition) competition", model: wonder, elapsed: 4.4, brief: brief),
            StudioEvent(step: .compose, title: "Picked \(concepts.count) concepts", detail: "\(final.formula.title): \(final.oneLineRule)", model: wonder, elapsed: 10.2, concepts: concepts, manifest: draft),
            StudioEvent(step: .compose, title: "Chose a \(lookTitle(final.style)) look", detail: StudioLookWords.detail(for: final.style), model: wonder, elapsed: 11.8),
            StudioEvent(step: .glue, title: "Wrote 1 custom function", detail: "score: +2 for every hill you clear without tapping", model: wonder, elapsed: 13.6),
            usedSourcesEvent(for: request, elapsed: 15.2),
            StudioEvent(step: .content, title: "Wrote 12 hill names", detail: "Twin Peaks, Bernal Hill, Tank Hill and 9 more", model: ember, elapsed: 16.9),
            StudioEvent(step: .validate, title: "Found 2 problems", detail: nil, elapsed: 17.5, issues: [
                "behavior.spawn_stream: rate 3.2 is above the safe range (0.5–2.5)",
                "glue.hill_bonus reads run.streak, which nothing sets",
            ]),
            StudioEvent(step: .repair, title: "Fixed 2 problems", detail: "Muse rewired the glue and slowed the hills", model: wonder, elapsed: 22.3, issues: [
                "Spawn rate set to 2.0",
                "Score now counts its own streak",
            ]),
            StudioEvent(step: .validate, title: "All checks pass", detail: "Schema, params, wiring and glue", elapsed: 22.8),
            StudioEvent(step: .playtest, title: "Bot played 5 runs", detail: "Runs last 24–61 s, scores 6–19. It can be lost and won.", elapsed: 25.6),
            StudioEvent(step: .cover, title: "Painted the cover", detail: "Hills at golden hour, in the \(lookTitle(final.style)) look", model: image, elapsed: 36.8),
            StudioEvent(step: .polish, title: "Named it \(final.title)", detail: final.oneLineRule, model: ember, elapsed: 39.4),
            doneEvent(final, request: request, elapsed: 40.6),
        ]
        return events.compactMap { $0 }
    }

    /// Like the harness: which opted-in posts were used, on the content step and on `.done`.
    private static func usedSourcesEvent(for request: StudioRequest, elapsed: TimeInterval) -> StudioEvent? {
        guard !request.sources.isEmpty else { return nil }
        let names = Array(request.sources.map(\.author).prefix(3))
        var event = StudioEvent(step: .content, title: "Used \(names.count) of \(request.sources.count) opted-in posts", detail: "Nothing else: no other posts or profiles", model: ember, elapsed: elapsed)
        event.sourcesUsed = names
        return event
    }

    private static func doneEvent(_ manifest: BubbleManifest, request: StudioRequest, elapsed: TimeInterval) -> StudioEvent {
        var event = StudioEvent(step: .done, title: "Ready to play", detail: "\(manifest.title) · \(manifest.formula.rawValue) · made in \(Int(elapsed)) s", elapsed: elapsed, manifest: manifest)
        if !request.sources.isEmpty {
            event.sourcesUsed = Array(request.sources.map(\.author).prefix(3))
        }
        return event
    }

    private static func tweakEvents(for request: StudioRequest) -> [StudioEvent] {
        guard var final = request.base else { return [] }
        final.version += 1
        if let look = StudioLook(id: request.paletteHint) {
            // A look change: same game, redrawn, with a new cover.
            final.style = look.applied(to: final.style)
            final.studio = StudioStamp(models: [wonder, image], createdAt: ISO8601DateFormatter().string(from: Date()), durationSec: 16.9, offline: false)
            return [
                StudioEvent(step: .understand, title: "Read your tweak", detail: "“\(request.prompt.prefix(70))”", model: wonder, elapsed: 1.3),
                StudioEvent(step: .compose, title: "Redrew it as \(look.title.lowercased())", detail: StudioLookWords.detail(for: final.style), model: wonder, elapsed: 4.6, manifest: final),
                StudioEvent(step: .validate, title: "All checks pass", detail: "Schema, params, wiring and glue", elapsed: 5.1),
                StudioEvent(step: .playtest, title: "Bot played 5 runs", detail: "Same rules and timing, new look.", elapsed: 7.9),
                StudioEvent(step: .cover, title: "Repainted the cover", detail: "In the \(look.title.lowercased()) look", model: image, elapsed: 16.2),
                StudioEvent(step: .done, title: "Ready to play", elapsed: 16.9, manifest: final),
            ]
        }
        final.studio = StudioStamp(models: [wonder, ember], createdAt: ISO8601DateFormatter().string(from: Date()), durationSec: 10.4, offline: false)
        return [
            StudioEvent(step: .understand, title: "Read your tweak", detail: "“\(request.prompt.prefix(70))”", model: wonder, elapsed: 1.4),
            StudioEvent(step: .compose, title: "Changed 2 settings", detail: "Speed ramp 1.0 → 0.7, spawn rate 2.0 → 1.6", model: wonder, elapsed: 5.2, concepts: ["behavior.speed_ramp", "behavior.spawn_stream"]),
            StudioEvent(step: .validate, title: "All checks pass", detail: "Schema, params, wiring and glue", elapsed: 5.7),
            StudioEvent(step: .playtest, title: "Bot played 5 runs", detail: "Runs last a little longer now: 31–74 s.", elapsed: 8.3),
            StudioEvent(step: .polish, title: "Kept the cover", detail: "Version \(final.version)", model: ember, elapsed: 9.8),
            StudioEvent(step: .done, title: "Ready to play", elapsed: 10.4, manifest: final),
        ]
    }

    private static func levelEvents(for request: StudioRequest, template: [BubbleFormula: BubbleManifest]) -> [StudioEvent] {
        guard let base = request.base else { return createEvents(for: request, template: template) }
        var final = base
        let index = (base.chain?.index ?? 1) + 1
        final.id = "\(base.id)-level-\(index)-\(UUID().uuidString.prefix(4).lowercased())"
        final.version = 1
        final.title = "\(base.title) \(index)"
        final.oneLineRule = "Faster hills, tighter gaps. Tap to glide."
        final.seed = base.seed + index
        final.lineage = BubbleLineage(parent: base.id, operators: ["next-level"])
        final.chain = BubbleChainLink(id: base.chain?.id ?? "chain-\(base.id)", index: index, title: base.chain?.title ?? base.title, prev: base.id)
        final.studio = StudioStamp(models: [wonder, ember, image], createdAt: ISO8601DateFormatter().string(from: Date()), durationSec: 23.5, offline: false)
        return [
            StudioEvent(step: .understand, title: "Read level \(index - 1)", detail: "\(base.title): \(base.oneLineRule)", model: wonder, elapsed: 1.5),
            StudioEvent(step: .compose, title: "Turned it up a notch", detail: "Faster hills, tighter gaps, fog that drifts", model: wonder, elapsed: 6.4, concepts: ["behavior.speed_ramp", "behavior.spawn_stream", "feel.mood_preset"], manifest: final),
            StudioEvent(step: .content, title: "Wrote 10 new hill names", detail: "Corona Heights, Mount Davidson and 8 more", model: ember, elapsed: 9.1),
            StudioEvent(step: .validate, title: "All checks pass", detail: "Schema, params, wiring and glue", elapsed: 9.6),
            StudioEvent(step: .playtest, title: "Bot played 5 runs", detail: "Harder than level \(index - 1): scores 4–14.", elapsed: 12.5),
            StudioEvent(step: .cover, title: "Painted the level \(index) cover", detail: "The same hills at dusk", model: image, elapsed: 22.1),
            StudioEvent(step: .done, title: "Ready to play", elapsed: 23.5, manifest: final),
        ]
    }

    /// The look Muse would pick: the hint, else one that matches the idea.
    static func look(for request: StudioRequest) -> StudioLook {
        if let look = StudioLook(id: request.paletteHint) { return look }
        let text = request.prompt.lowercased()
        let matches: [(StudioLook, [String])] = [
            (.paper, ["hill", "picnic", "cozy", "craft"]),
            (.ink, ["word", "daily", "story", "doodle"]),
            (.pixel, ["cable", "arcade", "retro", "catch"]),
            (.neon, ["night", "neon", "party"]),
            (.chalk, ["trivia", "quiz", "guess", "clue"]),
            (.clay, ["stack", "merge", "cute"]),
        ]
        for (look, words) in matches where words.contains(where: { text.contains($0) }) {
            return look
        }
        return [.riso, .glow, .clay][stableHash(text) % 3]
    }

    private static func lookTitle(_ style: BubbleStyle) -> String {
        (StudioLook(id: style.look) ?? .glow).title.lowercased()
    }

    /// Same text, same number, on every launch.
    static func stableHash(_ text: String) -> Int {
        text.unicodeScalars.reduce(7) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
    }

    /// The finished manifest: a copy of a real seed for the formula, renamed for the request.
    static func manifest(for request: StudioRequest, template: [BubbleFormula: BubbleManifest]) -> BubbleManifest {
        let formula = request.formulaHint ?? (request.mode == .daily ? .guess : (request.base?.formula ?? .dodge))
        let names: [(String, String, String)] = [
            ("Hill Hop", "Tap to glide over the hills. Don't touch the fog.", "⛰️"),
            ("Fog Drift", "Glide under the fog bank. Tap to rise.", "🌫️"),
            ("Bay Breeze", "Ride the breeze across the bay. Tap to lift.", "🌊"),
        ]
        let hash = stableHash(request.prompt)
        let pick = names[hash % names.count]
        var manifest = template[formula] ?? template[.dodge] ?? BubbleManifest(
            id: "studio",
            title: pick.0,
            oneLineRule: pick.1,
            formula: .dodge,
            brief: BubbleBrief(intent: request.prompt),
            concepts: [
                ConceptUse("space.side_scroll"), ConceptUse("entity.avatar"), ConceptUse("entity.obstacle"),
                ConceptUse("input.tap"), ConceptUse("behavior.gravity"), ConceptUse("behavior.impulse"),
                ConceptUse("behavior.spawn_stream"), ConceptUse("rule.collide_fail"), ConceptUse("score.count"),
                ConceptUse("flow.run_retry"),
            ]
        )
        if request.mode == .remix, let base = request.base {
            manifest = base
            manifest.title = "\(base.title) remix"
            manifest.lineage = BubbleLineage(parent: base.id, operators: ["remix"], remixOf: base.id)
        } else if manifest.formula == .dodge {
            manifest.title = pick.0
            manifest.oneLineRule = pick.1
            manifest.style.emoji = pick.2
        }
        manifest.id = StudioModel.newID(from: manifest.title)
        manifest.version = 1
        manifest.brief = request.brief ?? brief(for: request)
        manifest.structure = BubbleStructure(cadence: request.mode == .daily ? "daily" : "endless", scope: request.scope, setter: "ai")
        manifest.chain = nil
        if request.mode != .remix || request.paletteHint != nil {
            // Like Muse: the person's look, or one that matches the idea (LOOKS.md).
            manifest.style = look(for: request).applied(to: manifest.style)
            manifest.style.motif = request.prompt.lowercased().contains("hill") ? "hills" : nil
        }
        manifest.seed = hash % 1_000_000 + 1
        manifest.studio = StudioStamp(models: [wonder, ember, image], createdAt: ISO8601DateFormatter().string(from: Date()), durationSec: 40.6, offline: false)
        return manifest
    }
}
#endif
