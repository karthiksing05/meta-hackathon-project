package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
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
			Slug: g.Slug, GroupID: g.GroupID, EventID: g.EventID, Unlisted: g.Unlisted, Score: g.Score.View(), Sponsor: g.Sponsor, GroupPlay: g.GroupPlay,
			PackageURL: base, ManifestURL: base + g.ManifestPath, CreatedAt: g.CreatedAt,
		}
		if g.CoverPath != "" {
			v.CoverURL = base + g.CoverPath
		}
		out[i] = v
	}
	s.attachSoundViews(r.Context(), games, out)
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
	var games []model.Game
	var err error
	next := ""
	personalized := false
	if u := userFrom(r); u != nil && s.recsEnabled() && offset+limit <= searchPool {
		// Signed in: the best text matches are reordered with the person's taste, by Kevin's recommender.
		var pool []model.Game
		if pool, err = s.Store.Search(r.Context(), q, tag, searchPool+1, 0); err != nil {
			s.serverErr(w, r, err)
			return
		}
		more := len(pool) > searchPool
		if more {
			pool = pool[:searchPool]
		}
		pool = s.personalizeSearch(r.Context(), u, q+"|"+tag, pool)
		end := min(offset+limit, len(pool))
		if offset < len(pool) {
			games = pool[offset:end]
		}
		if end < len(pool) || more {
			next = strconv.Itoa(end) // past the reordered pool, pages continue in plain text-match order
		}
		personalized = true
	} else {
		if games, err = s.Store.Search(r.Context(), q, tag, limit+1, offset); err != nil {
			s.serverErr(w, r, err)
			return
		}
		if len(games) > limit {
			games, next = games[:limit], strconv.Itoa(offset+limit)
		}
	}
	items, err := s.views(r, games)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next, "personalized": personalized})
}

func (s *Server) gameOr404(w http.ResponseWriter, r *http.Request) (*model.Game, bool) {
	id := chi.URLParam(r, "id")
	var g *model.Game
	var err error
	switch {
	case pkgstore.ValidID(id):
		g, err = s.Store.GameByID(r.Context(), id)
	case slugRE.MatchString(id): // a game can also be reached by the slug from its manifest
		g, err = s.Store.GameBySlug(r.Context(), id)
	default:
		writeErr(w, 404, "game not found")
		return nil, false
	}
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
	s.writeBoard(w, r, g, nil)
}

