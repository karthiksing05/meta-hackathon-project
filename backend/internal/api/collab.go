package api

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Collaboration endpoints the app needs: scoped leaderboards, challenges, the moments inbox, and the saves
// seen from both sides.
//
//	GET  /v1/games/{id}/leaderboard?scope=everyone|friends|group&groupId=
//	GET  /v1/me/likes                 the games I saved, newest first
//	GET  /v1/games/{id}/likes         how many saved it, and which of my friends did
//	POST /v1/challenges               {gameId, toUserIds[]}: "beat my score"
//	GET  /v1/challenges               the ones I sent and received, with how each is going
//	GET  /v1/me/moments               what happened with me on other phones (challenges, remixes, play together)

const boardScan = 500 // how many board rows a scoped board filters from

// scopedBoard returns a game's board limited to people the caller shares a scope with.
// ok is false when it has already written an error.
func (s *Server) scopedBoard(w http.ResponseWriter, r *http.Request, g *model.Game, limit int) (rows []model.Score, ok bool) {
	ctx := r.Context()
	gameID, order := g.ID, model.OrderOf(g.Score)
	scope := r.URL.Query().Get("scope")
	if scope == "" || scope == "everyone" {
		rows, err := s.Store.Board(ctx, gameID, limit, order)
		if err != nil {
			s.serverErr(w, r, err)
			return nil, false
		}
		return rows, true
	}
	me := userFrom(r)
	if me == nil {
		writeErr(w, 401, "sign in to see this board")
		return nil, false
	}
	allowed := map[string]bool{me.ID: true}
	switch scope {
	case "friends":
		ids, err := s.Store.Friends(ctx, me.ID)
		if err != nil {
			s.serverErr(w, r, err)
			return nil, false
		}
		for _, id := range ids {
			allowed[id] = true
		}
	case "group":
		gid := r.URL.Query().Get("groupId")
		if gid == "" {
			writeErr(w, 400, "groupId is required for the group board")
			return nil, false
		}
		ms, err := s.Store.GroupMembers(ctx, gid)
		if err != nil {
			s.serverErr(w, r, err)
			return nil, false
		}
		mine := false
		for _, m := range ms {
			allowed[m.UserID] = true
			mine = mine || m.UserID == me.ID
		}
		if !mine {
			writeErr(w, 403, "join the Group to see its board")
			return nil, false
		}
	default:
		writeErr(w, 400, "scope must be everyone, friends or group")
		return nil, false
	}
	all, err := s.Store.Board(ctx, gameID, boardScan, order)
	if err != nil {
		s.serverErr(w, r, err)
		return nil, false
	}
	for _, row := range all {
		if allowed[row.UserID] && len(rows) < limit {
			rows = append(rows, row)
		}
	}
	return rows, true
}

// myBest is a person's score on a game, and whether they have one.
func (s *Server) myBest(ctx context.Context, gameID, userID string) (int64, bool) {
	sc, err := s.Store.ScoreOf(ctx, gameID, userID)
	if err != nil {
		return 0, false
	}
	return sc.Score, true
}

// beats says whether score a is better than score b for a game: higher, or lower when a smaller score is better.
func beats(sm *model.ScoreModel, a, b int64) bool {
	if sm.Lower() {
		return a < b
	}
	return a > b
}

func (s *Server) myLikes(w http.ResponseWriter, r *http.Request) {
	ids, err := s.Store.LikedGameIDs(r.Context(), userFrom(r).ID, limitParam(r, 50, 200))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	games := make([]model.Game, 0, len(ids))
	for _, id := range ids {
		if g, err := s.Store.GameByID(r.Context(), id); err == nil {
			games = append(games, *g)
		}
	}
	items, err := s.views(r, games)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) gameLikes(w http.ResponseWriter, r *http.Request) {
	g, ok := s.gameOr404(w, r)
	if !ok {
		return
	}
	friends := []profile{}
	if me := userFrom(r); me != nil {
		likers, err := s.Store.GameLikers(r.Context(), g.ID, 1000)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		fs, err := s.friendSet(r.Context(), me.ID)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		var ids []string
		for _, id := range likers {
			if fs[id] {
				ids = append(ids, id)
			}
		}
		users, err := s.Store.UsersByIDs(r.Context(), ids)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		for _, u := range users {
			friends = append(friends, profileOf(u, fs))
		}
	}
	writeJSON(w, 200, map[string]any{"count": g.Likes, "friends": friends})
}

const maxChallengeTargets = 20

