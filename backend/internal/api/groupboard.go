package api

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// GET /v1/groups/{id}/leaderboard?week=2026-W46
//
// A Group's weekly board: members ranked across the Group's games. Raw scores differ a lot between games, so each
// game awards rank points among the members who played it that week (first place 10, then 7, 5, 3, 2, and 1 for
// everyone after that; equal scores share a place). A member's points are the sum over the Group's games.
// Weeks are ISO weeks in UTC, Monday to Sunday; the default is the current week. `rankChange` is last week's rank
// minus this week's (positive means they moved up; 0 when they weren't ranked last week).
//
// A score counts for a week when it was last submitted in it (the server keeps each person's best per game).

var weekRE = regexp.MustCompile(`^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$`)

// rankPoints is what a place is worth in a game.
func rankPoints(place int) int {
	switch place {
	case 1:
		return 10
	case 2:
		return 7
	case 3:
		return 5
	case 4:
		return 3
	case 5:
		return 2
	default:
		return 1
	}
}

// isoWeekStart is the Monday 00:00 UTC that starts ISO week `week` of `year`.
func isoWeekStart(year, week int) time.Time {
	jan4 := time.Date(year, time.January, 4, 0, 0, 0, 0, time.UTC) // always in week 1
	monday1 := jan4.AddDate(0, 0, -((int(jan4.Weekday()) + 6) % 7))
	return monday1.AddDate(0, 0, 7*(week-1))
}

func weekLabel(start time.Time) string {
	y, w := start.ISOWeek()
	return fmt.Sprintf("%04d-W%02d", y, w)
}

type boardRow struct {
	UserID      string
	Points      int
	GamesPlayed int
}

// rankWeek turns each game's scores into rank points for the given members and week, and orders the members.
// models are the games' score models (a game without one ranks points, higher first). A game whose board is unranked
// awards no points.
func rankWeek(boards map[string][]model.Score, members map[string]bool, start, end time.Time, models map[string]*model.ScoreModel) []boardRow {
	byUser := map[string]*boardRow{}
	for gid, scores := range boards {
		sm := models[gid]
		if !sm.Ranked() {
			continue
		}
		var in []model.Score
		for _, s := range scores {
			if members[s.UserID] && !s.UpdatedAt.Before(start) && s.UpdatedAt.Before(end) {
				in = append(in, s)
			}
		}
		sort.SliceStable(in, func(i, j int) bool { return beats(sm, in[i].Score, in[j].Score) })
		place := 0
		for i, s := range in {
			if i == 0 || s.Score != in[i-1].Score { // equal scores share a place
				place = i + 1
			}
			r := byUser[s.UserID]
			if r == nil {
				r = &boardRow{UserID: s.UserID}
				byUser[s.UserID] = r
			}
			r.Points += rankPoints(place)
			r.GamesPlayed++
		}
	}
	rows := make([]boardRow, 0, len(byUser))
	for _, r := range byUser {
		rows = append(rows, *r)
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.Points != b.Points {
			return a.Points > b.Points
		}
		if a.GamesPlayed != b.GamesPlayed {
			return a.GamesPlayed > b.GamesPlayed
		}
		return a.UserID < b.UserID
	})
	return rows
}

// placeOf gives each user's 1-based rank, with ties on points and games played sharing a rank.
func placeOf(rows []boardRow) map[string]int {
	out := make(map[string]int, len(rows))
	rank := 0
	for i, r := range rows {
		if i == 0 || r.Points != rows[i-1].Points || r.GamesPlayed != rows[i-1].GamesPlayed {
			rank = i + 1
		}
		out[r.UserID] = rank
	}
	return out
}

func (s *Server) groupLeaderboard(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	ctx, me := r.Context(), userFrom(r)
	ms, err := s.Store.GroupMembers(ctx, g.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	members := map[string]bool{}
	ids := make([]string, 0, len(ms))
	for _, m := range ms {
		members[m.UserID] = true
		ids = append(ids, m.UserID)
	}
	if !members[me.ID] {
		writeErr(w, 403, "join the Group to see its board")
		return
	}

	start := isoWeekStart(time.Now().UTC().ISOWeek())
	if q := r.URL.Query().Get("week"); q != "" {
		m := weekRE.FindStringSubmatch(q)
		if m == nil {
			writeErr(w, 400, "week must look like 2026-W46")
			return
		}
		y, _ := strconv.Atoi(m[1])
		wk, _ := strconv.Atoi(m[2])
		start = isoWeekStart(y, wk)
		if weekLabel(start) != q { // 2026-W53 doesn't exist in most years
			writeErr(w, 400, "that week doesn't exist")
			return
		}
	}
	end := start.AddDate(0, 0, 7)
	prevStart := start.AddDate(0, 0, -7)

	games, err := s.Store.GamesByGroup(ctx, g.ID, 50)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	boards := make(map[string][]model.Score, len(games))
	models := make(map[string]*model.ScoreModel, len(games))
	for _, game := range games {
		rows, err := s.Store.Board(ctx, game.ID, boardScan, model.OrderOf(game.Score))
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		boards[game.ID] = rows
		models[game.ID] = game.Score
	}
	this := rankWeek(boards, members, start, end, models)
	before := placeOf(rankWeek(boards, members, prevStart, start, models))
	now := placeOf(this)

	users, err := s.Store.UsersByIDs(ctx, ids)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	byID := map[string]model.User{}
	for _, u := range users {
		byID[u.ID] = u
	}
	type row struct {
		User        profile `json:"user"`
		Points      int     `json:"points"`
		GamesPlayed int     `json:"gamesPlayed"`
		Rank        int     `json:"rank"`
		RankChange  int     `json:"rankChange"`
	}
	items := make([]row, 0, len(this))
	for _, r := range this {
		u, ok := byID[r.UserID]
		if !ok {
			continue
		}
		change := 0
		if prev, ranked := before[r.UserID]; ranked {
			change = prev - now[r.UserID]
		}
		items = append(items, row{User: profileOf(u, nil), Points: r.Points, GamesPlayed: r.GamesPlayed, Rank: now[r.UserID], RankChange: change})
	}
	writeJSON(w, 200, map[string]any{"week": weekLabel(start), "groupId": g.ID, "games": len(games), "items": items})
}
