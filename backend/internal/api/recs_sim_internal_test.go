package api

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"reflect"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/recs"
)

// An offline check of the whole feed ranker (game-recs.js in goja, plus the page rules and exploration) over a
// synthetic population: games with formulas, moods, bot playtests, plays, likes and finishes, some fresh, some
// in families; users with one favourite formula each. Run with -v to see the metrics:
//
//	go test ./internal/api -run TestRecsSimulation -v

var simFormulas = []string{"dodge", "time", "merge", "guess", "group", "answer", "make"}
var simMoods = map[string]string{"dodge": "hype", "time": "playful", "merge": "calm", "guess": "cozy", "group": "warm", "answer": "playful", "make": "playful"}

type simWorld struct {
	games    []model.Game
	byID     map[string]model.Game
	good     map[string]bool // bot playtests say the game works
	popular  map[string]bool // top third by plays
	fresh    map[string]bool
	families int
}

func simGames(now time.Time) simWorld {
	w := simWorld{byID: map[string]model.Game{}, good: map[string]bool{}, popular: map[string]bool{}, fresh: map[string]bool{}}
	r := rand.New(rand.NewSource(7))
	n := 0
	add := func(g model.Game) {
		w.games = append(w.games, g)
		w.byID[g.ID] = g
	}
	for _, f := range simFormulas {
		for k := 0; k < 6; k++ {
			n++
			id := fmt.Sprintf("g%02d", n)
			good := k%2 == 0
			if k == 5 && n%2 == 0 { // fresh games: half work, half don't
				good = true
			}
			var bots []model.BotRun
			for i, sk := range []float64{0.2, 0.5, 0.8, 0.95} {
				if good {
					bots = append(bots, model.BotRun{Skill: sk, Score: 10 + 30*i, Sec: 35})
				} else {
					bots = append(bots, model.BotRun{Skill: sk, Score: 12 - i, Sec: 2})
				}
			}
			plays := int64(r.Intn(40))
			if k == 1 || k == 2 { // one good and one weak game per formula are the hits
				plays = 400 + int64(r.Intn(200))
				w.popular[id] = true
			}
			created := now.Add(-10 * 24 * time.Hour).Add(-time.Duration(n) * time.Minute)
			if k == 5 {
				created = now.Add(-6 * time.Hour)
				w.fresh[id] = true
			}
			add(model.Game{ID: id, Slug: "mg-sim-" + id + "-abcd", Title: "Sim " + id, Formula: f, Mood: []string{simMoods[f]}, Energy: "medium",
				Competition: "light", Look: "paper", Scope: "everyone", Bots: bots, Plays: plays, Likes: plays / 5, Finishes: plays / 2, OwnerID: "maker", CreatedAt: created})
			w.good[id] = good
			w.families++
		}
	}
	// Families: two remixes and a Group copy of g01, a remix of g08. They must collapse into their base.
	base := w.byID["g01"]
	for i, suf := range []string{"r1", "r2"} {
		g := base
		g.ID, g.Slug, g.Title, g.RemixOf, g.CreatedAt = "g01"+suf, "mg-remix-"+suf+"-zzzz", "Remix "+suf, "g01", now.Add(-time.Duration(i+1)*time.Hour)
		add(g)
	}
	cp := base
	cp.ID, cp.Slug, cp.GroupID = "g01grp", base.Slug+"-newinsf", "grp1"
	add(cp)
	r8 := w.byID["g08"]
	r8.ID, r8.Slug, r8.Title, r8.RemixOf = "g08r", "mg-remix-g08-yyyy", "Remix of 8", "g08"
	add(r8)
	// Two sponsored games: their own families, shown only in ad slots.
	for _, id := range []string{"ad1", "ad2"} {
		add(model.Game{ID: id, Slug: "mg-ad-" + id + "-qqqq", Title: "Ad " + id, Formula: "dodge", Mood: []string{"hype"}, Look: "neon",
			Scope: "everyone", OwnerID: "brand", CreatedAt: now.Add(-48 * time.Hour), Sponsor: &model.Sponsor{Name: "Brand " + id}})
		w.families++
	}
	return w
}

type simSession struct {
	who, sid string
	rec      *model.RecsRecord
}

// page mirrors the feed handler for one page: build the pool from what this session saw, rank, record.
func (s *Server) simPage(t *testing.T, w simWorld, ss *simSession, count int, now time.Time) []rankedGame {
	t.Helper()
	sc := &socialContext{me: ss.who, friends: map[string]bool{}, groups: map[string]bool{}, peers: map[string]bool{}, scores: map[string][]model.Score{}, inGroup: map[string]map[string]bool{}}
	pool := buildPool(w.games, sc, seenSet(ss.rec.FeedSeen), nil)
	page, state, err := s.rankFeedPage(context.Background(), ss.who, ss.sid, ss.rec, w.games, pool, sc, ss.rec.FeedShown, count, 0, now)
	if err != nil {
		t.Fatal(err)
	}
	ss.rec.State = state
	for _, p := range page {
		ss.rec.Feed = append(ss.rec.Feed, p.g.ID)
		ss.rec.FeedKeys = append(ss.rec.FeedKeys, p.g.ID+"|"+p.p.Reason+"|"+orDash(p.p.RunUserID))
		ss.rec.FeedSeen = appendSeen(ss.rec.FeedSeen, p.g.ID, pool.bases[p.g.ID])
	}
	ss.rec.FeedShown += len(page)
	return page
}

