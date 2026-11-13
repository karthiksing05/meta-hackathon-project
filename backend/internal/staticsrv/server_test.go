package staticsrv

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/repo"
)

const gid = "0123456789abcdef01234567"

func setup(t *testing.T) http.Handler {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "published", gid, "assets")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(root, "published", gid, "manifest.json"), []byte(`{"a":1}`), 0o644)
	os.WriteFile(filepath.Join(root, "published", gid, "game.wasm"), []byte("0123456789"), 0o644)
	os.WriteFile(filepath.Join(root, "published", gid, ".secret"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(root, "outside.txt"), []byte("secret"), 0o644)
	os.MkdirAll(filepath.Join(root, "private", gid, "source"), 0o755)
	os.WriteFile(filepath.Join(root, "private", gid, "source", "prompt.txt"), []byte("src"), 0o644)
	h, err := New(filepath.Join(root, "published"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.(*handler).Close() })
	return h
}

func get(h http.Handler, method, path string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://x"+path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestServe(t *testing.T) {
	h := setup(t)
	w := get(h, "GET", "/"+gid+"/manifest.json", nil)
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("manifest: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	if cc := w.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("cache: %q", cc)
	}
	w = get(h, "GET", "/"+gid+"/game.wasm", nil)
	if w.Header().Get("Content-Type") != "application/wasm" {
		t.Fatalf("wasm type: %s", w.Header().Get("Content-Type"))
	}
	if w.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("accept-ranges missing")
	}
	// range request
	w = get(h, "GET", "/"+gid+"/game.wasm", map[string]string{"Range": "bytes=2-4"})
	if w.Code != 206 || w.Body.String() != "234" {
		t.Fatalf("range: %d %q", w.Code, w.Body.String())
	}
	// HEAD has headers but no body
	w = get(h, "HEAD", "/"+gid+"/game.wasm", nil)
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") != "10" {
		t.Fatalf("head: %d len=%d cl=%s", w.Code, w.Body.Len(), w.Header().Get("Content-Length"))
	}
	if w := get(h, "POST", "/"+gid+"/manifest.json", nil); w.Code != 405 {
		t.Fatalf("post: %d", w.Code)
	}
}

func TestNotServed(t *testing.T) {
	h := setup(t)
	for _, p := range []string{
		"/", "/" + gid, "/" + gid + "/", "/" + gid + "/assets/", // no directory listing
		"/" + gid + "/.secret",                      // hidden file
		"/" + gid + "/../../outside.txt",            // traversal
		"/" + gid + "/%2e%2e/%2e%2e/outside.txt",    // encoded traversal
		"/" + gid + "/..%2f..%2foutside.txt",        // encoded slash
		"/private/" + gid + "/source/prompt.txt",    // private tree
		"/../private/" + gid + "/source/prompt.txt", // traversal to private
		"/notanid/manifest.json",                    // not a server-generated id
		"/" + gid + "/missing.json",
	} {
		if w := get(h, "GET", p, nil); w.Code != 404 && w.Code != 301 {
			t.Errorf("%s: want 404, got %d (%q)", p, w.Code, w.Body.String())
		} else if w.Body.String() == "secret" || w.Body.String() == "src" {
			t.Errorf("%s leaked content", p)
		}
	}
}

func TestSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "published", gid), 0o755)
	os.WriteFile(filepath.Join(root, "outside.txt"), []byte("secret"), 0o644)
	if err := os.Symlink(filepath.Join(root, "outside.txt"), filepath.Join(root, "published", gid, "link.txt")); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	h, _ := New(filepath.Join(root, "published"))
	t.Cleanup(func() { h.(*handler).Close() })
	if w := get(h, "GET", "/"+gid+"/link.txt", nil); w.Code != 404 {
		t.Fatalf("symlink escape: %d", w.Code)
	}
}

func TestWebPlayer(t *testing.T) {
	dir := t.TempDir()
	runtimeDir, ok := repo.Find("FacebookClone/Bubbles/Runtime/web")
	if !ok {
		t.Skip("the app's runtime folder isn't here (the player reads it from FacebookClone/Bubbles/Runtime/web)")
	}
	h, err := New(dir, WithPlayerRuntime(runtimeDir))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.(*handler).Close() })
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	get := func(p string) (int, string, string) {
		res, err := http.Get(ts.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, res.Header.Get("Content-Type"), string(b)
	}
	code, ct, body := get("/play/")
	if code != 200 || !strings.HasPrefix(ct, "text/html") || !strings.Contains(body, "Game player") {
		t.Fatalf("player page: %d %s", code, ct)
	}
	if !strings.Contains(body, `id="del"`) || !strings.Contains(body, "/v1/creations/") || !strings.Contains(body, "confirm(") {
		t.Fatal("the player page has no delete button for the open game")
	}
	if code, ct, body := get("/play/runtime/bubble-runtime.js"); code != 200 || !strings.Contains(ct, "javascript") || len(body) < 100000 {
		t.Fatalf("runtime: %d %s %d bytes", code, ct, len(body))
	}
	if code, _, _ := get("/play/runtime/bubble-kit-microgame-engine.js"); code != 200 {
		t.Fatalf("engine bundle: %d", code)
	}
	if code, ct, _ := get("/play/runtime/bubble-glow.css"); code != 200 || !strings.HasPrefix(ct, "text/css") {
		t.Fatalf("css: %d %s", code, ct)
	}
	for _, p := range []string{"/play/runtime/", "/play/runtime", "/play/../server.go", "/play/runtime/../../server.go", "/play/nope.js", "/play/%2e%2e/server.go"} {
		if code, _, _ := get(p); code == 200 {
			t.Errorf("%s must not be served", p)
		}
	}
	res, _ := http.Get(ts.URL + "/play")
	res.Body.Close()
	if res.Request.URL.Path != "/play/" {
		t.Errorf("/play should redirect to /play/, ended at %s", res.Request.URL.Path)
	}
}
