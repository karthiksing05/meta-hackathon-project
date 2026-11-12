# Scroll Games: judging criteria map

The hackathon brief's judging criteria are not in this repository. The criteria below are an assumed standard set. Replace them with the real ones when known; the evidence column stays valid.

| Assumed criterion | Demo moment (PITCH.md run sheet) | Evidence |
|---|---|---|
| Impact and usefulness | 0:00 feed with friends' challenges; 4:35 daily game and streak; 5:05 new game lands in the feed. Shows a loop where people make and play together instead of only watching | Feed bands in `scroll-games/server/internal/srv/handlers.go` (`bandNames`); challenge flow in `SGResultView.swift`; challenge links open in a browser (`/c/<id>`); daily game and streak (`scroll-games/server/internal/srv/daily.go`, `daily_test.go`), follows saved on the server (`SGFollowService.swift`), verified in the iOS simulator with the streak going 3 to 4 and the score verified by server replay |
| Creativity and originality | 2:45 questions drawn from friends' photo captions and a Wonder-written "final round worth double" rule | `scroll-games/spec/concepts.json` (179 concepts, 14 kinds); `spec/templates/quiz.manifest.json`; glue API in `CONTRACTS.md` |
| Technical execution | 0:30 wasm game with verified score; 3:30 sandbox; 4:15 same seed in a browser | Rust core `scroll-games/runtime`; `sgtool validate` and `replay`; wasm 391 KB gzipped; `scroll-games/scripts/e2e-test-game.mjs` and `browser-play-check.mjs`; `go test ./...`, `cargo test` |
| Use of Meta AI models | 1:45 Ember brief in 1.2 s; 2:15 Wonder plan and Ember content in parallel; 2:45 Muse is load-bearing (including the Muse-generated demo photos) | `scroll-games/server/internal/srv/muse.go`, `prompts.go`, `gen.go`; live build 5.2 s (Wonder 5.0 s, Ember 2.2 s); 9 of 9 plans valid first try; `/api/usage` shows calls per model; 12 demo photos generated with muse-image-1.0 by `scroll-games/server/cmd/genphotos` (about $0.12 total), matched to their questions in the simulator |
| Presentation and UX | 1:15 opt-in toggle; 2:15 live stage list; 4:00 share sheet | `SGCreateFlowView.swift` (prompt, brief, generating, preview); loading, error, empty and offline states in `ScrollGamesHomeView.swift`; style guide `docs/STYLE_GUIDE.md` |
| Feasibility | 4:50 cost and latency numbers | About $0.027 per game; cache hit 3-5 ms; spend cap `SG_SPEND_CAP_USD`; template fallback; repair retry |

## Gaps to state honestly

- Moderation is a stub (`moderation: "stub-pass"`).
- Data and identity are synthetic (`X-User` header).
- 20 of 179 concepts are implemented; the rest are contract-only.
