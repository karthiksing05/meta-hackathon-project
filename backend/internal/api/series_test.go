package api_test

import (
	"fmt"
	"strings"
	"testing"
)

func runLog(seed int, phase string, score, timeMs int) string {
	return fmt.Sprintf(`{"format":"microgame-log/1","seed":%d,"game_hash":"x","calls":[],"final":{"state_hash":"h","phase":%q,"score":%d,"time_ms":%d}}`, seed, phase, score, timeMs)
}

func TestSeries(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	bobID, annID := meID(t, ts, bob), meID(t, ts, ann)

	// three real microgames on the server, made through the generator
	var games []string
	for _, slug := range []string{"series-a", "series-b", "series-c"} {
		gen.mu.Lock()
		gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", slug, 1)
		gen.mu.Unlock()
		_, out := startJob(t, ts, ann, map[string]any{"request": "a game " + slug})
		games = append(games, waitJob(t, ts, ann, out["jobId"].(string), "done")["game"].(map[string]any)["id"].(string))
	}

	start := func(tok string, body map[string]any) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/series", tok, js(body), "application/json")
	}
	if code, _ := start(ann, map[string]any{"opponentId": bobID, "games": games}); code != 400 {
		t.Fatalf("not friends yet: %d", code)
	}
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	if code, _ := start(ann, map[string]any{"opponentId": bobID, "games": []string{}}); code != 400 {
		t.Fatalf("no games: %d", code)
	}
	if code, _ := start(ann, map[string]any{"opponentId": bobID, "games": []string{"000000000000000000000000"}}); code != 404 {
		t.Fatalf("unknown game: %d", code)
	}
	code, se := start(ann, map[string]any{"opponentId": bobID, "games": games})
	if code != 201 || se["winsNeeded"].(float64) != 2 || len(se["rounds"].([]any)) != 3 || se["status"] != "active" || se["startedBy"] != "me" {
		t.Fatalf("start: %d %v", code, se)
	}
	sid := se["id"].(string)
	round := func(tok string, n int, log string) (int, map[string]any) {
		return do(t, "POST", fmt.Sprintf("%s/v1/series/%s/rounds/%d", ts.URL, sid, n), tok, js(map[string]any{"log": log}), "application/json")
	}

	// the series shows up for bob as a moment, and a stranger can't see it
	_, ms := do(t, "GET", ts.URL+"/v1/me/moments", bob, nil, "")
	if m := ms["moments"].([]any); len(m) != 1 || m[0].(map[string]any)["kind"] != "series_invited" {
		t.Fatalf("invite moment: %v", ms)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/series/"+sid, cat, nil, ""); code != 404 {
		t.Fatalf("a stranger saw the series: %d", code)
	}

	// round 1: bob plays first on engine seed 111
	if code, out := round(bob, 1, runLog(111, "won", 50, 5000)); code != 200 {
		t.Fatalf("bob round 1: %d %v", code, out)
	}
	if code, _ := round(bob, 1, runLog(111, "won", 50, 5000)); code != 409 {
		t.Fatalf("playing a round twice: %d", code)
	}
	_, ms = do(t, "GET", ts.URL+"/v1/me/moments", ann, nil, "")
	if m := ms["moments"].([]any); len(m) != 1 || m[0].(map[string]any)["kind"] != "series_round" {
		t.Fatalf("round moment for ann: %v", ms)
	}
	_, view := do(t, "GET", ts.URL+"/v1/series/"+sid, ann, nil, "")
	r1 := view["rounds"].([]any)[0].(map[string]any)
	if r1["theirs"].(map[string]any)["played"] != true || r1["theirs"].(map[string]any)["score"] != nil || r1["winner"] != nil {
		t.Fatalf("ann must not see bob's score before she plays: %v", r1)
	}
	for log, want := range map[string]int{
		runLog(222, "won", 40, 4000):     422, // a different seed from bob's
		runLog(111, "won", 99999, 4000):  422, // forged score
		runLog(111, "playing", 40, 4000): 422, // not finished
		"not json":                       400,
	} {
		if code, out := round(ann, 1, log); code != want {
			t.Fatalf("%s: %d %v", log, code, out)
		}
	}
	other := strings.Replace(runLog(111, "won", 40, 4000), `"game_hash":"x"`, `"game_hash":"other"`, 1)
	if code, _ := round(ann, 1, other); code != 422 {
		t.Fatalf("a run of another game: %d", code)
	}
	if code, _ := round(ann, 9, runLog(111, "won", 40, 4000)); code != 404 {
		t.Fatalf("no such round: %d", code)
	}
	if code, _ := round(cat, 1, runLog(111, "won", 40, 4000)); code != 404 {
		t.Fatalf("a stranger played a round: %d", code)
	}
	if code, out := round(ann, 1, runLog(111, "won", 40, 4000)); code != 200 {
		t.Fatalf("ann round 1: %d %v", code, out)
	}
	// the generator was handed the game's exact stored script
	if last := gen.requests[len(gen.requests)-1]; !strings.Contains(last, `/verify game={"z_first":1,"a_second":[3,2,1]}`) {
		t.Fatalf("what was verified: %s", last)
	}
	_, view = do(t, "GET", ts.URL+"/v1/series/"+sid, ann, nil, "")
	r1 = view["rounds"].([]any)[0].(map[string]any)
	if r1["winner"] != "them" || r1["theirs"].(map[string]any)["score"].(float64) != 50 || r1["mine"].(map[string]any)["score"].(float64) != 40 {
		t.Fatalf("round 1: %v", r1)
	}

	// round 2: ann wins on score; round 3: equal scores, ann is faster. Two wins ends it.
	round(ann, 2, runLog(333, "lost", 70, 9000))
	round(bob, 2, runLog(333, "won", 60, 9000))
	if _, v := do(t, "GET", ts.URL+"/v1/series/"+sid, ann, nil, ""); v["status"] != "active" {
		t.Fatalf("not over after two rounds: %v", v)
	}
	round(bob, 3, runLog(444, "won", 80, 7000))
	round(ann, 3, runLog(444, "won", 80, 6000))
	_, view = do(t, "GET", ts.URL+"/v1/series/"+sid, ann, nil, "")
	tally := view["tally"].(map[string]any)
	if view["status"] != "done" || view["winner"] != "me" || tally["Me"].(float64) != 2 || tally["Them"].(float64) != 1 || view["finishedAt"] == nil {
		t.Fatalf("the series: %v", view)
	}
	_, theirs := do(t, "GET", ts.URL+"/v1/series/"+sid, bob, nil, "")
	if theirs["winner"] != "them" || theirs["startedBy"] != "them" {
		t.Fatalf("bob's view: %v", theirs)
	}
	if code, _ := round(bob, 3, runLog(444, "won", 1, 1)); code != 409 {
		t.Fatalf("a finished series: %d", code)
	}
	_, list := do(t, "GET", ts.URL+"/v1/series", bob, nil, "")
	if items := list["items"].([]any); len(items) != 1 {
		t.Fatalf("list: %v", list)
	}
	_ = annID
}
