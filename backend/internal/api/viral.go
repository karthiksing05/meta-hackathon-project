package api

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// viral_match: a game many people are playing right now, told to the people whose learned taste it fits. A game is
// "viral" when enough distinct players touched it in the window (Kevin's defaults: 100 players in 24 hours). It fits a
// person when the cosine between their learned taste and the game's description (both from Kevin's game-recs.js, run
// unchanged) is high enough and they have learned from at least a few pages. Each person hears about a game once and at
// most once a day (ViralOptions.PerDay), never about their own game or one they already played, and only for public games.
//
// The scan runs on a timer (RunViral). Every number is configurable (VIRAL_* in api.env).

// ViralOptions tune viral_match. The zero value gives the defaults.
type ViralOptions struct {
	Off        bool          // VIRAL_MATCH=0
	MinPlayers int           // distinct players in the window (default 100)
	Window     time.Duration // default 24h
	Cosine     float64       // default 0.85
	MinPages   int           // pages the person has learned from (default 5)
	PerDay     int           // viral notifications per person per day (default 1)
	Interval   time.Duration // how often the scan runs (default 10 minutes)
	MaxUsers   int           // people checked per scan (default 5000)
}

func (v ViralOptions) withDefaults() ViralOptions {
	if v.MinPlayers < 1 {
		v.MinPlayers = 100
	}
	if v.Window <= 0 {
		v.Window = 24 * time.Hour
	}
	if v.Cosine <= 0 {
		v.Cosine = 0.85
	}
	if v.MinPages < 1 {
		v.MinPages = 5
	}
	if v.PerDay < 1 {
		v.PerDay = 1
	}
	if v.Interval <= 0 {
		v.Interval = 10 * time.Minute
	}
	if v.MaxUsers < 1 {
		v.MaxUsers = 5000
	}
	return v
}

// RunViral scans for viral games until ctx ends.
func (s *Server) RunViral(ctx context.Context) {
	if s.Recs == nil || s.Viral.Off {
		return
	}
	v := s.Viral.withDefaults()
	t := time.NewTimer(time.Minute) // let the server settle first
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if n, err := s.ScanViral(ctx, time.Now().UTC()); err != nil {
			s.Log.Warn("viral: scan failed", "err", err)
		} else if n > 0 {
			s.Log.Info("viral: notified", "count", n)
		}
		t.Reset(v.Interval)
	}
}

type viralGame struct {
	game    model.Game
	players int
	played  map[string]bool // user ids who played it in the window
}

// ScanViral runs one scan and returns how many notifications it made.
func (s *Server) ScanViral(ctx context.Context, now time.Time) (int, error) {
	v := s.Viral.withDefaults()
	evs, err := s.Store.ExportEvents(ctx, now.Add(-v.Window), 200000)
	if err != nil {
		return 0, err
	}
	type tally struct {
		actors map[string]bool
		users  map[string]bool
	}
	byGame := map[string]*tally{}
	resolved := map[string]string{} // the id an event used -> the game's id ("" when unknown)
	for _, e := range evs {
		if !(e.TookOver || e.RunsFinished > 0 || e.Replays > 0 || e.Type == "play" || e.Type == "finish") {
			continue
		}
		id, ok := resolved[e.GameID]
		if !ok {
			if store.LooksLikeID(e.GameID) {
				id = e.GameID
			} else if g, err := s.Store.GameBySlug(ctx, e.GameID); err == nil {
				id = g.ID
			}
			resolved[e.GameID] = id
		}
		if id == "" {
			continue
		}
		t := byGame[id]
		if t == nil {
			t = &tally{actors: map[string]bool{}, users: map[string]bool{}}
			byGame[id] = t
		}
		t.actors[e.Actor] = true
		if e.UserID != "" {
			t.users[e.UserID] = true
		}
	}
	var hot []viralGame
	for id, t := range byGame {
		if len(t.actors) < v.MinPlayers {
			continue
		}
		g, err := s.Store.GameByID(ctx, id)
		if err != nil || g.Unlisted || (g.Scope != "" && g.Scope != "everyone") {
			continue
		}
		hot = append(hot, viralGame{game: *g, players: len(t.actors), played: t.users})
	}
	if len(hot) == 0 {
		return 0, nil
	}
	ids, err := s.Store.RecsUserIDs(ctx, v.MaxUsers)
	if err != nil {
		return 0, err
	}
	// each viral game's description, from the recommender itself
	vecs := make([]gameVec, len(hot))
	for i, h := range hot {
		vecs[i] = s.describeGame(ctx, h.game)
	}
	notified := 0
	for _, uid := range ids {
		if ctx.Err() != nil {
			return notified, ctx.Err()
		}
		capped, told := s.viralHistory(ctx, uid, now, v)
		if capped {
			continue
		}
		taste, pages := s.tasteOf(ctx, uid)
		if pages < v.MinPages || vecNorm(taste) == 0 {
			continue
		}
		for i, h := range hot {
			if h.game.OwnerID == uid || h.played[uid] || told["viral:"+h.game.ID] || vecs[i].norm == 0 {
				continue
			}
			if cosine(taste, vecs[i]) < v.Cosine {
				continue
			}
			s.notify(ctx, model.Notification{
				UserID: uid, Kind: model.NotifViralMatch, GameID: h.game.ID, Source: "viral:" + h.game.ID,
				Title: "Everyone's playing " + h.game.Title, Body: "A lot of people are playing it today, and it looks like your kind of game.",
			})
			notified++
			break // one a day
		}
	}
	return notified, nil
}

