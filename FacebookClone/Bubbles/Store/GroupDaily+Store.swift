import Foundation

/// A Group's Daily from the server (`GET`/`POST /v1/groups/{id}/daily`): the one game the whole Group
/// plays that day, so the board is fair. The server owns which game it is; the app only shows it.
struct RemoteGroupDaily: Decodable, Sendable {
    var groupID: String
    var date: String
    var gameID: String
    var isToday: Bool
    var game: RemoteGame

    enum CodingKeys: String, CodingKey {
        case date, isToday, game
        case groupID = "groupId", gameID = "gameId"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        groupID = try c.decode(String.self, forKey: .groupID)
        date = try c.decode(String.self, forKey: .date)
        gameID = try c.decode(String.self, forKey: .gameID)
        game = try c.decode(RemoteGame.self, forKey: .game)
        // A set reply has no isToday: it is the day that was asked for.
        isToday = try c.decodeIfPresent(Bool.self, forKey: .isToday) ?? true
    }
}

extension BubbleStore {
    /// Asks the server for the Group's Daily today (the phone's own day) and makes it the Group's
    /// Daily card. Returns the game, or nil when the Group has none (or isn't on the games server).
    @MainActor
    @discardableResult
    func loadDaily(for group: FBGroup) async -> Bubble? {
        guard !isPreview else { return nil }
        guard let daily = try? await api.groupDaily(groupID: group.id, date: BubbleStore.dayKey(Date())),
              let bubble = await adopt(daily.game) else { return nil }
        dailyBubbleIDs[group.id] = bubble.id
        loadScores(for: bubble)
        return bubble
    }

    /// The Group's owner makes a game today's Daily; every other member is notified by the server.
    @MainActor
    func makeDaily(_ bubble: Bubble, in group: FBGroup) async throws {
        let daily = try await api.setGroupDaily(groupID: group.id, gameID: bubble.serverID, date: BubbleStore.dayKey(Date()))
        if let adopted = await adopt(daily.game) {
            dailyBubbleIDs[group.id] = adopted.id
            loadScores(for: adopted)
        }
    }

    /// Whether the signed-in account owns this Group on the games server (`GET /v1/groups/{id}`).
    @MainActor
    func ownsGroup(_ group: FBGroup) async -> Bool {
        guard !isPreview, let me = GamesAccount.shared.userID,
              let detail = try? await api.group(id: group.id) else { return false }
        return detail.group.ownerID == me
    }
}