// train teaches a user's model: games of their favourite formula are played, finished and liked (good ones more),
// everything else is mostly skipped.
func simTrain(t *testing.T, eng *recs.Engine, w simWorld, rec *model.RecsRecord, fav string, r *rand.Rand) {
	t.Helper()
	sums, _ := json.Marshal(summariesOf(w.games))
	state, err := eng.Run(context.Background(), rec.State, func(sess recsSession) error {
		if err := sess.Describe(sums); err != nil {
			return err
		}
		for i := 0; i < 30; i++ {
			g := w.games[r.Intn(len(w.games))]
			imp := map[string]any{"id": g.ID, "dwellSec": 1.5, "day": today()}
			if g.Formula == fav {
				imp["dwellSec"], imp["tookOver"], imp["runsFinished"], imp["liked"] = 40.0, true, 2, true
				if w.good[g.ID] {
					imp["replays"], imp["saved"] = 2, true
				}
			} else if r.Float64() < 0.3 {
				imp["dwellSec"], imp["tookOver"], imp["quitMidRun"] = 8.0, true, true
			}
			b, _ := json.Marshal(imp)
			if _, err := sess.Observe(b); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	rec.State = state
}

var simEngine *recs.Engine

func simServer(t *testing.T, explore float64) *Server {
	t.Helper()
	if simEngine == nil {
		e, err := recs.New(recs.Options{Runtimes: 2})
		if err != nil {
			t.Fatal(err)
		}
		simEngine = e
	}
	return New(Options{Recs: simEngine, FeedExplore: explore})
}

type simMetrics struct {
	tasteShare, baseShare            float64 // (a) favourite formula's share of the first page, and its share of the pool
	goodShare, goodPool              float64 // (b) share of first-page slots on games the bots rate well, vs their pool share
	popLift                          float64 // (b) among games the bots rate well: a hit's exposure rate over a non-hit's
	freshShare, freshPool            float64 // (c) share on games under 72h old, vs their pool share
	coverage                         int     // distinct games across every user's first page
	exploreShare                     float64 // share of slots filled by exploration
	repeats, familyRepeats, adMisses int     // (d)
	sessionLen, families             int
}

func runSim(t *testing.T, explore float64) simMetrics {
	now := time.Now().UTC()
	w := simGames(now)
	s := simServer(t, explore)
	var m simMetrics
	organic := 0
	for _, g := range w.games {
		if g.Sponsor == nil && g.RemixOf == "" && g.GroupID == "" {
			organic++
		}
	}
	slots, taste, good, popGood, otherGood, fresh, explored := 0, 0, 0, 0, 0, 0, 0
	distinct := map[string]bool{}
	r := rand.New(rand.NewSource(42))
	const users = 70
	const first = 10
	for u := 0; u < users; u++ {
		fav := simFormulas[u%len(simFormulas)]
		who := fmt.Sprintf("user%02d", u)
		ss := &simSession{who: who, sid: "s-" + who, rec: &model.RecsRecord{UserID: who}}
		simTrain(t, s.Recs, w, ss.rec, fav, r)
		for _, p := range s.simPage(t, w, ss, first, now) {
			if p.g.Sponsor != nil {
				continue
			}
			slots++
			distinct[p.g.ID] = true
			if p.g.Formula == fav {
				taste++
			}
			if w.good[p.g.ID] {
				good++
			}
			if w.good[p.g.ID] && w.popular[p.g.ID] {
				popGood++
			} else if w.good[p.g.ID] {
				otherGood++
			}
			if w.fresh[p.g.ID] {
				fresh++
			}
			if p.explore {
				explored++
			}
		}
	}
	f := func(a, b int) float64 { return float64(a) / float64(b) }
	m.tasteShare, m.baseShare = f(taste, slots), 1/float64(len(simFormulas))
	m.goodShare, m.goodPool = f(good, slots), 0.5
	goodHits, goodOthers := 0, 0
	for id, g := range w.byID {
		if w.good[id] && g.RemixOf == "" && g.GroupID == "" {
			if w.popular[id] {
				goodHits++
			} else {
				goodOthers++
			}
		}
	}
	m.popLift = (float64(popGood) / float64(goodHits)) / (float64(otherGood) / float64(goodOthers))
	m.freshShare, m.freshPool = f(fresh, slots), f(len(w.fresh), organic)
	m.coverage, m.exploreShare = len(distinct), f(explored, slots)

	// (d) Page a cold session to its end: no game or family twice, ads only in ad slots, every family shown once.
	ss := &simSession{who: "pager", sid: "s-pager", rec: &model.RecsRecord{UserID: "pager"}}
	bases := familyBases(w.games)
	seenG, seenB := map[string]bool{}, map[string]bool{}
	pos := 0
	for i := 0; i < 50; i++ {
		page := s.simPage(t, w, ss, 7, now)
		if len(page) == 0 {
			break
		}
		for _, p := range page {
			if seenG[p.g.ID] {
				m.repeats++
			}
			if seenB[bases[p.g.ID]] {
				m.familyRepeats++
			}
			if p.g.Sponsor != nil && !isAdSlot(pos) && pos < m.families-2 {
				m.adMisses++
			}
			seenG[p.g.ID], seenB[bases[p.g.ID]] = true, true
			pos++
		}
	}
	m.sessionLen, m.families = pos, w.families
	return m
}

func TestRecsSimulation(t *testing.T) {
	if testing.Short() {
		t.Skip("simulation")
	}
	for _, eps := range []float64{-1, 0.15} {
		m := runSim(t, eps)
		t.Logf("explore=%v: (a) favourite formula %.0f%% of first page (pool %.0f%%); (b) bot-rated good %.0f%% (pool %.0f%%), a hit is shown %.2fx as often as a non-hit of the same quality; "+
			"(c) fresh %.0f%% (pool %.0f%%); coverage %d games; explored %.0f%%; (d) session %d cards for %d families, repeats %d, family repeats %d, ad misses %d",
			eps, 100*m.tasteShare, 100*m.baseShare, 100*m.goodShare, 100*m.goodPool, m.popLift,
			100*m.freshShare, 100*m.freshPool, m.coverage, 100*m.exploreShare, m.sessionLen, m.families, m.repeats, m.familyRepeats, m.adMisses)
		if m.tasteShare < 1.75*m.baseShare {
			t.Errorf("explore=%v: personalisation is weak: favourite formula %.2f of the page vs %.2f base", eps, m.tasteShare, m.baseShare)
		}
		if m.goodShare <= m.goodPool {
			t.Errorf("explore=%v: bot quality doesn't lift a game: %.2f vs pool %.2f", eps, m.goodShare, m.goodPool)
		}
		if m.popLift <= 1.1 {
			t.Errorf("explore=%v: popularity doesn't lift a game: %.2fx", eps, m.popLift)
		}
		if m.freshShare < m.freshPool*0.75 {
			t.Errorf("explore=%v: fresh games are starved: %.2f vs pool %.2f", eps, m.freshShare, m.freshPool)
		}
		if m.repeats != 0 || m.familyRepeats != 0 || m.adMisses != 0 || m.sessionLen != m.families {
			t.Errorf("explore=%v: page rules broken: %+v", eps, m)
		}
	}
}

// Exploration is deterministic per session (a retried page is identical) and differs between sessions.
func TestExploreIsStablePerSession(t *testing.T) {
	now := time.Now().UTC()
	w := simGames(now)
	s := simServer(t, 0.5)
	ids := func(sid string) []string {
		ss := &simSession{who: "u1", sid: sid, rec: &model.RecsRecord{UserID: "u1"}}
		var out []string
		for _, p := range s.simPage(t, w, ss, 10, now) {
			out = append(out, p.g.ID)
		}
		return out
	}
	a, b := ids("sess-a"), ids("sess-a")
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("same session, different page:\n%v\n%v", a, b)
	}
	differs := false
	for i := 0; i < 5 && !differs; i++ {
		differs = !reflect.DeepEqual(a, ids(fmt.Sprintf("sess-%d", i)))
	}
	if !differs {
		t.Fatalf("every session got the same page: %v", a)
	}
}

func TestExploreRespectsThePool(t *testing.T) {
	now := time.Now()
	pool := []model.Game{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}, {ID: "e"}, {ID: "f"}}
	ranked := []rankedGame{{g: pool[0]}, {g: pool[1]}, {g: pool[2]}}
	out := explore(ranked, pool, 1, "s", 0, &socialContext{}, now) // every slot explores
	seen := map[string]bool{}
	for _, r := range out {
		if seen[r.g.ID] || !r.explore {
			t.Fatalf("bad explore page: %+v", out)
		}
		seen[r.g.ID] = true
	}
	if off := explore(ranked, pool, 0, "s", 0, &socialContext{}, now); len(off) != 3 {
		t.Fatalf("explore off changed the page size: %v", off)
	}
	for _, r := range explore(ranked, pool, 0, "s", 0, &socialContext{}, now) {
		if r.explore {
			t.Fatal("explore off still explored")
		}
	}
	srv := &Server{}
	for in, want := range map[float64]float64{0: 0.15, -1: 0, 0.3: 0.3, 5: 1} {
		srv.FeedExplore = in
		if got := srv.exploreRate(); got != want {
			t.Fatalf("exploreRate(%v) = %v, want %v", in, got, want)
		}
	}
}
