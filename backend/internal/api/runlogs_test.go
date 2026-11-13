package api_test

import (
	"fmt"
	"strings"
	"testing"
)

// replayOf is a runtime replay log (what the app plays as a Burst) for one run.
func replayOf(seed, ticks int) map[string]any {
	return map[string]any{"seed": seed, "tick_rate": 60, "total_ticks": ticks,
		"inputs": []any{map[string]any{"t": 12, "a": "tap", "v": []float64{180, 320}}, map[string]any{"t": 14, "a": "up", "v": []float64{180, 320}}}}
}

func TestWatchAFriendsRun(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	maya, alex, cat, dan := register(t, ts, "maya"), register(t, ts, "alex"), register(t, ts, "cat"), register(t, ts, "dan")
	mayaID, alexID, danID := meID(t, ts, maya), meID(t, ts, alex), meID(t, ts, dan)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+mayaID, alex, nil, "") // alex and maya are friends; cat and dan are not

	gen.mu.Lock()
	gen.manifest = strings.Replace(strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "burst-watch", 1), `"formula":"microgame"`, `"formula":"microgame","score":{"kind":"points"}`, 1)
	gen.mu.Unlock()
	_, o := startJob(t, ts, maya, map[string]any{"request": "a game to watch"})
	game := waitJob(t, ts, maya, o["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	post := func(tok string, body map[string]any) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", tok, js(body), "application/json")
	}
	logURL := func(userID string) string { return fmt.Sprintf("%s/v1/games/%s/runs/%s/log", ts.URL, game, userID) }
	rowOf := func(out map[string]any, userID string) map[string]any {
		for _, r := range out["items"].([]any) {
			if row := r.(map[string]any); row["userId"] == userID {
				return row
			}
		}
		return nil
	}

	// a malformed or oversized replay is refused before anything is counted
	if code, _ := post(maya, map[string]any{"log": runLog(3, "won", 40, 9000), "replay": map[string]any{"inputs": []any{}}}); code != 400 {
		t.Fatalf("a replay without a seed: %d", code)
	}
	big := replayOf(3, 600)
	big["inputs"] = make([]any, 40001)
	for i := range big["inputs"].([]any) {
		big["inputs"].([]any)[i] = 0
	}
	if code, _ := post(maya, map[string]any{"log": runLog(3, "won", 40, 9000), "replay": big}); code != 400 {
		t.Fatalf("a replay with too many inputs: %d", code)
	}

	// maya's counted run keeps its replay; her own board row offers it
	code, out := post(maya, map[string]any{"log": runLog(3, "won", 40, 9000), "replay": replayOf(3, 600)})
	if code != 200 || out["counted"] != true {
		t.Fatalf("maya's run: %d %v", code, out)
	}
	if row := rowOf(out, mayaID); row == nil || row["replayAvailable"] != true || row["replayUrl"] != "/v1/games/"+game+"/runs/"+mayaID+"/log" {
		t.Fatalf("maya's own row: %v", out)
	}

	// her friend sees Watch on her row and gets the replay; signed out and strangers don't
	_, board := do(t, "GET", ts.URL+"/v1/games/"+game+"/leaderboard", alex, nil, "")
	if row := rowOf(board, mayaID); row == nil || row["replayAvailable"] != true {
		t.Fatalf("alex's board: %v", board)
	}
	code, l := do(t, "GET", logURL(mayaID), alex, nil, "")
	rp, _ := l["replay"].(map[string]any)
	if code != 200 || l["userId"] != mayaID || l["score"].(float64) != 40 || rp == nil || rp["seed"].(float64) != 3 || len(rp["inputs"].([]any)) != 2 {
		t.Fatalf("alex watches maya: %d %v", code, l)
	}
	if _, has := l["engineLog"]; has {
		t.Fatalf("the engine log stays on the server: %v", l)
	}
	_, board = do(t, "GET", ts.URL+"/v1/games/"+game+"/leaderboard", "", nil, "")
	if row := rowOf(board, mayaID); row == nil || row["replayAvailable"] != nil {
		t.Fatalf("signed out: %v", board)
	}
	_, board = do(t, "GET", ts.URL+"/v1/games/"+game+"/leaderboard", cat, nil, "")
	if row := rowOf(board, mayaID); row == nil || row["replayAvailable"] != nil {
		t.Fatalf("a stranger's board: %v", board)
	}
	if code, _ := do(t, "GET", logURL(mayaID), cat, nil, ""); code != 403 {
		t.Fatalf("a stranger watches: %d", code)
	}
	if code, _ := do(t, "GET", logURL(mayaID), "", nil, ""); code != 401 {
		t.Fatalf("signed out watches: %d", code)
	}

	// a Group-mate may watch: dan joins a Group maya is in
	code, g := do(t, "POST", ts.URL+"/v1/groups", maya, js(map[string]any{"name": "Burst Club", "category": "Social"}), "application/json")
	if code != 201 {
		t.Fatalf("group: %d %v", code, g)
	}
	if code, _ := do(t, "GET", logURL(mayaID), dan, nil, ""); code != 403 {
		t.Fatalf("dan before joining: %d", code)
	}
	do(t, "PUT", ts.URL+"/v1/groups/"+g["id"].(string)+"/members/me", dan, nil, "")
	if code, _ := do(t, "GET", logURL(mayaID), dan, nil, ""); code != 200 {
		t.Fatalf("a Group-mate watches: %d", code)
	}
	_, board = do(t, "GET", ts.URL+"/v1/games/"+game+"/leaderboard", dan, nil, "")
	if row := rowOf(board, mayaID); row == nil || row["replayAvailable"] != true {
		t.Fatalf("a Group-mate's board: %v", board)
	}

	// a run that isn't better keeps the old replay; a better one without a replay hides the row's Watch
	post(maya, map[string]any{"log": runLog(4, "won", 10, 9000), "replay": replayOf(4, 300)})
	_, l = do(t, "GET", logURL(mayaID), alex, nil, "")
	if l["replay"].(map[string]any)["seed"].(float64) != 3 {
		t.Fatalf("a worse run replaced the replay: %v", l)
	}
	_, out = post(maya, map[string]any{"log": runLog(5, "won", 90, 9000)})
	if row := rowOf(out, mayaID); out["counted"] != true || row == nil || row["replayAvailable"] != nil {
		t.Fatalf("a better run with no replay: %v", out)
	}

	// a person with no kept run: 404 for a friend
	do(t, "PUT", ts.URL+"/v1/me/friends/"+danID, alex, nil, "")
	if code, _ := do(t, "GET", logURL(danID), alex, nil, ""); code != 404 {
		t.Fatalf("no run: %d", code)
	}
	_ = alexID

	// a game without a score model keeps the replay of the best plain score
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "plain-watch", 1)
	gen.mu.Unlock()
	_, o = startJob(t, ts, maya, map[string]any{"request": "a plain game"})
	plain := waitJob(t, ts, maya, o["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	do(t, "POST", ts.URL+"/v1/games/"+plain+"/scores", maya, js(map[string]any{"score": 12, "replay": replayOf(9, 100)}), "application/json")
	do(t, "POST", ts.URL+"/v1/games/"+plain+"/scores", maya, js(map[string]any{"score": 5, "replay": replayOf(10, 100)}), "application/json")
	code, l = do(t, "GET", fmt.Sprintf("%s/v1/games/%s/runs/%s/log", ts.URL, plain, mayaID), alex, nil, "")
	if code != 200 || l["replay"].(map[string]any)["seed"].(float64) != 9 || l["score"].(float64) != 12 {
		t.Fatalf("plain game replay: %d %v", code, l)
	}
}
