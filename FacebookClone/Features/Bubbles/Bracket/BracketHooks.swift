import Foundation

/// Where the app tells brackets what happened (docs/BUBBLES.md 7.14). Small calls from shared
/// screens, so the feature stays in its own folder.
///
/// One offer per Add friend: server friendships (`gamesFriendAdded`) get the best-of-5 sheet, which
/// starts a server series; brackets also start from a friend's profile card.
@MainActor
enum BracketHooks {
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        ServerBracketService.shared.install(appStore: appStore, bubbleStore: bubbleStore)
    }

    /// After the player records your run: a round of a bracket when the game and seed match one.
    static func didFinish(_ score: BubbleScore, in bubble: Bubble, request: BubblePlayRequest) {
        guard let seed = request.seed else { return }
        BracketServices.current.recordMine(gameID: bubble.id, seed: seed, score: score.score)
    }

    /// You tapped Add friend next to someone new on a Group's (or Event's) board: propose a bracket
    /// right away, so you have something to do together while the request is out.
    static func met(_ user: User, on origin: BracketOrigin) {
        // Series are between server friends; a request still out gets the offer once it's accepted.
        guard user.friendship == .friends, BracketServices.current.bracket(with: user.id) == nil else { return }
        BracketServices.current.propose(with: user, origin: origin)
    }
}
