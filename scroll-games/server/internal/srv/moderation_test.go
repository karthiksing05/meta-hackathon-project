package srv

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// modVerdict builds a classifier answer: every category "none" except those in hits (category -> severity).
func modVerdict(hits map[string]string) string {
	m := map[string]map[string]string{}
	for _, c := range modCategories {
		m[c] = map[string]string{"severity": "none", "reason": ""}
		if sev, ok := hits[c]; ok {
			m[c] = map[string]string{"severity": sev, "reason": "test reason for " + c}
		}
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func hasReason(rs []ModReason, cat, sev string) bool {
	for _, r := range rs {
		if r.Category == cat && r.Severity == sev {
			return true
		}
	}
	return false
}

func TestPrecheckBlocklist(t *testing.T) {
	cases := []struct {
		text, cat, sev string
	}{
		{"you are a n1gger", "hate", "high"},
		{"free porn here", "sexual", "high"},
		{"send nudes", "sexual", "low"},
		{"just kill myself already", "self_harm", "high"},
		{"a documentary about suicide", "self_harm", "low"},
		{"mail me at jane.doe@example.com", "personal_info", "high"},
		{"call 415-555-0134 now", "personal_info", "high"},
		{"call (415) 555-0134", "personal_info", "high"},
		{"+44 20 7946 0958", "personal_info", "high"},
		{"she lives at 221 Baker Street", "personal_info", "low"},
		{"click here to win", "spam", "low"},
		{"visit https://evil.example/x", "spam", "low"},
		{"aaaaaaaaaaaaaaaa", "spam", "low"},
		{"Taylor Swift is stupid", "harassment", "low"},
		{"Z​ero-width n​igg​er", "", ""}, // obfuscation by zero-width chars is stripped before scanning
	}
	for _, c := range cases {
		got := precheck([]modText{{"title", c.text}})
		if c.cat == "" {
			continue
		}
		if !hasReason(got, c.cat, c.sev) {
			t.Errorf("%q: want %s/%s, got %+v", c.text, c.cat, c.sev, got)
		}
	}
	for _, clean := range []string{"Which year? 2024 2025 2026", "Where was this sunset over the Tagus taken?", "Taylor Swift's Eras Tour", "Suicide Squad cast quiz?"} {
		for _, r := range precheck([]modText{{"q", clean}}) {
			if r.Severity == "high" {
				t.Errorf("%q should not be high: %+v", clean, r)
			}
		}
	}
	if got := precheck([]modText{{"title", strings.Repeat("a b ", 40)}}); !hasReason(got, "spam", "low") {
		t.Errorf("long title not flagged: %+v", got)
	}
}

func TestParseModeration(t *testing.T) {
	rs, err := parseModeration(modVerdict(map[string]string{"hate": "high", "spam": "low"}))
	if err != nil || len(rs) != 2 || !hasReason(rs, "hate", "high") || !hasReason(rs, "spam", "low") {
		t.Fatalf("rs=%+v err=%v", rs, err)
	}
	if _, err := parseModeration(`{"hate":{"severity":"none","reason":""}}`); err == nil {
		t.Fatal("missing categories should be an error")
	}
	if _, err := parseModeration("nope"); err == nil {
		t.Fatal("garbage should be an error")
	}
	rs, _ = parseModeration(strings.Replace(modVerdict(nil), `"hate":{"reason":"","severity":"none"}`, `"hate":{"reason":"x","severity":"weird"}`, 1))
	if !hasReason(rs, "hate", "low") {
		t.Fatalf("unknown severity should be low: %+v", rs)
	}
}

func TestCollectModTextCoversPlayerVisibleStrings(t *testing.T) {
	manifest := json.RawMessage(`{"title":"T","description":"D","glue":[{"id":"g1","script":"fn on_event(ev){ set(\"banner\", \"Double points now\"); }"}]}`)
	texts := collectModText("", "", manifest, json.RawMessage(validContent), func(id string) (Media, bool) {
		return Media{ID: id, Caption: "A sunny viewpoint"}, id == "m1"
	})
	var all []string
	for _, x := range texts {
		all = append(all, x.Where+"="+x.Text)
	}
	joined := strings.Join(all, "\n")
	for _, want := range []string{"title=T", "description=D", "content.items[0].prompt=a?", "content.items[0].choices[1]=2", "content.items[0].clue=c",
		"content.copy.intro=i", "Double points now", "photo caption m1=A sunny viewpoint"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in:\n%s", want, joined)
		}
	}
}

func modApp(t *testing.T, f *fakeMuse) *App {
	return testApp(t, f.srv.URL, fakeTool(t, `{"ok":true,"errors":[],"warnings":[]}`))
}

func TestModerateDecisions(t *testing.T) {
	texts := []modText{{"title", "Lisbon Trip Trivia"}}
	cases := []struct {
		name     string
		out      string
		status   int
		decision string
		checker  string
	}{
		{"pass", modVerdict(nil), 0, DecisionPass, ModelEmber + "+precheck"},
		{"flag", modVerdict(map[string]string{"harassment": "low"}), 0, DecisionFlagged, ModelEmber + "+precheck"},
		{"block", modVerdict(map[string]string{"hate": "high", "spam": "low"}), 0, DecisionBlocked, ModelEmber + "+precheck"},
		{"muse http error", "", 500, DecisionPrecheck, "precheck"},
		{"muse garbage", "not json", 0, DecisionPrecheck, "precheck"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFakeMuse(t)
			f.modOut, f.modStatus = c.out, c.status
			m := modApp(t, f).moderate(context.Background(), texts, nil, nil)
			if m.Decision != c.decision || m.Checker != c.checker {
				t.Fatalf("got %s/%s want %s/%s: %+v", m.Decision, m.Checker, c.decision, c.checker, m)
			}
			if c.decision == DecisionBlocked && (len(m.Reasons) != 2 || !hasReason(m.Reasons, "hate", "high")) {
				t.Fatalf("reasons: %+v", m.Reasons)
			}
		})
	}
}

