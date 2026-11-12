// Package staticsrv serves published game packages: read-only, GET/HEAD only, range requests,
// no directory listings, traversal-safe, with long-lived immutable cache headers.
package staticsrv

import (
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
)

var idRE = regexp.MustCompile(`^[a-f0-9]{24}$`)

func init() {
	// Make content types deterministic regardless of the container's mime database.
	for ext, t := range map[string]string{
		".wasm": "application/wasm", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
		".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
		".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
		".glb": "model/gltf-binary", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
		".txt": "text/plain; charset=utf-8", ".bin": "application/octet-stream",
	} {
		mime.AddExtensionType(ext, t)
	}
}

// New serves files under root (the published/ directory). os.Root confines every open to that
// tree, even through symlinks, so path traversal cannot escape it.
func New(rootDir string) (http.Handler, error) {
	root, err := os.OpenRoot(rootDir)
	if err != nil {
		return nil, err
	}
	return &handler{root: root}, nil
}

type handler struct{ root *os.Root }

// Close releases the directory handle.
func (h *handler) Close() error { return h.root.Close() }

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("ok"))
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name, ok := cleanPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	f, err := h.root.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() { // directories are never listed
		http.NotFound(w, r)
		return
	}
	hd := w.Header()
	hd.Set("Cache-Control", "public, max-age=31536000, immutable")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Access-Control-Allow-Origin", "*")
	hd.Set("Cross-Origin-Resource-Policy", "cross-origin")
	hd.Set("ETag", fmt.Sprintf(`"%x-%x"`, st.ModTime().UnixNano(), st.Size()))
	if ct := mime.TypeByExtension(strings.ToLower(path.Ext(name))); ct != "" {
		hd.Set("Content-Type", ct)
	} else {
		hd.Set("Content-Type", "application/octet-stream")
	}
	// ServeContent adds Accept-Ranges, handles Range, If-None-Match and HEAD.
	http.ServeContent(w, r, "", st.ModTime(), f)
}

// cleanPath accepts only /<24-hex id>/<file path> with no dot segments or hidden components,
// and returns the path relative to the published root.
func cleanPath(p string) (string, bool) {
	if !strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\\x00") {
		return "", false
	}
	rel := p[1:]
	if rel == "" || strings.HasSuffix(rel, "/") {
		return "", false
	}
	segs := strings.Split(rel, "/")
	if len(segs) < 2 || !idRE.MatchString(segs[0]) {
		return "", false
	}
	for _, s := range segs {
		if s == "" || s == "." || s == ".." || strings.HasPrefix(s, ".") {
			return "", false
		}
	}
	if !fs.ValidPath(rel) {
		return "", false
	}
	return rel, true
}
