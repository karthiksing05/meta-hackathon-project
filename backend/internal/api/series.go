package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// A series is a best-of-N between two friends: the same games on the same seeds, scores the server has checked.
//
//	POST /v1/series                       {opponentId, games: [gameId ...]}        -> the series, with a server-picked seed per round
//	POST /v1/series/{id}/rounds/{n}       {log}                                    -> the series; the run's input log is replayed in the engine
//	GET  /v1/series                       mine, newest first
//	GET  /v1/series/{id}                  one
//
// The phone never reports a score. It sends the run's input log (microgame-log/1); the generator service replays it
// against the game's exact stored text and the server keeps the replayed score and time, never the claimed ones.
// A round is decided once both have played: the higher score wins, a tie goes to the lower time, otherwise it is a
// draw. The series is over when someone has won more than half the rounds, or every round is decided.

const (
	maxSeriesGames = 5
	maxLogBytes    = 256 << 10
	verifyTimeout  = 15 * time.Second
)

func randomSeed() int64 {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UnixNano() & 0x7fffffff
	}
	return int64(binary.BigEndian.Uint32(b[:]) & 0x7fffffff)
}

type playView struct {
	Played bool   `json:"played"`
	Score  *int64 `json:"score,omitempty"`
	TimeMs *int64 `json:"timeMs,omitempty"`
}

type roundView struct {
	N      int             `json:"n"`
	GameID string          `json:"gameId"`
	Game   *model.GameView `json:"game,omitempty"`
	Seed   int64           `json:"seed"`
	Mine   playView        `json:"mine"`
	Theirs playView        `json:"theirs"`           // the score is hidden until you have played the round
	Winner string          `json:"winner,omitempty"` // me, them or draw, once both have played
}

type seriesView struct {
	ID         string                        `json:"id"`
	Status     string                        `json:"status"` // active or done
	Opponent   profile                       `json:"opponent"`
	StartedBy  string                        `json:"startedBy"` // me or them
	Rounds     []roundView                   `json:"rounds"`
	Tally      struct{ Me, Them, Draws int } `json:"tally"`
	WinsNeeded int                           `json:"winsNeeded"`
	Winner     string                        `json:"winner,omitempty"` // me, them or draw, when done
	CreatedAt  time.Time                     `json:"createdAt"`
	FinishedAt *time.Time                    `json:"finishedAt,omitempty"`
}

// roundOutcome says who won a decided round: "a", "b" or "draw".
func roundOutcome(a, b model.RoundPlay, lower bool) string {
	switch {
	case a.DNF || b.DNF: // a run that didn't finish loses to one that did; two of them are a draw
		switch {
		case a.DNF && b.DNF:
			return "draw"
		case a.DNF:
			return "b"
		}
		return "a"
	case a.Score != b.Score:
		if (a.Score > b.Score) != lower {
			return "a"
		}
		return "b"
	case a.TimeMs != b.TimeMs:
		if a.TimeMs < b.TimeMs {
			return "a"
		}
		return "b"
	}
	return "draw"
}

// settle recomputes whether the series is over and who won it.
func settle(se *model.Series, now time.Time) {
	var wa, wb, decided int
	for _, r := range se.Rounds {
		pa, oka := r.Plays[se.PlayerA]
		pb, okb := r.Plays[se.PlayerB]
		if !oka || !okb {
			continue
		}
		decided++
		switch roundOutcome(pa, pb, r.Lower) {
		case "a":
			wa++
		case "b":
			wb++
		}
	}
	if wa >= se.WinsNeeded || wb >= se.WinsNeeded || decided == len(se.Rounds) {
		switch {
		case wa > wb:
			se.WinnerID = se.PlayerA
		case wb > wa:
			se.WinnerID = se.PlayerB
		default:
			se.WinnerID = ""
		}
		if se.FinishedAt == nil {
			se.FinishedAt = &now
		}
	}
}

