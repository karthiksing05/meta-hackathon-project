package api

import (
	"hash/fnv"
	"math/rand"
	"sort"
	"strconv"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// Exploration: a little controlled randomness on top of the recommender's order, so a feed isn't the same
// handful of games for everyone and new or overlooked games get seen.
//
//   - Jitter: each game on the page moves up or down by up to exploreJitter places, from a hash of the session and
//     the game. The same session always gets the same order, so a retried page is identical.
//   - Epsilon: each regular slot, with probability FEED_EXPLORE (default 0.15), is given to a random eligible
//     family the recommender did not put on this page (still one per family, still never seen this session).
//
// Sponsored games are left alone (they keep their fixed ad slots), and the page rules in feedpage.go apply
// unchanged: exploration only chooses among the unseen families buildPool offers.

const (
	defaultFeedExplore = 0.15
	exploreJitter      = 1.0 // at most this many places up or down
)

// exploreRate is the epsilon in use: Options.FeedExplore, 0 meaning the default and a negative value meaning off.
func (s *Server) exploreRate() float64 {
	switch e := s.FeedExplore; {
	case e < 0:
		return 0
	case e == 0:
		return defaultFeedExplore
	case e > 1:
		return 1
	default:
		return e
	}
}

func hash64(parts ...string) uint64 {
	h := fnv.New64a()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return h.Sum64()
}

// unit is a deterministic number in [0, 1) from the given strings.
func unit(parts ...string) float64 { return float64(hash64(parts...)>>11) / float64(1<<53) }

// explore applies the session jitter and the epsilon picks to a ranked list of regular games. pool is every
// eligible family (one game each); session identifies the person and session; start is the page's position in it.
func explore(ranked []rankedGame, pool []model.Game, eps float64, session string, start int, sc *socialContext, now time.Time) []rankedGame {
	if len(ranked) == 0 {
		return ranked
	}
	out := append([]rankedGame(nil), ranked...)
	// Jitter: a stable sort on position plus a small per-session offset.
	keys := make(map[string]float64, len(out))
	for i, r := range out {
		keys[r.g.ID] = float64(i) + exploreJitter*(2*unit("jitter", session, r.g.ID)-1)
	}
	sort.SliceStable(out, func(i, j int) bool { return keys[out[i].g.ID] < keys[out[j].g.ID] })
	if eps <= 0 {
		return out
	}
	used := make(map[string]bool, len(out))
	for _, r := range out {
		used[r.g.ID] = true
	}
	var spare []model.Game
	for _, g := range pool {
		if !used[g.ID] {
			spare = append(spare, g)
		}
	}
	rng := rand.New(rand.NewSource(int64(hash64("explore", session, strconv.Itoa(start)))))
	for i := range out {
		if len(spare) == 0 {
			break
		}
		if rng.Float64() >= eps {
			continue
		}
		k := rng.Intn(len(spare))
		g := spare[k]
		spare = append(spare[:k], spare[k+1:]...)
		out[i] = rankedGame{g: g, p: rankPick{GameID: g.ID, Reason: bestReason(g, sc, now), Why: "Something different to try"}, explore: true}
	}
	return out
}

// bestReason is the highest-weighted reason the feed's candidates give a game, so an explored game still gets the
// app's usual context line.
func bestReason(g model.Game, sc *socialContext, now time.Time) string {
	reason, w := "popular", -1.0
	for _, c := range candidatesFor([]model.Game{g}, sc, now) {
		if cw, _ := c["weight"].(float64); cw > w {
			w, reason = cw, c["reason"].(string)
		}
	}
	return reason
}
