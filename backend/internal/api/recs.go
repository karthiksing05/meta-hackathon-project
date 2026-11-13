package api

import (
	"context"
	"encoding/json"
	"hash/fnv"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Ranking and learning. The recommender is Kevin's game-recs.js, run unchanged inside the backend
// (internal/recs). The phone sends what happened (events) and asks what to show next; the server
// keeps each person's model, so nothing about ranking lives in the app.
//
//	GET  /v1/feed?limit=&sessionID=&exclude=   -> the next pages, ranked (the one feed endpoint)
//	POST /v1/feed/events                       -> also teaches my model (signed in)
//	POST /v1/blend     {group, members, count} -> games and a game spec for a set of people
//	GET  /v1/me/recs                           -> my model's summary and taste profile

const (
	searchPool       = 50  // the best text matches that a signed-in search reorders with the person's taste
	searchRecsWeight = 0.4 // how much of the final order comes from the recommender (the rest is text relevance)
	maxCandidates    = 300
	sessionGap       = 30 * time.Minute
	maxFeedHistory   = 200
	maxBlendMember   = 12
)

// userLocks serializes one person's load-run-save round trips, so two requests can't overwrite each other.
type userLocks struct{ m sync.Map }

func (l *userLocks) lock(id string) func() {
	v, _ := l.m.LoadOrStore(id, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

func today() int { return int(time.Now().Unix() / 86400) }

func (s *Server) recsEnabled() bool { return s.Recs != nil }

// gameSummary is what the recommender needs to know about a game.
func gameSummary(g model.Game) map[string]any {
	mood := g.Mood
	if len(mood) == 0 {
		mood = g.Tags
	}
	scope := g.Scope
	if scope == "" {
		scope = "everyone"
	}
	bots := make([]map[string]any, 0, len(g.Bots))
	for _, b := range g.Bots {
		r := map[string]any{"skill": b.Skill, "score": b.Score}
		if b.Sec > 0 {
			r["sec"] = b.Sec
		}
		bots = append(bots, r)
	}
	var group any
	if g.GroupID != "" {
		group = g.GroupID
	}
	return map[string]any{
		"id": g.ID, "formula": g.Formula, "mood": nonNil(mood), "energy": g.Energy, "competition": g.Competition,
		"look": g.Look, "scope": scope, "isDaily": g.IsDaily, "bots": bots, "creatorID": g.OwnerID, "groupID": group,
	}
}

func summariesOf(games []model.Game) []map[string]any {
	out := make([]map[string]any, len(games))
	for i, g := range games {
		out[i] = gameSummary(g)
	}
	return out
}

// candidatesOf offers every game on equal terms (reason "popular", weight 1, which adds nothing to a
// score). The server has no ranking logic of its own: which game comes first is decided entirely by
// Kevin's recommender, from each game's description and each person's model.
func candidatesOf(games []model.Game) []map[string]any {
	out := make([]map[string]any, len(games))
	for i, g := range games {
		out[i] = map[string]any{"gameID": g.ID, "reason": "popular", "runUserID": nil, "weight": 1.0}
	}
	return out
}

func (s *Server) loadRecs(ctx context.Context, userID string) (*model.RecsRecord, error) {
	rec, err := s.Store.GetRecs(ctx, userID)
	if err != nil {
		if err == store.ErrNotFound {
			return &model.RecsRecord{UserID: userID}, nil
		}
		return nil, err
	}
	return rec, nil
}

type rankPick struct {
	GameID    string          `json:"gameID"`
	Reason    string          `json:"reason"`
	RunUserID *string         `json:"runUserID"`
	Score     float64         `json:"score"`
	Hook      float64         `json:"hook"`
	Tier      string          `json:"tier"`
	PSlop     float64         `json:"pSlop"`
	Unproven  bool            `json:"unproven"`
	Why       string          `json:"why"`
	Team      string          `json:"team"`
	Raw       json.RawMessage `json:"-"`
}

// feedItem is a game as the feed shows it: the game's own fields plus why it was picked.
type feedItem struct {
	model.GameView
	FeedItemID string  `json:"feedItemID"`
	BaseID     string  `json:"baseId,omitempty"` // the game's family: copies, remixes and variants share it
	Reason     string  `json:"reason"`
	Why        string  `json:"why,omitempty"`
	Score      float64 `json:"score"`
	Hook       float64 `json:"hook"`
	Unproven   bool    `json:"unproven"`
	Team       string  `json:"team,omitempty"`
}

// feed is the one feed endpoint: GET /v1/feed?limit=10&sessionID=...&exclude=...
//
// Every page it returns is ordered by Kevin's recommender, inside the page rules in feedpage.go: one entry per
// game family, never a family twice in one session, sponsored games only at fixed positions. A signed-in
// person's session is kept with their model; a guest's is kept in memory under its sessionID (the server makes
// one up and returns it when the caller sends none). exclude=<id,id,...> (ids or slugs) skips games the caller
// already has, signed in or not. Only if ranking is switched off on the server (RECS_RUNTIMES=0) does the order
// fall back to newest first, with reason "newest"; the page rules still apply.
func (s *Server) feed(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	count := limitParam(r, 10, 30)
	if c, err := strconv.Atoi(q.Get("count")); err == nil && c > 0 {
		count = min(c, 30)
	}
	sessionID := q.Get("sessionID")
	if len(sessionID) > 64 {
		writeErr(w, 400, "sessionID is too long")
		return
	}
	games, err := s.Store.AllGames(r.Context(), maxCandidates)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	u := userFrom(r)
	if u == nil && sessionID == "" {
		sessionID = "g_" + auth.NewID(12) // a guest's pages need a session to continue from
	}
	var exclude []string
	for _, id := range strings.Split(q.Get("exclude"), ",") {
		if id = strings.TrimSpace(id); id != "" && len(exclude) < 200 {
			exclude = append(exclude, id)
		}
	}

	now := time.Now().UTC()
	rec := &model.RecsRecord{}
	anonKey := "anon|" + sessionID
	var anon anonFeed
	if u != nil {
		unlock := s.recsLocks.lock(u.ID)
		defer unlock()
		if rec, err = s.loadRecs(r.Context(), u.ID); err != nil {
			s.serverErr(w, r, err)
			return
		}
		if (sessionID != "" && sessionID != rec.FeedSession) || (!rec.FeedAt.IsZero() && now.Sub(rec.FeedAt) > sessionGap) {
			rec.Feed, rec.FeedKeys, rec.FeedSeen, rec.FeedShown = nil, nil, nil, 0 // a new session starts a new page list
		}
		if sessionID != "" {
			rec.FeedSession = sessionID
		}
	} else {
		unlock := s.recsLocks.lock(anonKey)
		defer unlock()
		anon = s.anonFeeds.get(anonKey, now)
		rec.Feed, rec.FeedSeen, rec.FeedShown = append([]string(nil), anon.seen...), anon.seen, anon.shown
	}

	sc := s.loadSocial(r.Context(), u)
	pool := buildPool(games, sc, seenSet(rec.FeedSeen), exclude)
	start := rec.FeedShown

	var page []rankedGame
	var state string
	if !s.recsEnabled() {
		org, spon := make([]rankedGame, len(pool.organic)), make([]rankedGame, len(pool.sponsored))
		for i, g := range pool.organic {
			org[i] = rankedGame{g, rankPick{GameID: g.ID, Reason: "newest"}}
		}
		for i, g := range pool.sponsored {
			spon[i] = rankedGame{g, rankPick{GameID: g.ID, Reason: "newest"}}
		}
		page = layoutPage(org, spon, start, count)
	} else {
		who := "anon|" + sessionID
		if u != nil {
			who = u.ID
		}
		h := fnv.New32a()
		h.Write([]byte(who + "|" + strconv.Itoa(start+len(exclude)) + "|" + strconv.Itoa(today())))
		seed := h.Sum32()
		summaries := summariesOf(games)
		var org, spon []rankedGame
		state, err = s.Recs.Run(r.Context(), rec.State, func(sess recsSession) error {
			var err error
			if org, err = rankPool(sess, pool.organic, count, sc, now, summaries, rec, seed); err != nil {
				return err
			}
			spon, err = rankPool(sess, pool.sponsored, count, sc, now, summaries, rec, seed^0x5f3759df)
			return err
		})
		if err != nil {
			s.Log.Error("recs: rank failed", "err", err)
			writeErr(w, 503, "ranking is unavailable right now")
			return
		}
		page = layoutPage(org, spon, start, count)
	}

	shown := make([]model.Game, len(page))
	for i, p := range page {
		shown[i] = p.g
	}
	views, err := s.views(r, shown)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := make([]feedItem, len(page))
	for i, p := range page {
		base := pool.bases[p.g.ID]
		items[i] = feedItem{GameView: views[i], FeedItemID: "fi_" + auth.NewID(6), BaseID: base, Reason: p.p.Reason, Why: p.p.Why,
			Score: p.p.Score, Hook: p.p.Hook, Unproven: p.p.Unproven, Team: p.p.Team}
		rec.Feed = append(rec.Feed, p.g.ID)
		rec.FeedKeys = append(rec.FeedKeys, p.g.ID+"|"+p.p.Reason+"|"+orDash(p.p.RunUserID))
		rec.FeedSeen = appendSeen(rec.FeedSeen, p.g.ID, base)
	}
	rec.FeedShown += len(page)
	if u != nil { // a signed-in person's session and model are kept with their model
		if n := len(rec.Feed) - maxFeedHistory; n > 0 {
			rec.Feed, rec.FeedKeys = rec.Feed[n:], rec.FeedKeys[n:]
		}
		if s.recsEnabled() {
			rec.State = state
		}
		rec.FeedAt, rec.UpdatedAt = now, now
		if err := s.Store.PutRecs(r.Context(), rec); err != nil {
			s.serverErr(w, r, err)
			return
		}
	} else {
		s.anonFeeds.put(anonKey, anonFeed{seen: rec.FeedSeen, shown: rec.FeedShown, at: now})
	}
	writeJSON(w, 200, map[string]any{"items": items, "sessionID": sessionID})
}

// rankedGame is a game the recommender placed, with why.
type rankedGame struct {
	g model.Game
	p rankPick
}

// rankPool asks the recommender to order a page's worth of games from pool, a list with one game per unseen
// family. Every candidate is unseen, so the recommender can only choose among new games. It may name a game twice
// in one answer (its repeat window is short), so picks are kept once each and it is asked again, without the games
// it has already given, until the page is full or the pool is empty.
func rankPool(sess recsSession, pool []model.Game, want int, sc *socialContext, now time.Time, summaries []map[string]any,
	rec *model.RecsRecord, seed uint32) ([]rankedGame, error) {
	var out []rankedGame
	left := append([]model.Game(nil), pool...)
	feed := append([]string(nil), rec.Feed...)
	keys := append([]string(nil), rec.FeedKeys...)
	for round := 0; round < 4 && len(out) < want && len(left) > 0; round++ {
		need := want - len(out)
		input, _ := json.Marshal(map[string]any{
			"candidates": candidatesFor(left, sc, now), "summaries": summaries, "feed": nonNil(feed), "feedKeys": nonNil(keys),
			"count": min(need*2, 60), "seed": seed + uint32(round), "day": today(), "now": now.UnixMilli(),
		})
		raw, err := sess.Rank(input)
		if err != nil {
			return nil, err
		}
		var reply struct {
			Picks []rankPick `json:"picks"`
		}
		if err := json.Unmarshal(raw, &reply); err != nil {
			return nil, err
		}
		byID := map[string]int{}
		for i, g := range left {
			byID[g.ID] = i
		}
		taken := map[string]bool{}
		for _, p := range reply.Picks {
			if len(out) >= want {
				break
			}
			i, ok := byID[p.GameID]
			if !ok || taken[p.GameID] {
				continue
			}
			taken[p.GameID] = true
			out = append(out, rankedGame{left[i], p})
			feed = append(feed, p.GameID)
			keys = append(keys, p.GameID+"|"+p.Reason+"|"+orDash(p.RunUserID))
		}
		if len(taken) == 0 {
			break // the recommender has nothing more to give from this pool
		}
		kept := left[:0:0]
		for _, g := range left {
			if !taken[g.ID] {
				kept = append(kept, g)
			}
		}
		left = kept
	}
	return out, nil
}

func orDash(s *string) string {
	if s == nil || *s == "" {
		return "-"
	}
	return *s
}

// ---- learning from events ----

// learnFromEvents teaches a signed-in person's model what happened. Failures are logged and never
// fail the request: events are stored either way.
func (s *Server) learnFromEvents(ctx context.Context, userID string, evs []model.Event) {
	if !s.recsEnabled() || len(evs) == 0 {
		return
	}
	type step struct {
		kind string // "observe" or "signal"
		body []byte
	}
	var steps []step
	ids := map[string]bool{}
	resolved := map[string]string{} // game key -> server id ("" when unknown)
	resolve := func(key string) string {
		if id, ok := resolved[key]; ok {
			return id
		}
		var g *model.Game
		var err error
		if store.LooksLikeID(key) {
			g, err = s.Store.GameByID(ctx, key)
		} else {
			g, err = s.Store.GameBySlug(ctx, key)
		}
		id := ""
		if err == nil {
			id = g.ID
		}
		resolved[key] = id
		return id
	}
	for _, e := range evs {
		if e.Type != "" { // the older event types carry no page detail
			continue
		}
		id := resolve(e.GameID)
		if id == "" {
			continue
		}
		day := today()
		if e.Day != nil {
			day = *e.Day
		}
		if e.Kind != "" {
			b, _ := json.Marshal(map[string]any{"id": id, "kind": e.Kind, "with": nonNil(e.With), "day": day})
			steps = append(steps, step{"signal", b})
		} else if e.Impression {
			b, _ := json.Marshal(map[string]any{
				"id": id, "dwellSec": e.DwellSec, "tookOver": e.TookOver, "runsFinished": e.RunsFinished, "replays": e.Replays,
				"saved": e.Saved, "liked": e.Liked, "floated": e.Floated, "openedBoard": e.OpenedBoard, "addedFriend": e.AddedFriend,
				"remixed": e.Remixed, "social": nonNil(e.Social), "with": nonNil(e.With), "quitMidRun": e.QuitMidRun,
				"endedSession": e.EndedSession, "day": day,
			})
			steps = append(steps, step{"observe", b})
		} else {
			continue
		}
		ids[id] = true
	}
	if len(steps) == 0 {
		return
	}
	var games []model.Game
	for id := range ids {
		if g, err := s.Store.GameByID(ctx, id); err == nil {
			games = append(games, *g)
		}
	}
	sort.Slice(games, func(i, j int) bool { return games[i].ID < games[j].ID })
	summaries, _ := json.Marshal(summariesOf(games))

	unlock := s.recsLocks.lock(userID)
	defer unlock()
	rec, err := s.loadRecs(ctx, userID)
	if err != nil {
		s.Log.Error("recs: could not load state", "user", userID, "err", err)
		return
	}
	state, err := s.Recs.Run(ctx, rec.State, func(sess recsSession) error {
		if err := sess.Describe(summaries); err != nil {
			return err
		}
		for _, st := range steps {
			var err error
			if st.kind == "signal" {
				_, err = sess.Signal(st.body)
			} else {
				_, err = sess.Observe(st.body)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.Log.Error("recs: could not learn from events", "user", userID, "err", err)
		return
	}
	rec.State, rec.UpdatedAt = state, time.Now().UTC()
	if err := s.Store.PutRecs(ctx, rec); err != nil {
		s.Log.Error("recs: could not save state", "user", userID, "err", err)
	}
}

// ---- summary ----

func (s *Server) myRecs(w http.ResponseWriter, r *http.Request) {
	if !s.recsEnabled() {
		writeErr(w, 503, "ranking is not set up on this server")
		return
	}
	u := userFrom(r)
	unlock := s.recsLocks.lock(u.ID)
	defer unlock()
	rec, err := s.loadRecs(r.Context(), u.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	var summary, profile, tally json.RawMessage
	if _, err := s.Recs.Run(r.Context(), rec.State, func(sess recsSession) (err error) {
		if summary, err = sess.DebugSummary(); err != nil {
			return err
		}
		if profile, err = sess.Profile(); err != nil {
			return err
		}
		tally, err = sess.InterleaveStats()
		return err
	}); err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"version": s.Recs.Version(), "summary": summary, "profile": profile, "interleave": tally})
}

// ---- Group Blend ----

type blendMember struct {
	UserID   string         `json:"userID"`
	Name     string         `json:"name"`
	IsFriend bool           `json:"isFriend"`
	Skill    map[string]any `json:"skill"`
	Bio      string         `json:"bio"`
	Themes   []string       `json:"themes"`
}

type blendIn struct {
	Group   struct{ ID, Name string } `json:"group"`
	Members []blendMember             `json:"members"`
	Count   int                       `json:"count"`
}

// blend ranks games for a set of people and builds the Blend game spec. Members the server knows
// (they have played) are blended from what they actually like; others get the file's demo profile,
// steered by `bio` and `themes`.
func (s *Server) blend(w http.ResponseWriter, r *http.Request) {
	if !s.recsEnabled() {
		writeErr(w, 503, "ranking is not set up on this server")
		return
	}
	var in blendIn
	if !decode(w, r, &in) {
		return
	}
	if len(in.Members) < 1 || len(in.Members) > maxBlendMember {
		writeErr(w, 400, "send between 1 and 12 members")
		return
	}
	if in.Count < 1 {
		in.Count = 8
	}
	in.Count = min(in.Count, 20)
	if in.Group.Name == "" {
		in.Group.Name = "your Group"
	}
	u := userFrom(r)
	hasMe := false
	for i, m := range in.Members {
		if m.UserID == "" || len(m.UserID) > 64 {
			writeErr(w, 400, "every member needs a userID")
			return
		}
		hasMe = hasMe || m.UserID == u.ID
		in.Members[i].Skill = skillOf(m.Skill)
	}
	if !hasMe {
		writeErr(w, 400, "the signed-in person must be one of the members")
		return
	}
	s.runBlend(w, r, in)
}

// runBlend runs a Blend for already-validated members; the signed-in person is one of them.
func (s *Server) runBlend(w http.ResponseWriter, r *http.Request, in blendIn) {
	u := userFrom(r)
	if in.Count < 1 {
		in.Count = 8
	}
	in.Count = min(in.Count, 20)
	if in.Group.Name == "" {
		in.Group.Name = "your Group"
	}
	games, err := s.Store.AllGames(r.Context(), maxCandidates)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	friends, _ := s.friendSet(r.Context(), u.ID) // who is a friend comes from the server, not the caller

	// Profiles of the members the server knows.
	members := make([]map[string]any, 0, len(in.Members))
	for _, m := range in.Members {
		member := map[string]any{"id": m.UserID, "name": m.Name, "isMe": m.UserID == u.ID, "isFriend": friends[m.UserID] || m.UserID == u.ID, "skill": m.Skill}
		if m.Bio != "" || len(m.Themes) > 0 {
			member["hints"] = map[string]any{"bio": m.Bio, "themes": nonNil(m.Themes)}
		}
		if m.UserID != u.ID {
			m.IsFriend = friends[m.UserID]
			if p := s.memberProfile(r.Context(), m); p != nil {
				member["profile"] = p
			}
		}
		members = append(members, member)
	}

	unlock := s.recsLocks.lock(u.ID)
	defer unlock()
	rec, err := s.loadRecs(r.Context(), u.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	input, _ := json.Marshal(map[string]any{
		"group": map[string]any{"id": in.Group.ID, "name": in.Group.Name}, "members": members,
		"summaries": summariesOf(games), "feed": []string{}, "count": in.Count, "day": today(),
	})
	var out map[string]any
	if _, err := s.Recs.Run(r.Context(), rec.State, func(sess recsSession) error {
		b, err := sess.GroupBlend(input)
		if err != nil {
			return err
		}
		return json.Unmarshal(b, &out)
	}); err != nil {
		s.Log.Error("recs: blend failed", "user", u.ID, "err", err)
		writeErr(w, 503, "blending is unavailable right now")
		return
	}
	// Attach the game to each pick, so the app needs no second call.
	byID := map[string]model.Game{}
	for _, g := range games {
		byID[g.ID] = g
	}
	if picks, ok := out["picks"].([]any); ok {
		for _, p := range picks {
			pm, _ := p.(map[string]any)
			if g, ok := byID[str(pm["gameID"])]; ok {
				if v, err := s.views(r, []model.Game{g}); err == nil {
					pm["game"] = v[0]
				}
			}
		}
	}
	writeJSON(w, 200, out)
}

func str(v any) string { s, _ := v.(string); return s }

// skillOf accepts {overall, byFormula} and leaves the rest to the recommender's defaults.
func skillOf(in map[string]any) map[string]any {
	out := map[string]any{"overall": 0.5, "byFormula": map[string]any{}}
	if in == nil {
		return out
	}
	if o, ok := in["overall"].(float64); ok {
		out["overall"] = math.Max(0, math.Min(1, o))
	}
	if by, ok := in["byFormula"].(map[string]any); ok {
		clean := map[string]any{}
		for k, v := range by {
			if f, ok := v.(float64); ok {
				clean[strings.ToLower(k)] = math.Max(0, math.Min(1, f))
			}
		}
		out["byFormula"] = clean
	}
	return out
}

// memberProfile is a known person's taste profile, or nil when they have no history here.
func (s *Server) memberProfile(ctx context.Context, m blendMember) map[string]any {
	rec, err := s.Store.GetRecs(ctx, m.UserID)
	if err != nil || rec.State == "" {
		return nil
	}
	unlock := s.recsLocks.lock(m.UserID)
	defer unlock()
	var raw []byte
	if _, err := s.Recs.Run(ctx, rec.State, func(sess recsSession) (err error) {
		raw, err = sess.Profile()
		return err
	}); err != nil {
		return nil
	}
	var p map[string]any
	if json.Unmarshal(raw, &p) != nil {
		return nil
	}
	if n, _ := p["n"].(float64); n < 1 { // no pages seen: use the demo profile instead
		return nil
	}
	name := m.Name
	if name == "" {
		name = m.UserID
	}
	p["id"], p["name"], p["isMe"], p["isFriend"], p["skill"] = m.UserID, name, false, m.IsFriend, m.Skill
	p["themes"] = nonNil(m.Themes)
	return p
}

// personalizeSearch reorders a search's best text matches with the person's taste. The text match
// still counts most: each game's final position blends its text-relevance rank (60%) with its
// recommender rank (40%). It asks Kevin's recommender to rank only these games and keeps the answer
// out of the person's saved model and page history, since a search result isn't a page they were shown.
func (s *Server) personalizeSearch(ctx context.Context, u *model.User, query string, pool []model.Game) []model.Game {
	if len(pool) < 2 {
		return pool
	}
	rec, err := s.loadRecs(ctx, u.ID)
	if err != nil {
		return pool
	}
	h := fnv.New32a()
	h.Write([]byte(u.ID + "|" + query))
	input, _ := json.Marshal(map[string]any{
		"candidates": candidatesOf(pool), "summaries": summariesOf(pool), "feed": []string{}, "feedKeys": []string{},
		"count": len(pool), "seed": h.Sum32(), "day": today(), "now": time.Now().UnixMilli(),
	})
	var reply struct {
		Picks []rankPick `json:"picks"`
	}
	if _, err := s.Recs.Run(ctx, rec.State, func(sess recsSession) error {
		out, err := sess.Rank(input)
		if err != nil {
			return err
		}
		return json.Unmarshal(out, &reply)
	}); err != nil {
		s.Log.Warn("recs: search personalization skipped", "err", err)
		return pool
	}
	// A game can be picked twice once the repeat window passes: keep its first place, and put any
	// game the recommender didn't place after the others, in text order.
	recRank := map[string]int{}
	for _, p := range reply.Picks {
		if _, ok := recRank[p.GameID]; !ok {
			recRank[p.GameID] = len(recRank)
		}
	}
	for _, g := range pool {
		if _, ok := recRank[g.ID]; !ok {
			recRank[g.ID] = len(recRank)
		}
	}
	type scored struct {
		g     model.Game
		fused float64
		text  int
	}
	rows := make([]scored, len(pool))
	for i, g := range pool {
		rows[i] = scored{g, (1-searchRecsWeight)*float64(i) + searchRecsWeight*float64(recRank[g.ID]), i}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].fused != rows[j].fused {
			return rows[i].fused < rows[j].fused
		}
		return rows[i].text < rows[j].text
	})
	out := make([]model.Game, len(rows))
	for i, r := range rows {
		out[i] = r.g
	}
	return out
}
