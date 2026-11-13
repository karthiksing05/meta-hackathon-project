package api

import (
	"net/http"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// Drafts and deleting. A change made through /v1/generate is a draft (unlisted) until its owner publishes it.
//
//	POST   /v1/creations/{id}/publish   put the game in the feed, search and its Group's list
//	DELETE /v1/creations/{id}           remove the game, its saves and its scores (owner only)
//
// The game's files stay in storage; only the record goes, so the game can no longer be found or opened through the API.

func (s *Server) publishCreation(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	if err := s.Store.SetGameUnlisted(r.Context(), g.ID, false); err != nil {
		s.serverErr(w, r, err)
		return
	}
	g.Unlisted = false
	views, err := s.views(r, []model.Game{*g})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, views[0])
}

func (s *Server) deleteCreation(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownedOr404(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteGame(r.Context(), g.ID); err != nil {
		s.serverErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
