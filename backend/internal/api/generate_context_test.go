package api_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// A game made for a Group: the generator gets context.group, even with the harness off.
func TestGenerateForAGroupSendsContextGroup(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 6)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")
	code, g := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Fog Club", "category": "Social"}), "application/json")
	if code != 201 {
		t.Fatalf("group: %d %v", code, g)
	}
	gid := g["id"].(string)
	if code, out := startJob(t, ts, bob, map[string]any{"request": "a fog game", "groupId": gid}); code != 403 {
		t.Fatalf("a non-member: %d %v", code, out)
	}
	if code, out := startJob(t, ts, ann, map[string]any{"request": "a fog game", "groupId": "grp_nope"}); code != 404 {
		t.Fatalf("an unknown group: %d %v", code, out)
	}
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", bob, nil, "")
	code, out := startJob(t, ts, bob, map[string]any{"request": "a fog game", "groupId": gid})
	if code != 202 {
		t.Fatalf("start: %d %v", code, out)
	}
	waitJob(t, ts, bob, out["jobId"].(string), "done")
	c, _ := composeBody(t, gen)["context"].(map[string]any)
	grp, _ := c["group"].(map[string]any)
	if grp["id"] != gid || grp["kind"] != "group" || grp["name"] != "Fog Club" {
		t.Fatalf("context sent to /compose: %v", c)
	}
	// The members by display name only, the maker first: no emails or ids.
	ms, _ := grp["members"].([]any)
	if len(ms) != 2 || ms[0].(map[string]any)["name"] != "bob" || ms[1].(map[string]any)["name"] != "ann" {
		t.Fatalf("members in context.group: %v", grp["members"])
	}
	if raw, _ := json.Marshal(grp); strings.Contains(string(raw), "@") {
		t.Fatalf("context.group carries an email: %s", raw)
	}
}

// Planning for a Group: the plan prompt names the Group and its people; only members may ask.
func TestHarnessPlanForAGroup(t *testing.T) {
	hg := newHarnessGenerator(t)
	ts := serverWithHarness(t, hg.URL, true)
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	code, g := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Pickle Crew", "category": "Social"}), "application/json")
	if code != 201 {
		t.Fatalf("group: %d %v", code, g)
	}
	gid := g["id"].(string)
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", bob, nil, "")
	body := func(id string) io.Reader {
		return js(map[string]any{"request": "a quiz about our group", "groupId": id})
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/harness/plan", cat, body(gid), "application/json"); code != 403 {
		t.Fatalf("a non-member: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/harness/plan", ann, body("grp_nope"), "application/json"); code != 404 {
		t.Fatalf("an unknown group: %d", code)
	}
	if code, out := do(t, "POST", ts.URL+"/v1/harness/plan", ann, body(gid), "application/json"); code != 200 {
		t.Fatalf("plan: %d %v", code, out)
	}
	hg.mu.Lock()
	defer hg.mu.Unlock()
	if len(hg.planUsers) == 0 {
		t.Fatal("no plan call")
	}
	last := hg.planUsers[len(hg.planUsers)-1]
	if !strings.Contains(last, `"Pickle Crew"`) || !strings.Contains(last, "ann, bob") || strings.Contains(last, "@example.com") {
		t.Fatalf("plan prompt about the group: %s", last)
	}
}

// Preferences go into the harness context, and a brand's sponsor record into the understanding.
func TestHarnessGetsPreferencesAndTheSponsor(t *testing.T) {
	hg := newHarnessGenerator(t)
	h, err := harness.New(context.Background(), harness.Config{
		Source:       harness.MemorySource{Catalog: harnessCatalog()},
		Understander: harness.MuseUnderstander{Muse: harness.UnderstandMuse(hg.URL)},
	})
	if err != nil {
		t.Fatal(err)
	}
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
		GeneratorURL: hg.URL, GenerateConcurrent: 2, GeneratePerHour: 6, SponsorUsers: map[string]bool{"fizzco": true},
		HarnessContext: true, Harness: h, Planner: &harness.Planner{Muse: harness.PlanMuse(hg.URL)},
	})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	tok := register(t, ts, "fizzco")
	prefs := []map[string]any{{"axis": "look", "chosen": map[string]any{"label": "Neon", "value": "neon"}, "rejected": []map[string]any{{"label": "Paper", "value": "paper"}}}}
	code, out := startJob(t, ts, tok, map[string]any{"request": "a harry potter krillion", "preferences": prefs,
		"sponsor": map[string]any{"name": "Fizz Co"}})
	if code != 202 {
		t.Fatalf("start: %d %v", code, out)
	}
	waitJob(t, ts, tok, out["jobId"].(string), "done")
	c, _ := composeBody(t, hg.gen)["context"].(map[string]any)
	ps, _ := c["preferences"].([]any)
	if len(ps) != 1 || ps[0].(map[string]any)["axis"] != "look" {
		t.Errorf("preferences in context: %v", c["preferences"])
	}
	u, _ := c["understanding"].(map[string]any)
	if sp, _ := u["sponsor"].(map[string]any); sp["name"] != "Fizz Co" {
		t.Errorf("sponsor in the understanding: %v", u)
	}

	many := make([]map[string]any, 21)
	for i := range many {
		many[i] = prefs[0]
	}
	if code, _ := startJob(t, ts, tok, map[string]any{"request": "x", "preferences": many}); code != 400 {
		t.Errorf("21 preferences: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/harness/plan", tok, js(map[string]any{"request": "a harry potter krillion", "preferences": prefs}), "application/json"); code != 200 {
		t.Errorf("plan with preferences: %d", code)
	}
}
