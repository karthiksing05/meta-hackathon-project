package api

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Score-aware boards. A game's manifest.json may carry a top-level `score` (authoring/SPEC.md 2.13): what the board
// ranks, in which direction, which runs count, how scores are combined, how ties break, and how a score is shown.
//
//   - direction "lower": a time trial ranks the fastest first (a smaller score is better).
//   - counts_when "finished": only won runs go on the board. The run's phase comes from replaying its log.
//   - aggregate "best" keeps a person's best run, "latest" their newest ("sum_week" ranks as best for now).
//   - tie_break "less time" puts the shorter run first, "earlier" the one set first.
//   - bounds: a score outside them, or above max_rate_per_s, is refused.
//   - ranked false (the score check couldn't vouch for it): the board is a plain list, newest first.
//
// Every score is a whole number: time kinds are whole milliseconds, accuracy a whole percent.
//
// A game with a score model only takes scores from a replayed run: POST /v1/games/{id}/scores {log}. The server reads
// the phase, the score and the time from the engine's replay and ignores what the phone claims. A game without a
// model keeps taking a plain {score}.

type manifestScore struct {
	Kind       string `json:"kind"`
	Measures   string `json:"measures"`
	Unit       string `json:"unit"`
	Direction  string `json:"direction"`
	CountsWhen string `json:"counts_when"`
	Aggregate  string `json:"aggregate"`
	TieBreak   string `json:"tie_break"`
	Format     string `json:"format"`
	Source     string `json:"source"`
	Bounds     *struct {
		Min         *float64 `json:"min"`
		Max         *float64 `json:"max"`
		MaxRatePerS *float64 `json:"max_rate_per_s"`
	} `json:"bounds"`
	Ranked *bool `json:"ranked"`
}

var scoreKinds = map[string]bool{
	"points": true, "time_to_complete": true, "count_in_time": true, "survival_time": true,
	"accuracy": true, "distance": true, "tiered_points": true, "streak": true,
}

// scoreModelFrom normalizes a manifest's score block, filling in what the kind implies. A value it doesn't know falls back
// to the kind's default, so a slightly off block never stops a game from being published.
func scoreModelFrom(in *manifestScore) *model.ScoreModel {
	if in == nil {
		return nil
	}
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	if !scoreKinds[kind] {
		kind = "points"
	}
	sm := &model.ScoreModel{Kind: kind, Measures: clipText(in.Measures, 200), Unit: clipText(in.Unit, 40), Source: strings.ToLower(in.Source)}
	sm.Direction = "higher"
	if kind == "time_to_complete" {
		sm.Direction = "lower"
	}
	if d := strings.ToLower(in.Direction); d == "higher" || d == "lower" {
		sm.Direction = d
	}
	sm.CountsWhen = "any"
	if kind == "time_to_complete" || kind == "accuracy" {
		sm.CountsWhen = "finished"
	}
	if c := strings.ToLower(in.CountsWhen); c == "any" || c == "finished" {
		sm.CountsWhen = c
	}
	sm.Aggregate = "best"
	if a := strings.ToLower(in.Aggregate); a == "latest" || a == "sum_week" {
		sm.Aggregate = a
	}
	sm.TieBreak = "earlier"
	if strings.ToLower(in.TieBreak) == "less time" {
		sm.TieBreak = "less time"
	}
	sm.Format = strings.TrimSpace(in.Format)
	if sm.Format == "" || len(sm.Format) > 40 {
		sm.Format = defaultFormat(kind)
	}
	if b := in.Bounds; b != nil {
		sm.Bounds = &model.ScoreBounds{}
		if b.Min != nil {
			v := int64(math.Round(*b.Min))
			sm.Bounds.Min = &v
		}
		if b.Max != nil {
			v := int64(math.Round(*b.Max))
			sm.Bounds.Max = &v
		}
		if b.MaxRatePerS != nil && *b.MaxRatePerS > 0 {
			sm.Bounds.MaxRatePerS = *b.MaxRatePerS
		}
		if sm.Bounds.Min == nil && sm.Bounds.Max == nil && sm.Bounds.MaxRatePerS == 0 {
			sm.Bounds = nil
		}
	}
	sm.Unranked = in.Ranked != nil && !*in.Ranked
	return sm
}

