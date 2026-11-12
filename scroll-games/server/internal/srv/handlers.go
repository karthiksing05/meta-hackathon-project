package srv

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(c int)           { w.status = c; w.ResponseWriter.WriteHeader(c) }
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func decode(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4<<20)).Decode(v)
}

// Handler returns the full HTTP handler with CORS and request logging.
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/me", a.me)
	mux.HandleFunc("GET /api/users", a.users)
	mux.HandleFunc("GET /api/media", a.media)
	mux.HandleFunc("GET /api/groups", a.groups)
	mux.HandleFunc("POST /api/briefs", a.briefs)
	mux.HandleFunc("POST /api/games/generate", a.generate)
	mux.HandleFunc("GET /api/games/{id}", a.getGame)
	mux.HandleFunc("POST /api/games/{id}/publish", a.publish)
	mux.HandleFunc("POST /api/games/{id}/moderate", a.moderateEndpoint)
	mux.HandleFunc("POST /api/games/{id}/report", a.reportGame)
	mux.HandleFunc("GET /api/moderation/queue", a.moderationQueue)
	mux.HandleFunc("POST /api/games/{id}/plays", a.postPlay)
	mux.HandleFunc("GET /api/games/{id}/leaderboard", a.leaderboard)
	mux.HandleFunc("GET /api/daily", a.daily)
	mux.HandleFunc("GET /api/feed", a.feed)
	mux.HandleFunc("POST /api/challenges", a.postChallenge)
	mux.HandleFunc("GET /api/challenges/{id}", a.getChallenge)
	mux.HandleFunc("GET /c/{id}", a.challengeRedirect)
	mux.HandleFunc("GET /api/usage", a.usage)
	mux.HandleFunc("POST /api/users/{id}/follow", a.follow)
	mux.HandleFunc("DELETE /api/users/{id}/follow", a.unfollow)
	media := http.StripPrefix("/media/", http.FileServer(http.Dir(a.cfg.MediaDir)))
	mux.HandleFunc("GET /media/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		media.ServeHTTP(w, r)
	})
	player := http.StripPrefix("/player/", http.FileServer(http.Dir(a.cfg.PlayerDir)))
	mux.HandleFunc("GET /player/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		player.ServeHTTP(w, r)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { writeErr(w, 404, "not found") })

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var rw http.ResponseWriter = w
		if strings.HasPrefix(r.URL.Path, "/api/") {
			rw = &mediaRewriter{ResponseWriter: w, base: requestBase(r)}
		}
		sw := &statusWriter{ResponseWriter: rw, status: 200}
		t0 := time.Now()
		mux.ServeHTTP(sw, r)
		log.Printf("%s %s %d %dms", r.Method, r.URL.Path, sw.status, time.Since(t0).Milliseconds())
	})
}

