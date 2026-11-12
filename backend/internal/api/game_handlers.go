package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// view converts stored games into responses with public package URLs on the games hostname.
func (s *Server) views(r *http.Request, games []model.Game) ([]model.GameView, error) {
	var liked map[string]bool
	if u := userFrom(r); u != nil && len(games) > 0 {
		ids := make([]string, len(games))
		for i, g := range games {
			ids[i] = g.ID
		}
		var err error
		if liked, err = s.Store.LikedSet(r.Context(), u.ID, ids); err != nil {
			return nil, err
		}
	}
	out := make([]model.GameView, len(games))
	for i, g := range games {
		base := s.GamesBaseURL + "/" + g.StorageKey + "/"
		v := model.GameView{
			ID: g.ID, Title: g.Title, Description: g.Description, Tags: nonNil(g.Tags), Formula: g.Formula,
			OwnerID: g.OwnerID, OwnerUsername: g.OwnerUsername, Likes: g.Likes, Plays: g.Plays,
			Finishes: g.Finishes, LikedByMe: liked[g.ID], RemixOf: g.RemixOf,
			PackageURL: base, ManifestURL: base + g.ManifestPath, CreatedAt: g.CreatedAt,
		}
		if g.CoverPath != "" {
			v.CoverURL = base + g.CoverPath
		}
		out[i] = v
	}
	return out, nil
}

func nonNil(t []string) []string {
	if t == nil {
		return []string{}
	}
	return t
}

func limitParam(r *http.Request, def, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n < 1 {
		return def
	}
	return min(n, max)
}

// page fetches limit+1 rows to learn whether another page exists.
func (s *Server) listPage(w http.ResponseWriter, r *http.Request, fetch func(limit int, c store.Cursor) ([]model.Game, error)) {
	cur, err := store.DecodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeErr(w, 400, "invalid cursor")
		return
	}
	limit := limitParam(r, 20, 50)
	games, err := fetch(limit+1, cur)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	next := ""
	if len(games) > limit {
		games = games[:limit]
		last := games[limit-1]
		next = store.Cursor{At: last.CreatedAt, ID: last.ID}.Encode()
	}
	items, err := s.views(r, games)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func (s *Server) feed(w http.ResponseWriter, r *http.Request) {
	s.listPage(w, r, func(limit int, c store.Cursor) ([]model.Game, error) {
		return s.Store.Feed(r.Context(), limit, c)
	})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	tag := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("tag")))
	if len(q) > 100 || len(tag) > 40 {
		writeErr(w, 400, "query too long")
		return
	}
	limit := limitParam(r, 20, 50)
	offset, _ := strconv.Atoi(r.URL.Query().Get("cursor"))
	if offset < 0 || offset > 10000 {
		offset = 0
	}
	games, err := s.Store.Search(r.Context(), q, tag, limit+1, offset)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	next := ""
	if len(games) > limit {
		games, next = games[:limit], strconv.Itoa(offset+limit)
	}
	items, err := s.views(r, games)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func (s *Server) feedEvents(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DeviceID string `json:"deviceId"`
		Events   []struct {
			GameID string  `json:"gameId"`
			Type   string  `json:"type"`
			Value  float64 `json:"value"`
			At     *int64  `json:"at"` // optional client time, unix ms
		} `json:"events"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Events) == 0 || len(in.Events) > 100 {
		writeErr(w, 400, "send between 1 and 100 events")
		return
	}
	u := userFrom(r)
	if u == nil && (in.DeviceID == "" || len(in.DeviceID) > 64) {
		writeErr(w, 400, "deviceId is required when not signed in")
		return
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	evs := make([]model.Event, 0, len(in.Events))
	for _, e := range in.Events {
		if !model.EventTypes[e.Type] || !pkgstore.ValidID(e.GameID) {
			writeErr(w, 400, "unknown event type or game id")
			return
		}
		at := now
		if e.At != nil { // trust client time only within a sane window
			if t := time.UnixMilli(*e.At).UTC(); t.After(now.Add(-24*time.Hour)) && t.Before(now.Add(time.Minute)) {
				at = t
			}
		}
		ev := model.Event{ID: auth.NewID(12), GameID: e.GameID, Type: e.Type, Value: e.Value, CreatedAt: at}
		if u != nil {
			ev.UserID = u.ID
		} else {
			ev.DeviceID = in.DeviceID
		}
		evs = append(evs, ev)
	}
	if err := s.Store.AddEvents(r.Context(), evs); err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 202, map[string]int{"accepted": len(evs)})
}

func (s *Server) gameOr404(w http.ResponseWriter, r *http.Request) (*model.Game, bool) {
	id := chi.URLParam(r, "id")
	if !pkgstore.ValidID(id) {
		writeErr(w, 404, "game not found")
		return nil, false
	}
	g, err := s.Store.GameByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "game not found")
		} else {
			s.serverErr(w, r, err)
		}
		return nil, false
	}
	return g, true
}

func (s *Server) getGame(w http.ResponseWriter, r *http.Request) {
	g, ok := s.gameOr404(w, r)
	if !ok {
		return
	}
	v, err := s.views(r, []model.Game{*g})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v[0])
}

func (s *Server) like(liked bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		g, ok := s.gameOr404(w, r)
		if !ok {
			return
		}
		n, err := s.Store.SetLike(r.Context(), g.ID, userFrom(r).ID, liked)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"likes": n, "likedByMe": liked})
	}
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	g, ok := s.gameOr404(w, r)
	if !ok {
		return
	}
	rows, err := s.Store.Leaderboard(r.Context(), g.ID, limitParam(r, 20, 100))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if rows == nil {
		rows = []model.Score{}
	}
	writeJSON(w, 200, map[string]any{"items": rows})
}

func (s *Server) submitScore(w http.ResponseWriter, r *http.Request) {
	g, ok := s.gameOr404(w, r)
	if !ok {
		return
	}
	var in struct{ Score float64 }
	if !decode(w, r, &in) {
		return
	}
	if in.Score != in.Score || in.Score > 1e12 || in.Score < -1e12 { // NaN and absurd values
		writeErr(w, 400, "invalid score")
		return
	}
	u := userFrom(r)
	err := s.Store.SubmitScore(r.Context(), model.Score{
		GameID: g.ID, UserID: u.ID, Username: u.Username, Score: in.Score,
		UpdatedAt: time.Now().UTC().Truncate(time.Millisecond),
	})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	s.leaderboard(w, r)
}

// ---- creations ----

var tagRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,23}$`)

