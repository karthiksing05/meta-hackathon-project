package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Same-seed rounds (docs/harness-gaps/group-play.md): someone sends a game into a chat or a Group, everyone plays the
// same run on the server's seed whenever they like, and the results are compared afterwards. There is no live
// multiplayer and there are no server chats: the round keeps its own result lines, so it is the thread.
//
//	POST /v1/rounds {gameId, target: {kind: "chat"|"group", id}, members?: [userId], mode?}  -> the round
//	POST /v1/rounds/{id}/plays {log}   the run's input log is replayed in the engine; only the replayed result counts
//	GET  /v1/rounds/{id}
//	GET  /v1/rounds?target=chat:<id>|group:<id>      (no target: the rounds you are in)
//
// A round ends when everyone has played, or after 24 hours. A best-of series is not a round: use POST /v1/series.
const (
	roundWindow     = 24 * time.Hour
	maxRoundMembers = 20
)

type roundPlayView struct {
	Played  bool           `json:"played"`
	Score   *int64         `json:"score,omitempty"`
	Display string         `json:"display,omitempty"`
	TimeMs  *int64         `json:"timeMs,omitempty"`
	DNF     bool           `json:"dnf,omitempty"`
	Result  map[string]any `json:"result,omitempty"`
}

type agreementWith struct {
	UserID  string `json:"userId"`
	Percent int    `json:"percent"`
}

type roundDoc struct {
	ID         string                   `json:"id"`
	GameID     string                   `json:"gameId"`
	Game       *model.GameView          `json:"game,omitempty"`
	Creator    string                   `json:"creatorId"`
	Target     map[string]string        `json:"target"`
	Members    []profile                `json:"members"`
	Mode       string                   `json:"mode"`
	Seed       int64                    `json:"seed"`
	Length     int                      `json:"length,omitempty"`
	Plays      map[string]roundPlayView `json:"plays"` // by user id; a member who hasn't played has played: false
	Lines      []roundLineView          `json:"lines"`
	Order      []string                 `json:"order,omitempty"` // user ids, best first (not for an opinion game)
	WinnerID   string                   `json:"winnerId,omitempty"`
	Agreement  []agreementWith          `json:"agreement,omitempty"` // mine against each other player (opinion games)
	CreatedAt  time.Time                `json:"createdAt"`
	ClosesAt   time.Time                `json:"closesAt"`
	Finished   bool                     `json:"finished"`
	FinishedAt *time.Time               `json:"finishedAt,omitempty"`
}

type roundLineView struct {
	UserID string    `json:"userId"`
	Text   string    `json:"text"`
	At     time.Time `json:"at"`
}

// closeRound settles a round: it is over when everyone has played or the window has passed. It reports whether it changed.
func (s *Server) closeRound(rd *model.Round, g *model.Game, now time.Time) bool {
	if rd.FinishedAt != nil {
		return false
	}
	if len(rd.Plays) < len(rd.Members) && now.Before(rd.ClosesAt) {
		return false
	}
	t := now
	rd.FinishedAt = &t
	if ord := rankRound(rd, g); len(ord) > 0 && !compareAgreement(g) {
		if len(ord) == 1 || roundBetter(rd.Plays[ord[0]], rd.Plays[ord[1]], g) {
			rd.WinnerID = ord[0] // a tie for first has no winner
		}
	}
	return true
}

func compareAgreement(g *model.Game) bool {
	return g != nil && g.GroupPlay != nil && g.GroupPlay.Result.Compare == "agreement"
}

// roundOrder says whether a is ahead of b: the game's ending order first (for a story), then the score by its model.
func roundBetter(a, b model.RoundEntry, g *model.Game) bool {
	if g != nil && g.GroupPlay != nil && g.GroupPlay.Result.Compare == "ending" {
		ea, eb := endingRank(a, g), endingRank(b, g)
		if ea != eb {
			return ea < eb
		}
	}
	return roundOutcome(toPlay(a), toPlay(b), g != nil && g.Score.Lower()) == "a"
}

func toPlay(e model.RoundEntry) model.RoundPlay {
	return model.RoundPlay{Score: e.Score, TimeMs: e.TimeMs, DNF: e.DNF, At: e.At}
}

