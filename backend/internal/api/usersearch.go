package api

import (
	"net/http"
	"strings"
)

// GET /v1/users?q=ann&limit=20: find people to add as friends. Matches the start of a username or of any
// word in a display name, case-insensitive. Needs sign-in, leaves out the caller, and never returns email.
func (s *Server) searchUsers(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r)
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if n := len([]rune(q)); n < 2 || n > 40 {
		writeErr(w, 400, "q must be 2 to 40 characters")
		return
	}
	limit := limitParam(r, 20, 50)
	// ask for a little extra: the caller is dropped from the list
	found, err := s.Store.SearchUsers(r.Context(), q, limit+1)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	friends, err := s.friendSet(r.Context(), me.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := make([]profile, 0, len(found))
	for _, u := range found {
		if u.ID == me.ID || len(items) >= limit {
			continue
		}
		items = append(items, profileOf(u, friends))
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