// requestBase is the scheme://host the client used to reach this server.
func requestBase(r *http.Request) string {
	scheme := "http"
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		scheme = p
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// mediaRewriter makes the stored relative "/media/..." URLs absolute in API responses
// (including SSE events) so the player and iOS clients can load them directly.
type mediaRewriter struct {
	http.ResponseWriter
	base string
}

func (w *mediaRewriter) Write(p []byte) (int, error) {
	if _, err := w.ResponseWriter.Write(bytes.ReplaceAll(p, []byte(`"/media/`), []byte(`"`+w.base+`/media/`))); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (w *mediaRewriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *mediaRewriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func userID(r *http.Request) string {
	if u := r.Header.Get("X-User"); u != "" {
		return u
	}
	return "u_me"
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "muse": map[string]any{"configured": a.muse.Configured(), "capabilities": a.muse.Capabilities()},
		"sgtool": a.tool.Available()})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	u, ok := a.store.user(userID(r))
	if !ok {
		writeErr(w, 404, "unknown user")
		return
	}
	writeJSON(w, 200, u)
}

func (a *App) follow(w http.ResponseWriter, r *http.Request)   { a.setFollow(w, r, true) }
func (a *App) unfollow(w http.ResponseWriter, r *http.Request) { a.setFollow(w, r, false) }

// setFollow adds or removes {id} from the caller's follows list and returns the updated user.
func (a *App) setFollow(w http.ResponseWriter, r *http.Request, on bool) {
	target := r.PathValue("id")
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	if _, ok := a.store.user(target); !ok {
		writeErr(w, 404, "unknown user")
		return
	}
	for i := range a.store.d.Users {
		u := &a.store.d.Users[i]
		if u.ID != userID(r) {
			continue
		}
		if u.ID == target {
			writeErr(w, 400, "cannot follow yourself")
			return
		}
		next := []string{}
		for _, f := range u.Follows {
			if f != target {
				next = append(next, f)
			}
		}
		if on {
			next = append(next, target)
		}
		u.Follows = next
		a.store.saveLocked()
		writeJSON(w, 200, *u)
		return
	}
	writeErr(w, 404, "unknown user")
}

func (a *App) users(w http.ResponseWriter, r *http.Request) {
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	writeJSON(w, 200, a.store.d.Users)
}

func (a *App) media(w http.ResponseWriter, r *http.Request) {
	g := r.URL.Query().Get("group")
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	out := []Media{}
	for _, m := range a.store.d.Media {
		if g == "" || m.GroupID == g {
			out = append(out, m)
		}
	}
	writeJSON(w, 200, out)
}

func (a *App) groups(w http.ResponseWriter, r *http.Request) {
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	writeJSON(w, 200, a.store.d.Groups)
}

func (a *App) usage(w http.ResponseWriter, r *http.Request) {
	snap := a.budget.Snapshot()
	snap["capabilities"] = a.muse.Capabilities()
	writeJSON(w, 200, snap)
}

func (a *App) briefs(w http.ResponseWriter, r *http.Request) {
	var req BriefReq
	if err := decode(r, &req); err != nil || strings.TrimSpace(req.Prompt) == "" {
		writeErr(w, 400, "prompt required")
		return
	}
	writeJSON(w, 200, a.MakeBrief(r.Context(), req))
}

func (a *App) generate(w http.ResponseWriter, r *http.Request) {
	var req GenerateReq
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	uid := userID(r)
	if r.URL.Query().Get("stream") == "0" {
		g, err := a.Generate(r.Context(), uid, req, func(Event) {})
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"game": g})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	fl, _ := w.(http.Flusher)
	var mu sync.Mutex
	send := func(name string, v any) {
		mu.Lock()
		defer mu.Unlock()
		raw, _ := json.Marshal(v)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, raw)
		if fl != nil {
			fl.Flush()
		}
	}
	g, err := a.Generate(r.Context(), uid, req, func(e Event) { send("stage", e) })
	if err != nil {
		send("error", map[string]string{"message": err.Error()})
		return
	}
	send("done", map[string]any{"game": g})
}

func (a *App) withStats(g *Game) Game {
	out := *g
	out.Stats = GameStats{}
	for _, p := range a.store.d.Plays {
		if p.GameID == g.ID && p.Verified {
			out.Stats.Plays++
			if p.Score > out.Stats.Best {
				out.Stats.Best = p.Score
			}
		}
	}
	return out
}

func (a *App) getGame(w http.ResponseWriter, r *http.Request) {
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	g, ok := a.store.d.Games[r.PathValue("id")]
	if !ok {
		writeErr(w, 404, "game not found")
		return
	}
	writeJSON(w, 200, map[string]any{"game": a.withStats(g)})
}

func (a *App) publish(w http.ResponseWriter, r *http.Request) {
	a.store.mu.RLock()
	g, ok := a.store.d.Games[r.PathValue("id")]
	var gm Game
	if ok {
		gm = *g
	}
	a.store.mu.RUnlock()
	if !ok {
		writeErr(w, 404, "game not found")
		return
	}
	if gm.CreatorID != userID(r) {
		writeErr(w, 403, "only the creator can publish")
		return
	}
	// Moderation runs outside the store lock; a verdict cached during generation makes this instant.
	mod := a.moderateGame(r.Context(), gm)

	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	g, ok = a.store.d.Games[gm.ID]
	if !ok {
		writeErr(w, 404, "game not found")
		return
	}
	g.Moderation = mod
	if mod.Decision == DecisionBlocked {
		g.Status = "draft"
		a.store.saveLocked()
		writeJSON(w, 422, map[string]any{"error": "blocked by moderation", "moderation": mod})
		return
	}
	g.Status = "published"
	item := FeedItem{ID: newID("f_"), Type: "game", ActorID: g.CreatorID, GameID: g.ID,
		Text: a.store.userName(g.CreatorID) + " published " + g.Title, CreatedAt: time.Now().UTC()}
	a.store.d.Feed = append(a.store.d.Feed, item)
	a.store.saveLocked()
	writeJSON(w, 200, map[string]any{"game": a.withStats(g), "feed_item": a.expandFeed(item, ""), "moderation": mod})
}

// replayScore re-runs the game through sgtool; ok is false if it could not be replayed.
func (a *App) replayScore(g *Game, seed uint32, inputs json.RawMessage) (int, int, bool) {
	res, err := a.tool.Replay(g.Manifest, g.Content, seed, inputs)
	if err != nil {
		return 0, 0, false
	}
	return res.Score, res.Ticks, true
}