func clipText(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func defaultFormat(kind string) string {
	switch kind {
	case "time_to_complete", "survival_time":
		return "m:ss.t"
	case "accuracy":
		return "{n}%"
	case "distance":
		return "{n} m"
	}
	return "{n}"
}

// formatScore shows a whole-number score the way the game's format says: text with one {n}, or a time (the value is
// milliseconds): m:ss.t, m:ss or s.t.
func formatScore(n int64, format string) string {
	switch format {
	case "m:ss.t", "m:ss":
		neg := ""
		if n < 0 {
			neg, n = "-", -n
		}
		min, sec, tenth := n/60000, (n/1000)%60, (n%1000)/100
		if format == "m:ss" {
			return fmt.Sprintf("%s%d:%02d", neg, min, sec)
		}
		return fmt.Sprintf("%s%d:%02d.%d", neg, min, sec, tenth)
	case "s.t":
		return fmt.Sprintf("%d.%d", n/1000, (n%1000)/100)
	}
	if strings.Contains(format, "{n}") {
		return strings.Replace(format, "{n}", strconv.FormatInt(n, 10), 1)
	}
	return strconv.FormatInt(n, 10)
}

// displayScore is a score as it should be shown for a game.
func displayScore(g *model.Game, n int64) string {
	if g == nil || g.Score == nil {
		return strconv.FormatInt(n, 10)
	}
	return formatScore(n, g.Score.Format)
}

// scoreBetter says whether a new score beats an old one for the game: by direction, then the tie-break.
func scoreBetter(sm *model.ScoreModel, neu, old model.Score) bool {
	if neu.Score != old.Score {
		if sm.Lower() {
			return neu.Score < old.Score
		}
		return neu.Score > old.Score
	}
	return sm != nil && sm.TieBreak == "less time" && neu.TimeMs < old.TimeMs
}

// runValue is what a replayed run counts for under a score model: the run time for time kinds, otherwise the engine's
// score, rounded to a whole number.
func runValue(sm *model.ScoreModel, res *verifyResult) (value, timeMs int64, finished bool) {
	timeMs = int64(math.Round(res.Recomputed.TimeMs))
	value = int64(math.Round(res.Recomputed.Score))
	if sm != nil && (sm.Kind == "time_to_complete" || sm.Kind == "survival_time") && sm.Source != "score" {
		value = timeMs
	}
	return value, timeMs, res.Recomputed.Phase == "won"
}

// outOfBounds reports why a score can't be real for the game, or "".
func outOfBounds(sm *model.ScoreModel, value, timeMs int64) string {
	b := sm.Bounds
	if b == nil {
		return ""
	}
	if b.Min != nil && value < *b.Min {
		return "that score is lower than this game allows"
	}
	if b.Max != nil && value > *b.Max {
		return "that score is higher than this game allows"
	}
	if b.MaxRatePerS > 0 && timeMs > 0 && float64(value)/(float64(timeMs)/1000) > b.MaxRatePerS {
		return "that score is earned faster than this game allows"
	}
	return ""
}

// submitScored takes a run for a game with a score model.
func (s *Server) submitScored(w http.ResponseWriter, r *http.Request, g *model.Game) {
	if s.GeneratorURL == "" {
		writeErr(w, 503, "checking scores is not set up on this server")
		return
	}
	run, ok := readRunBody(w, r, maxLogBytes+maxReplayBytes+4096, "this game ranks verified runs: send the run's log (up to 256 KB)", false)
	if !ok {
		return
	}
	logText := run.Log
	replay, err := parseReplay(run.Replay)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	text, err := s.gameText(r.Context(), g)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	res, code, msg := s.verifyRun(r.Context(), text, logText)
	if res == nil {
		writeErr(w, code, msg)
		return
	}
	if !requireFinishedRun(w, res, "that run wasn't played on this game") {
		return
	}
	sm := g.Score
	value, timeMs, finished := runValue(sm, res)
	if msg := outOfBounds(sm, value, timeMs); msg != "" {
		writeErr(w, 422, msg)
		return
	}
	extra := map[string]any{"counted": true, "score": value, "display": displayScore(g, value), "finished": finished}
	if sm.FinishedOnly() && !finished {
		extra["counted"], extra["reason"] = false, "only finished runs count for this game"
		s.writeBoard(w, r, g, extra)
		return
	}

	u := userFrom(r)
	unlock := s.scoreLocks.lock(g.ID + ":" + u.ID) // read the old score and write the new one without another run in between
	defer unlock()
	neu := model.Score{GameID: g.ID, UserID: u.ID, Username: u.Username, Score: value, TimeMs: timeMs, UpdatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	old, err := s.Store.ScoreOf(r.Context(), g.ID, u.ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
	case err != nil:
		s.serverErr(w, r, err)
		return
	case sm.Aggregate != "latest" && !scoreBetter(sm, neu, *old):
		extra["counted"], extra["reason"] = false, "that isn't better than your best"
		s.writeBoard(w, r, g, extra)
		return
	}
	if err := s.watchLeader(r.Context(), g, func() error { return s.Store.PutScore(r.Context(), neu) }); err != nil {
		s.serverErr(w, r, err)
		return
	}
	s.noteChallengeAccepted(r.Context(), u.ID, g.ID)
	s.keepRunLog(r.Context(), neu, replay, logText)
	s.writeBoard(w, r, g, extra)
}

// scoreRow is a board row with its score as it should be shown.
type scoreRow struct {
	model.Score
	Display         string `json:"display"`
	ReplayAvailable bool   `json:"replayAvailable,omitempty"` // the caller may watch this run (runlogs.go)
	ReplayURL       string `json:"replayUrl,omitempty"`
}

// writeBoard answers with a game's board (scope and limit as the leaderboard route takes them), shaped by its score model.
func (s *Server) writeBoard(w http.ResponseWriter, r *http.Request, g *model.Game, extra map[string]any) {
	rows, ok := s.scopedBoard(w, r, g, limitParam(r, 20, 100))
	if !ok {
		return
	}
	items := make([]scoreRow, len(rows))
	for i, row := range rows {
		items[i] = scoreRow{Score: row, Display: displayScore(g, row.Score)}
	}
	s.markReplays(r.Context(), g, userFrom(r), items)
	out := map[string]any{"items": items, "ranked": g.Score.Ranked()}
	if g.Score != nil {
		out["direction"], out["format"] = g.Score.Direction, g.Score.Format
	}
	for k, v := range extra {
		out[k] = v
	}
	writeJSON(w, 200, out)
}
