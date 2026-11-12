package srv

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const validManifest = `{"schema":"sg.manifest/1","title":"Muse Quiz","description":"d","level":"remix","template":"quiz","seed_scope":"per_challenge","concepts":[{"id":"score.points"}],"glue":[{"id":"g","on":["round.started"],"script":"fn on_event(ev) {}"}],"theme":{"palette":"ocean","mood":"chill","emoji":"x"}}`
const validContent = `{"items":[{"prompt":"a?","media_id":"m1","choices":["1","2","3","4"],"answer":1,"clue":"c"},{"prompt":"b?","media_id":"","choices":["1","2","3","4"],"answer":0,"clue":"c"},{"prompt":"c?","media_id":"","choices":["1","2","3","4"],"answer":2,"clue":"c"}],"copy":{"intro":"i","win":"w","lose":"l"}}`

const validBrief = `{"intent":"A quiz about cats","audience":"cat people","mood":"playful","energy":3,"competition":"versus","limits":{"duration_s":60,"rounds":6},"title_idea":"Cat Quiz","glue_ideas":["final round worth double"]}`

type fakeMuse struct {
	srv       *httptest.Server
	calls     atomic.Int32
	manifest  string
	content   string
	rejectAll bool // 400 on reasoning_effort
}

func newFakeMuse(t *testing.T) *fakeMuse {
	f := &fakeMuse{manifest: validManifest, content: validContent}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		if f.rejectAll {
			if _, ok := req["reasoning_effort"]; ok {
				w.WriteHeader(400)
				fmt.Fprint(w, `{"error":"unknown field reasoning_effort"}`)
				return
			}
		}
		f.calls.Add(1)
		out := f.manifest
		if req["model"] == ModelEmber {
			out = f.content
		}
		if rf, ok := req["response_format"].(map[string]any); ok {
			if js, _ := rf["json_schema"].(map[string]any); js["name"] == "brief" {
				out = validBrief
			}
		}
		b, _ := json.Marshal(out)
		fmt.Fprintf(w, `{"choices":[{"message":{"content":%s}}],"usage":{"prompt_tokens":1000,"completion_tokens":500}}`, b)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func fakeTool(t *testing.T, validateJSON string) string {
	p := filepath.Join(t.TempDir(), "sgtool")
	script := "#!/bin/sh\ncat >/dev/null\ncase \"$1\" in\nvalidate) echo '" + validateJSON + "';;\nreplay) echo '{\"score\":100,\"ticks\":10}';;\nesac\n"
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func testApp(t *testing.T, museURL, tool string) *App {
	cfg := DefaultConfig()
	cfg.DataDir = t.TempDir()
	cfg.SpecDir = filepath.Join(cfg.DataDir, "nospec")
	cfg.PlayerDir = cfg.DataDir
	cfg.SgtoolPath = tool
	cfg.MuseBaseURL = museURL
	cfg.MuseKey = "test-key"
	cfg.Speculate = false
	cfg.PlanTimeout, cfg.ContentTimeout, cfg.RepairTimeout, cfg.BriefTimeout = 3*time.Second, 3*time.Second, 3*time.Second, 3*time.Second
	return NewApp(cfg)
}

func genReq() GenerateReq {
	return GenerateReq{Prompt: "trivia about our Lisbon trip", MediaIDs: []string{"m1", "m2", "m3"}}
}

func TestBudgetMathAndRefusal(t *testing.T) {
	if got := CostMicro(ModelEmber, 1000, 500); got != 350 { // 100+250
		t.Fatalf("ember cost = %d", got)
	}
	if got := CostMicro(ModelWonder, 1, 1); got != 24 {
		t.Fatalf("wonder cost = %d", got)
	}
	if got := CostMicro(ModelEmber, 1, 1); got != 1 { // 0.6 rounds up
		t.Fatalf("round up = %d", got)
	}
	path := filepath.Join(t.TempDir(), "usage.json")
	b := NewBudget(path, 0.001)
	if !b.Reserve(900) {
		t.Fatal("first reserve should pass")
	}
	if b.Reserve(200) {
		t.Fatal("reserve over cap should be refused")
	}
	b.Record(900, Call{Model: ModelWonder, PromptTokens: 100, CompletionTokens: 20}) // 800
	if b2 := NewBudget(path, 0.001); b2.Spent() != 0.0008 {
		t.Fatalf("spend not persisted: %v", b2.Spent())
	}

	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, "")
	app.cfg.CapUSD = 0
	app.budget = NewBudget("", 0)
	app.muse.budget = app.budget
	resp := app.MakeBrief(context.Background(), BriefReq{Prompt: "a quiz about cats"})
	if resp.Source != "fallback-budget" || f.calls.Load() != 0 {
		t.Fatalf("expected budget fallback without calls, got %s calls=%d", resp.Source, f.calls.Load())
	}
}

func TestGenerateMuseAndCacheHit(t *testing.T) {
	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, fakeTool(t, `{"ok":true,"errors":[],"warnings":[]}`))
	g, err := app.Generate(context.Background(), "u_me", genReq(), func(Event) {})
	if err != nil || g.Gen.Source != "muse" {
		t.Fatalf("err=%v source=%v", err, g.Gen.Source)
	}
	if g.Gen.CostUSD <= 0 || f.calls.Load() != 2 {
		t.Fatalf("cost=%v calls=%d", g.Gen.CostUSD, f.calls.Load())
	}
	g2, err := app.Generate(context.Background(), "u_me", genReq(), func(Event) {})
	if err != nil || g2.Gen.Source != "cache" || f.calls.Load() != 2 || g2.ID == g.ID {
		t.Fatalf("cache hit failed: %v %v calls=%d", err, g2.Gen.Source, f.calls.Load())
	}
}