// endingRank is where the run's ending sits in the game's list of endings, best first (unknown endings are last).
func endingRank(e model.RoundEntry, g *model.Game) int {
	name := fmt.Sprint(e.Result["ending"])
	for i, x := range g.GroupPlay.Result.Endings {
		if strings.EqualFold(x, name) {
			return i
		}
	}
	return len(g.GroupPlay.Result.Endings)
}

// rankRound is the players, best first.
func rankRound(rd *model.Round, g *model.Game) []string {
	ids := make([]string, 0, len(rd.Plays))
	for id := range rd.Plays {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := rd.Plays[ids[i]], rd.Plays[ids[j]]
		if roundBetter(a, b, g) {
			return true
		}
		if roundBetter(b, a, g) {
			return false
		}
		return a.At.Before(b.At) // a tie: the earlier run first
	})
	return ids
}

// groupPlayOf is the game's group_play, or the default for a game without one.
func groupPlayOf(g *model.Game) model.GroupPlay {
	if g != nil && g.GroupPlay != nil {
		return *g.GroupPlay
	}
	return model.GroupPlay{Mode: "same_seed_async", SameSeed: true, Result: model.GroupPlayResult{Compare: "score"}}
}

const defaultShareLine = "{name}: {result} on {title}. Your turn."

// fillTokens replaces {name}, {title}, {result}, {score}, {ending}, {choices} and {agreement}; one with no value is removed.
func fillTokens(tpl string, vals map[string]string) string {
	for _, k := range []string{"name", "title", "result", "score", "ending", "choices", "agreement"} {
		tpl = strings.ReplaceAll(tpl, "{"+k+"}", vals[k])
	}
	return strings.Join(strings.Fields(tpl), " ")
}

// roundLine is the line the thread shows when someone has played.
func roundLine(g *model.Game, name string, e model.RoundEntry) string {
	gp := groupPlayOf(g)
	vals := map[string]string{"name": name, "title": g.Title, "score": displayScore(g, e.Score)}
	if v, ok := e.Result["ending"]; ok {
		vals["ending"] = fmt.Sprint(v)
	}
	if v, ok := e.Result["choices_used"]; ok {
		vals["choices"] = fmt.Sprint(v)
	}
	display := gp.Result.Display
	if display == "" {
		display = "{score}"
	}
	if e.DNF {
		vals["result"] = "didn't finish"
	} else {
		vals["result"] = fillTokens(display, vals)
	}
	line := gp.ShareLine
	if line == "" || !strings.Contains(line, "{") {
		line = defaultShareLine
	}
	return clipText(fillTokens(line, vals), 200)
}

