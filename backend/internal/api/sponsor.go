package api

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Sponsored games: a brand's playable game shown in the feed like an ad. The server decides what is sponsored; the app only
// draws a card for a feed item that carries a `sponsor`. No `sponsor` means not sponsored.
//
//	sponsor: {name, avatarUrl?, cta, url?}      on every game and feed item (cta defaults to "Play now")
//	PUT    /v1/games/{id}/sponsor {name, avatarUrl?, cta?, url?}   mark a game sponsored (its owner, and only a brand account)
//	DELETE /v1/games/{id}/sponsor                                   take it off (its owner)
//	POST   /v1/generate {..., sponsor: {...}}                       make a game that is sponsored from the start
//
// Brand accounts are the usernames in SPONSOR_USERS (comma separated); nobody else can sponsor a game, so a person can't
// pass their own game off as an ad. Tapping a sponsored card is a feed moment event: {kind: "sponsor_tap", gameID}.
// Real brand names are allowed (CLAUDE.md, Karthik's decision): the server doesn't check names, only who may set a sponsor.

const defaultSponsorCTA = "Play now"

type sponsorIn struct {
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	CTA       string `json:"cta"`
	URL       string `json:"url"`
}

func (s *Server) isBrand(u *model.User) bool {
	return u != nil && s.SponsorUsers[strings.ToLower(u.Username)]
}

func webURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", true
	}
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 500 || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", false
	}
	return raw, true
}

// sponsorFrom checks a sponsor block. It returns the clean block, or a message for a 400.
func sponsorFrom(in *sponsorIn) (*model.Sponsor, string) {
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 60 {
		return nil, "a sponsor needs a name of at most 60 characters"
	}
	cta := strings.TrimSpace(in.CTA)
	if cta == "" {
		cta = defaultSponsorCTA
	}
	if len([]rune(cta)) > 24 {
		return nil, "cta must be at most 24 characters"
	}
	avatar, ok := webURL(in.AvatarURL)
	if !ok {
		return nil, "avatarUrl must be an http or https address"
	}
	link, ok := webURL(in.URL)
	if !ok {
		return nil, "url must be an http or https address"
	}
	return &model.Sponsor{Name: name, AvatarURL: avatar, CTA: cta, URL: link}, ""
}

func (s *Server) setGameSponsor(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	if !s.isBrand(userFrom(r)) {
		writeErr(w, 403, "only a brand account can sponsor a game")
		return
	}
	var in sponsorIn
	if !decode(w, r, &in) {
		return
	}
	sp, msg := sponsorFrom(&in)
	if sp == nil {
		writeErr(w, 400, msg)
		return
	}
	if err := s.Store.SetGameSponsor(r.Context(), g.ID, sp); err != nil {
		s.serverErr(w, r, err)
		return
	}
	g.Sponsor = sp
	s.writeGameView(w, r, g)
}

func (s *Server) clearGameSponsor(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	if err := s.Store.SetGameSponsor(r.Context(), g.ID, nil); err != nil && !errors.Is(err, store.ErrNotFound) {
		s.serverErr(w, r, err)
		return
	}
	g.Sponsor = nil
	s.writeGameView(w, r, g)
}

func (s *Server) writeGameView(w http.ResponseWriter, r *http.Request, g *model.Game) {
	views, err := s.views(r, []model.Game{*g})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, views[0])
}