func TestFallbackWhenSgtoolMissing(t *testing.T) {
	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, "/nonexistent/sgtool")
	g, err := app.Generate(context.Background(), "u_me", genReq(), func(Event) {})
	if err != nil || g.Gen.Source != "fallback" {
		t.Fatalf("err=%v source=%v", err, g.Gen.Source)
	}
	if !strings.Contains(string(g.Manifest), "double_final_round") {
		t.Fatal("expected template manifest")
	}
}

func TestFallbackOnInvalidMuseJSON(t *testing.T) {
	f := newFakeMuse(t)
	f.manifest, f.content = "sorry, I cannot do that", "nope"
	app := testApp(t, f.srv.URL, fakeTool(t, `{"ok":true,"errors":[],"warnings":[]}`))
	g, err := app.Generate(context.Background(), "u_me", genReq(), func(Event) {})
	if err != nil || g.Gen.Source != "fallback" {
		t.Fatalf("err=%v source=%v", err, g.Gen.Source)
	}
	var c struct{ Items []json.RawMessage }
	_ = json.Unmarshal(g.Content, &c)
	if len(c.Items) != 3 {
		t.Fatalf("expected caption template content for 3 photos, got %d", len(c.Items))
	}
}

func TestRepairThenFallback(t *testing.T) {
	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, fakeTool(t, `{"ok":false,"errors":[{"path":"glue[0]","msg":"bad"}],"warnings":[]}`))
	var stages []string
	g, err := app.Generate(context.Background(), "u_me", genReq(), func(e Event) { stages = append(stages, e.Stage+":"+e.Status) })
	if err != nil || g.Gen.Source != "fallback" {
		t.Fatalf("err=%v source=%v", err, g.Gen.Source)
	}
	if !contains(stages, "repair:start") || f.calls.Load() != 3 {
		t.Fatalf("expected one repair call; stages=%v calls=%d", stages, f.calls.Load())
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestReasoningEffortRejectedIsRemembered(t *testing.T) {
	f := newFakeMuse(t)
	f.rejectAll = true
	app := testApp(t, f.srv.URL, "")
	resp := app.MakeBrief(context.Background(), BriefReq{Prompt: "a quiz about cats"})
	_ = resp
	if app.muse.Capabilities()[ModelEmber].ReasoningEffort != "rejected" {
		t.Fatalf("caps = %+v", app.muse.Capabilities())
	}
}

func TestSSEEventOrder(t *testing.T) {
	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, fakeTool(t, `{"ok":true,"errors":[],"warnings":[]}`))
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	body := `{"prompt":"trivia about Lisbon","media_ids":["m1","m2","m3"]}`
	resp, err := http.Post(ts.URL+"/api/games/generate", "application/json", strings.NewReader(body))
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
	if seq[len(seq)-1] != "done" || idx("plan:done") < 0 || idx("content:done") < 0 {
		t.Fatalf("seq=%v", seq)
	}
	if !(idx("plan:start") < idx("plan:done") && idx("plan:done") < idx("glue:done")+1 && idx("glue:done") < idx("validate:start") &&
		idx("content:done") < idx("validate:start") && idx("validate:done") < idx("save:start") && idx("save:done") < idx("done")) {
		t.Fatalf("bad order: %v", seq)
	}
	if idx("repair:start") != -1 {
		t.Fatalf("unexpected repair: %v", seq)
	}
}

