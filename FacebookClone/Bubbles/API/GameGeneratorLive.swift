import Foundation

/// Server-side generation on Max's API (`GameGenerator`), through `GamesAPILive`'s session, tokens
/// and refresh. Generating needs an account: without one it signs in as this device's account
/// first (`GamesAuth.signInAsDevice`, password in the Keychain).
struct GameGeneratorLive: GameGenerator {
    static let shared = GameGeneratorLive(api: .shared)

    let api: GamesAPILive
    var pollInterval: TimeInterval { 1.5 }

    func start(request: String, brief: BubbleBrief) async throws -> String {
        try await start(request: request, brief: brief, sound: nil)
    }

    func start(request: String, brief: BubbleBrief, sound: RemoteGameSound?) async throws -> String {
        if await !api.isSignedIn { _ = try await api.signInAsDevice() }
        var payload: [String: Any] = ["request": request, "brief": Self.json(brief)]
        Self.add(sound, to: &payload)
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await api.generationStart(body: body)
        return try decode(GenerationStarted.self, data).jobID
    }

    func start(revision: GameRevision) async throws -> String {
        if await !api.isSignedIn { _ = try await api.signInAsDevice() }
        // Studio's games carry the app's id; the map links it to the server's when the job finished.
        guard let base = api.ids.serverID(for: revision.baseGameID) else {
            throw GamesAPIError.unknownGame(revision.baseGameID)
        }
        var payload: [String: Any] = ["baseGameId": base]
        if let change = revision.change?.trimmingCharacters(in: .whitespacesAndNewlines), !change.isEmpty {
            payload["change"] = String(change.prefix(GameRevision.maxChangeCharacters))
        }
        if let look = revision.look?.trimmingCharacters(in: .whitespacesAndNewlines), !look.isEmpty {
            payload["look"] = look
        }
        if revision.nextLevel { payload["nextLevel"] = true }
        if let brief = revision.brief { payload["brief"] = Self.json(brief) }
        Self.add(revision.sound, to: &payload)
        let data = try await api.generationStart(body: try JSONSerialization.data(withJSONObject: payload))
        return try decode(GenerationStarted.self, data).jobID
    }

    /// A library sound for the game: `soundId`, `offsetMs`, `mix` (backend/README.md, "Sounds").
    static func add(_ sound: RemoteGameSound?, to payload: inout [String: Any]) {
        guard let sound else { return }
        payload["soundId"] = sound.id
        payload["offsetMs"] = sound.offsetMs
        payload["mix"] = sound.mix
    }

    /// `BubbleBrief` as the server reads it (snake_case keys, like the app's manifest).
    static func json(_ brief: BubbleBrief) -> [String: Any] {
        var out: [String: Any] = [
            "intent": brief.intent, "audience": brief.audience, "mood": brief.mood,
            "energy": brief.energy, "competition": brief.competition,
        ]
        if let occasion = brief.occasion { out["occasion"] = occasion }
        if let notes = brief.notes { out["notes"] = notes }
        return out
    }

    func job(id: String, after: Int?) async throws -> GenerationJob {
        try decode(GenerationJob.self, try await api.generationJob(id: id, after: after))
    }

    func cancel(id: String) async {
        await api.generationCancel(id: id)
    }

    func manifest(for game: RemoteGame) async throws -> BubbleManifest {
        // Decoded straight from the server's bytes: `content.game_json` stays its exact text.
        let manifest = try BubbleManifest.decode(try await api.fetch(game.manifestURL))
        // Scores, saves and events for this game go to its server id.
        api.ids.link(localID: manifest.id, serverID: game.id)
        return manifest
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try GamesAPICoding.decoder().decode(T.self, from: data) }
        catch { throw GamesAPIError.decoding(String(describing: error).prefix(200).description) }
    }
}
