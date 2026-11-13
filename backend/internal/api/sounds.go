package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Sounds: loops that play behind games in the feed, like TikTok sounds. A sound is a published package (a zip with a
// manifest.json, an audio file and an optional cover), kept on the games host next to games.
//
//	GET    /v1/sounds?tab=trending|for_you|saved|recent&q=&limit=   find sounds (saved needs sign-in)
//	GET    /v1/sounds/{id}                                         one sound
//	GET    /v1/sounds/{id}/games?sort=top|recent                    the games that use it
//	PUT    /v1/sounds/{id}/save, DELETE /v1/sounds/{id}/save        save or unsave (idempotent)
//	POST   /v1/sounds                                              upload a sound package (application/zip)
//	PUT    /v1/games/{id}/sound {soundId, offsetMs?, mix?}          put a sound behind a game (its owner)
//	DELETE /v1/games/{id}/sound                                     take it off
//
// POST /v1/generate also takes soundId, offsetMs and mix; a change to a game keeps the original's sound unless it names
// another. The sound is presentation only: it never changes a replay or a score check.
//
// manifest.json of a sound package: {"title": "...", "audio": "loop.m4a", "cover": "cover.png"?, "duration_ms": 30000?,
// "bpm": 120?, "kind": "library" | "original"?}. Only audio, image and json files are allowed in a package.
// "for_you" ranks like "trending" for now; a personal ranking needs the recommender to learn sound affinity first.

const (
	maxSoundList    = 50
	defaultSoundMix = 0.7
)

var (
	audioFileRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.(m4a|mp3|ogg|wav)$`)
	coverFileRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.(png|jpg|jpeg|webp)$`)
)

func (s *Server) soundViews(r *http.Request, list []model.Sound) ([]model.SoundView, error) {
	var saved map[string]bool
	if u := userFrom(r); u != nil && len(list) > 0 {
		ids := make([]string, len(list))
		for i, x := range list {
			ids[i] = x.ID
		}
		var err error
		if saved, err = s.Store.SoundsSavedSet(r.Context(), u.ID, ids); err != nil {
			return nil, err
		}
	}
	out := make([]model.SoundView, len(list))
	for i, x := range list {
		base := s.GamesBaseURL + "/" + x.StorageKey + "/"
		v := model.SoundView{
			ID: x.ID, Title: x.Title, Creator: x.OwnerUsername, CreatorID: x.OwnerID, Kind: x.Kind, DurationMs: x.DurationMs, BPM: x.BPM,
			AudioURL: base + x.AudioPath, UseCount: x.UseCount, Saves: x.Saves, SavedByMe: saved[x.ID], CreatedAt: x.CreatedAt,
		}
		if x.CoverPath != "" {
			v.CoverURL = base + x.CoverPath
		}
		out[i] = v
	}
	return out, nil
}

func (s *Server) soundOr404(w http.ResponseWriter, r *http.Request) (*model.Sound, bool) {
	sd, err := s.Store.SoundByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "sound not found")
		} else {
			s.serverErr(w, r, err)
		}
		return nil, false
	}
	return sd, true
}

func (s *Server) listSounds(w http.ResponseWriter, r *http.Request) {
	tab := r.URL.Query().Get("tab")
	q := store.SoundQuery{Order: "trending", Q: strings.TrimSpace(r.URL.Query().Get("q")), Limit: limitParam(r, 20, maxSoundList)}
	switch tab {
	case "", "trending", "for_you":
	case "recent":
		q.Order = "recent"
	case "saved":
		u := userFrom(r)
		if u == nil {
			writeErr(w, 401, "sign in to see your saved sounds")
			return
		}
		q.SavedBy = u.ID
	default:
		writeErr(w, 400, "tab must be trending, for_you, saved or recent")
		return
	}
	if len([]rune(q.Q)) > 40 {
		writeErr(w, 400, "q is too long")
		return
	}
	list, err := s.Store.FindSounds(r.Context(), q)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items, err := s.soundViews(r, list)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) getSound(w http.ResponseWriter, r *http.Request) {
	sd, ok := s.soundOr404(w, r)
	if !ok {
		return
	}
	v, err := s.soundViews(r, []model.Sound{*sd})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v[0])
}

func (s *Server) soundGames(w http.ResponseWriter, r *http.Request) {
	sd, ok := s.soundOr404(w, r)
	if !ok {
		return
	}
	order := "recent"
	switch r.URL.Query().Get("sort") {
	case "", "top":
		order = "top"
	case "recent":
	default:
		writeErr(w, 400, "sort must be top or recent")
		return
	}
	games, err := s.Store.GamesBySound(r.Context(), sd.ID, order, limitParam(r, 30, 100))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items, err := s.views(r, games)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": sd.UseCount})
}

func (s *Server) saveSound(saved bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sd, ok := s.soundOr404(w, r)
		if !ok {
			return
		}
		n, err := s.Store.SetSoundSaved(r.Context(), sd.ID, userFrom(r).ID, saved)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"saves": n, "savedByMe": saved})
	}
}

