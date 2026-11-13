package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Watching a friend's run: the replay behind each counted score is kept with it, and the people who may see it
// (the player, their friends and anyone in a Group with them) can watch it from the board.
//
//	POST /v1/games/{id}/scores  {score | log, replay?}   replay: the runtime's replay log of the same run
//	GET  /v1/games/{id}/leaderboard                     rows carry replayAvailable and replayUrl when the caller may watch
//	GET  /v1/games/{id}/runs/{userId}/log               {gameId, userId, username, score, display, updatedAt, replay}

const (
	maxReplayBytes  = 256 << 10 // the runtime's replay log, compacted
	maxReplayInputs = 40000     // about 11 minutes of a pointer moving every tick
)

// replayIn is the runtime replay log a score submission may carry: `{seed, tick_rate, total_ticks, inputs, length?}`.
type replayIn struct {
	Seed       *json.Number      `json:"seed"`
	TickRate   int               `json:"tick_rate"`
	TotalTicks int               `json:"total_ticks"`
	Inputs     []json.RawMessage `json:"inputs"`
}

// parseReplay checks a submitted replay's shape and size and returns it compacted. An absent replay is "" with no error.
func parseReplay(raw json.RawMessage) (string, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	if len(raw) > 0 && raw[0] == '"' { // sent as JSON text
		var text string
		if json.Unmarshal(raw, &text) != nil {
			return "", errors.New("replay must be the run's replay log")
		}
		raw = json.RawMessage(text)
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return "", errors.New("replay must be the run's replay log")
	}
	if buf.Len() > maxReplayBytes {
		return "", errors.New("that run's replay is too large (up to 256 KB)")
	}
	var r replayIn
	dec := json.NewDecoder(bytes.NewReader(buf.Bytes()))
	dec.UseNumber()
	if err := dec.Decode(&r); err != nil || r.Seed == nil || r.Inputs == nil || r.TotalTicks < 0 || r.TickRate < 0 {
		return "", errors.New("replay needs seed, total_ticks and inputs")
	}
	if len(r.Inputs) > maxReplayInputs {
		return "", errors.New("that run's replay has too many inputs")
	}
	return buf.String(), nil
}

// keepRunLog stores the replay behind a score that just went on the board. Without a replay nothing is kept; the
// board then offers no replay for that row, as the score and the old log no longer match.
func (s *Server) keepRunLog(ctx context.Context, sc model.Score, replay, engineLog string) {
	if replay == "" {
		return
	}
	l := model.RunLog{GameID: sc.GameID, UserID: sc.UserID, Username: sc.Username, Score: sc.Score, Replay: replay,
		EngineLog: engineLog, UpdatedAt: sc.UpdatedAt}
	if err := s.Store.PutRunLog(ctx, l); err != nil { // the score counted; a lost replay only hides the Watch button
		s.Log.Warn("keep run log", "game", sc.GameID, "err", err)
	}
}

// watchable is everyone whose runs a person may watch: themselves, their friends and the members of their Groups.
func (s *Server) watchable(ctx context.Context, me string) (map[string]bool, error) {
	out, err := s.friendSet(ctx, me)
	if err != nil {
		return nil, err
	}
	out[me] = true
	groups, err := s.Store.GroupsOfUser(ctx, me)
	if err != nil {
		return nil, err
	}
	for _, g := range groups {
		ms, err := s.Store.GroupMembers(ctx, g.ID)
		if err != nil {
			return nil, err
		}
		for _, m := range ms {
			out[m.UserID] = true
		}
	}
	return out, nil
}

// canWatch says whether me may watch them's runs: the same person, friends, or in a Group together.
func (s *Server) canWatch(ctx context.Context, me, them string) (bool, error) {
	if me == them {
		return true, nil
	}
	friends, err := s.friendSet(ctx, me)
	if err != nil || friends[them] {
		return friends[them], err
	}
	mine, err := s.Store.GroupsOfUser(ctx, me)
	if err != nil {
		return false, err
	}
	theirs, err := s.Store.GroupsOfUser(ctx, them)
	if err != nil {
		return false, err
	}
	in := map[string]bool{}
	for _, g := range mine {
		in[g.ID] = true
	}
	for _, g := range theirs {
		if in[g.ID] {
			return true, nil
		}
	}
	return false, nil
}

// markReplays sets replayAvailable and replayUrl on the rows whose run the caller may watch and whose log still
// matches the score on the board. Signed out, no row offers one.
func (s *Server) markReplays(ctx context.Context, g *model.Game, me *model.User, items []scoreRow) {
	if me == nil || len(items) == 0 {
		return
	}
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.UserID
	}
	logs, err := s.Store.RunLogScores(ctx, g.ID, ids)
	if err != nil || len(logs) == 0 {
		return
	}
	who, err := s.watchable(ctx, me.ID)
	if err != nil {
		return
	}
	for i, it := range items {
		if sc, ok := logs[it.UserID]; ok && sc == it.Score.Score && who[it.UserID] {
			items[i].ReplayAvailable = true
			items[i].ReplayURL = "/v1/games/" + g.ID + "/runs/" + it.UserID + "/log"
		}
	}
}

// runLog is GET /v1/games/{id}/runs/{userId}/log: the replay behind a person's board score.
func (s *Server) runLog(w http.ResponseWriter, r *http.Request) {
	g, ok := s.gameOr404(w, r)
	if !ok {
		return
	}
	me, them := userFrom(r), chi.URLParam(r, "userId")
	allowed, err := s.canWatch(r.Context(), me.ID, them)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if !allowed {
		writeErr(w, 403, "only their friends and Group members can watch this run")
		return
	}
	l, err := s.Store.RunLogOf(r.Context(), g.ID, them)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "no replay for this run")
		return
	}
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"gameId": l.GameID, "userId": l.UserID, "username": l.Username, "score": l.Score, "display": displayScore(g, l.Score),
		"updatedAt": l.UpdatedAt, "replay": json.RawMessage(l.Replay),
	})
}
