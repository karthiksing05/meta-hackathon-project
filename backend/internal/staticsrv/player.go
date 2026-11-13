package staticsrv

import (
	_ "embed"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// A small web player for testing, served at /play/ on the games host. It is the app's own game runtime plus
// one page that loads a game's manifest from this host and boots it, so a game looks and plays in a browser as
// it does in the app. The runtime files are not copied into the backend: they are read from
// FacebookClone/Bubbles/Runtime/web (the Docker image copies that folder to /app/player/runtime and sets
// PLAYER_RUNTIME_DIR). Open /play/?game=<24-character id or slug>, or /play/ for a list.

//go:embed player/index.html
var playerPage []byte

// Option configures the handler.
type Option func(*handler)

// WithPlayerRuntime serves the app's runtime files (bubble-runtime.js, the kits, the engine bundle and the
// stylesheet) from dir at /play/runtime/. Without it the player page loads but has no runtime.
func WithPlayerRuntime(dir string) Option {
	return func(h *handler) {
		if root, err := os.OpenRoot(dir); err == nil {
			h.player = root
		}
	}
}

// servePlayer handles /play and /play/...; it reports whether it did.
func (h *handler) servePlayer(w http.ResponseWriter, r *http.Request) bool {
	p := r.URL.Path
	if p == "/play" {
		http.Redirect(w, r, "/play/", http.StatusMovedPermanently)
		return true
	}
	if !strings.HasPrefix(p, "/play/") {
		return false
	}
	rel := strings.TrimPrefix(p, "/play/")
	hd := w.Header()
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Cache-Control", "public, max-age=300") // short: the player changes with deploys
	if rel == "" || rel == "index.html" {
		hd.Set("Content-Type", "text/html; charset=utf-8")
		w.Write(playerPage)
		return true
	}
	name, ok := strings.CutPrefix(rel, "runtime/")
	if !ok || h.player == nil || name == "" || strings.ContainsAny(name, "\\\x00") || strings.Contains(name, "..") || strings.HasPrefix(name, ".") || strings.Contains(name, "/") {
		http.NotFound(w, r)
		return true
	}
	f, err := h.player.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return true
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		http.NotFound(w, r)
		return true
	}
	if ct := mime.TypeByExtension(strings.ToLower(path.Ext(name))); ct != "" {
		hd.Set("Content-Type", ct)
	}
	var rs io.ReadSeeker = f
	http.ServeContent(w, r, "", time.Time{}, rs)
	return true
}