// resultState keeps the end-state values the game names (group_play.result.state), as plain values. A game that names
// none keeps nothing.
func resultState(g *model.Game, all map[string]any) map[string]any {
	gp := groupPlayOf(g)
	if len(gp.Result.State) == 0 || len(all) == 0 {
		return nil
	}
	out := map[string]any{}
	for _, name := range gp.Result.State {
		v, ok := all[name]
		if !ok {
			continue
		}
		if b, err := json.Marshal(v); err != nil || len(b) > 2048 {
			continue
		}
		out[name] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (s *Server) roundGame(ctx context.Context, key string) (*model.Game, error) {
	if store.LooksLikeID(key) {
		return s.Store.GameByID(ctx, key)
	}
	return s.Store.GameBySlug(ctx, strings.ToLower(key))
}

func (s *Server) displayName(ctx context.Context, id string, cache map[string]profile) profile {
	if p, ok := cache[id]; ok {
		return p
	}
	p := profile{ID: id}
	if u, err := s.Store.UserByID(ctx, id); err == nil {
		p = profileOf(*u, nil)
	}
	cache[id] = p
	return p
}

func (s *Server) createRound(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GameID string `json:"gameId"`
		Target struct {
			Kind string `json:"kind"`
			ID   string `json:"id"`
		} `json:"target"`
		Members []string `json:"members"`
		Mode    string   `json:"mode"`
	}
	if !decode(w, r, &in) {
		return
	}
	ctx, me := r.Context(), userFrom(r)
	g, err := s.roundGame(ctx, strings.TrimSpace(in.GameID))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "game not found")
		} else {
			s.serverErr(w, r, err)
		}
		return
	}
	if g.Formula != "microgame" {
		writeErr(w, 422, "only microgames can be played in a round (their results can be checked)")
		return
	}
	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	if mode == "" {
		mode = groupPlayOf(g).Mode
	}
	switch mode {
	case "series":
		writeErr(w, 400, "a best-of series is not a round: start it with POST /v1/series")
		return
	case "same_seed_async", "group_round", "weekly_board", "opinion_compare":
	default:
		writeErr(w, 400, "mode must be same_seed_async, group_round, weekly_board or opinion_compare")
		return
	}
	kind := strings.ToLower(strings.TrimSpace(in.Target.Kind))
	tid := strings.TrimSpace(in.Target.ID)
	if (kind != "chat" && kind != "group") || tid == "" || len(tid) > 80 {
		writeErr(w, 400, "target needs a kind (chat or group) and an id")
		return
	}
	members := map[string]bool{me.ID: true}
	switch kind {
	case "group":
		if !s.isMember(ctx, tid, me.ID) {
			writeErr(w, 403, "you are not in that Group")
			return
		}
		ms, err := s.Store.GroupMembers(ctx, tid)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		inGroup := map[string]bool{}
		for _, m := range ms {
			inGroup[m.UserID] = true
		}
		if len(in.Members) == 0 {
			members = inGroup
		} else {
			for _, id := range in.Members {
				if !inGroup[id] {
					writeErr(w, 400, "everyone in a Group round must be in the Group")
					return
				}
				members[id] = true
			}
		}
	case "chat":
		if len(in.Members) == 0 {
			writeErr(w, 400, "a chat round needs the people in the chat (members)")
			return
		}
		fs, err := s.friendSet(ctx, me.ID)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		for _, id := range in.Members {
			if !fs[id] && id != me.ID {
				writeErr(w, 400, "you can only start a round with friends")
				return
			}
			members[id] = true
		}
	}
	members[me.ID] = true
	if len(members) < 2 {
		writeErr(w, 400, "a round needs at least one other person")
		return
	}
	if len(members) > maxRoundMembers {
		writeErr(w, 400, fmt.Sprintf("a round has up to %d people", maxRoundMembers))
		return
	}
	ids := make([]string, 0, len(members))
	for id := range members {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	now := time.Now().UTC().Truncate(time.Millisecond)
	rd := &model.Round{
		ID: auth.NewID(12), GameID: g.ID, CreatorID: me.ID, TargetKind: kind, TargetID: tid, Members: ids, Mode: mode,
		Seed: randomSeed(), Length: groupPlayOf(g).RoundSeconds, Plays: map[string]model.RoundEntry{}, Lines: []model.RoundLine{},
		CreatedAt: now, ClosesAt: now.Add(roundWindow),
	}
	if err := s.Store.InsertRound(ctx, rd); err != nil {
		s.serverErr(w, r, err)
		return
	}
	v, err := s.roundFor(r, rd, g)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, v)
}

// roundFor is a round as the person asking sees it.
func (s *Server) roundFor(r *http.Request, rd *model.Round, g *model.Game) (roundDoc, error) {
	ctx, me := r.Context(), userFrom(r)
	cache := map[string]profile{}
	v := roundDoc{ID: rd.ID, GameID: rd.GameID, Creator: rd.CreatorID, Mode: rd.Mode, Seed: rd.Seed, Length: rd.Length,
		Target: map[string]string{"kind": rd.TargetKind, "id": rd.TargetID}, Plays: map[string]roundPlayView{}, Lines: []roundLineView{},
		Members: []profile{}, CreatedAt: rd.CreatedAt, ClosesAt: rd.ClosesAt, Finished: rd.FinishedAt != nil, FinishedAt: rd.FinishedAt, WinnerID: rd.WinnerID}
	if g != nil {
		views, err := s.views(r, []model.Game{*g})
		if err != nil {
			return v, err
		}
		if len(views) == 1 {
			v.Game = &views[0]
		}
	}
	for _, id := range rd.Members {
		v.Members = append(v.Members, s.displayName(ctx, id, cache))
		e, ok := rd.Plays[id]
		if !ok {
			v.Plays[id] = roundPlayView{}
			continue
		}
		score, tm := e.Score, e.TimeMs
		v.Plays[id] = roundPlayView{Played: true, Score: &score, Display: displayScore(g, e.Score), TimeMs: &tm, DNF: e.DNF, Result: e.Result}
	}
	for _, l := range rd.Lines {
		v.Lines = append(v.Lines, roundLineView{UserID: l.UserID, Text: l.Text, At: l.At})
	}
	if compareAgreement(g) {
		if mine, ok := rd.Plays[me.ID]; ok {
			for _, id := range rd.Members {
				if other, ok := rd.Plays[id]; ok && id != me.ID {
					v.Agreement = append(v.Agreement, agreementWith{UserID: id, Percent: picksAgreement(picksOf(mine), picksOf(other))})
				}
			}
		}
	} else {
		v.Order = rankRound(rd, g)
	}
	return v, nil
}