func TestFeedOrdering(t *testing.T) {
	me := User{ID: "u_me", Friends: []string{"u_f"}, Follows: []string{"u_c"}}
	now := time.Now()
	items := []FeedItem{
		{ID: "rest-new", Type: "game", ActorID: "u_x", CreatedAt: now},
		{ID: "creator", Type: "game", ActorID: "u_c", CreatedAt: now.Add(-time.Hour)},
		{ID: "friend-old", Type: "score", ActorID: "u_f", CreatedAt: now.Add(-5 * time.Hour)},
		{ID: "friend-new", Type: "game", ActorID: "u_f", CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "chal", Type: "challenge", ActorID: "u_x", ToUserIDs: []string{"u_me"}, CreatedAt: now.Add(-9 * time.Hour)},
	}
	var got []string
	for _, it := range orderFeed(items, me) {
		got = append(got, it.ID)
	}
	want := "chal,friend-new,friend-old,creator,rest-new"
	if strings.Join(got, ",") != want {
		t.Fatalf("got %v", got)
	}
}

func TestFeedOrderingPutsOwnRecentItemsAfterChallenges(t *testing.T) {
	me := User{ID: "u_me", Friends: []string{"u_f"}, Follows: []string{"u_c"}}
	now := time.Now()
	items := []FeedItem{
		{ID: "friend", Type: "game", ActorID: "u_f", CreatedAt: now},
		{ID: "mine-old", Type: "game", ActorID: "u_me", CreatedAt: now.Add(-48 * time.Hour)},
		{ID: "mine-score", Type: "score", ActorID: "u_me", CreatedAt: now.Add(-3 * time.Hour)},
		{ID: "mine-game", Type: "game", ActorID: "u_me", CreatedAt: now.Add(-time.Hour)},
		{ID: "chal", Type: "challenge", ActorID: "u_x", ToUserIDs: []string{"u_me"}, CreatedAt: now.Add(-9 * time.Hour)},
	}
	var got []string
	for _, it := range orderFeed(items, me) {
		got = append(got, it.ID)
	}
	want := "chal,mine-game,mine-score,friend,mine-old"
	if strings.Join(got, ",") != want {
		t.Fatalf("got %v", got)
	}
	if bandNames[feedBand(items[2], me)] != "you" {
		t.Fatal("own recent item should be band you")
	}
}

func TestEndpointsPlayAndChallenge(t *testing.T) {
	app := testApp(t, "http://127.0.0.1:1", fakeTool(t, `{"ok":true,"errors":[],"warnings":[]}`))
	ts := httptest.NewServer(app.Handler())
	defer ts.Close()
	get := func(path string, v any) {
		r, err := http.Get(ts.URL + path)
		if err != nil || r.StatusCode != 200 {
			t.Fatalf("%s: %v %v", path, err, r)
		}
		_ = json.NewDecoder(r.Body).Decode(v)
		r.Body.Close()
	}
	var feed []FeedView
	get("/api/feed", &feed)
	if len(feed) < 8 || feed[0].Type != "challenge" || feed[0].Band != "challenge" {
		t.Fatalf("feed head: %+v", feed[0])
	}
	var media []Media
	get("/api/media?group=g_lisbon", &media)
	if len(media) != 8 {
		t.Fatalf("media = %d", len(media))
	}
	post := func(path, body string, v any) {
		r, err := http.Post(ts.URL+path, "application/json", strings.NewReader(body))
		if err != nil || r.StatusCode != 200 {
			t.Fatalf("%s: %v %v", path, err, r)
		}
		_ = json.NewDecoder(r.Body).Decode(v)
		r.Body.Close()
	}
	var pr struct {
		Play     Play
		Verified bool
		Rank     int
		Beat     map[string]any
	}
	post("/api/games/g_lisbon1/plays", `{"seed":5,"inputs":[],"score":100,"challenge_id":"c_seed1"}`, &pr)
	if !pr.Verified || pr.Beat == nil || pr.Beat["won"] != false {
		t.Fatalf("play: %+v", pr)
	}
	post("/api/games/g_lisbon1/plays", `{"seed":5,"inputs":[],"score":999}`, &pr)
	if pr.Verified {
		t.Fatal("mismatched score must not verify")
	}
	var ch struct {
		URL  string
		Text string
	}
	post("/api/challenges", `{"game_id":"g_lisbon1","play_id":"p_seed1"}`, &ch)
	if !strings.HasPrefix(ch.URL, "http://127.0.0.1:") || !strings.HasSuffix(ch.Text, "Beat them?") {
		t.Fatalf("challenge: %+v", ch)
	}
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	r, _ := c.Get(ts.URL + "/c/c_seed1")
	if r.StatusCode != 302 || !strings.Contains(r.Header.Get("Location"), "game=g_lisbon1") {
		t.Fatalf("redirect: %d %s", r.StatusCode, r.Header.Get("Location"))
	}
}