// createSound publishes a sound package and records the sound.
func (s *Server) createSound(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/zip") {
		writeErr(w, 415, "send the sound package as application/zip")
		return
	}
	u := userFrom(r)
	r.Body = http.MaxBytesReader(w, r.Body, s.MaxUploadMB<<20+1)
	id := auth.NewID(12)
	var m struct {
		Title      string `json:"title"`
		Audio      string `json:"audio"`
		Cover      string `json:"cover"`
		DurationMs int64  `json:"duration_ms"`
		BPM        int    `json:"bpm"`
		Kind       string `json:"kind"`
	}
	_, err := s.Packages.Publish(r.Context(), id, r.Body, func(p *pkgstore.Package) error {
		if json.Unmarshal(p.Manifest, &m) != nil {
			return errors.New("manifest.json has the wrong shape")
		}
		m.Title = strings.TrimSpace(m.Title)
		switch {
		case m.Title == "" || len([]rune(m.Title)) > 80:
			return errors.New("a sound needs a title of at most 80 characters")
		case !audioFileRE.MatchString(m.Audio):
			return errors.New("audio must name an m4a, mp3, ogg or wav file in the package")
		case m.Cover != "" && !coverFileRE.MatchString(m.Cover):
			return errors.New("cover must name a png, jpg or webp file in the package")
		case m.DurationMs < 0 || m.DurationMs > 10*60*1000:
			return errors.New("duration_ms must be between 0 and 10 minutes")
		case m.BPM < 0 || m.BPM > 400:
			return errors.New("bpm must be between 0 and 400")
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
	kind := "original"
	if m.Kind == "library" {
		kind = "library"
	}
	sd := &model.Sound{
		ID: id, Title: m.Title, OwnerID: u.ID, OwnerUsername: u.Username, Kind: kind, DurationMs: m.DurationMs, BPM: m.BPM,
		StorageKey: id, AudioPath: m.Audio, CoverPath: m.Cover, CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
	if err := s.Store.InsertSound(r.Context(), sd); err != nil {
		s.serverErr(w, r, err)
		return
	}
	v, err := s.soundViews(r, []model.Sound{*sd})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, v[0])
}

// attachSound puts a sound behind a game (or replaces the one it has) and keeps the use counts right.
func (s *Server) attachSound(ctx context.Context, g *model.Game, soundID string, offsetMs int64, mix float64) error {
	if _, err := s.Store.SoundByID(ctx, soundID); err != nil {
		return err
	}
	gs := &model.GameSound{ID: soundID, OffsetMs: min(max(offsetMs, 0), 10*60*1000), Mix: min(max(mix, 0), 1)}
	if err := s.Store.SetGameSound(ctx, g.ID, gs); err != nil {
		return err
	}
	if g.Sound == nil || g.Sound.ID != soundID {
		_ = s.Store.AddSoundUse(ctx, soundID, 1)
		if g.Sound != nil {
			_ = s.Store.AddSoundUse(ctx, g.Sound.ID, -1)
		}
	}
	g.Sound = gs
	return nil
}

func (s *Server) setGameSound(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	var in struct {
		SoundID  string   `json:"soundId"`
		OffsetMs *int64   `json:"offsetMs"`
		Mix      *float64 `json:"mix"`
	}
	if !decode(w, r, &in) {
		return
	}
	offset, mix := int64(0), defaultSoundMix
	if g.Sound != nil && g.Sound.ID == in.SoundID { // changing only the trim or the mix keeps what is already set
		offset, mix = g.Sound.OffsetMs, g.Sound.Mix
	}
	if in.OffsetMs != nil {
		offset = *in.OffsetMs
	}
	if in.Mix != nil {
		mix = *in.Mix
	}
	if err := s.attachSound(r.Context(), g, in.SoundID, offset, mix); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "sound not found")
		} else {
			s.serverErr(w, r, err)
		}
		return
	}
	views, err := s.views(r, []model.Game{*g})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, views[0])
}

func (s *Server) clearGameSound(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	if g.Sound != nil {
		if err := s.Store.SetGameSound(r.Context(), g.ID, nil); err != nil {
			s.serverErr(w, r, err)
			return
		}
		_ = s.Store.AddSoundUse(r.Context(), g.Sound.ID, -1)
		g.Sound = nil
	}
	views, err := s.views(r, []model.Game{*g})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, views[0])
}

// attachSoundViews fills in the sound on each game view (one lookup for the page).
func (s *Server) attachSoundViews(ctx context.Context, games []model.Game, out []model.GameView) {
	var ids []string
	for _, g := range games {
		if g.Sound != nil {
			ids = append(ids, g.Sound.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	sounds, err := s.Store.SoundsByIDs(ctx, ids)
	if err != nil {
		return // a game still plays without its sound
	}
	byID := map[string]model.Sound{}
	for _, sd := range sounds {
		byID[sd.ID] = sd
	}
	for i, g := range games {
		sd, ok := byID[func() string {
			if g.Sound != nil {
				return g.Sound.ID
			}
			return ""
		}()]
		if !ok {
			continue
		}
		base := s.GamesBaseURL + "/" + sd.StorageKey + "/"
		v := &model.GameSoundView{ID: sd.ID, Title: sd.Title, Creator: sd.OwnerUsername, AudioURL: base + sd.AudioPath, OffsetMs: g.Sound.OffsetMs, Mix: g.Sound.Mix}
		if sd.CoverPath != "" {
			v.CoverURL = base + sd.CoverPath
		}
		out[i].Sound = v
	}
}
