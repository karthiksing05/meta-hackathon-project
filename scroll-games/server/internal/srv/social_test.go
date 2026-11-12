package srv

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFollowUnfollow(t *testing.T) {
	app := testApp(t, "http://127.0.0.1:1", "")
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	do := func(method, path, user string) (int, User) {
		req, _ := http.NewRequest(method, ts.URL+path, nil)
		if user != "" {
			req.Header.Set("X-User", user)
		}
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		var u User
		_ = json.NewDecoder(r.Body).Decode(&u)
		return r.StatusCode, u
	}
	me := func() User {
		_, u := do("GET", "/api/me", "")
		return u
	}
	if code, u := do("POST", "/api/users/u_pixel/follow", ""); code != 200 || strings.Join(u.Follows, ",") != "u_nova,u_pixel" {
		t.Fatalf("follow: %d %+v", code, u)
	}
	do("POST", "/api/users/u_pixel/follow", "")
	if f := me().Follows; len(f) != 2 {
		t.Fatalf("follow not idempotent: %v", f)
	}
	if code, u := do("DELETE", "/api/users/u_nova/follow", ""); code != 200 || strings.Join(u.Follows, ",") != "u_pixel" {
		t.Fatalf("unfollow: %d %+v", code, u)
	}
	if code, u := do("DELETE", "/api/users/u_nova/follow", ""); code != 200 || len(u.Follows) != 1 {
		t.Fatalf("unfollow twice: %d %+v", code, u)
	}
	if code, _ := do("POST", "/api/users/u_nobody/follow", ""); code != 404 {
		t.Fatalf("unknown target = %d", code)
	}
	if code, _ := do("POST", "/api/users/u_me/follow", ""); code != 400 {
		t.Fatalf("self follow = %d", code)
	}
	if code, _ := do("POST", "/api/users/u_nova/follow", "u_ghost"); code != 404 {
		t.Fatalf("unknown caller = %d", code)
	}
	if code, u := do("POST", "/api/users/u_nova/follow", "u_ana"); code != 200 || len(u.Follows) != 1 {
		t.Fatalf("other user follow: %d %+v", code, u)
	}
	if f := me().Follows; len(f) != 1 || f[0] != "u_pixel" {
		t.Fatalf("me unaffected by others: %v", f)
	}
}

func TestLocalMediaServedAbsoluteAndMigrated(t *testing.T) {
	media := t.TempDir()
	if err := os.WriteFile(filepath.Join(media, "m1.jpg"), []byte("jpegdata"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { mediaDir = "static/media" })
	mk := func(dataDir string) *App {
		cfg := DefaultConfig()
		cfg.DataDir, cfg.MediaDir, cfg.PlayerDir = dataDir, media, dataDir
		cfg.SpecDir = filepath.Join(dataDir, "nospec")
		cfg.Speculate = false
		return NewApp(cfg)
	}
	dir := t.TempDir()
	app := mk(dir)
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	var list []Media
	r, _ := http.Get(ts.URL + "/api/media?group=g_lisbon")
	_ = json.NewDecoder(r.Body).Decode(&list)
	r.Body.Close()
	if list[0].URL != ts.URL+"/media/m1.jpg" {
		t.Fatalf("m1 url = %s", list[0].URL)
	}
	if !strings.HasPrefix(list[1].URL, "https://picsum.photos/") {
		t.Fatalf("missing file should fall back to picsum, got %s", list[1].URL)
	}
	r, _ = http.Get(ts.URL + "/media/m1.jpg")
	if r.StatusCode != 200 || !strings.Contains(r.Header.Get("Cache-Control"), "max-age") {
		t.Fatalf("media serve: %d %v", r.StatusCode, r.Header)
	}
	r.Body.Close()

	// A store written before the photos existed gets migrated on load.
	app.store.mu.Lock()
	app.store.d.Media[0].URL = picsumURL("m1")
	app.store.d.Games["g_lisbon1"].Content = json.RawMessage(strings.ReplaceAll(string(app.store.d.Games["g_lisbon1"].Content), "/media/m1.jpg", picsumURL("m1")))
	app.store.saveLocked()
	app.store.mu.Unlock()
	app2 := mk(dir)
	if u := app2.store.d.Media[0].URL; u != "/media/m1.jpg" {
		t.Fatalf("migrated media url = %s", u)
	}
	if c := string(app2.store.d.Games["g_lisbon1"].Content); !strings.Contains(c, `"/media/m1.jpg"`) || strings.Contains(c, "sg-m1/") {
		t.Fatalf("content not migrated")
	}
	if u := app2.store.d.Media[1].URL; !strings.Contains(u, "picsum") {
		t.Fatalf("m2 should stay picsum: %s", u)
	}
}
