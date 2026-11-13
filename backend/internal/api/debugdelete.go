package api

import "net/http"

// DELETE /v1/debug/games/{id}: delete a game with no sign-in, for the debug viewer at /play/ (and curl). It is OFF unless the
// server runs with DEBUG_DELETE=1 (api.env, then restart the api); when off it answers 403. While it is on, anyone who can
// reach the API can delete any game, so turn it on only while debugging and off again afterwards.
//
// It removes the game's record with its saves and scores (the same as DELETE /v1/creations/{id}); the files stay on the games host.
func (s *Server) debugDeleteGame(w http.ResponseWriter, r *http.Request) {
	if !s.DebugDelete {
		writeErr(w, 403, "debug delete is off on this server")
		return
	}
	g, ok := s.gameOr404(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteGame(r.Context(), g.ID); err != nil {
		s.serverErr(w, r, err)
		return
	}
	s.deleteGameMedia(g.OwnerID, g.ID)
	s.Log.Warn("debug delete: a game was deleted without sign-in", "game", g.ID, "title", g.Title, "owner", g.OwnerUsername)
	w.WriteHeader(http.StatusNoContent)
}
