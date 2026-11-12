// Package api is the HTTP layer: routing, middleware and handlers for the public JSON API.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

type Options struct {
	Store        store.Store
	Packages     pkgstore.PackageStore
	Signer       *auth.Signer
	RefreshTTL   time.Duration
	GamesBaseURL string
	CORSOrigins  []string
	MaxUploadMB  int64
	Log          *slog.Logger
}

type Server struct {
	Options
	authLimiter *limiter
}

func New(o Options) *Server {
	if o.Log == nil {
		o.Log = slog.Default()
	}
	return &Server{Options: o, authLimiter: newLimiter(10, time.Minute)}
}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, clientIP, middleware.Recoverer, s.securityHeaders, s.cors)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/readyz", s.ready)

	r.Route("/v1", func(r chi.Router) {
		r.Route("/auth", func(r chi.Router) {
			r.With(s.rateLimit).Post("/register", s.register)
			r.With(s.rateLimit).Post("/login", s.login)
			r.With(s.rateLimit).Post("/refresh", s.refresh)
			r.Post("/logout", s.logout)
			r.With(s.requireAuth).Get("/me", s.me)
		})
		r.With(s.optionalAuth).Get("/feed", s.feed)
		r.With(s.optionalAuth).Post("/feed/events", s.feedEvents)
		r.With(s.optionalAuth).Get("/search", s.search)

		// recommender support: shared event log roll-ups
		r.Get("/games/stats", s.gameStats)
		r.Get("/experiments/interleave", s.interleave)
		r.With(s.requireAuth).Get("/events/export", s.exportEvents)

		r.Route("/games/{id}", func(r chi.Router) {
			r.With(s.optionalAuth).Get("/", s.getGame)
			r.With(s.requireAuth).Put("/like", s.like(true))
			r.With(s.requireAuth).Delete("/like", s.like(false))
			r.Get("/leaderboard", s.leaderboard)
			r.With(s.requireAuth).Post("/scores", s.submitScore)
		})

		r.Route("/creations", func(r chi.Router) {
			r.Use(s.requireAuth)
			r.Get("/", s.listCreations)
			r.Post("/", s.createCreation)
			r.Get("/{id}", s.getCreation)
			r.Get("/{id}/source", s.creationSource)
		})
	})
	return r
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	checks := map[string]string{"database": "ok", "storage": "ok"}
	code := 200
	if err := s.Store.Ping(ctx); err != nil {
		checks["database"], code = "unavailable", 503
		s.Log.Warn("readyz: database", "err", err)
	}
	if err := s.Packages.Ready(ctx); err != nil {
		checks["storage"], code = "unavailable", 503
		s.Log.Warn("readyz: storage", "err", err)
	}
	writeJSON(w, code, checks)
}

// ---- JSON helpers ----

type apiError struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, apiError{Error: msg, Code: http.StatusText(code)})
}

func (s *Server) serverErr(w http.ResponseWriter, r *http.Request, err error) {
	s.Log.Error("request failed", "path", r.URL.Path, "err", err, "request_id", middleware.GetReqID(r.Context()))
	writeErr(w, 500, "internal error")
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		writeErr(w, 400, "invalid JSON body")
		return false
	}
	return true
}

// ---- middleware ----

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store") // API responses are never cached by Cloudflare
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range s.CORSOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" && allowed[o] {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", o)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(204)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type ctxKey int

const userKey ctxKey = 1

// clientIP prefers Cloudflare's header. The API is only reachable through the tunnel or the
// private Docker network, so the header cannot be spoofed by an outside client.
func clientIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
			r.RemoteAddr = ip
		}
		next.ServeHTTP(w, r)
	})
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func (s *Server) authenticate(r *http.Request) (*model.User, bool) {
	tok := bearer(r)
	if tok == "" {
		return nil, false
	}
	id, err := s.Signer.Verify(tok)
	if err != nil {
		return nil, false
	}
	u, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		return nil, false
	}
	return u, true
}

func (s *Server) optionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, ok := s.authenticate(r); ok {
			r = r.WithContext(context.WithValue(r.Context(), userKey, u))
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.authenticate(r)
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="bubbles"`)
			writeErr(w, 401, "authentication required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}

func userFrom(r *http.Request) *model.User {
	u, _ := r.Context().Value(userKey).(*model.User)
	return u
}

// ---- rate limiting (per client IP, fixed window) ----

type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]*bucket
}
type bucket struct {
	n     int
	reset time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{max: max, window: window, hits: map[string]*bucket{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if len(l.hits) > 10000 {
		for k, b := range l.hits {
			if now.After(b.reset) {
				delete(l.hits, k)
			}
		}
	}
	b := l.hits[key]
	if b == nil || now.After(b.reset) {
		b = &bucket{reset: now.Add(l.window)}
		l.hits[key] = b
	}
	b.n++
	return b.n <= l.max
}

func (s *Server) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		if !s.authLimiter.allow(host) {
			w.Header().Set("Retry-After", "60")
			writeErr(w, 429, "too many attempts, try again in a minute")
			return
		}
		next.ServeHTTP(w, r)
	})
}

var errBadRequest = errors.New("bad request")
