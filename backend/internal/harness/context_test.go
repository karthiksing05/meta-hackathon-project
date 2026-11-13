package harness

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func TestBuildContextShape(t *testing.T) {
	h := newTestHarness(t, Config{})
	p, err := h.Context(context.Background(), Request{Text: "make krillion"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := BuildContext(p)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(c)
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	if m["version"] != "harness-context/1" {
		t.Fatalf("version = %v", m["version"])
	}
	for _, k := range []string{"understanding", "types", "tools", "gold_ids", "learned", "notes"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing %q", k)
		}
	}
	if _, ok := m["plan"]; ok {
		t.Error("plan should be absent until the planner exists")
	}
	if _, ok := m["understanding"].(map[string]any)["unknown_refs"]; ok {
		t.Error("the generator's understanding has no unknown_refs")
	}
	ty := m["types"].([]any)[0].(map[string]any)
	for _, k := range []string{"id", "name", "family", "summary", "core_loop", "rules", "win", "lose", "scoring", "pieces",
		"content_needs", "difficulty_levers", "tools", "gate_profile", "status", "source", "refs", "match"} {
		if _, ok := ty[k]; !ok {
			t.Errorf("type card missing %q", k)
		}
	}
	if c.GateProfile != "trivia" || c.Types[0].ID != "rare_answer_trivia" {
		t.Errorf("gate %q first %q", c.GateProfile, c.Types[0].ID)
	}
	tl := m["tools"].([]any)[0].(map[string]any)
	for _, k := range []string{"id", "kind", "status", "summary", "when_to_use", "api", "params", "events"} {
		if _, ok := tl[k]; !ok {
			t.Errorf("tool card missing %q", k)
		}
	}
	if !strings.Contains(strings.Join(c.Notes, "|"), "lookup skipped: catalog alias hit") {
		t.Errorf("notes = %v", c.Notes)
	}
}

func TestBuildContextLimits(t *testing.T) {
	long := strings.Repeat("very long text ", 400)
	var p ContextPack
	for i := 0; i < 10; i++ {
		gt := testCatalog().Types[0]
		gt.ID = "t" + string(rune('a'+i))
		gt.Summary, gt.CoreLoop = long, long
		gt.Rules = []string{long, long, long, long, long, long, long, long, long, long}
		gt.Refs = []string{"authoring/games/gold_x" + string(rune('a'+i)) + ".authoring.json"}
		p.Types = append(p.Types, TypeHit{Type: gt, Score: 0.5, Reasons: []string{long}})
	}
	for i := 0; i < 60; i++ {
		tool := GameTool{ID: "tool" + strings.Repeat("x", i%5) + string(rune('a'+i%26)) + string(rune('a'+i/26)), Kind: "builtin", Status: "shipped", Summary: long, WhenToUse: long, API: long}
		p.Tools = append(p.Tools, ToolHit{ID: tool.ID, Tool: &tool})
	}
	p.Tools = append(p.Tools, ToolHit{ID: "not_there", Missing: true})
	c, err := BuildContext(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Types) > ContextMaxTypes || len(c.Tools) > ContextMaxTools {
		t.Fatalf("%d types, %d tools", len(c.Types), len(c.Tools))
	}
	if n := size(c); n > ContextMaxBytes {
		t.Fatalf("context is %d bytes", n)
	}
	if len(c.GoldIDs) == 0 || c.GoldIDs[0] != "gold_xa" {
		t.Errorf("gold ids = %v", c.GoldIDs)
	}
	if !strings.Contains(strings.Join(c.Notes, "|"), "not_there") {
		t.Errorf("missing tool not noted: %v", c.Notes)
	}
}

func TestGeneratorMuse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/muse/json" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("the API must not send a key")
		}
		b, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(b, &body)
		if body["model"] != ModelSpark || body["maxTokens"] != float64(4000) || body["system"] == "" || body["user"] != "hi" {
			t.Errorf("body = %v", body)
		}
		json.NewEncoder(w).Encode(map[string]string{"content": "```json\n{\"ok\": true}\n```", "model": ModelSpark})
	}))
	defer srv.Close()
	got, err := UnderstandMuse(srv.URL).JSON(context.Background(), "sys", "hi")
	if err != nil || string(got) != `{"ok": true}` {
		t.Fatalf("got %s, %v", got, err)
	}

	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	}))
	defer slow.Close()
	g := UnderstandMuse(slow.URL)
	g.Timeout = 100 * time.Millisecond
	if _, err := g.JSON(context.Background(), "s", "u"); err == nil || !strings.Contains(err.Error(), "didn't answer") {
		t.Fatalf("timeout err = %v", err)
	}
	if _, err := UnderstandMuse("").JSON(context.Background(), "s", "u"); err == nil {
		t.Fatal("empty GENERATOR_URL should fail")
	}
}

// Runs against a real MongoDB when MONGO_TEST_URI is set (see internal/store's integration test).
func TestMongoCatalog(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set")
	}
	ctx := context.Background()
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Disconnect(ctx)
	db := client.Database("harness_test_" + time.Now().Format("150405"))
	defer db.Drop(ctx)

	cat := testCatalog()
	if _, err := SeedMongo(ctx, db, cat); err != nil {
		t.Fatal(err)
	}
	learned := MongoLearned{DB: db}
	lt := cat.Types[0]
	lt.ID, lt.Status, lt.Source = "rare_answer_daily", "learned", "lookup"
	if err := learned.Put(ctx, "Krillion", lt); err != nil {
		t.Fatal(err)
	}
	// a learned type whose id is a seed id is stored under learned_<id>
	clash := cat.Types[1]
	if err := learned.Put(ctx, "Temple Dash", clash); err != nil {
		t.Fatal(err)
	}
	if got, ok, _ := learned.Get(ctx, "temple dash"); !ok || got.ID != "learned_lane_runner" {
		t.Fatalf("clash stored as %q", got.ID)
	}
	// re-seeding with a repository entry of the learned id does not overwrite it
	cat2 := testCatalog()
	over := cat2.Types[0]
	over.ID, over.Summary = "rare_answer_daily", "a seed version that must not replace the learned one, ever."
	cat2.Types = append(cat2.Types, over)
	rep, err := SeedMongo(ctx, db, cat2)
	if err != nil {
		t.Fatal(err)
	}
	if rep.KeptLearned != 1 {
		t.Errorf("report = %+v", rep)
	}
	got, ok, err := learned.Get(ctx, "krillion")
	if err != nil || !ok || got.Status != "learned" || got.Summary != lt.Summary {
		t.Fatalf("learned entry changed: %+v %v %v", got, ok, err)
	}
	src := &MongoSource{DB: db}
	loaded, err := src.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Types) != len(cat.Types)+2 || len(loaded.Tools) != len(cat.Tools) {
		t.Fatalf("loaded %d types %d tools (skipped %v)", len(loaded.Types), len(loaded.Tools), src.Skipped)
	}
}
