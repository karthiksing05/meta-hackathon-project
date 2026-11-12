import Foundation

/// Muse Studio with a Muse key: turns one sentence into a validated, playtested Bubble with a
/// painted cover, streaming every step.
///
/// - `draftBrief`: Muse Ember reads the request as a brief (fast JSON, a few seconds).
/// - `compose`: the brief, then Muse Wonder's tool-calling agent (`MuseComposeSession`) composes
///   from the runtime's concept library, Ember writes bulk content, the runtime validates and
///   playtests (two repair rounds at most), Muse Image paints the cover in parallel, and Studio
///   fills every default and pins `engine_version`.
/// - Any failure or timeout falls back to the offline composer, so a Bubble always comes out.
final class MuseStudioService: BubbleStudioService {
    struct Options: Sendable {
        /// Seconds for the brief before Studio reads it on the device instead.
        var briefTimeout: TimeInterval = 12
        var session = MuseComposeSession.Options()
        /// Seconds to keep waiting for the cover once the Bubble is ready.
        var coverWait: TimeInterval = 45
        /// Seconds between offline steps (app only, for the timeline animation).
        var offlinePacing: TimeInterval = 0.3

        init() {}
    }

    let client: MuseClient
    let runtime: StudioRuntime
    let world: StudioDemoWorld?
    let offline: OfflineComposer
    var options: Options
    /// Looks Studio used lately, so new Bubbles vary (LOOKS.md).
    let lookMemory: StudioLookMemory

    var isMuseConnected: Bool { client.isConfigured }
    var callLog: MuseCallLog { client.callLog }

    init(config: MuseConfig, runtime: StudioRuntime, world: StudioDemoWorld?, callLog: MuseCallLog = MuseCallLog(), options: Options = Options(),
         lookMemory: StudioLookMemory = .shared) {
        self.client = MuseClient(config: config, callLog: callLog)
        self.runtime = runtime
        self.world = world
        self.options = options
        self.lookMemory = lookMemory
        self.offline = OfflineComposer(world: world, pacing: options.offlinePacing)
    }

    // MARK: - Brief

    func draftBrief(_ request: StudioRequest) async throws -> BubbleBrief {
        let request = Self.enrich(request, world: world)
        do {
            return try await museBrief(request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            if Task.isCancelled { throw CancellationError() }
            return offline.brief(for: request)
        }
    }

    private func museBrief(_ request: StudioRequest) async throws -> BubbleBrief {
        let catalog = (try? await runtime.catalog()) ?? .empty
        let client = self.client
        let timeout = options.briefTimeout
        let value = try await StudioAsync.withTimeout(timeout) {
            try await client.chatJSON(
                model: client.config.fastModel,
                system: MusePrompts.briefSystem(catalog),
                user: MusePrompts.briefUser(request),
                options: MuseClient.ChatOptions(maxTokens: 4_000, reasoningEffort: "low", timeout: timeout, maxAttempts: 2, purpose: "brief")
            ).value
        }
        return Self.normalizedBrief(value, request: request)
    }

    static func normalizedBrief(_ value: JSONValue, request: StudioRequest) -> BubbleBrief {
        var brief = (try? value.decode(BubbleBrief.self)) ?? BubbleBrief(intent: request.prompt)
        brief.intent = brief.intent.trimmingCharacters(in: .whitespacesAndNewlines)
        if brief.intent.isEmpty || (request.prompt.isEmpty && brief.intent.lowercased().contains("fitting for the audience")) {
            brief.intent = request.prompt.isEmpty ? MusePrompts.defaultIntent(request) : request.prompt
        }
        if brief.intent.hasSuffix(".") { brief.intent.removeLast() }
        brief.audience = request.scope
        brief.mood = Array(StudioManifestBuilder.unique(brief.mood.map { $0.lowercased() }).prefix(3))
        if brief.mood.isEmpty { brief.mood = ["playful"] }
        if !["low", "medium", "high"].contains(brief.energy) { brief.energy = "medium" }
        if !["none", "light", "friendly", "fierce"].contains(brief.competition) { brief.competition = "light" }
        if request.mode == .daily { brief.occasion = "daily" }
        if brief.occasion?.lowercased() == "null" || brief.occasion?.isEmpty == true { brief.occasion = nil }
        if request.mode != .daily && !request.scope.hasPrefix("event:") { brief.contentSources = nil }
        if let notes = brief.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
            brief.notes = notes
        } else {
            brief.notes = nil
        }
        return brief
    }

