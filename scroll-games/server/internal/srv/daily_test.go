package srv

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type dailyEnv struct {
	t   *testing.T
	app *App
	ts  *httptest.Server
	now time.Time
}

func newDailyEnv(t *testing.T, start string) *dailyEnv {
	app := testApp(t, "http://127.0.0.1:1", fakeTool(t, `{"ok":true,"errors":[],"warnings":[]}`))
	day, _ := time.Parse(dateLayout, start)
	e := &dailyEnv{t: t, app: app, now: day.Add(9 * time.Hour)}
	app.now = func() time.Time { return e.now }
	e.ts = httptest.NewServer(app.Handler())
	t.Cleanup(e.ts.Close)
	return e
}

func (e *dailyEnv) call(method, path, user, body string, v any) int {
	req, _ := http.NewRequest(method, e.ts.URL+path, strings.NewReader(body))
	req.Header.Set("X-User", user)
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer r.Body.Close()
	if v != nil {
		_ = json.NewDecoder(r.Body).Decode(v)
	}
	return r.StatusCode
}

type dailyResp struct {
	Date           string `json:"date"`
	Game           Game   `json:"game"`
	Seed           uint32 `json:"seed"`
	ResetsAt       string `json:"resets_at"`
	MyPlay         *Play  `json:"my_play"`
	MyStreak       int    `json:"my_streak"`
	FriendsPlayed  int    `json:"friends_played"`
	LeaderboardTop []dailyLine
}

func (e *dailyEnv) daily(user string) dailyResp {
	var d dailyResp
	if c := e.call("GET", "/api/daily", user, "", &d); c != 200 {
		e.t.Fatalf("daily status %d", c)
	}
	return d
}

func (e *dailyEnv) playDaily(user string, d dailyResp, seed uint32) (int, map[string]any) {
	var out map[string]any
	body := fmt.Sprintf(`{"seed":%d,"inputs":[],"score":100,"daily":true,"date":%q}`, seed, d.Date)
	c := e.call("POST", "/api/games/"+d.Game.ID+"/plays", user, body, &out)
	return c, out
}

func TestDailySeedDeterministicByDate(t *testing.T) {
	if dailySeed("2026-11-12") != dailySeed("2026-11-12") {
		t.Fatal("seed not stable")
	}
	if dailySeed("2026-11-12") == dailySeed("2026-11-13") {
		t.Fatal("different dates should differ")
	}
	e := newDailyEnv(t, "2026-11-12")
	a, b := e.daily("u_me"), e.daily("u_ben")
	if a.Seed != dailySeed("2026-11-12") || a.Seed != b.Seed || a.Game.ID != b.Game.ID {
		t.Fatalf("daily differs between users: %+v %+v", a, b)
	}
	if a.ResetsAt != "2026-11-13T00:00:00Z" {
		t.Fatalf("resets_at = %s", a.ResetsAt)
	}
	e.now = e.now.AddDate(0, 0, 1)
	next := e.daily("u_me")
	if next.Date != "2026-11-13" || next.Seed == a.Seed {
		t.Fatalf("next day: %+v", next)
	}
}

func TestDailyPicksSeedScopeDailyGames(t *testing.T) {
	e := newDailyEnv(t, "2026-11-12")
	e.app.store.mu.Lock()
	e.app.store.d.Games["g_book1"].Manifest = json.RawMessage(`{"seed_scope":"daily"}`)
	e.app.store.mu.Unlock()
	for i := 0; i < 3; i++ {
		if id := e.daily("u_me").Game.ID; id != "g_book1" {
			t.Fatalf("day %d picked %s", i, id)
		}
		e.now = e.now.AddDate(0, 0, 1)
	}
}