type manifestMeta struct {
	Title   string   `json:"title"`
	Rule    string   `json:"one_line_rule"`
	Formula string   `json:"formula"`
	Tags    []string `json:"tags"`
	Brief   struct {
		Mood []string `json:"mood"`
	} `json:"brief"`
	Lineage struct {
		RemixOf string `json:"remix_of"`
	} `json:"lineage"`
}

func (s *Server) createCreation(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/zip") {
		writeErr(w, 415, "send the game package as application/zip")
		return
	}
	u := userFrom(r)
	r.Body = http.MaxBytesReader(w, r.Body, s.MaxUploadMB<<20+1)
	id := auth.NewID(12) // server-generated; clients never choose ids or paths
	var m manifestMeta
	pkg, err := s.Packages.Publish(r.Context(), id, r.Body, func(p *pkgstore.Package) error {
		if json.Unmarshal(p.Manifest, &m) != nil {
			return errors.New("manifest.json has the wrong shape")
		}
		t, d := strings.TrimSpace(m.Title), strings.TrimSpace(m.Rule)
		if t == "" || len([]rune(t)) > 80 || len([]rune(d)) > 300 {
			return errors.New("manifest needs a title (max 80 characters) and a one_line_rule (max 300)")
		}
		return nil
	})
	if err != nil {
		var inv *pkgstore.InvalidError
		var tooBig *http.MaxBytesError
		switch {
		case errors.As(err, &inv):
			writeErr(w, 422, inv.Msg)
		case errors.As(err, &tooBig):
			writeErr(w, 413, "upload too large")
		default:
			s.serverErr(w, r, err)
		}
		return
	}
	g := &model.Game{
		ID: id, OwnerID: u.ID, OwnerUsername: u.Username,
		Title:       strings.TrimSpace(m.Title),
		Description: strings.TrimSpace(m.Rule),
		Formula:     strings.ToLower(strings.TrimSpace(m.Formula)),
		Tags:        normTags(append(append(m.Tags, m.Brief.Mood...), m.Formula)),
		StorageKey:  id, ManifestPath: pkg.ManifestPath, CoverPath: pkg.CoverPath, HasSource: pkg.HasSource,
		CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
	if rm := m.Lineage.RemixOf; rm != "" {
		if _, err := s.Store.GameByID(r.Context(), rm); err == nil {
			g.RemixOf = rm
		}
	}
	if err := s.Store.InsertGame(r.Context(), g); err != nil {
		s.serverErr(w, r, err)
		return
	}
	v, _ := s.views(r, []model.Game{*g})
	writeJSON(w, 201, v[0])
}

func normTags(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if tagRE.MatchString(t) && !seen[t] && len(out) < 8 {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

func (s *Server) listCreations(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	s.listPage(w, r, func(limit int, c store.Cursor) ([]model.Game, error) {
		return s.Store.GamesByOwner(r.Context(), u.ID, limit, c)
	})
}

func (s *Server) ownedOr404(w http.ResponseWriter, r *http.Request) (*model.Game, bool) {
	g, ok := s.gameOr404(w, r)
	if !ok {
		return nil, false
	}
	if g.OwnerID != userFrom(r).ID {
		writeErr(w, 404, "game not found") // do not reveal other people's creations
		return nil, false
	}
	return g, true
}

func (s *Server) getCreation(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	v, err := s.views(r, []model.Game{*g})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"game": v[0], "hasSource": g.HasSource})
}

// creationSource returns the private editable source as a zip, for remix generation. It is
// owner-only and is never reachable on the public games hostname.
func (s *Server) creationSource(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	if !g.HasSource {
		writeErr(w, 404, "this creation has no editable source")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+g.ID+`-source.zip"`)
	if err := s.Packages.WriteSourceZip(r.Context(), g.ID, w); err != nil {
		s.Log.Error("source zip", "id", g.ID, "err", err)
	}
}