func (s *Server) seriesFor(r *http.Request, se *model.Series) (seriesView, error) {
	ctx, me := r.Context(), userFrom(r)
	other := se.PlayerB
	if other == me.ID {
		other = se.PlayerA
	}
	v := seriesView{ID: se.ID, Status: "active", WinsNeeded: se.WinsNeeded, CreatedAt: se.CreatedAt, FinishedAt: se.FinishedAt, Rounds: []roundView{}}
	if se.FinishedAt != nil {
		v.Status = "done"
	}
	v.StartedBy = "them"
	if se.PlayerA == me.ID {
		v.StartedBy = "me"
	}
	if u, err := s.Store.UserByID(ctx, other); err == nil {
		v.Opponent = profileOf(*u, nil)
	} else {
		v.Opponent = profile{ID: other}
	}
	games := make([]model.Game, 0, len(se.Rounds))
	for _, rd := range se.Rounds {
		if g, err := s.Store.GameByID(ctx, rd.GameID); err == nil {
			games = append(games, *g)
		}
	}
	views, err := s.views(r, games)
	if err != nil {
		return v, err
	}
	byID := map[string]model.GameView{}
	for _, gv := range views {
		byID[gv.ID] = gv
	}
	for _, rd := range se.Rounds {
		rv := roundView{N: rd.N, GameID: rd.GameID, Seed: rd.Seed}
		if gv, ok := byID[rd.GameID]; ok {
			gv := gv
			rv.Game = &gv
		}
		mine, theirs := rd.Plays[me.ID], rd.Plays[other]
		_, iPlayed := rd.Plays[me.ID]
		_, theyPlayed := rd.Plays[other]
		if iPlayed {
			rv.Mine = playView{Played: true, Score: &mine.Score, TimeMs: &mine.TimeMs}
		}
		if theyPlayed {
			rv.Theirs = playView{Played: true}
			if iPlayed { // no peeking at their number before you've played
				rv.Theirs.Score, rv.Theirs.TimeMs = &theirs.Score, &theirs.TimeMs
			}
		}
		if iPlayed && theyPlayed {
			switch roundOutcome(mine, theirs, rd.Lower) {
			case "a":
				rv.Winner = "me"
				v.Tally.Me++
			case "b":
				rv.Winner = "them"
				v.Tally.Them++
			default:
				rv.Winner = "draw"
				v.Tally.Draws++
			}
		}
		v.Rounds = append(v.Rounds, rv)
	}
	if se.FinishedAt != nil {
		switch se.WinnerID {
		case "":
			v.Winner = "draw"
		case me.ID:
			v.Winner = "me"
		default:
			v.Winner = "them"
		}
	}
	return v, nil
}

func (s *Server) createSeries(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OpponentID string   `json:"opponentId"`
		Games      []string `json:"games"`
	}
	if !decode(w, r, &in) {
		return
	}
	ctx, me := r.Context(), userFrom(r)
	if in.OpponentID == "" || in.OpponentID == me.ID {
		writeErr(w, 400, "pick a friend to play against")
		return
	}
	if len(in.Games) < 1 || len(in.Games) > maxSeriesGames {
		writeErr(w, 400, "a series has 1 to 5 games")
		return
	}
	fs, err := s.friendSet(ctx, me.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if !fs[in.OpponentID] {
		writeErr(w, 400, "you can only start a series with a friend")
		return
	}
	rounds := make([]model.SeriesRound, 0, len(in.Games))
	for i, key := range in.Games {
		var g *model.Game
		if store.LooksLikeID(key) {
			g, err = s.Store.GameByID(ctx, key)
		} else {
			g, err = s.Store.GameBySlug(ctx, strings.ToLower(key))
		}
		if err != nil {
			writeErr(w, 404, "game "+strconv.Itoa(i+1)+" was not found")
			return
		}
		if g.Formula != "microgame" {
			writeErr(w, 422, "only microgames can be played in a series (their scores can be checked)")
			return
		}
		rounds = append(rounds, model.SeriesRound{N: i + 1, GameID: g.ID, Seed: randomSeed(), Lower: g.Score.Lower(), Plays: map[string]model.RoundPlay{}})
	}
	se := &model.Series{
		ID: auth.NewID(12), PlayerA: me.ID, PlayerB: in.OpponentID, Rounds: rounds,
		WinsNeeded: len(rounds)/2 + 1, CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
	if err := s.Store.InsertSeries(ctx, se); err != nil {
		s.serverErr(w, r, err)
		return
	}
	if first, err := s.Store.GameByID(ctx, se.Rounds[0].GameID); err == nil {
		s.notifySeries(ctx, se, first, *me)
	}
	v, err := s.seriesFor(r, se)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, v)
}

func (s *Server) seriesOr404(w http.ResponseWriter, r *http.Request) (*model.Series, bool) {
	se, err := s.Store.SeriesByID(r.Context(), chi.URLParam(r, "id"))
	me := userFrom(r)
	if err != nil || (se.PlayerA != me.ID && se.PlayerB != me.ID) { // never reveal other people's series
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.serverErr(w, r, err)
		} else {
			writeErr(w, 404, "series not found")
		}
		return nil, false
	}
	return se, true
}

