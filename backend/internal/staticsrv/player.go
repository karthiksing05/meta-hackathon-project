package staticsrv

import (
	"embed"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

// A small web player for testing, served at /play/ on the games host. It is the app's own game runtime
// (the files in player/runtime, copied from the app; player/SOURCE_COMMIT says which commit) plus one
// page that loads a game's manifest from this host and boots it, so a game looks and plays in a browser
// as it does in the app. Open /play/?game=<24-character id or slug>, or /play/ for a list.
//
//go:embed player
var playerFS embed.FS

// servePlayer handles /play and /play/...; it reports whether it did.
func servePlayer(w http.ResponseWriter, r *http.Request) bool {
	p := r.URL.Path
	if p == "/play" {
		http.Redirect(w, r, "/play/", http.StatusMovedPermanently)
		return true
	}
	if !strings.HasPrefix(p, "/play/") {
		return false
	}
	rel := strings.TrimPrefix(p, "/play/")
	if rel == "" {
		rel = "index.html"
	}
	name := path.Join("player", rel)
	if !fs.ValidPath(name) || strings.Contains(rel, "..") {
		http.NotFound(w, r)
		return true
	}
	f, err := playerFS.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return true
	}
	defer f.Close()
	st, err := f.Stat()
	rs, ok := f.(io.ReadSeeker)
	if err != nil || st.IsDir() || !ok {
		http.NotFound(w, r)
		return true
	}
	hd := w.Header()
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Cache-Control", "public, max-age=300") // short: the player changes with deploys
	if ct := mime.TypeByExtension(strings.ToLower(path.Ext(name))); ct != "" {
		hd.Set("Content-Type", ct)
	}
	http.ServeContent(w, r, "", time.Time{}, rs)
	return true
}
