import Foundation

// LOCAL STAND-IN for the other person's side of a bracket. With one phone at the demo, their round
// is a bot run of the real runtime on the round's exact seed and length (`BubbleStore.simulateRun`),
// so it carries a replay and verifies. When the server's /v1/brackets lands (docs/BUBBLES.md 7.14)
// their real runs come from it instead, and this file goes away. Nothing else uses bot data.
@MainActor
enum BracketLocalOpponent {
    /// Plays `round` as `user` after a short, stable delay (3–9 s, so it feels live).
    static func play(_ round: BracketRound, as user: User, bubbleStore: BubbleStore, completion: @escaping (Int, BubbleInputLog?) -> Void) {
        guard let bubble = bubbleStore.bubble(id: round.gameID) else { return }
        let manifest = bubble.manifest.withSeed(round.seed).withLength(round.length)
        let delay = 3 + Double(SeededGenerator.stableHash("bracket-delay|\(user.id)|\(round.seed)") % 60) / 10
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            bubbleStore.simulateRun(of: user, on: bubble, manifest: manifest, skill: 0.8) { score in
                completion(score.score, score.replay)
            }
        }
    }
}
