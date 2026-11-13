import Foundation

/// Who saved a game, as the server says (`GET /v1/games/{id}/likes`): how many people did, and
/// which of your friends did. The server names no other savers.
struct BubbleSavers: Equatable {
    var count: Int
    /// Your friends who saved it, as app users.
    var friends: [User]
}

/// Where a game's savers stand.
enum BubbleSaversState: Equatable {
    case loading
    case loaded(BubbleSavers)
    case failed(String)

    var savers: BubbleSavers? {
        if case .loaded(let savers) = self { return savers }
        return nil
    }
}

/// Saves (docs/BUBBLES.md 7.10): your saved games and who else saved a game, from the server.
extension BubbleStore {
    /// Loads which of your friends saved `bubble`, once per session (again with `force`). Skips the
    /// call when nobody but you saved it, or when you're signed out (the server names friends only).
    func loadSavers(for bubble: Bubble, force: Bool = false) {
        guard !isPreview, GamesAccount.shared.userID != nil else { return }
        let others = bubble.saveCount - (bubble.isSaved ? 1 : 0)
        guard others > 0 else { return }
        switch saverStates[bubble.id] {
        case .loading: return
        case .loaded where !force: return
        default: break
        }
        // A reload keeps showing what is already known.
        if saverStates[bubble.id]?.savers == nil { saverStates[bubble.id] = .loading }
        let id = bubble.id
        let gameID = bubble.serverID
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let reply = try await api.saves(gameID: gameID)
                let friends = reply.friends.map { self.person($0) }.filter { !$0.isMe }
                saverStates[id] = .loaded(BubbleSavers(count: reply.count, friends: friends))
            } catch {
                saverStates[id] = .failed(error.localizedDescription)
            }
        }
    }

    /// Your saved games (`GET /v1/me/likes`), added to this session's games so the Library's Saved
    /// section lists them.
    @MainActor
    func loadSavedGames() async {
        guard !isPreview, !savedGamesState.isLoading, await GamesAccount.shared.waitForUser() != nil else { return }
        savedGamesState = .loading
        do {
            let games = try await api.savedGames()
            for game in games {
                await adopt(game)
            }
            savedGamesState = .idle
        } catch {
            savedGamesState = .failed(error.localizedDescription)
        }
    }
}