func TestModerateFallbackKeepsPrecheckBlock(t *testing.T) {
	f := newFakeMuse(t)
	f.modStatus = 500
	m := modApp(t, f).moderate(context.Background(), []modText{{"title", "mail bob@example.com"}}, nil, nil)
	if m.Decision != DecisionBlocked || m.Checker != "precheck" {
		t.Fatalf("%+v", m)
	}
}

func TestModerateTimeoutFallsBack(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(2 * time.Second) }))
	defer slow.Close()
	app := testApp(t, slow.URL, fakeTool(t, `{"ok":true}`))
	app.cfg.ModerationTimeout = 150 * time.Millisecond
	t0 := time.Now()
	m := app.moderate(context.Background(), []modText{{"title", "Fine"}}, nil, nil)
	if m.Decision != DecisionPrecheck || time.Since(t0) > time.Second {
		t.Fatalf("%+v after %v", m, time.Since(t0))
	}
}

func TestModerateRespectsBudget(t *testing.T) {
	f := newFakeMuse(t)
	app := modApp(t, f)
	app.budget = NewBudget("", 0)
	app.muse.budget = app.budget
	m := app.moderate(context.Background(), []modText{{"title", "Fine"}}, nil, nil)
	if m.Decision != DecisionPrecheck || f.modCalls.Load() != 0 {
		t.Fatalf("%+v calls=%d", m, f.modCalls.Load())
	}
}

func TestModerateVerdictIsCached(t *testing.T) {
	f := newFakeMuse(t)
	app := modApp(t, f)
	texts := []modText{{"title", "Same text"}}
	app.moderate(context.Background(), texts, nil, nil)
	app.moderate(context.Background(), texts, nil, nil)
	if f.modCalls.Load() != 1 {
		t.Fatalf("calls=%d", f.modCalls.Load())
	}
}

