import Foundation

// Rounds (`/v1/rounds`) and agreement (`/v1/games/{id}/agreement`) on the live server
// (backend/README.md, "Rounds: same-seed play in a chat or a Group"). The server owns the seed, the
// replay check, the lines, the order, the winner and the agreement; these calls only carry them.
extension GamesAPILive {
    /// Starts a round (`POST /v1/rounds`). A chat round needs `members` (friends, up to 19 besides
    /// you); a Group round with no members is the whole Group. `mode` defaults to the game's.
    func startRound(gameID: String, target: RoundTarget, members: [String] = [], mode: String? = nil) async throws -> RemoteRound {
        var payload: [String: Any] = [
            "gameId": try serverGameID(gameID),
            "target": ["kind": target.kind.rawValue, "id": target.id],
        ]
        if !members.isEmpty { payload["members"] = members }
        if let mode, !mode.isEmpty { payload["mode"] = mode }
        let data = try await authedJSON("POST", "v1/rounds", body: try JSONSerialization.data(withJSONObject: payload))
        return adopt(try decodeReply(data) as RemoteRound)
    }

    /// The rounds in a chat or a Group that I'm in, newest first; nil target: every round I'm in.
    func rounds(target: RoundTarget?) async throws -> [RemoteRound] {
        let query = target.map { [URLQueryItem(name: "target", value: $0.wire)] } ?? []
        let list: RemoteList<RemoteRound> = try decodeReply(try await authedJSON("GET", "v1/rounds", query: query))
        return list.items.map(adopt)
    }

    /// One round (members only; 404 for anyone else).
    func round(id: String) async throws -> RemoteRound {
        adopt(try decodeReply(try await authedJSON("GET", "v1/rounds/\(id)")) as RemoteRound)
    }

    /// My run of a round: the engine's input log as text (`POST /v1/rounds/{id}/plays {log}`). The
    /// server replays it and keeps only the replayed result. 409: already played, or it's over.
    func playRound(id: String, log: String) async throws -> RemoteRound {
        let body = try JSONSerialization.data(withJSONObject: ["log": log])
        return adopt(try decodeReply(try await authedJSON("POST", "v1/rounds/\(id)/plays", body: body, timeout: 30)) as RemoteRound)
    }

    /// How my picks in an opinion game compare (`GET /v1/games/{id}/agreement`): with one friend
    /// (`with`), my friends (`scope: "friends"`) or a Group (`scope: "group"`, `groupID`).
    /// 409 until you and someone else have each played a round of it.
    func agreement(gameID: String, with userID: String? = nil, scope: String? = nil, groupID: String? = nil) async throws -> RemoteGameAgreement {
        var query: [URLQueryItem] = []
        if let userID { query.append(URLQueryItem(name: "with", value: userID)) }
        if let scope { query.append(URLQueryItem(name: "scope", value: scope)) }
        if let groupID { query.append(URLQueryItem(name: "groupId", value: groupID)) }
        return try decodeReply(try await authedJSON("GET", "v1/games/\(try serverGameID(gameID))/agreement", query: query))
    }

    /// A game's `group_play` (`GET /v1/games/{id}`); nil when it has none.
    func groupPlay(gameID: String) async throws -> RemoteGroupPlay? {
        let id = (try? serverGameID(gameID)) ?? gameID
        let data = try await authedJSON("GET", "v1/games/\(id)")
        return (try decodeReply(data) as RemoteGameGroupPlay).groupPlay
    }

    private func adopt(_ round: RemoteRound) -> RemoteRound {
        if let game = round.game { remember(game) }
        return round
    }
}
