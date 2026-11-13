import Foundation

// The other side of a challenge, group-chat session or game night (docs/BUBBLES.md 7.1). With one
// phone at the demo, friends' plays are bot runs of the real runtime on the exact same seed and
// length, so their scores come with replays and stay verifiable like yours.

extension BubbleRuntimeWorker {
    /// Plays `manifest` once with the formula's bot, off the main thread. Nil when the runtime
    /// can't simulate it (the stub runtime, or a crash).
    func simulateOnce(_ manifest: BubbleManifest, botSeed: Int, botSkill: Double, completion: @escaping (BubbleJSRuntime.Simulation?) -> Void) {
        queue.async { [weak self] in
            let simulation = self?.loadRuntime()?.simulate(
                manifest,
                seed: manifest.seed,
                maxTicks: BubbleRuntimeWorker.botMaxTicks,
                bot: true,
                botSeed: botSeed,
                botSkill: botSkill
            )
            DispatchQueue.main.async {
                completion(simulation?.ok == true ? simulation : nil)
            }
        }
    }
}

extension BubbleStore {
    /// Simulates `user` playing `manifest` (pass the challenge's or session's seed and length
    /// already applied, e.g. `bubble.manifest.withSeed(seed).withLength(length)`). Calls back on the
    /// main thread with a score that carries its replay and share artifact (with the kit's `tag`);
    /// nothing is added to any board, the caller
    /// decides. Falls back to a synthetic score without a replay when the runtime can't simulate.
    ///
    /// - Parameters:
    ///   - skill: 0...1; nil uses the person's roster skill.
    ///   - botSeed: varies the bot's choices; nil derives a stable one from the person and seed.
    func simulateRun(of user: User, on bubble: Bubble, manifest: BubbleManifest, skill: Double? = nil, botSeed: Int? = nil, completion: @escaping (BubbleScore) -> Void) {
        let resolvedSkill = skill ?? BubbleRoster.skill(of: user.id)
        let seedKey = "opponent|\(user.id)|\(manifest.id)|\(manifest.seed)"
        let resolvedBotSeed = botSeed ?? Int(truncatingIfNeeded: SeededGenerator.stableHash(seedKey) & 0x7FFF_FFFF)
        runtimeWorker.simulateOnce(manifest, botSeed: resolvedBotSeed, botSkill: resolvedSkill) { simulation in
            if let simulation, var replay = simulation.replay {
                replay.length = manifest.length
                // The run's share artifact, tag included ("ending=ferry"), for friends' results.
                let share = simulation.raw["share"].flatMap { try? $0.decode(BubbleShareArtifact.self) }
                completion(BubbleScore(user: user, score: simulation.score, replay: replay, share: share, isVerified: true))
            } else {
                completion(BubbleScore(user: user, score: BubbleStore.syntheticScore(for: bubble, userID: user.id)))
            }
        }
    }
}