func TestBriefFromMuseHasSpecShape(t *testing.T) {
	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, "")
	resp := app.MakeBrief(context.Background(), BriefReq{Prompt: "a quiz about cats", MediaIDs: []string{"m1", "m2", "m3"}})
	if resp.Source != "muse" || resp.Brief.TitleIdea != "Cat Quiz" || resp.Brief.Template != "quiz" || len(resp.Brief.ContentSource.MediaIDs) != 3 {
		t.Fatalf("brief = %+v source=%s", resp.Brief, resp.Source)
	}
	raw, _ := json.Marshal(resp.Brief)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	for _, k := range []string{"intent", "audience", "mood", "energy", "competition", "content_source", "limits", "title_idea", "template", "level", "glue_ideas"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("brief JSON lacks %q: %s", k, raw)
		}
	}
}

func TestSpeculativeJobIsReusedByGenerate(t *testing.T) {
	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, fakeTool(t, `{"ok":true,"errors":[],"warnings":[]}`))
	app.cfg.Speculate = true
	resp := app.MakeBrief(context.Background(), BriefReq{Prompt: "a quiz about cats", MediaIDs: []string{"m1", "m2", "m3"}})
	briefJSON, _ := json.Marshal(resp.Brief)
	g, err := app.Generate(context.Background(), "u_me", GenerateReq{Brief: briefJSON, MediaIDs: []string{"m1", "m2", "m3"}}, func(Event) {})
	if err != nil || g.Gen.Source != "muse" {
		t.Fatalf("err=%v game=%+v", err, g)
	}
	// 1 brief + 1 plan + 1 content: Generate joined the speculative job instead of starting its own.
	if n := f.calls.Load(); n != 3 {
		t.Fatalf("muse calls = %d, want 3", n)
	}
}

func TestEmbeddedTemplatesMatchSpec(t *testing.T) {
	for rel, embedded := range map[string]string{"templates/quiz.manifest.json": embeddedQuizManifest, "templates/trip-trivia.content.json": embeddedQuizContent} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "spec", rel))
		if err != nil {
			t.Skip("spec not present")
		}
		var a, b any
		if json.Unmarshal(raw, &a) != nil || json.Unmarshal([]byte(embedded), &b) != nil || fmt.Sprint(a) != fmt.Sprint(b) {
			t.Fatalf("embedded copy of %s drifted from the spec file", rel)
		}
	}
}

func TestSpecDrivenCatalogAndBriefSchema(t *testing.T) {
	spec := filepath.Join("..", "..", "..", "spec")
	if _, err := os.Stat(filepath.Join(spec, "concepts.json")); err != nil {
		t.Skip("spec not present")
	}
	cat := BuildCatalogDigest(spec)
	if !strings.Contains(cat, "flow.session") || strings.Contains(cat, "input.swipe:") {
		t.Fatalf("unexpected catalog digest: %.200s", cat)
	}
	schema := LoadBriefSchema(spec)
	props := schema["properties"].(map[string]any)
	if _, ok := props["title_idea"]; !ok {
		t.Fatal("brief schema lacks title_idea")
	}
	if _, ok := props["template"]; ok {
		t.Fatal("server-filled keys must be stripped from the model schema")
	}
}

func TestNormalizeContentCapsItemsAndFillsMediaURLs(t *testing.T) {
	media := []Media{{ID: "m1", URL: "http://x/m1.jpg"}}
	if _, err := normalizeContent(json.RawMessage(validContent), media, 2); err == nil || !strings.Contains(err.Error(), "only 2") {
		t.Fatalf("expected the item cap to leave too few questions, got %v", err)
	}
	out, err := normalizeContent(json.RawMessage(validContent), media, 0)
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Items []struct {
			MediaURL string `json:"media_url"`
			Kind     string `json:"kind"`
		} `json:"items"`
	}
	_ = json.Unmarshal(out, &c)
	if c.Items[0].MediaURL != "http://x/m1.jpg" || c.Items[0].Kind != "question" {
		t.Fatalf("items = %+v", c.Items)
	}
}

func TestDecodeBriefToleratesStringNumbers(t *testing.T) {
	b, err := DecodeBrief(json.RawMessage(`{"title_idea":"x","energy":"medium","limits":{"rounds":"8","duration_s":"abc"}}`))
	if err != nil {
		t.Fatal(err)
	}
	b.Normalize("remix", nil)
	if b.Limits.Rounds != 8 || b.Energy != 3 || b.Limits.DurationS != 80 {
		t.Fatalf("brief = %+v", b)
	}
}