func postJSON(t *testing.T, ts *httptest.Server, path, user, body string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", ts.URL+path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-User", user)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func feedGameIDs(t *testing.T, ts *httptest.Server, user string) map[string]bool {
	t.Helper()
	req, _ := http.NewRequest("GET", ts.URL+"/api/feed", nil)
	req.Header.Set("X-User", user)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var items []struct {
		Game *struct {
			ID string `json:"id"`
		} `json:"game"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&items)
	ids := map[string]bool{}
	for _, it := range items {
		if it.Game != nil {
			ids[it.Game.ID] = true
		}
	}
	return ids
}

func generateDraft(t *testing.T, app *App) *Game {
	g, err := app.Generate(context.Background(), "u_me", genReq(), func(Event) {})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestPublishPassFlagBlock(t *testing.T) {
	for _, c := range []struct {
		name      string
		out       string
		code      int
		status    string
		visibleTo bool // visible to a friend's feed
	}{
		{"pass", modVerdict(nil), 200, "published", true},
		{"flag", modVerdict(map[string]string{"sexual": "low"}), 200, "published", false},
		{"block", modVerdict(map[string]string{"hate": "high"}), 422, "draft", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newFakeMuse(t)
			f.modOut = c.out
			app := modApp(t, f)
			ts := httptest.NewServer(app.Handler())
			defer ts.Close()
			g := generateDraft(t, app)
			before := f.modCalls.Load()
			code, body := postJSON(t, ts, "/api/games/"+g.ID+"/publish", "u_me", "{}")
			if code != c.code {
				t.Fatalf("code=%d body=%v", code, body)
			}
			if f.modCalls.Load() != before {
				t.Fatalf("publish should reuse the verdict cached during generation (calls %d -> %d)", before, f.modCalls.Load())
			}
			mod, _ := body["moderation"].(map[string]any)
			if mod == nil || mod["decision"] == nil {
				t.Fatalf("no moderation in response: %v", body)
			}
			app.store.mu.RLock()
			stored := app.store.d.Games[g.ID]
			status, sm := stored.Status, stored.Moderation
			app.store.mu.RUnlock()
			if status != c.status || sm == nil || sm.Decision != mod["decision"] {
				t.Fatalf("status=%s stored=%+v", status, sm)
			}
			if c.code == 422 && len(mod["reasons"].([]any)) == 0 {
				t.Fatalf("blocked without reasons: %v", mod)
			}
			if got := feedGameIDs(t, ts, "u_ana")[g.ID]; got != c.visibleTo {
				t.Fatalf("friend sees game = %v, want %v", got, c.visibleTo)
			}
			if c.status == "published" && !feedGameIDs(t, ts, "u_me")[g.ID] {
				t.Fatal("creator must still see their own game")
			}
		})
	}
}

func TestPublishFallsBackWhenMuseDown(t *testing.T) {
	f := newFakeMuse(t)
	f.modStatus = 500
	app := modApp(t, f)
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	g := generateDraft(t, app)
	if g.Moderation == nil || g.Moderation.Decision != DecisionPrecheck {
		t.Fatalf("%+v", g.Moderation)
	}
	code, body := postJSON(t, ts, "/api/games/"+g.ID+"/publish", "u_me", "{}")
	mod, _ := body["moderation"].(map[string]any)
	if code != 200 || mod["decision"] != DecisionPrecheck {
		t.Fatalf("code=%d body=%v", code, body)
	}
}

func TestPublishPrecheckBlockWithoutMuse(t *testing.T) {
	f := newFakeMuse(t)
	f.modStatus = 500
	app := modApp(t, f)
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	g := generateDraft(t, app)
	app.store.mu.Lock()
	app.store.d.Games[g.ID].Title = "email me at x@example.com"
	app.store.mu.Unlock()
	code, _ := postJSON(t, ts, "/api/games/"+g.ID+"/publish", "u_me", "{}")
	if code != 422 {
		t.Fatalf("code=%d", code)
	}
}

func TestPublishOnlyCreator(t *testing.T) {
	f := newFakeMuse(t)
	app := modApp(t, f)
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	g := generateDraft(t, app)
	if code, _ := postJSON(t, ts, "/api/games/"+g.ID+"/publish", "u_ana", "{}"); code != 403 {
		t.Fatalf("code=%d", code)
	}
}

func TestReportThresholdHidesGame(t *testing.T) {
	f := newFakeMuse(t)
	app := modApp(t, f)
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	g := generateDraft(t, app)
	postJSON(t, ts, "/api/games/"+g.ID+"/publish", "u_me", "{}")

	_, body := postJSON(t, ts, "/api/games/"+g.ID+"/report", "u_ana", `{"reason":"rude"}`)
	if body["reports"] != float64(1) || body["hidden"] != false || !feedGameIDs(t, ts, "u_ana")[g.ID] {
		t.Fatalf("after 1 report: %v", body)
	}
	_, body = postJSON(t, ts, "/api/games/"+g.ID+"/report", "u_ana", `{"reason":"again"}`)
	if body["reports"] != float64(1) {
		t.Fatalf("same user must not count twice: %v", body)
	}
	_, body = postJSON(t, ts, "/api/games/"+g.ID+"/report", "u_ben", `{"reason":"spam"}`)
	if body["reports"] != float64(2) || body["hidden"] != true {
		t.Fatalf("after 2 reports: %v", body)
	}
	if feedGameIDs(t, ts, "u_ana")[g.ID] || !feedGameIDs(t, ts, "u_me")[g.ID] {
		t.Fatal("reported game hidden from others, still visible to creator")
	}
	if code, _ := postJSON(t, ts, "/api/games/g_nope/report", "u_ana", `{}`); code != 404 {
		t.Fatalf("unknown game code=%d", code)
	}

	resp, err := http.Get(ts.URL + "/api/moderation/queue")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var q []struct {
		Game    Game     `json:"game"`
		Reports []Report `json:"reports"`
		Hidden  bool     `json:"hidden"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&q)
	if len(q) != 1 || q[0].Game.ID != g.ID || len(q[0].Reports) != 2 || !q[0].Hidden {
		t.Fatalf("queue=%+v", q)
	}
}

func TestQueueListsFlaggedGames(t *testing.T) {
	f := newFakeMuse(t)
	f.modOut = modVerdict(map[string]string{"spam": "low"})
	app := modApp(t, f)
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	g := generateDraft(t, app)
	postJSON(t, ts, "/api/games/"+g.ID+"/publish", "u_me", "{}")
	resp, err := http.Get(ts.URL + "/api/moderation/queue")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var q []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&q)
	if len(q) != 1 {
		t.Fatalf("queue=%v", q)
	}
}

