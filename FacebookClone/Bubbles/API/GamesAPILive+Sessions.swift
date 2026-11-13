import Foundation

// Making a game together on the live server (`/v1/sessions`, backend/README.md "Making a game
// together"). Access, entries and making the game all happen on the server.
extension GamesAPILive {
    /// Starts a session (`POST /v1/sessions`). A chat session names its `members` (friends); a
    /// Group session with no members invites the whole Group.
    func startSession(kind: String, title: String, ask: String, target: RoundTarget, members: [String] = []) async throws -> RemoteSession {
        var payload: [String: Any] = [
            "kind": kind, "title": title, "ask": ask,
            "target": ["kind": target.kind.rawValue, "id": target.id],
        ]
        if !members.isEmpty { payload["members"] = members }
        let data = try await authedJSON("POST", "v1/sessions", body: try JSONSerialization.data(withJSONObject: payload))
        return adoptSession(try decodeReply(data))
    }

    /// The sessions in a chat or a Group that I can see, newest first.
    func sessions(target: RoundTarget) async throws -> [RemoteSession] {
        let list: RemoteList<RemoteSession> = try decodeReply(try await authedJSON("GET", "v1/sessions", query: [URLQueryItem(name: "target", value: target.wire)]))
        return list.items.map(adoptSession)
    }

    /// One session (members only; 404 for anyone else).
    func session(id: String) async throws -> RemoteSession {
        adoptSession(try decodeReply(try await authedJSON("GET", "v1/sessions/\(id)")))
    }

    /// Adds my entry (`POST /v1/sessions/{id}/entries {text}`).
    func addSessionEntry(id: String, text: String) async throws -> RemoteSession {
        let body = try JSONSerialization.data(withJSONObject: ["text": text])
        return adoptSession(try decodeReply(try await authedJSON("POST", "v1/sessions/\(id)/entries", body: body)))
    }

    /// Has Muse make the game from every entry (`POST /v1/sessions/{id}/make`, the starter only).
    /// Returns the job id; the session's `status` follows it.
    func makeSession(id: String) async throws -> String {
        let reply: RemoteSessionMake = try decodeReply(try await authedJSON("POST", "v1/sessions/\(id)/make", body: Data("{}".utf8), timeout: 20))
        return reply.jobID
    }

    private func adoptSession(_ session: RemoteSession) -> RemoteSession {
        if let game = session.game { remember(game) }
        return session
    }
}
