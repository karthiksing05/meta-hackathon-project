package api

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// Agreement for opinion games (a game whose group_play.result.compare is "agreement": rate, rank, tier list). There is
// no right answer, so there is no winner: people are compared on how much their picks match.
//
//	GET /v1/games/{id}/agreement?with=<userId>                  you and one friend
//	GET /v1/games/{id}/agreement?scope=friends                  you and your friends who played
//	GET /v1/games/{id}/agreement?scope=group&groupId=<id>       you and the Group's members who played
//	-> {agreement: 0-100, players, items: [{item, mine, group, share}]}
//
// Picks are each player's latest replay-checked end state (`picks`, named in group_play.result.state) from the rounds
// they played; nothing a phone claims counts. For two people `group` is their pick and `share` is 100 or 0.
// For a crowd `group` is the most common pick and `share` is the share of the others who picked what you did.

// picksOf reads a run's picks as item -> pick. A list is read in prompt order (items "1", "2", ...); an object by key.
func picksOf(e model.RoundEntry) map[string]string {
	out := map[string]string{}
	switch v := e.Result["picks"].(type) {
	case []any:
		for i, x := range v {
			out[strconv.Itoa(i+1)] = fmt.Sprint(x)
		}
	case map[string]any:
		for k, x := range v {
			out[k] = fmt.Sprint(x)
		}
	}
	return out
}

// picksAgreement is how much two sets of picks match, 0 to 100: matching items over every item either one picked.
func picksAgreement(a, b map[string]string) int {
	items := map[string]bool{}
	for k := range a {
		items[k] = true
	}
	for k := range b {
		items[k] = true
	}
	if len(items) == 0 {
		return 0
	}
	same := 0
	for k := range items {
		if x, ok := a[k]; ok && x == b[k] {
			same++
		}
	}
	return int(math.Round(100 * float64(same) / float64(len(items))))
}

type agreementItem struct {
	Item  string  `json:"item"`
	Mine  string  `json:"mine"`
	Group string  `json:"group"`
	Share float64 `json:"share"`
}

func (s *Server) gameAgreement(w http.ResponseWriter, r *http.Request) {
	ctx, me := r.Context(), userFrom(r)
	g, err := s.roundGame(ctx, chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, 404, "game not found")
		return
	}
	if !compareAgreement(g) {
		writeErr(w, 422, "this game has no agreement to compare: its results are not picks")
		return
	}
	q := r.URL.Query()
	var who map[string]bool
	switch {
	case strings.TrimSpace(q.Get("with")) != "":
		other := strings.TrimSpace(q.Get("with"))
		fs, err := s.friendSet(ctx, me.ID)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		if !fs[other] {
			writeErr(w, 403, "you can only compare with a friend")
			return
		}
		who = map[string]bool{me.ID: true, other: true}
	case q.Get("scope") == "friends":
		fs, err := s.friendSet(ctx, me.ID)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		who = map[string]bool{me.ID: true}
		for id := range fs {
			who[id] = true
		}
	case q.Get("scope") == "group":
		gid := strings.TrimSpace(q.Get("groupId"))
		if gid == "" || !s.isMember(ctx, gid, me.ID) {
			writeErr(w, 403, "pick a Group you are in (groupId)")
			return
		}
		ms, err := s.Store.GroupMembers(ctx, gid)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		who = map[string]bool{}
		for _, m := range ms {
			who[m.UserID] = true
		}
	default:
		writeErr(w, 400, "use with=<userId>, scope=friends or scope=group&groupId=<id>")
		return
	}
	rounds, err := s.Store.RoundsForGame(ctx, g.ID, 500)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	latest := map[string]map[string]string{} // each person's latest picks (rounds are newest first)
	for _, rd := range rounds {
		for id, e := range rd.Plays {
			if !who[id] || latest[id] != nil {
				continue
			}
			if p := picksOf(e); len(p) > 0 {
				latest[id] = p
			}
		}
	}
	mine := latest[me.ID]
	if mine == nil {
		writeErr(w, 409, "play a round of this game first: your picks are what get compared")
		return
	}
	others := make([]string, 0, len(latest))
	for id := range latest {
		if id != me.ID {
			others = append(others, id)
		}
	}
	sort.Strings(others)
	if len(others) == 0 {
		writeErr(w, 409, "nobody else has played this game in a round yet")
		return
	}
	total := 0
	for _, id := range others {
		total += picksAgreement(mine, latest[id])
	}
	keys := make([]string, 0, len(mine))
	for k := range mine {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, ea := strconv.Atoi(keys[i])
		b, eb := strconv.Atoi(keys[j])
		if ea == nil && eb == nil {
			return a < b
		}
		return keys[i] < keys[j]
	})
	items := make([]agreementItem, 0, len(keys))
	for _, k := range keys {
		counts := map[string]int{}
		same := 0
		for _, id := range others {
			if pick, ok := latest[id][k]; ok {
				counts[pick]++
				if pick == mine[k] {
					same++
				}
			}
		}
		top, topN := "", 0
		for pick, n := range counts { // the most common pick; a tie goes to the first by name so the answer is stable
			if n > topN || (n == topN && pick < top) {
				top, topN = pick, n
			}
		}
		items = append(items, agreementItem{Item: k, Mine: mine[k], Group: top, Share: math.Round(1000*float64(same)/float64(len(others))) / 1000})
	}
	writeJSON(w, 200, map[string]any{"agreement": int(math.Round(float64(total) / float64(len(others)))), "players": len(others) + 1, "items": items})
}