func (a *App) postPlay(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Seed        uint32          `json:"seed"`
		Inputs      json.RawMessage `json:"inputs"`
		Score       int             `json:"score"`
		Ticks       int             `json:"ticks"`
		ChallengeID string          `json:"challenge_id"`
		Daily       bool            `json:"daily"`
		Date        string          `json:"date"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	a.store.mu.RLock()
	g, ok := a.store.d.Games[r.PathValue("id")]
	var gm Game
	if ok {
		gm = *g
	}
	a.store.mu.RUnlock()
	if !ok {
		writeErr(w, 404, "game not found")
		return
	}
	today := ""
	if req.Daily {
		var msg string
		if today, msg = a.checkDailyPlay(gm.ID, req.Date, req.Seed); msg != "" {
			writeErr(w, 400, msg)
			return
		}
	}
	score, ticks, replayed := a.replayScore(&gm, req.Seed, req.Inputs)
	verified := replayed && score == req.Score
	if replayed && req.Ticks == 0 {
		req.Ticks = ticks
	}

	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	uid := userID(r)
	p := &Play{ID: newID("p_"), GameID: gm.ID, UserID: uid, Seed: req.Seed, Inputs: req.Inputs, Score: req.Score, Ticks: req.Ticks,
		Verified: verified, ChallengeID: req.ChallengeID, CreatedAt: time.Now().UTC()}
	counted := false
	if req.Daily {
		p.Daily, p.Date = true, today
		counted = verified && !a.hasCountedDaily(uid, today)
		p.Practice = !counted
	}
	a.store.d.Plays[p.ID] = p
	rank := 1
	for _, o := range a.store.d.Plays {
		if o.GameID == gm.ID && o.Verified && o.ID != p.ID && o.Score > p.Score {
			rank++
		}
	}
	resp := map[string]any{"play": p, "verified": verified, "rank": rank}
	if req.Daily {
		resp["daily"] = a.dailyResult(uid, p, counted)
	}
	if c, ok := a.store.d.Challenges[req.ChallengeID]; ok && req.ChallengeID != "" {
		resp["beat"] = map[string]any{"user": a.store.userName(c.FromID), "score": c.Score, "won": p.Score > c.Score}
	}
	if verified {
		a.store.d.Feed = append(a.store.d.Feed, FeedItem{ID: newID("f_"), Type: "score", ActorID: uid, GameID: gm.ID, PlayID: p.ID,
			Text: fmt.Sprintf("%s scored %d on %s", a.store.userName(uid), p.Score, gm.Title), CreatedAt: p.CreatedAt})
	}
	a.store.saveLocked()
	writeJSON(w, 200, resp)
}

func (a *App) leaderboard(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	if _, ok := a.store.d.Games[id]; !ok {
		writeErr(w, 404, "game not found")
		return
	}
	plays := []*Play{}
	for _, p := range a.store.d.Plays {
		if p.GameID == id && p.Verified {
			plays = append(plays, p)
		}
	}
	sort.Slice(plays, func(i, j int) bool {
		if plays[i].Score != plays[j].Score {
			return plays[i].Score > plays[j].Score
		}
		return plays[i].CreatedAt.Before(plays[j].CreatedAt)
	})
	if len(plays) > 20 {
		plays = plays[:20]
	}
	out := []map[string]any{}
	for i, p := range plays {
		out = append(out, map[string]any{"rank": i + 1, "user": a.store.userName(p.UserID), "user_id": p.UserID, "score": p.Score, "play": p})
	}
	writeJSON(w, 200, out)
}

func (a *App) postChallenge(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GameID    string   `json:"game_id"`
		PlayID    string   `json:"play_id"`
		ToUserIDs []string `json:"to_user_ids"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	p, ok := a.store.d.Plays[req.PlayID]
	if !ok || (req.GameID != "" && p.GameID != req.GameID) {
		writeErr(w, 404, "play not found")
		return
	}
	g := a.store.d.Games[p.GameID]
	if g == nil {
		writeErr(w, 404, "game not found")
		return
	}
	to := req.ToUserIDs
	if len(to) == 0 {
		if u, ok := a.store.user(p.UserID); ok {
			to = u.Friends
		}
	}
	c := &Challenge{ID: newID("c_"), GameID: g.ID, PlayID: p.ID, FromID: p.UserID, ToUserIDs: to, Seed: p.Seed, Score: p.Score,
		CreatedAt: time.Now().UTC()}
	a.store.d.Challenges[c.ID] = c
	name := a.store.userName(p.UserID)
	text := fmt.Sprintf("%s scored %d on %s. Beat them?", name, p.Score, g.Title)
	a.store.d.Feed = append(a.store.d.Feed, FeedItem{ID: newID("f_"), Type: "challenge", ActorID: p.UserID, GameID: g.ID, PlayID: p.ID,
		ChallengeID: c.ID, ToUserIDs: to, Text: text, CreatedAt: c.CreatedAt})
	a.store.saveLocked()
	writeJSON(w, 200, map[string]any{"challenge": c, "url": "http://" + r.Host + "/c/" + c.ID, "text": text})
}