func (s *Server) createChallenge(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GameID    string   `json:"gameId"`
		ToUserIDs []string `json:"toUserIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.ToUserIDs) < 1 || len(in.ToUserIDs) > maxChallengeTargets {
		writeErr(w, 400, "challenge between 1 and 20 friends")
		return
	}
	me := userFrom(r)
	var g *model.Game
	var err error
	if store.LooksLikeID(in.GameID) {
		g, err = s.Store.GameByID(r.Context(), in.GameID)
	} else {
		g, err = s.Store.GameBySlug(r.Context(), in.GameID)
	}
	if err != nil {
		writeErr(w, 404, "game not found")
		return
	}
	fs, err := s.friendSet(r.Context(), me.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	seen := map[string]bool{}
	var to []string
	for _, id := range in.ToUserIDs {
		if id == me.ID || seen[id] {
			continue
		}
		if !fs[id] {
			writeErr(w, 400, "you can only challenge your friends")
			return
		}
		seen[id] = true
		to = append(to, id)
	}
	if len(to) == 0 {
		writeErr(w, 400, "pick at least one friend")
		return
	}
	best, played := s.myBest(r.Context(), g.ID, me.ID)
	if !played && g.Score.Lower() {
		writeErr(w, 422, "play it first, so there is a score to beat")
		return
	}
	c := &model.Challenge{
		ID: auth.NewID(12), GameID: g.ID, FromID: me.ID, FromName: me.DisplayName, ToIDs: to,
		Score: best, CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
	if c.FromName == "" {
		c.FromName = me.Username
	}
	if err := s.Store.InsertChallenge(r.Context(), c); err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, c)
}

type challengeResponse struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	Score    int64  `json:"score"`
	Beat     bool   `json:"beat"`
}

type challengeView struct {
	ID        string              `json:"id"`
	Direction string              `json:"direction"` // sent or received
	Game      *model.GameView     `json:"game,omitempty"`
	From      profile             `json:"from"`
	ToIDs     []string            `json:"toIds"`
	Score     int64               `json:"score"`             // the score to beat
	MyScore   *int64              `json:"myScore,omitempty"` // received: my best on the game
	Beaten    bool                `json:"beaten"`            // received: I have beaten it
	Responses []challengeResponse `json:"responses"`         // sent: the friends who have played, and how they did
	CreatedAt time.Time           `json:"createdAt"`
}

func (s *Server) listChallenges(w http.ResponseWriter, r *http.Request) {
	ctx, me := r.Context(), userFrom(r)
	cs, err := s.Store.ChallengesFor(ctx, me.ID, limitParam(r, 30, 50))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := make([]challengeView, 0, len(cs))
	for _, c := range cs {
		v := challengeView{ID: c.ID, ToIDs: c.ToIDs, Score: c.Score, CreatedAt: c.CreatedAt, Responses: []challengeResponse{}}
		g, err := s.Store.GameByID(ctx, c.GameID)
		if err != nil {
			continue // the game is gone
		}
		if gv, err := s.views(r, []model.Game{*g}); err == nil && len(gv) == 1 {
			v.Game = &gv[0]
		}
		if from, err := s.Store.UserByID(ctx, c.FromID); err == nil {
			v.From = profileOf(*from, nil)
		} else {
			v.From = profile{ID: c.FromID, DisplayName: c.FromName}
		}
		board, _ := s.Store.Board(ctx, c.GameID, boardScan, model.OrderOf(g.Score))
		if c.FromID == me.ID {
			v.Direction = "sent"
			to := map[string]bool{}
			for _, id := range c.ToIDs {
				to[id] = true
			}
			for _, row := range board {
				if to[row.UserID] {
					v.Responses = append(v.Responses, challengeResponse{row.UserID, row.Username, row.Score, beats(g.Score, row.Score, c.Score)})
				}
			}
		} else {
			v.Direction = "received"
			for _, row := range board {
				if row.UserID == me.ID {
					best := row.Score
					v.MyScore = &best
					v.Beaten = beats(g.Score, best, c.Score)
				}
			}
		}
		items = append(items, v)
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

type moment struct {
	MomentID string    `json:"momentID"`
	Kind     string    `json:"kind"`
	GameID   string    `json:"gameID,omitempty"`
	From     profile   `json:"from"`
	At       time.Time `json:"at"`
}

func (s *Server) myMoments(w http.ResponseWriter, r *http.Request) {
	ctx, me := r.Context(), userFrom(r)
	limit := limitParam(r, 30, 100)
	out := []moment{}
	cs, err := s.Store.ChallengesFor(ctx, me.ID, limit)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	people := map[string]profile{}
	who := func(id, fallback string) profile {
		if p, ok := people[id]; ok {
			return p
		}
		p := profile{ID: id, DisplayName: fallback}
		if u, err := s.Store.UserByID(ctx, id); err == nil {
			p = profileOf(*u, nil)
		}
		people[id] = p
		return p
	}
	for _, c := range cs {
		if c.FromID != me.ID {
			out = append(out, moment{"challenge:" + c.ID, "challenge_received", c.GameID, who(c.FromID, c.FromName), c.CreatedAt})
		}
	}
	// a friend started a series with you, or played a round of one
	if list, err := s.Store.SeriesForUser(ctx, me.ID, limit); err == nil {
		for _, se := range list {
			other := se.PlayerA
			if se.PlayerA == me.ID {
				other = se.PlayerB
			} else {
				out = append(out, moment{"series:" + se.ID, "series_invited", se.Rounds[0].GameID, who(other, ""), se.CreatedAt})
			}
			for _, rd := range se.Rounds {
				if p, ok := rd.Plays[other]; ok {
					out = append(out, moment{"series:" + se.ID + ":" + strconv.Itoa(rd.N), "series_round", rd.GameID, who(other, ""), p.At})
				}
			}
		}
	}
	evs, err := s.Store.MomentsWith(ctx, me.ID, limit)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	for _, e := range evs {
		if e.UserID == "" || e.UserID == me.ID {
			continue
		}
		out = append(out, moment{"event:" + e.ID, e.Kind, e.GameID, who(e.UserID, ""), e.CreatedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	if len(out) > limit {
		out = out[:limit]
	}
	writeJSON(w, 200, map[string]any{"moments": out, "cursor": ""})
}
