package api_test

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestTimeTrialBoard(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")
	annID, bobID := meID(t, ts, ann), meID(t, ts, bob)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")

	make := func(slug, score string) string {
		gen.mu.Lock()
		gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", slug, 1)
		gen.manifest = strings.Replace(gen.manifest, `"formula":"microgame"`, `"formula":"microgame","score":`+score, 1)
		gen.mu.Unlock()
		_, out := startJob(t, ts, ann, map[string]any{"request": "a game " + slug})
		return waitJob(t, ts, ann, out["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	}
	trial := make("time-trial", `{"kind":"time_to_complete","measures":"time to serve 20 orders","tie_break":"less time","format":"m:ss.t","bounds":{"min":10000,"max":600000}}`)
	calm := make("calm-garden", `{"kind":"points","ranked":false}`)

	// the game shows how it ranks
	_, g := do(t, "GET", ts.URL+"/v1/games/"+trial, "", nil, "")
	sc := g["score"].(map[string]any)
	if sc["direction"] != "lower" || sc["countsWhen"] != "finished" || sc["format"] != "m:ss.t" || sc["ranked"] != true || sc["tieBreak"] != "less time" {
		t.Fatalf("score on the game: %v", g["score"])
	}
	post := func(tok, game string, body map[string]any) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", tok, js(body), "application/json")
	}
	run := func(phase string, score, timeMs int) map[string]any {
		return map[string]any{"log": runLog(1, phase, score, timeMs)}
	}

	// a plain score isn't taken for a game with a model; unfinished and out-of-bounds runs are refused
	if code, _ := post(ann, trial, map[string]any{"score": 5}); code != 400 {
		t.Fatalf("a plain score on a game with a score model: %d", code)
	}
	if code, _ := post(ann, trial, run("playing", 0, 20000)); code != 422 {
		t.Fatalf("an unfinished run: %d", code)
	}
	if code, _ := post(ann, trial, run("won", 99999, 20000)); code != 422 { // the replay disagrees with the claim
		t.Fatalf("a forged run: %d", code)
	}
	for _, ms := range []int{5000, 700000} {
		if code, _ := post(ann, trial, run("won", 0, ms)); code != 422 {
			t.Fatalf("a time outside the bounds (%d): %d", ms, code)
		}
	}

	// a lost run doesn't count on a finished-only board; the server's own number comes back
	code, out := post(ann, trial, run("lost", 0, 30000))
	if code != 200 || out["counted"] != false || out["finished"] != false || len(out["items"].([]any)) != 0 {
		t.Fatalf("a lost run: %d %v", code, out)
	}

	// time trial: the fastest is first, and times are shown as m:ss.t
	post(ann, trial, run("won", 0, 90000))
	code, out = post(bob, trial, run("won", 0, 60500))
	rows := out["items"].([]any)
	if code != 200 || out["counted"] != true || out["score"].(float64) != 60500 || out["display"] != "1:00.5" || out["ranked"] != true || out["direction"] != "lower" ||
		len(rows) != 2 || rows[0].(map[string]any)["userId"] != bobID || rows[0].(map[string]any)["display"] != "1:00.5" || rows[0].(map[string]any)["timeMs"].(float64) != 60500 {
		t.Fatalf("time trial board: %d %v", code, out)
	}
	// best keeps the best: a slower run changes nothing, a faster one replaces it
	_, out = post(ann, trial, run("won", 0, 95000))
	if out["counted"] != false || out["items"].([]any)[1].(map[string]any)["score"].(float64) != 90000 {
		t.Fatalf("a slower run: %v", out)
	}
	_, out = post(ann, trial, run("won", 0, 50000))
	rows = out["items"].([]any)
	if out["counted"] != true || rows[0].(map[string]any)["userId"] != annID || rows[0].(map[string]any)["display"] != "0:50.0" || len(rows) != 2 {
		t.Fatalf("a faster run: %v", out)
	}

	// scoped boards use the same order
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	_, fr := do(t, "GET", fmt.Sprintf("%s/v1/games/%s/leaderboard?scope=friends", ts.URL, trial), ann, nil, "")
	if r := fr["items"].([]any); len(r) != 2 || r[0].(map[string]any)["userId"] != annID {
		t.Fatalf("friends board: %v", fr)
	}

	// "beat my score" on a time trial: a smaller time beats it
	if code, _ := do(t, "POST", ts.URL+"/v1/challenges", bob, js(map[string]any{"gameId": trial, "toUserIds": []string{annID}}), "application/json"); code != 201 {
		t.Fatalf("challenge: %d", code)
	}
	_, ch := do(t, "GET", ts.URL+"/v1/challenges", ann, nil, "")
	if c := ch["items"].([]any)[0].(map[string]any); c["score"].(float64) != 60500 || c["beaten"] != true || c["myScore"].(float64) != 50000 {
		t.Fatalf("a time challenge: %v", c) // ann's 0:50.0 is under bob's 1:00.5, so she has beaten it
	}
	// nobody can challenge on a time they haven't set
	cat := register(t, ts, "cat")
	catID := meID(t, ts, cat)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+annID, cat, nil, "")
	do(t, "PUT", ts.URL+"/v1/me/friends/"+catID, ann, nil, "")
	if code, _ := do(t, "POST", ts.URL+"/v1/challenges", cat, js(map[string]any{"gameId": trial, "toUserIds": []string{annID}}), "application/json"); code != 422 {
		t.Fatalf("a challenge with no score to beat: %d", code)
	}

	// an unranked board is a plain list, newest first
	post(ann, calm, run("won", 10, 1000))
	time.Sleep(5 * time.Millisecond) // scores are stamped to the millisecond
	_, out = post(bob, calm, run("lost", 99, 2000))
	rows = out["items"].([]any)
	if out["ranked"] != false || len(rows) != 2 || rows[0].(map[string]any)["userId"] != bobID {
		t.Fatalf("unranked board: %v", out)
	}
	_, cg := do(t, "GET", ts.URL+"/v1/games/"+calm, "", nil, "")
	if cg["score"].(map[string]any)["ranked"] != false {
		t.Fatalf("unranked on the game: %v", cg["score"])
	}

	// a game without a score model is as before
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "plain-one", 1)
	gen.mu.Unlock()
	_, o := startJob(t, ts, ann, map[string]any{"request": "a plain game"})
	plain := waitJob(t, ts, ann, o["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	if code, out := post(ann, plain, map[string]any{"score": 77}); code != 200 || out["items"].([]any)[0].(map[string]any)["score"].(float64) != 77 || out["ranked"] != true {
		t.Fatalf("a plain game: %d %v", code, out)
	}
}

func TestSeriesOnATimeTrial(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")
	bobID := meID(t, ts, bob)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	gen.mu.Lock()
	gen.manifest = strings.Replace(strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "trial-series", 1), `"formula":"microgame"`, `"formula":"microgame","score":{"kind":"time_to_complete"}`, 1)
	gen.mu.Unlock()
	_, o := startJob(t, ts, ann, map[string]any{"request": "a time trial"})
	game := waitJob(t, ts, ann, o["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)

	_, se := do(t, "POST", ts.URL+"/v1/series", ann, js(map[string]any{"opponentId": bobID, "games": []string{game}}), "application/json")
	sid := se["id"].(string)
	round := func(tok string, log string) map[string]any {
		_, out := do(t, "POST", ts.URL+"/v1/series/"+sid+"/rounds/1", tok, js(map[string]any{"log": log}), "application/json")
		return out
	}
	// the faster time wins; a run that doesn't finish loses to one that does
	round(ann, runLog(7, "won", 0, 40000))
	out := round(bob, runLog(7, "won", 0, 30000))
	if out["status"] != "done" || out["winner"] != "me" || out["rounds"].([]any)[0].(map[string]any)["winner"] != "me" { // bob's view: his 30 s beats ann's 40 s
		t.Fatalf("the faster time wins: %v", out)
	}

	// a lost run on a finished-only game is a DNF
	_, se = do(t, "POST", ts.URL+"/v1/series", ann, js(map[string]any{"opponentId": bobID, "games": []string{game}}), "application/json")
	sid = se["id"].(string)
	round(ann, runLog(8, "lost", 0, 20000)) // quicker, but it didn't finish
	out = round(bob, runLog(8, "won", 0, 90000))
	if out["winner"] != "me" || out["rounds"].([]any)[0].(map[string]any)["winner"] != "me" {
		t.Fatalf("a finished run beats a DNF (bob's view): %v", out)
	}
}
