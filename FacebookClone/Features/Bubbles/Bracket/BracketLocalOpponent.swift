import Foundation

// LOCAL STAND-IN for the other person's side of a bracket. With one phone at the demo, their round
// is a bot run of the real runtime on the round's exact seed and length, so it carries a replay and
// verifies. This is the one piece of the old `BubbleStore.simulateRun` (BubbleOpponentRuns.swift,
// removed with the mocks) the bracket needs, kept here so nothing else depends on bot data. When the
// server serves brackets (docs/BUBBLES.md 7.14) their real runs come from it and this file goes away.
@MainActor
enum BracketLocalOpponent {
    /// Bot skill for the stand-in: a decent player, not a perfect one.
    static let skill = 0.8

    /// Plays `round` as `user` after a short, stable delay (3–9 s, so it feels live). Calls back on
    /// the main thread; never calls back when the runtime can't simulate the game.
    static func play(_ round: BracketRound, as user: User, bubbleStore: BubbleStore, completion: @escaping (Int, BubbleInputLog?) -> Void) {
        guard let bubble = bubbleStore.bubble(id: round.gameID) else { return }
        let manifest = bubble.manifest.withSeed(round.seed).withLength(round.length)
        let botSeed = Int(truncatingIfNeeded: SeededGenerator.stableHash("bracket-bot|\(user.id)|\(round.seed)") & 0x7FFF_FFFF)
        let delay = 3 + Double(SeededGenerator.stableHash("bracket-delay|\(user.id)|\(round.seed)") % 60) / 10
        let worker = bubbleStore.runtimeWorker
        let skill = Self.skill
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            worker.queue.async {
                let simulation = worker.loadRuntime()?.simulate(
                    manifest,
                    seed: manifest.seed,
                    maxTicks: BubbleRuntimeWorker.botMaxTicks,
                    bot: true,
                    botSeed: botSeed,
                    botSkill: skill
                )
                DispatchQueue.main.async {
                    guard let simulation, simulation.ok else { return }
                    var replay = simulation.replay
                    replay?.length = manifest.length
                    completion(simulation.score, replay)
                }
            }
        }
    }
}
