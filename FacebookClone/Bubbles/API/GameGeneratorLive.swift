import Foundation

/// Server-side generation on Max's API (`GameGenerator`), through `GamesAPILive`'s session, tokens
/// and refresh. Generating needs an account: without one it signs in as this device's account
/// first (`GamesAuth.signInAsDevice`, password in the Keychain).
struct GameGeneratorLive: GameGenerator {
    static let shared = GameGeneratorLive(api: .shared)

    let api: GamesAPILive
    var pollInterval: TimeInterval { 1.5 }

    func start(request: String, brief: BubbleBrief) async throws -> String {
        if await !api.isSignedIn { _ = try await api.signInAsDevice() }
        var briefJSON: [String: Any] = [
            "intent": brief.intent, "audience": brief.audience, "mood": brief.mood,
            "energy": brief.energy, "competition": brief.competition,
        ]
        if let occasion = brief.occasion { briefJSON["occasion"] = occasion }
        if let notes = brief.notes { briefJSON["notes"] = notes }
        let body = try JSONSerialization.data(withJSONObject: ["request": request, "brief": briefJSON])
        let data = try await api.generationStart(body: body)
        return try decode(GenerationStarted.self, data).jobID
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
