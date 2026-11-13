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
//	POST /v1/me/feed   {count, sessionID?}    -> the next pages for me, ranked
//	POST /v1/feed/events                       -> also teaches my model (signed in)
//	POST /v1/blend     {group, members, count} -> games and a game spec for a set of people
//	GET  /v1/me/recs                           -> my model's summary and taste profile

const (
	maxCandidates  = 300
	sessionGap     = 30 * time.Minute
	maxFeedHistory = 200
	maxBlendMember = 12
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

// candidatesOf offers every game: new ones get a small push, popular ones a push that grows with
// plays and saves. (There is no friends graph on the server yet, so no "from your people" reasons.)
func candidatesOf(games []model.Game, now time.Time) []map[string]any {
	out := make([]map[string]any, len(games))
	for i, g := range games {
		reason, weight := "popular", 1+math.Min(1, math.Log1p(float64(g.Plays)+3*float64(g.Likes))/6)
		if now.Sub(g.CreatedAt) < 48*time.Hour {
			reason, weight = "new", 1.3
		}
		out[i] = map[string]any{"gameID": g.ID, "reason": reason, "runUserID": nil, "weight": weight}
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

type feedIn struct {
	Count     int    `json:"count"`
	SessionID string `json:"sessionID"`
}

func (s *Server) myFeed(w http.ResponseWriter, r *http.Request) {
	if !s.recsEnabled() {
		writeErr(w, 503, "ranking is not set up on this server")
		return
	}
	var in feedIn
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	if in.Count < 1 {
		in.Count = 10
	}
	in.Count = min(in.Count, 30)
	if len(in.SessionID) > 64 {
		writeErr(w, 400, "sessionID is too long")
		return
	}
	u := userFrom(r)
	games, err := s.Store.AllGames(r.Context(), maxCandidates)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if len(games) == 0 {
		writeJSON(w, 200, map[string]any{"items": []any{}})
		return
	}
	unlock := s.recsLocks.lock(u.ID)
	defer unlock()

	rec, err := s.loadRecs(r.Context(), u.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	now := time.Now().UTC()
	if (in.SessionID != "" && in.SessionID != rec.FeedSession) || (!rec.FeedAt.IsZero() && now.Sub(rec.FeedAt) > sessionGap) {
		rec.Feed, rec.FeedKeys = nil, nil // a new session starts a new page list
	}
	if in.SessionID != "" {
		rec.FeedSession = in.SessionID
	}
	h := fnv.New32a()
	h.Write([]byte(u.ID + "|" + strconv.Itoa(len(rec.Feed)) + "|" + strconv.Itoa(today())))
	input, _ := json.Marshal(map[string]any{
		"candidates": candidatesOf(games, now), "summaries": summariesOf(games), "feed": nonNil(rec.Feed), "feedKeys": nonNil(rec.FeedKeys),
		"count": in.Count, "seed": h.Sum32(), "day": today(), "now": now.UnixMilli(),
	})
	var reply struct {
		Picks []rankPick `json:"picks"`
		Bait  any        `json:"bait"`
	}
	state, err := s.Recs.Run(r.Context(), rec.State, func(sess recsSession) error {
		out, err := sess.Rank(input)
		if err != nil {
			return err
		}
		return json.Unmarshal(out, &reply)
	})
	if err != nil {
		s.Log.Error("recs: rank failed", "user", u.ID, "err", err)
		writeErr(w, 503, "ranking is unavailable right now")
		return
	}
	byID := map[string]model.Game{}
	for _, g := range games {
		byID[g.ID] = g
	}
	var shown []model.Game
	for _, p := range reply.Picks {
		if g, ok := byID[p.GameID]; ok {
			shown = append(shown, g)
		}
	}
	views, err := s.views(r, shown)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(shown))
	vi := 0
	for _, p := range reply.Picks {
		if _, ok := byID[p.GameID]; !ok {
			continue
		}
		item := map[string]any{
			"feedItemID": "fi_" + auth.NewID(6), "game": views[vi], "reason": p.Reason, "why": p.Why,
			"score": p.Score, "hook": p.Hook, "unproven": p.Unproven,
		}
		if p.Team != "" {
			item["team"] = p.Team
		}
		items = append(items, item)
		vi++
		rec.Feed = append(rec.Feed, p.GameID)
		rec.FeedKeys = append(rec.FeedKeys, p.GameID+"|"+p.Reason+"|"+orDash(p.RunUserID))
	}
	if n := len(rec.Feed) - maxFeedHistory; n > 0 {
		rec.Feed, rec.FeedKeys = rec.Feed[n:], rec.FeedKeys[n:]
	}
	rec.State, rec.FeedAt, rec.UpdatedAt = state, now, now
	if err := s.Store.PutRecs(r.Context(), rec); err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "bait": reply.Bait})
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
	games, err := s.Store.AllGames(r.Context(), maxCandidates)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}

	// Profiles of the members the server knows.
	members := make([]map[string]any, 0, len(in.Members))
	for _, m := range in.Members {
		member := map[string]any{"id": m.UserID, "name": m.Name, "isMe": m.UserID == u.ID, "isFriend": m.IsFriend || m.UserID == u.ID, "skill": m.Skill}
		if m.Bio != "" || len(m.Themes) > 0 {
			member["hints"] = map[string]any{"bio": m.Bio, "themes": nonNil(m.Themes)}
		}
		if m.UserID != u.ID {
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