func TestLegacyStringModerationStillLoads(t *testing.T) {
	var g Game
	if err := json.Unmarshal([]byte(`{"id":"g1","moderation":"stub-pass"}`), &g); err != nil || g.Moderation == nil || g.Moderation.Checker != "legacy-stub" {
		t.Fatalf("err=%v mod=%+v", err, g.Moderation)
	}
}

func TestSSEIncludesModerateStage(t *testing.T) {
	f := newFakeMuse(t)
	app := modApp(t, f)
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	resp, err := http.Post(ts.URL+"/api/games/generate", "application/json", strings.NewReader(`{"prompt":"trivia about Lisbon","media_ids":["m1","m2","m3"]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var seq []string
	var ev string
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "event: ") {
			ev = strings.TrimPrefix(line, "event: ")
		} else if strings.HasPrefix(line, "data: ") {
			if ev == "stage" {
				var e Event
				_ = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &e)
				seq = append(seq, e.Stage+":"+e.Status)
			} else {
				seq = append(seq, ev)
			}
		}
	}
	idx := func(s string) int {
		for i, x := range seq {
			if x == s {
				return i
			}
		}
		return -1
	}
	if !(idx("moderate:start") >= 0 && idx("moderate:start") < idx("validate:done") && idx("moderate:done") < idx("save:start") && idx("moderate:start") > idx("content:done")) {
		t.Fatalf("seq=%v", seq)
	}
	// cached generation also reports the stage
	var cached []string
	if _, err := app.Generate(context.Background(), "u_me", GenerateReq{Prompt: "trivia about Lisbon", MediaIDs: []string{"m1", "m2", "m3"}}, func(e Event) {
		cached = append(cached, e.Stage+":"+e.Status)
	}); err != nil {
		t.Fatal(err)
	}
	if !contains(cached, "moderate:done") {
		t.Fatalf("cached path missing moderate: %v", cached)
	}
}

// Moderation of the content overlaps the Wonder plan, so it adds ~nothing to generation time.
func TestModerationOverlapsPlan(t *testing.T) {
	f := newFakeMuse(t)
	f.planDelay, f.contentDelay, f.modDelay = 5*time.Second, 2*time.Second, 1700*time.Millisecond
	app := modApp(t, f)
	app.cfg.PlanTimeout, app.cfg.ContentTimeout = 10*time.Second, 10*time.Second
	var mu sync.Mutex
	var modStart, modDone, planDone time.Duration
	t0 := time.Now()
	g, err := app.Generate(context.Background(), "u_me", genReq(), func(e Event) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case e.Stage == "moderate" && e.Status == "start":
			modStart = time.Since(t0)
		case e.Stage == "moderate" && e.Status == "done":
			modDone = time.Since(t0)
		case e.Stage == "plan" && e.Status == "done":
			planDone = time.Since(t0)
		}
	})
	total := time.Since(t0)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("plan done %v, moderate start %v done %v, total %v (previous design: ~%v)", planDone, modStart, modDone, total, planDone+f.modDelay)
	if total > planDone+500*time.Millisecond {
		t.Fatalf("moderation added %v on top of the plan", total-planDone)
	}
	if modStart < 1800*time.Millisecond || modStart > 2600*time.Millisecond {
		t.Fatalf("moderate should start when content finishes (~2s), started at %v", modStart)
	}
	if g.Moderation == nil || g.Moderation.Decision != DecisionPass || g.Moderation.Checker != ModelEmber+"+precheck" {
		t.Fatalf("%+v", g.Moderation)
	}
	if n := f.modCalls.Load(); n != 1 {
		t.Fatalf("want exactly one Muse moderation call, got %d", n)
	}
	// Publish reuses the cached verdict: no further Muse call.
	if m := app.moderateGame(context.Background(), *g); m.Decision != DecisionPass || f.modCalls.Load() != 1 {
		t.Fatalf("publish-time check not cached: calls=%d %+v", f.modCalls.Load(), m)
	}
}

// A long plan text that the pre-checks cannot settle gets a second Muse call; content stays cached.
func TestModerationLongPlanTextGetsSecondCall(t *testing.T) {
	f := newFakeMuse(t)
	f.manifest = strings.Replace(validManifest, `"description":"d"`, `"description":"`+strings.Repeat("A calm description of the trip. ", 12)+`"`, 1)
	app := modApp(t, f)
	g := generateDraft(t, app)
	if n := f.modCalls.Load(); n != 2 {
		t.Fatalf("want 2 Muse moderation calls, got %d", n)
	}
	if g.Moderation.Decision != DecisionPass {
		t.Fatalf("%+v", g.Moderation)
	}
}