    // MARK: - Compose

    func compose(_ request: StudioRequest) -> AsyncThrowingStream<StudioEvent, Error> {
        let request = Self.enrich(request, world: world)
        return AsyncThrowingStream { continuation in
            let timeline = StudioTimeline(continuation: continuation)
            let task = Task { await self.run(request, timeline: timeline) }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The offline composer on request ("Try the offline composer" after a failure).
    func composeOffline(_ request: StudioRequest) -> AsyncThrowingStream<StudioEvent, Error> {
        offline.stream(Self.enrich(request, world: world), runtime: runtime)
    }

    private func run(_ request: StudioRequest, timeline: StudioTimeline) async {
        let cover = StudioCoverPainter()
        do {
            timeline.emit(.understand, StudioCopy.understandTitle(request), detail: StudioCopy.understandDetail(request))
            let catalog = (try? await runtime.catalog()) ?? .empty
            let builder = StudioManifestBuilder(request: request, catalog: catalog)
            // The cover shows up the moment it's painted, while Muse keeps composing.
            let imageModel = client.config.imageModel
            cover.whenPainted { painted in
                let look = catalog.look(painted.look)?.withArticle ?? "a"
                let scene = StudioCopy.quote(painted.scene ?? "the game's scene", max: 90)
                timeline.emit(.cover, "Painted the cover",
                              detail: "\(OfflineComposer.sentence(look)) cover, painted in \(StudioCopy.seconds(painted.seconds)) while Muse composed: \(scene)",
                              model: imageModel, cover: painted.image)
            }

            // 1. Brief.
            var models: [String] = []
            let brief: BubbleBrief
            if let given = request.brief {
                brief = Self.normalizedBrief((try? JSONValue.encode(given)) ?? .object([:]), request: request)
                timeline.emit(.brief, "Using your brief", detail: Self.briefLine(brief), brief: brief)
            } else {
                do {
                    brief = try await museBrief(request)
                    models.append(client.config.fastModel)
                    timeline.emit(.brief, "Brief: \(Self.briefTitle(brief))", detail: brief.notes ?? Self.briefLine(brief),
                                  model: client.config.fastModel, brief: brief)
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    brief = offline.brief(for: request)
                    let reason = (error as? MuseError)?.shortReason ?? "an error"
                    timeline.emit(.brief, "Brief from your words", detail: "Muse couldn't answer (\(reason)), so Studio read it on the device",
                                  brief: brief, offline: true)
                }
            }
            try Task.checkCancellation()

            // 2. Compose with Muse; fall back to the offline composer.
            var outcome: MuseComposeSession.Outcome?
            var offlineResult: OfflineComposer.Result?
            if catalog.isEmpty {
                timeline.emit(.compose, "The game library didn't load", detail: "Studio is using its offline composer", offline: true)
                offlineResult = await offline.compose(request, brief: brief, catalog: catalog, runtime: runtime, timeline: timeline)
            } else {
                let session = MuseComposeSession(
                    request: request, brief: brief, catalog: catalog, client: client, runtime: runtime,
                    timeline: timeline, cover: cover, builder: builder, options: options.session, world: world,
                    recentLooks: lookMemory.recent
                )
                do {
                    outcome = try await session.run()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    if Task.isCancelled { throw CancellationError() }
                    let reason = (error as? MuseError)?.errorDescription ?? error.localizedDescription
                    timeline.emit(.repair, "Muse couldn't finish, so the offline composer stepped in", detail: reason, offline: true)
                    offlineResult = await offline.compose(request, brief: brief, catalog: catalog, runtime: runtime, timeline: timeline)
                }
                for model in session.modelsUsed where !models.contains(model) {
                    models.append(model)
                }
            }
            try Task.checkCancellation()

            // 3. Cover (painting since the title and look were known). An offline result in another
            // look doesn't get Muse's cover: cover and game always share a look.
            var coverData: Data?
            let finalLook = (outcome?.manifest ?? offlineResult?.manifest)?.style.look
            if cover.isStarted, let finalLook, cover.look != finalLook {
                cover.cancel()
                timeline.emit(.cover, "Skipped the cover", detail: "It was painted in another look, so the card shows the game's own poster frame",
                              model: client.config.imageModel)
            } else if cover.isStarted {
                coverData = await cover.image(waitingAtMost: options.coverWait)
                try Task.checkCancellation()
                let lookName = catalog.look(cover.look)?.withArticle ?? "a"
                if let coverData, !cover.announced {
                    let took = cover.paintSeconds.map { " in \(StudioCopy.seconds($0))" } ?? ""
                    let scene = StudioCopy.quote(cover.scene ?? "the game's scene", max: 90)
                    timeline.emit(.cover, "Painted the cover", detail: "\(OfflineComposer.sentence(lookName)) cover, painted\(took) while Muse composed: \(scene)",
                                  model: client.config.imageModel, cover: coverData)
                } else if coverData == nil {
                    timeline.emit(.cover, "The cover didn't paint", detail: "\(cover.failure ?? "no image"), so the card shows the game's own poster frame",
                                  model: client.config.imageModel)
                }
            }

            // 4. Polish: every default, engine pinned, stamped.
            let isOffline = offlineResult != nil
            guard let made = outcome?.manifest ?? offlineResult?.manifest else {
                throw MuseComposeSession.SessionError.noPassingDraft("no manifest")
            }
            let compiled = builder.compiled(made)
            let filled = (outcome?.filledDefaults ?? offlineResult?.filled ?? 0) + compiled.filled
            let usedModels = Self.ordered(models.filter { $0 != client.config.imageModel || coverData != nil })
            let coverPrompt = cover.look == compiled.manifest.style.look ? cover.prompt : nil
            let manifest = builder.stamped(compiled.manifest, models: usedModels, started: timeline.startDate, offline: isOffline,
                                           coverPrompt: coverPrompt)
            var polish = filled == 0
                ? "Every param already set · pinned engine v\(manifest.engineVersion)"
                : "Filled \(filled) \(filled == 1 ? "default" : "defaults") · pinned engine v\(manifest.engineVersion)"
            if let notes = outcome?.notes, let note = notes.first {
                polish += " · Note: \(note)"
            }
            timeline.emit(.polish, "Final touches", detail: polish, offline: isOffline)

            if request.mode == .create || request.mode == .remix || request.mode == .daily {
                lookMemory.record(manifest.style.look)
            }
            let sources = outcome?.sourcesUsed ?? offlineResult?.sourcesUsed ?? []
            let seconds = StudioCopy.seconds(timeline.elapsed)
            timeline.emit(.done, "Ready to play", detail: "\(manifest.title) · \(manifest.formula.rawValue) · made in \(seconds)",
                          manifest: manifest, cover: coverData, offline: isOffline,
                          baseUpdate: builder.baseUpdate(for: manifest), sources: sources.isEmpty ? nil : sources)
            timeline.finish()
        } catch {
            cover.cancel()
            if error is CancellationError || Task.isCancelled {
                timeline.finish(throwing: CancellationError())
            } else {
                timeline.emit(.failed, "This bubble popped", detail: error.localizedDescription)
                timeline.finish(throwing: error)
            }
        }
    }

    // MARK: - Helpers

    /// Fills in the audience from the demo world, and for the demo Event's icebreaker, what
    /// attendees shared. Daily Bubbles only ever use the sources the request carries.
    static func enrich(_ request: StudioRequest, world: StudioDemoWorld?) -> StudioRequest {
        guard let world else { return request }
        var out = request
        if let scope = world.scope(for: request.scope) {
            if out.scopeName == nil || out.scopeName?.isEmpty == true { out.scopeName = scope.name }
            if out.audienceNames.isEmpty { out.audienceNames = scope.audience }
            if request.scope == "event:\(world.eventID)", request.sources.isEmpty, request.mode != .daily {
                out.sources = world.eventSources()
            }
        }
        return out
    }

    static func ordered(_ models: [String]) -> [String] {
        let order = ["muse-wonder-1.0", "muse-spark-1.3", "muse-ember-1.0", "muse-image-1.0"]
        return StudioManifestBuilder.unique(models).sorted { (order.firstIndex(of: $0) ?? 99) < (order.firstIndex(of: $1) ?? 99) }
    }

    static func briefTitle(_ brief: BubbleBrief) -> String {
        let mood = brief.mood.prefix(2).joined(separator: " and ")
        return "\(mood.isEmpty ? "playful" : mood), \(brief.energy) energy"
    }

    static func briefLine(_ brief: BubbleBrief) -> String {
        var parts = [brief.intent]
        if !brief.mood.isEmpty { parts.append(brief.mood.joined(separator: ", ")) }
        parts.append("\(brief.energy) energy")
        parts.append("\(brief.competition) competition")
        return parts.joined(separator: " · ")
    }
}
