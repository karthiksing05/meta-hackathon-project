package api

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// How people get into a Group (model.Group.JoinPolicy), and the profile fields people set themselves.
//
//	open     PUT /members/me joins.
//	request  PUT /members/me asks (202, "requested"); the owner sees GET /requests and approves with PUT /members/{uid}.
//	invite   PUT /members/me is refused (403, code "invite_only"); a member adds people with PUT /members/{uid}.
//
// In open and invite Groups any member can add someone; in request Groups only the owner can. Recruiting is a flag
// the owner sets to say the Group wants new members. PATCH /v1/groups/{id} changes the settings (owner only).

var colorRE = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func validColor(c string) bool { return c == "" || colorRE.MatchString(c) }

func validJoinPolicy(p string) bool {
	return p == "" || p == model.JoinOpen || p == model.JoinRequest || p == model.JoinInvite
}

func (s *Server) addJoinRequest(ctx context.Context, groupID, userID string) error {
	g, err := s.Store.GroupByID(ctx, groupID)
	if err != nil {
		return err
	}
	if fbHas(g.Requests, userID) {
		return nil
	}
	if len(g.Requests) >= 500 {
		g.Requests = g.Requests[1:] // the oldest ask drops off; a Group this busy should be open
	}
	g.Requests = append(g.Requests, userID)
	return s.Store.UpsertGroup(ctx, g)
}

func (s *Server) dropJoinRequest(ctx context.Context, groupID, userID string) error {
	g, err := s.Store.GroupByID(ctx, groupID)
	if err != nil {
		return err
	}
	if !fbHas(g.Requests, userID) {
		return nil
	}
	kept := make([]string, 0, len(g.Requests))
	for _, id := range g.Requests {
		if id != userID {
			kept = append(kept, id)
		}
	}
	g.Requests = kept
	return s.Store.UpsertGroup(ctx, g)
}

// PUT /v1/groups/{id}/members/{uid}: a member adds someone (an invite, which joins them right away), or the owner of
// a request Group approves an ask.
func (s *Server) addGroupMember(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	me, uid := userFrom(r), chi.URLParam(r, "uid")
	if !s.isMember(r.Context(), g.ID, me.ID) {
		writeErr(w, 403, "only members can add people")
		return
	}
	if model.JoinPolicyOf(*g) == model.JoinRequest && g.OwnerID != me.ID {
		writeErr(w, 403, "in this group the owner approves new members")
		return
	}
	if _, err := s.Store.UserByID(r.Context(), uid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "person not found")
		} else {
			s.serverErr(w, r, err)
		}
		return
	}
	if !s.isMember(r.Context(), g.ID, uid) {
		if err := s.Store.AddGroupMember(r.Context(), model.GroupMember{GroupID: g.ID, UserID: uid, JoinedAt: time.Now().UTC().Truncate(time.Millisecond)}); err != nil {
			s.serverErr(w, r, err)
			return
		}
	}
	if err := s.dropJoinRequest(r.Context(), g.ID, uid); err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"groupID": g.ID, "userID": uid, "isMember": true})
}

// GET /v1/groups/{id}/requests: the people asking to join, oldest first (owner only).
func (s *Server) groupRequests(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	me := userFrom(r)
	if g.OwnerID != me.ID {
		writeErr(w, 403, "only the owner sees join requests")
		return
	}
	users, err := s.Store.UsersByIDs(r.Context(), g.Requests)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	byID := map[string]model.User{}
	for _, u := range users {
		byID[u.ID] = u
	}
	friends, _ := s.friendSet(r.Context(), me.ID)
	items := []profile{}
	for _, id := range g.Requests {
		if u, ok := byID[id]; ok {
			items = append(items, profileOf(u, friends))
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

// PATCH /v1/groups/{id} {name?, about?, category?, coverSeed?, coverColor?, joinPolicy?, recruiting?, private?}:
// the owner changes the Group's settings. Returns the Group.
func (s *Server) updateGroup(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	me := userFrom(r)
	if g.OwnerID != me.ID {
		writeErr(w, 403, "only the owner can change the group")
		return
	}
	var in struct {
		Name, About, Category, CoverSeed, CoverColor, JoinPolicy *string
		Recruiting, Private                                      *bool
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if l := len([]rune(n)); l < 2 || l > 80 {
			writeErr(w, 400, "a group needs a name of 2 to 80 characters")
			return
		}
		g.Name = n
	}
	set := func(dst *string, v *string, max int) bool {
		if v == nil {
			return true
		}
		if len(*v) > max {
			return false
		}
		*dst = *v
		return true
	}
	if !set(&g.About, in.About, 500) || !set(&g.Category, in.Category, 40) || !set(&g.CoverSeed, in.CoverSeed, 60) {
		writeErr(w, 400, "about, category or coverSeed is too long")
		return
	}
	if in.CoverColor != nil {
		if !validColor(*in.CoverColor) {
			writeErr(w, 400, `coverColor must be "#RRGGBB"`)
			return
		}
		g.CoverColor = *in.CoverColor
	}
	if in.JoinPolicy != nil {
		if !validJoinPolicy(*in.JoinPolicy) {
			writeErr(w, 400, `joinPolicy must be "open", "request" or "invite"`)
			return
		}
		g.JoinPolicy = *in.JoinPolicy
	}
	if in.Recruiting != nil {
		g.Recruiting = *in.Recruiting
	}
	if in.Private != nil {
		g.Private = *in.Private
	}
	if err := s.Store.UpsertGroup(r.Context(), g); err != nil {
		s.serverErr(w, r, err)
		return
	}
	views, err := s.groupViews(r.Context(), []model.Group{*g}, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, views[0])
}

// PATCH /v1/me/profile {displayName?, bio?, avatarUrl?, coverColor?}: my profile. avatarUrl is an https picture
// ("" goes back to the app's cartoon). Returns me.
func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName, Bio, AvatarURL, CoverColor *string
	}
	if !decode(w, r, &in) {
		return
	}
	u := *userFrom(r)
	if in.DisplayName != nil {
		n := strings.TrimSpace(*in.DisplayName)
		if l := len([]rune(n)); l < 1 || l > 60 {
			writeErr(w, 400, "displayName must be 1 to 60 characters")
			return
		}
		u.DisplayName = n
	}
	if in.Bio != nil {
		b := strings.TrimSpace(*in.Bio)
		if len([]rune(b)) > 300 {
			writeErr(w, 400, "bio must be at most 300 characters")
			return
		}
		u.Bio = b
	}
	if in.AvatarURL != nil {
		if *in.AvatarURL != "" && !validPhotoURL(*in.AvatarURL) {
			writeErr(w, 400, "avatarUrl must be an https URL")
			return
		}
		u.AvatarURL = *in.AvatarURL
	}
	if in.CoverColor != nil {
		if !validColor(*in.CoverColor) {
			writeErr(w, 400, `coverColor must be "#RRGGBB"`)
			return
		}
		u.CoverColor = *in.CoverColor
	}
	if err := s.Store.UpdateUserProfile(r.Context(), &u); err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, u)
}