func TestDailyOneCountedAttempt(t *testing.T) {
	e := newDailyEnv(t, "2026-11-12")
	d := e.daily("u_me")
	if d.MyPlay != nil || d.MyStreak != 3 {
		t.Fatalf("expected unplayed with 3-day streak: %+v", d)
	}
	if c, _ := e.playDaily("u_me", d, d.Seed+1); c != 400 {
		t.Fatalf("wrong seed status = %d", c)
	}
	bad := d
	bad.Date = "2026-11-11"
	if c, _ := e.playDaily("u_me", bad, d.Seed); c != 400 {
		t.Fatalf("stale date status = %d", c)
	}
	c, first := e.playDaily("u_me", d, d.Seed)
	fd := first["daily"].(map[string]any)
	if c != 200 || fd["counted"] != true || fd["streak"].(float64) != 4 {
		t.Fatalf("first play: %d %+v", c, first)
	}
	_, second := e.playDaily("u_me", d, d.Seed)
	sd := second["daily"].(map[string]any)
	if sd["counted"] != false || sd["practice"] != true || sd["streak"].(float64) != 4 {
		t.Fatalf("second play must be practice: %+v", second)
	}
	after := e.daily("u_me")
	if after.MyPlay == nil || after.MyPlay.ID != first["play"].(map[string]any)["id"] || after.MyStreak != 4 {
		t.Fatalf("daily after play: %+v", after)
	}
	e.app.store.mu.RLock()
	defer e.app.store.mu.RUnlock()
	n := 0
	for _, p := range e.app.countedDailyLocked("2026-11-12") {
		if p.UserID == "u_me" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("u_me has %d counted plays", n)
	}
}

func TestDailyStreakIncrementsAndResets(t *testing.T) {
	e := newDailyEnv(t, "2026-11-12")
	user := "u_new"
	e.app.store.mu.Lock()
	e.app.store.d.Users = append(e.app.store.d.Users, User{ID: user, Name: "New", Friends: []string{}, Follows: []string{}})
	e.app.store.mu.Unlock()
	streak := func() int {
		e.app.store.mu.RLock()
		defer e.app.store.mu.RUnlock()
		return e.app.streakLocked(user, dateOf(e.now))
	}
	play := func() {
		d := e.daily(user)
		if c, _ := e.playDaily(user, d, d.Seed); c != 200 {
			t.Fatalf("play status %d", c)
		}
	}
	play()
	for i := 2; i <= 3; i++ {
		e.now = e.now.AddDate(0, 0, 1)
		e.daily(user)
		if streak() != i-1 {
			t.Fatalf("streak before play day %d = %d", i, streak())
		}
		play()
		if streak() != i {
			t.Fatalf("streak after play day %d = %d", i, streak())
		}
	}
	e.now = e.now.AddDate(0, 0, 1) // missed day 4: streak still alive until day end
	if streak() != 3 {
		t.Fatalf("streak on unplayed day = %d", streak())
	}
	e.now = e.now.AddDate(0, 0, 1) // missed two days: reset
	if streak() != 0 || e.daily(user).MyStreak != 0 {
		t.Fatalf("streak should reset, got %d", streak())
	}
}

func TestDailyFeedItem(t *testing.T) {
	e := newDailyEnv(t, "2026-11-12")
	var feed []FeedView
	e.call("GET", "/api/feed", "u_me", "", &feed)
	head := feed[0]
	if head.Type != "daily" || head.Band != "daily" || head.Game == nil || feed[1].Type == "daily" {
		t.Fatalf("feed head: %+v", head)
	}
	if !strings.HasPrefix(head.Text, "Today's daily: "+head.Game.Title) || !strings.HasSuffix(head.Text, "Keep your 3-day streak.") ||
		!strings.Contains(head.Text, "friends played") {
		t.Fatalf("text = %q", head.Text)
	}
	d := e.daily("u_me")
	e.playDaily("u_me", d, d.Seed)
	e.call("GET", "/api/feed", "u_me", "", &feed)
	if feed[0].Type != "daily" || feed[0].Play == nil || !strings.HasPrefix(feed[0].Text, "You scored 100 on today's daily (#") {
		t.Fatalf("after play: %+v", feed[0])
	}
}