func (s *Server) roundOr404(w http.ResponseWriter, r *http.Request) (*model.Round, *model.Game, bool) {
	ctx, me := r.Context(), userFrom(r)
	rd, err := s.Store.RoundByID(ctx, chi.URLParam(r, "id"))
	if err != nil || !hasID(rd.Members, me.ID) { // never reveal other people's rounds
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.serverErr(w, r, err)
		} else {
			writeErr(w, 404, "round not found")
		}
		return nil, nil, false
	}
	g, err := s.Store.GameByID(ctx, rd.GameID)
	if err != nil {
		g = nil // the game was deleted: the results still show
	}
	return rd, g, true
}

func hasID(list []string, id string) bool {
	for _, x := range list {
		if x == id {
			return true
		}
	}
	return false
}

func (s *Server) getRound(w http.ResponseWriter, r *http.Request) {
	rd, g, ok := s.roundOr404(w, r)
	if !ok {
		return
	}
	if rd.FinishedAt == nil && time.Now().After(rd.ClosesAt) { // the window ran out since the last play: record it
		unlock := s.seriesLocks.lock("round:" + rd.ID)
		defer unlock()
		if fresh, err := s.Store.RoundByID(r.Context(), rd.ID); err == nil {
			rd = fresh
		}
		if s.closeRound(rd, g, time.Now().UTC().Truncate(time.Millisecond)) {
			if err := s.Store.ReplaceRound(r.Context(), rd); err != nil {
				s.serverErr(w, r, err)
				return
			}
		}
	}
	v, err := s.roundFor(r, rd, g)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) listRounds(w http.ResponseWriter, r *http.Request) {
	ctx, me := r.Context(), userFrom(r)
	limit := limitParam(r, 20, 50)
	var list []model.Round
	var err error
	if t := strings.TrimSpace(r.URL.Query().Get("target")); t != "" {
		kind, id, _ := strings.Cut(t, ":")
		if (kind != "chat" && kind != "group") || id == "" {
			writeErr(w, 400, "target is chat:<id> or group:<id>")
			return
		}
		list, err = s.Store.RoundsForTarget(ctx, kind, id, limit*3)
	} else {
		list, err = s.Store.RoundsForUser(ctx, me.ID, limit)
	}
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := []roundDoc{}
	for i := range list {
		rd := &list[i]
		if !hasID(rd.Members, me.ID) { // only the rounds you are in
			continue
		}
		g, gerr := s.Store.GameByID(ctx, rd.GameID)
		if gerr != nil {
			g = nil
		}
		s.closeRound(rd, g, time.Now().UTC().Truncate(time.Millisecond)) // shown closed; saved on the next play or read
		v, err := s.roundFor(r, rd, g)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		if items = append(items, v); len(items) == limit {
			break
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) playRound(w http.ResponseWriter, r *http.Request) {
	if s.GeneratorURL == "" {
		writeErr(w, 503, "checking results is not set up on this server")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxLogBytes+4096)
	var in struct {
		Log json.RawMessage `json:"log"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErr(w, 413, "that run's log is too large")
		} else {
			writeErr(w, 400, "invalid JSON body")
		}
		return
	}
	logText := string(in.Log)
	if len(in.Log) > 0 && in.Log[0] == '"' { // the log as text, the way the app sends it
		if json.Unmarshal(in.Log, &logText) != nil {
			writeErr(w, 400, "log must be the run's log")
			return
		}
	}
	if logText == "" || len(logText) > maxLogBytes {
		writeErr(w, 400, "log is required (up to 256 KB)")
		return
	}
	var head struct {
		Seed json.Number `json:"seed"`
	}
	if json.Unmarshal([]byte(logText), &head) != nil || head.Seed == "" {
		writeErr(w, 400, "log must be a microgame-log/1 run")
		return
	}

	ctx, me := r.Context(), userFrom(r)
	unlock := s.seriesLocks.lock("round:" + chi.URLParam(r, "id")) // two runs can't overwrite each other
	defer unlock()
	rd, g, ok := s.roundOr404(w, r)
	if !ok {
		return
	}
	if g == nil {
		writeErr(w, 404, "the game for this round is gone")
		return
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	if s.closeRound(rd, g, now) { // the window ran out: record it and refuse
		_ = s.Store.ReplaceRound(ctx, rd)
	}
	if rd.FinishedAt != nil {
		writeErr(w, 409, "this round is over")
		return
	}
	if _, played := rd.Plays[me.ID]; played {
		writeErr(w, 409, "you already played this round")
		return
	}
	text, err := s.gameText(ctx, g)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	res, code, msg := s.verifyRun(ctx, text, logText, groupPlayOf(g).Result.State...)
	if res == nil {
		writeErr(w, code, msg)
		return
	}
	if !res.OK || !res.GameHashOK || res.Recomputed == nil {
		reason := "the run didn't check out"
		if !res.GameHashOK {
			reason = "that run wasn't played on this round's game"
		} else if len(res.Problems) > 0 {
			reason = "the run didn't check out: " + res.Problems[0]
		}
		writeErr(w, 422, reason)
		return
	}
	if res.Recomputed.Phase != "won" && res.Recomputed.Phase != "lost" {
		writeErr(w, 422, "the run isn't finished")
		return
	}
	// Everyone plays the same seed. The phone derives the engine's seed from the round's, so the log's seed is not the
	// round's; the first run sets it and every other run has to match.
	if rd.LogSeed != "" && rd.LogSeed != head.Seed.String() {
		writeErr(w, 422, "that run wasn't played on this round's seed")
		return
	}
	rd.LogSeed = head.Seed.String()
	e := model.RoundEntry{Score: int64(math.Round(res.Recomputed.Score)), TimeMs: int64(math.Round(res.Recomputed.TimeMs)), At: now,
		Result: resultState(g, res.Result)}
	if g.Score != nil {
		var finished bool
		e.Score, e.TimeMs, finished = runValue(g.Score, res)
		e.DNF = g.Score.FinishedOnly() && !finished
	}
	rd.Plays[me.ID] = e
	rd.Lines = append(rd.Lines, model.RoundLine{UserID: me.ID, Text: roundLine(g, firstNonEmpty(me.DisplayName, me.Username), e), At: now})
	s.closeRound(rd, g, now)
	if err := s.Store.ReplaceRound(ctx, rd); err != nil {
		s.serverErr(w, r, err)
		return
	}
	v, err := s.roundFor(r, rd, g)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}

// roundMoments are the moments rounds put in a person's feed: one started with them in it, a friend played, one ended.
func (s *Server) roundMoments(ctx context.Context, me string, limit int, who func(id, fallback string) profile) []moment {
	list, err := s.Store.RoundsForUser(ctx, me, limit)
	if err != nil {
		return nil
	}
	var out []moment
	for _, rd := range list {
		if rd.CreatorID != me {
			out = append(out, moment{"round:" + rd.ID, "round_started", rd.GameID, who(rd.CreatorID, ""), rd.CreatedAt})
		}
		for id, e := range rd.Plays {
			if id != me {
				out = append(out, moment{"round:" + rd.ID + ":" + id, "round_played", rd.GameID, who(id, ""), e.At})
			}
		}
		if rd.FinishedAt != nil {
			out = append(out, moment{"round:" + rd.ID + ":done", "round_finished", rd.GameID, who(rd.CreatorID, ""), *rd.FinishedAt})
		}
	}
	return out
}