func (a *App) getChallenge(w http.ResponseWriter, r *http.Request) {
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	c, ok := a.store.d.Challenges[r.PathValue("id")]
	if !ok {
		writeErr(w, 404, "challenge not found")
		return
	}
	writeJSON(w, 200, map[string]any{"challenge": c, "game": a.withStats(a.store.d.Games[c.GameID])})
}

func (a *App) challengeRedirect(w http.ResponseWriter, r *http.Request) {
	a.store.mu.RLock()
	c, ok := a.store.d.Challenges[r.PathValue("id")]
	a.store.mu.RUnlock()
	if !ok {
		writeErr(w, 404, "challenge not found")
		return
	}
	q := url.Values{"game": {c.GameID}, "seed": {fmt.Sprint(c.Seed)}, "challenge": {c.ID}}
	http.Redirect(w, r, "/player/index.html?"+q.Encode(), http.StatusFound)
}

// ---- Feed -------------------------------------------------------------------

type FeedView struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Actor     *User      `json:"actor"`
	Game      *Game      `json:"game"`
	Play      *Play      `json:"play,omitempty"`
	Challenge *Challenge `json:"challenge,omitempty"`
	Text      string     `json:"text"`
	CreatedAt time.Time  `json:"created_at"`
	Band      string     `json:"band"`
}

// feedBand ranks an item for the viewer: 0 challenge to me, 1 my own item from the last 24h,
// 2 friend, 3 followed creator, 4 rest.
func feedBand(it FeedItem, me User) int {
	if it.Type == "challenge" {
		for _, id := range it.ToUserIDs {
			if id == me.ID {
				return 0
			}
		}
	}
	if it.ActorID == me.ID && time.Since(it.CreatedAt) < 24*time.Hour {
		return 1
	}
	for _, id := range me.Friends {
		if id == it.ActorID {
			return 2
		}
	}
	for _, id := range me.Follows {
		if id == it.ActorID {
			return 3
		}
	}
	return 4
}

var bandNames = []string{"challenge", "you", "friends", "creators", "discover"}

// orderFeed sorts by band, then newest first.
func orderFeed(items []FeedItem, me User) []FeedItem {
	out := append([]FeedItem{}, items...)
	sort.SliceStable(out, func(i, j int) bool {
		bi, bj := feedBand(out[i], me), feedBand(out[j], me)
		if bi != bj {
			return bi < bj
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}

// expandFeed requires the store lock; viewer may be empty.
func (a *App) expandFeed(it FeedItem, viewer string) FeedView {
	v := FeedView{ID: it.ID, Type: it.Type, Text: it.Text, CreatedAt: it.CreatedAt, Band: "discover"}
	if u, ok := a.store.user(it.ActorID); ok {
		v.Actor = &u
	}
	if g, ok := a.store.d.Games[it.GameID]; ok {
		gs := a.withStats(g)
		gs.Manifest, gs.Content = nil, nil
		v.Game = &gs
	}
	v.Play = a.store.d.Plays[it.PlayID]
	v.Challenge = a.store.d.Challenges[it.ChallengeID]
	if me, ok := a.store.user(viewer); ok {
		v.Band = bandNames[feedBand(it, me)]
	}
	return v
}

func (a *App) feed(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	daily := a.dailyFeedItem(uid)
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	me, ok := a.store.user(uid)
	if !ok {
		writeErr(w, 400, "unknown user")
		return
	}
	items := []FeedItem{}
	for _, it := range a.store.d.Feed {
		if g, ok := a.store.d.Games[it.GameID]; ok && g.Status == "published" && (g.CreatorID == uid || !a.hiddenFromOthersLocked(g)) {
			items = append(items, it)
		}
	}
	out := []FeedView{}
	if daily != nil {
		out = append(out, *daily)
	}
	for _, it := range orderFeed(items, me) {
		out = append(out, a.expandFeed(it, uid))
	}
	writeJSON(w, 200, out)
}
