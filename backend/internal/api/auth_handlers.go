package api

import (
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

var usernameRE = regexp.MustCompile(`^[a-z0-9_]{3,24}$`)

type tokenResponse struct {
	AccessToken  string      `json:"accessToken"`
	ExpiresAt    time.Time   `json:"expiresAt"`
	RefreshToken string      `json:"refreshToken"`
	User         *model.User `json:"user"`
}

func (s *Server) issue(w http.ResponseWriter, r *http.Request, u *model.User, code int) {
	access, exp := s.Signer.Issue(u.ID)
	refresh, hash := auth.NewRefreshToken()
	err := s.Store.PutRefresh(r.Context(), model.RefreshToken{
		Hash: hash, UserID: u.ID, ExpiresAt: time.Now().Add(s.RefreshTTL).UTC(),
	})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	out := *u
	out.Email = u.Email
	writeJSON(w, code, tokenResponse{AccessToken: access, ExpiresAt: exp, RefreshToken: refresh, User: &out})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email       string `json:"email"`
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Password    string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	username := strings.ToLower(strings.TrimSpace(in.Username))
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || len(email) > 254 {
		writeErr(w, 400, "a valid email is required")
		return
	}
	if !usernameRE.MatchString(username) {
		writeErr(w, 400, "username must be 3-24 characters: letters, digits or underscore")
		return
	}
	if len(in.Password) < 8 || len(in.Password) > 72 {
		writeErr(w, 400, "password must be 8-72 characters")
		return
	}
	display := strings.TrimSpace(in.DisplayName)
	if display == "" {
		display = username
	}
	if len([]rune(display)) > 60 {
		writeErr(w, 400, "displayName is too long")
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	u := &model.User{
		ID: auth.NewID(12), Email: email, Username: username, DisplayName: display,
		PasswordHash: hash, CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
	if err := s.Store.CreateUser(r.Context(), u); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, 409, "email or username is already taken")
			return
		}
		s.serverErr(w, r, err)
		return
	}
	s.issue(w, r, u, 201)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	if !decode(w, r, &in) {
		return
	}
	// The "email" field also takes a username (with or without a leading @).
	id := strings.ToLower(strings.TrimSpace(in.Email))
	var u *model.User
	var err error
	if strings.Contains(id, "@") && !strings.HasPrefix(id, "@") {
		u, err = s.Store.UserByEmail(r.Context(), id)
	} else {
		u, err = s.Store.UserByUsername(r.Context(), strings.TrimPrefix(id, "@"))
	}
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 401, "wrong email or password")
			return
		}
		s.serverErr(w, r, err)
		return
	}
	if u.PasswordHash == "" || !auth.CheckPassword(u.PasswordHash, in.Password) { // demo people have no password
		writeErr(w, 401, "wrong email or password")
		return
	}
	s.issue(w, r, u, 200)
}

// refresh rotates the refresh token: the old one is consumed and a new pair is returned.
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := s.Store.TakeRefresh(r.Context(), auth.HashToken(in.RefreshToken))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 401, "invalid or expired refresh token")
			return
		}
		s.serverErr(w, r, err)
		return
	}
	u, err := s.Store.UserByID(r.Context(), t.UserID)
	if err != nil {
		writeErr(w, 401, "invalid or expired refresh token")
		return
	}
	s.issue(w, r, u, 200)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken   string `json:"refreshToken"`
		InstallationID string `json:"installationId"` // optional: this installation stops getting pushes for the account
	}
	if decode(w, r, &in) && in.RefreshToken != "" {
		// Taking the token (it is single use) says whose session this is, so only their device can be revoked.
		if t, err := s.Store.TakeRefresh(r.Context(), auth.HashToken(in.RefreshToken)); err == nil && t != nil && in.InstallationID != "" {
			_ = s.Store.DeletePushDevice(r.Context(), in.InstallationID, t.UserID)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, userFrom(r))
}

// changePassword sets a new password for the signed-in person after checking the current one.
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct{ CurrentPassword, NewPassword string }
	if !decode(w, r, &in) {
		return
	}
	if len(in.NewPassword) < 8 || len(in.NewPassword) > 72 {
		writeErr(w, 400, "password must be 8-72 characters")
		return
	}
	u, err := s.Store.UserByID(r.Context(), userFrom(r).ID)
	if err != nil || u.PasswordHash == "" || !auth.CheckPassword(u.PasswordHash, in.CurrentPassword) {
		writeErr(w, 401, "wrong password")
		return
	}
	hash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if err := s.Store.SetPasswordHash(r.Context(), u.ID, hash); err != nil {
		s.serverErr(w, r, err)
		return
	}
	w.WriteHeader(204)
}