func (s *Server) submitScore(w http.ResponseWriter, r *http.Request) {
	g, ok := s.gameOr404(w, r)
	if !ok {
		return
	}
	if g.Score != nil { // a game with a score model only takes replayed runs
		s.submitScored(w, r, g)
		return
	}
	var in struct {
		Score  float64
		Replay json.RawMessage `json:"replay"` // the runtime's replay of the run, for friends to watch (runlogs.go)
	}
	if !decode(w, r, &in) {
		return
	}
	replay, err := parseReplay(in.Replay)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if in.Score != in.Score || in.Score > 1e12 || in.Score < -1e12 { // NaN and absurd values
		writeErr(w, 400, "invalid score")
		return
	}
	if in.Score != math.Trunc(in.Score) {
		writeErr(w, 400, "score must be a whole number")
		return
	}
	u := userFrom(r)
	unlock := s.scoreLocks.lock(g.ID + ":" + u.ID) // whether this run set the best decides whose replay is kept
	defer unlock()
	neu := model.Score{
		GameID: g.ID, UserID: u.ID, Username: u.Username, Score: int64(in.Score),
		UpdatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
	old, oldErr := s.Store.ScoreOf(r.Context(), g.ID, u.ID)
	err = s.watchLeader(r.Context(), g, func() error { return s.Store.SubmitScore(r.Context(), neu) })
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if errors.Is(oldErr, store.ErrNotFound) || (oldErr == nil && neu.Score > old.Score) {
		s.keepRunLog(r.Context(), neu, replay, "")
	}
	s.noteChallengeAccepted(r.Context(), u.ID, g.ID)
	s.leaderboard(w, r)
}

// ---- creations ----

var (
	tagRE  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,23}$`)
	slugRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
)

type manifestMeta struct {
	ID    string `json:"id"` // optional: kept as the game's slug when it is unique
	Chain struct {
		Index int `json:"index"`
	} `json:"chain"`
	Style struct {
		Look string `json:"look"`
	} `json:"style"`
	Structure struct {
		Cadence      string `json:"cadence"`
		Scope        string `json:"scope"` // "group:<id>" or "event:<id>"
		GroupID      string `json:"group_id"`
		GroupIDCamel string `json:"groupID"`
		EventID      string `json:"event_id"`
		EventIDCamel string `json:"eventID"`
	} `json:"structure"`
	Title   string   `json:"title"`
	Rule    string   `json:"one_line_rule"`
	Formula string   `json:"formula"`
	Tags    []string `json:"tags"`
	Brief   struct {
		Mood        []string `json:"mood"`
		Energy      string   `json:"energy"`
		Competition string   `json:"competition"`
	} `json:"brief"`
	Lineage struct {
		RemixOf string `json:"remix_of"`
	} `json:"lineage"`
	Bots      json.RawMessage    `json:"bots"`  // playtest runs an uploaded game brings; generated games send theirs separately
	Score     *manifestScore     `json:"score"` // what the board ranks and how (scoring.go)
	GroupPlay *manifestGroupPlay `json:"group_play"`
}

// publishError is a failed publish: Status and Msg are safe to show; Err (when set) is an internal failure.
type publishError struct {
	Status int
	Msg    string
	Err    error
}

// publishPackage unpacks and validates a game package (a zip with manifest.json), stores it under a
// new server-generated id and records the game. Uploads and generated games both go through it.
func (s *Server) publishPackage(ctx context.Context, u *model.User, body io.Reader, bots []model.BotRun) (*model.Game, *publishError) {
	return s.publish(ctx, u, body, bots, nil)
}

// publish is publishPackage, or with replace set, a new build of that game: the package goes under a fresh storage key
// and the game keeps its id, owner, likes, plays, scores, sound and sponsor (the store swaps only what the package holds).
func (s *Server) publish(ctx context.Context, u *model.User, body io.Reader, bots []model.BotRun, replace *model.Game) (*model.Game, *publishError) {
	id := auth.NewID(12) // server-generated; clients never choose ids or paths
	var m manifestMeta
	pkg, err := s.Packages.Publish(ctx, id, body, func(p *pkgstore.Package) error {
		if json.Unmarshal(p.Manifest, &m) != nil {
			return errors.New("manifest.json has the wrong shape")
		}
		t, d := strings.TrimSpace(m.Title), strings.TrimSpace(m.Rule)
		if t == "" || len([]rune(t)) > 80 || len([]rune(d)) > 300 {
			return errors.New("manifest needs a title (max 80 characters) and a one_line_rule (max 300)")
		}
		if slug := strings.ToLower(strings.TrimSpace(m.ID)); slugRE.MatchString(slug) {
			if ex, err := s.Store.GameBySlug(ctx, slug); err == nil && (replace == nil || ex.ID != replace.ID) {
				return errors.New("a game with this manifest id already exists; use a different id")
			}
		}
		return nil
	})
	if err != nil {
		var inv *pkgstore.InvalidError
		var tooBig *http.MaxBytesError
		switch {
		case errors.As(err, &inv):
			return nil, &publishError{Status: 422, Msg: inv.Msg}
		case errors.As(err, &tooBig):
			return nil, &publishError{Status: 413, Msg: "upload too large"}
		default:
			return nil, &publishError{Status: 500, Msg: "internal error", Err: err}
		}
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
	if slug := strings.ToLower(strings.TrimSpace(m.ID)); slugRE.MatchString(slug) {
		g.Slug = slug
	}
	g.GroupID, g.EventID = scopeIDs(&m)
	if m.Chain.Index > 1 && m.Chain.Index < 1000 {
		g.Level = m.Chain.Index
	}
	if len(bots) == 0 {
		var mb []model.BotRun
		if json.Unmarshal(m.Bots, &mb) == nil { // an unreadable block is ignored, never a reason to refuse the game
			bots = cleanBots(mb)
		}
	}
	g.Score = scoreModelFrom(m.Score)
	g.GroupPlay = groupPlayFrom(m.GroupPlay)
	g.Mood, g.Energy, g.Competition = normTags(m.Brief.Mood), strings.ToLower(strings.TrimSpace(m.Brief.Energy)), strings.ToLower(strings.TrimSpace(m.Brief.Competition))
	g.Look, g.IsDaily, g.Bots = strings.ToLower(strings.TrimSpace(m.Style.Look)), strings.EqualFold(m.Structure.Cadence, "daily"), bots
	switch {
	case strings.HasPrefix(m.Structure.Scope, "group"):
		g.Scope = "group"
	case strings.HasPrefix(m.Structure.Scope, "event"):
		g.Scope = "event"
	default:
		g.Scope = "everyone"
	}
	if rm := m.Lineage.RemixOf; rm != "" {
		if orig, err := s.Store.GameByID(ctx, rm); err == nil {
			g.RemixOf = orig.ID
		} else if orig, err := s.Store.GameBySlug(ctx, rm); err == nil {
			g.RemixOf = orig.ID
		}
	}
	if replace != nil {
		g.ID, g.OwnerID, g.OwnerUsername, g.CreatedAt = replace.ID, replace.OwnerID, replace.OwnerUsername, replace.CreatedAt
		if g.RemixOf == "" {
			g.RemixOf = replace.RemixOf
		}
		if len(g.Bots) == 0 {
			g.Bots = replace.Bots // keep the playtest runs when the new build brings none
		}
		if err := s.Store.ReplaceGameContent(ctx, g); err != nil {
			return nil, &publishError{Status: 500, Msg: "internal error", Err: err}
		}
		fresh, err := s.Store.GameByID(ctx, g.ID)
		if err != nil {
			return nil, &publishError{Status: 500, Msg: "internal error", Err: err}
		}
		return fresh, nil
	}
	if err := s.Store.InsertGame(ctx, g); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return nil, &publishError{Status: 409, Msg: "a game with this id already exists"}
		}
		return nil, &publishError{Status: 500, Msg: "internal error", Err: err}
	}
	return g, nil
}

func (s *Server) createCreation(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/zip") {
		writeErr(w, 415, "send the game package as application/zip")
		return
	}
	u := userFrom(r)
	r.Body = http.MaxBytesReader(w, r.Body, s.MaxUploadMB<<20+1)
	g, perr := s.publishPackage(r.Context(), u, r.Body, nil)
	if perr != nil {
		if perr.Err != nil {
			s.serverErr(w, r, perr.Err)
		} else {
			writeErr(w, perr.Status, perr.Msg)
		}
		return
	}
	v, _ := s.views(r, []model.Game{*g})
	writeJSON(w, 201, v[0])
}

// PUT /v1/creations/{id} (application/zip): a new build of one of your games. It keeps the game's id, likes, plays, scores,
// sound and sponsor; the title, rule, tags, score model, group_play and files come from the new package. Send the same
// score model, or the existing board is ranked by the new one. The old files stay on the games host, unlinked.
func (s *Server) replaceCreation(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/zip") {
		writeErr(w, 415, "send the game package as application/zip")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.MaxUploadMB<<20+1)
	unlock := s.seriesLocks.lock("replace:" + g.ID) // two replacements of one game don't interleave
	defer unlock()
	ng, perr := s.publish(r.Context(), userFrom(r), r.Body, nil, g)
	if perr != nil {
		if perr.Err != nil {
			s.serverErr(w, r, perr.Err)
		} else {
			writeErr(w, perr.Status, perr.Msg)
		}
		return
	}
	v, _ := s.views(r, []model.Game{*ng})
	writeJSON(w, 200, v[0])
}

// scopeIDs reads the Group and Event a game belongs to from the manifest's structure block.
func scopeIDs(m *manifestMeta) (group, event string) {
	st := m.Structure
	group = firstNonEmpty(st.GroupID, st.GroupIDCamel)
	event = firstNonEmpty(st.EventID, st.EventIDCamel)
	if kind, id, ok := strings.Cut(st.Scope, ":"); ok {
		if kind == "group" && group == "" {
			group = id
		}
		if kind == "event" && event == "" {
			event = id
		}
	}
	return clip(group), clip(event)
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func clip(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 64 {
		return ""
	}
	return s
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