func (s *Server) getSeries(w http.ResponseWriter, r *http.Request) {
	se, ok := s.seriesOr404(w, r)
	if !ok {
		return
	}
	v, err := s.seriesFor(r, se)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) listSeries(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.SeriesForUser(r.Context(), userFrom(r).ID, limitParam(r, 20, 50))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := make([]seriesView, 0, len(list))
	for i := range list {
		v, err := s.seriesFor(r, &list[i])
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		items = append(items, v)
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

// verifyResult is what the generator's engine says about a replayed run.
type verifyResult struct {
	OK         bool           `json:"ok"`
	GameHashOK bool           `json:"game_hash_ok"`
	Problems   []string       `json:"problems"`
	Result     map[string]any `json:"result"` // the end state of the replayed run, by variable name
	Recomputed *struct {
		Phase  string  `json:"phase"`
		Score  float64 `json:"score"`
		TimeMs float64 `json:"time_ms"`
	} `json:"recomputed"`
}

// verifyRun replays a log against a game's exact text in the generator service.
// names (optional) are the end-state variables to report as `result`.
func (s *Server) verifyRun(ctx context.Context, gameText, log string, names ...string) (*verifyResult, int, string) {
	payload := map[string]any{"game": gameText, "log": log}
	if len(names) > 0 {
		payload["state"] = names
	}
	body, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(ctx, verifyTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.GeneratorURL+"/verify", bytes.NewReader(body))
	if err != nil {
		return nil, 500, "internal error"
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.Log.Error("series: generator unreachable", "err", err)
		return nil, 503, "the score checker is unavailable right now, try again shortly"
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		s.Log.Error("series: verify failed", "status", res.StatusCode)
		return nil, 502, "the score checker couldn't check this run"
	}
	var v verifyResult
	if json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&v) != nil {
		return nil, 502, "the score checker returned something unreadable"
	}
	return &v, 0, ""
}

// gameText is the exact game script the engine ran, from the stored manifest.
func (s *Server) gameText(ctx context.Context, g *model.Game) (string, error) {
	raw, err := s.Packages.ReadManifest(ctx, g.StorageKey)
	if err != nil {
		return "", err
	}
	var m struct {
		Content struct {
			GameJSON string `json:"game_json"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &m); err != nil || m.Content.GameJSON == "" {
		return "", pkgstore.ErrNotFound
	}
	return m.Content.GameJSON, nil
}

func (s *Server) submitRound(w http.ResponseWriter, r *http.Request) {
	if s.GeneratorURL == "" {
		writeErr(w, 503, "checking scores is not set up on this server")
		return
	}
	n, err := strconv.Atoi(chi.URLParam(r, "n"))
	if err != nil {
		writeErr(w, 404, "round not found")
		return
	}
	run, ok := readRunBody(w, r, maxLogBytes+4096, "log is required (up to 256 KB)", true)
	if !ok {
		return
	}
	logText, headSeed := run.Log, run.Seed

	ctx, me := r.Context(), userFrom(r)
	id := chi.URLParam(r, "id")
	unlock := s.seriesLocks.lock(id) // two submissions can't overwrite each other
	defer unlock()
	se, ok := s.seriesOr404(w, r)
	if !ok {
		return
	}
	if n < 1 || n > len(se.Rounds) {
		writeErr(w, 404, "round not found")
		return
	}
	rd := &se.Rounds[n-1]
	if rd.Plays == nil {
		rd.Plays = map[string]model.RoundPlay{}
	}
	if se.FinishedAt != nil {
		writeErr(w, 409, "this series is over")
		return
	}
	if _, played := rd.Plays[me.ID]; played {
		writeErr(w, 409, "you already played this round")
		return
	}
	g, err := s.Store.GameByID(ctx, rd.GameID)
	if err != nil {
		writeErr(w, 404, "the game for this round is gone")
		return
	}
	text, err := s.gameText(ctx, g)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	res, code, msg := s.verifyRun(ctx, text, logText)
	if res == nil {
		writeErr(w, code, msg)
		return
	}
	if !requireFinishedRun(w, res, "that run wasn't played on this round's game") {
		return
	}
	// Both players must play the same seed. The phone derives the engine's seed from the round's seed, so the log's
	// seed is not the round's; the first run sets it and the other has to match.
	if rd.LogSeed != "" && rd.LogSeed != headSeed {
		writeErr(w, 422, "that run wasn't played on this round's seed")
		return
	}
	rd.LogSeed = headSeed
	play := model.RoundPlay{
		Score: int64(math.Round(res.Recomputed.Score)), TimeMs: int64(math.Round(res.Recomputed.TimeMs)),
		At: time.Now().UTC().Truncate(time.Millisecond),
	}
	if g.Score != nil { // a game with a score model: its value, and a run that didn't finish when only finished runs count
		var finished bool
		play.Score, play.TimeMs, finished = runValue(g.Score, res)
		play.DNF = g.Score.FinishedOnly() && !finished
	}
	rd.Plays[me.ID] = play
	settle(se, time.Now().UTC().Truncate(time.Millisecond))
	if err := s.Store.ReplaceSeries(ctx, se); err != nil {
		s.serverErr(w, r, err)
		return
	}
	v, err := s.seriesFor(r, se)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}