// viralHistory says whether the person already heard about a viral game inside the day (capped), and which viral games
// they have been told about (by source), so a game is never announced twice.
func (s *Server) viralHistory(ctx context.Context, uid string, now time.Time, v ViralOptions) (capped bool, told map[string]bool) {
	told = map[string]bool{}
	rows, err := s.Store.NotificationsFor(ctx, uid, 100, nil)
	if err != nil {
		return true, told // when unsure, say nothing
	}
	n := 0
	for _, r := range rows {
		if r.Kind != model.NotifViralMatch {
			continue
		}
		told[r.Source] = true
		if now.Sub(r.CreatedAt) < 24*time.Hour {
			n++
		}
	}
	return n >= v.PerDay, told
}

type gameVec struct {
	x    []float64
	norm float64
}

func (s *Server) describeGame(ctx context.Context, g model.Game) gameVec {
	var out gameVec
	raw, _ := json.Marshal(gameSummary(g))
	_, err := s.Recs.Run(ctx, "", func(sess recsSession) error {
		x, n, err := sess.Vector(raw)
		out = gameVec{x: x, norm: n}
		return err
	})
	if err != nil {
		s.Log.Warn("viral: could not describe a game", "game", g.ID, "err", err)
		return gameVec{}
	}
	return out
}

// tasteOf is a person's learned taste vector and the number of pages it was learned from.
func (s *Server) tasteOf(ctx context.Context, uid string) ([]float64, int) {
	rec, err := s.Store.GetRecs(ctx, uid)
	if err != nil || rec.State == "" {
		return nil, 0
	}
	var taste []float64
	pages := 0
	_, err = s.Recs.Run(ctx, rec.State, func(sess recsSession) error {
		raw, err := sess.Profile()
		if err != nil {
			return err
		}
		var p struct {
			N     float64   `json:"n"`
			Taste []float64 `json:"taste"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		taste, pages = p.Taste, int(p.N)
		return nil
	})
	if err != nil {
		return nil, 0
	}
	return taste, pages
}

func vecNorm(a []float64) float64 {
	s := 0.0
	for _, x := range a {
		s += x * x
	}
	return math.Sqrt(s)
}

func cosine(taste []float64, g gameVec) float64 {
	if len(taste) != len(g.x) {
		return 0
	}
	dot := 0.0
	for i := range taste {
		dot += taste[i] * g.x[i]
	}
	d := vecNorm(taste) * g.norm
	if d == 0 {
		return 0
	}
	return dot / d
}
