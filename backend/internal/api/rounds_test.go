package api_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// stateLog is a finished run whose end state carries the named values (what the engine's replay reports).
func stateLog(seed int, score, timeMs int, state map[string]any) string {
	st, _ := json.Marshal(state)
	return fmt.Sprintf(`{"format":"microgame-log/1","seed":%d,"game_hash":"x","calls":[],"final":{"state_hash":"h","phase":"won","score":%d,"time_ms":%d,"state":%s}}`, seed, score, timeMs, st)
}

func TestRounds(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	annID, bobID, catID := meID(t, ts, ann), meID(t, ts, bob), meID(t, ts, cat)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	do(t, "PUT", ts.URL+"/v1/me/friends/"+catID, ann, nil, "")

	make := func(slug, extra string) string {
		gen.mu.Lock()
		gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", slug, 1)
		gen.manifest = strings.Replace(gen.manifest, `"formula":"microgame"`, `"formula":"microgame",`+extra, 1)
		gen.mu.Unlock()
		_, out := startJob(t, ts, ann, map[string]any{"request": "a game " + slug})
		return waitJob(t, ts, ann, out["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	}
	quiz := make("round-quiz", `"group_play":{"mode":"group_round","modes":["same_seed_async","group_round"],"round_seconds":45,"result":{"kind":"score","compare":"score","display":"{score} right","state":[]},"share_line":"{name}: {result} on {title}. Your turn.","same_seed":true}`)
	opinion := make("round-cars", `"score":{"kind":"points","ranked":false},"group_play":{"mode":"opinion_compare","result":{"kind":"picks","compare":"agreement","display":"{agreement}% in sync","state":["picks"]},"share_line":"{name} rated {title}. Compare.","same_seed":true}`)
	story := make("round-story", `"group_play":{"mode":"same_seed_async","result":{"kind":"ending","compare":"ending","display":"{ending}","endings":["king","pauper","exile"],"state":["ending","choices_used"]},"share_line":"{name}: {result} in {choices} choices.","same_seed":true}`)

	// the game says how it is played together
	_, g := do(t, "GET", ts.URL+"/v1/games/"+quiz, "", nil, "")
	gp, _ := g["group_play"].(map[string]any)
	if gp == nil || gp["mode"] != "group_round" || gp["round_seconds"].(float64) != 45 || gp["result"].(map[string]any)["compare"] != "score" {
		t.Fatalf("group_play on the game: %v", g["group_play"])
	}

	start := func(tok string, body map[string]any) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/rounds", tok, js(body), "application/json")
	}
	chat := func(game string, members ...string) map[string]any {
		return map[string]any{"gameId": game, "target": map[string]any{"kind": "chat", "id": "thread-1"}, "members": members}
	}
	if code, _ := start(ann, chat(quiz, catID, bobID, "0123456789abcdef01234567")); code != 400 {
		t.Fatalf("a round with a stranger: %d", code)
	}
	if code, _ := start(ann, map[string]any{"gameId": quiz, "target": map[string]any{"kind": "chat", "id": "t"}}); code != 400 {
		t.Fatalf("a chat round with no one in it: %d", code)
	}
	if code, out := start(ann, map[string]any{"gameId": quiz, "mode": "series", "target": map[string]any{"kind": "chat", "id": "t"}, "members": []string{bobID}}); code != 400 || !strings.Contains(fmt.Sprint(out["error"]), "/v1/series") {
		t.Fatalf("a series is not a round: %d %v", code, out)
	}
	if code, _ := start(ann, chat("000000000000000000000000", bobID)); code != 404 {
		t.Fatalf("unknown game: %d", code)
	}
	if code, _ := start(ann, map[string]any{"gameId": quiz, "target": map[string]any{"kind": "group", "id": "nope"}}); code != 403 {
		t.Fatalf("a Group you are not in: %d", code)
	}
	code, rd := start(ann, chat(quiz, bobID, catID))
	if code != 201 || rd["mode"] != "group_round" || rd["length"].(float64) != 45 || len(rd["members"].([]any)) != 3 || rd["finished"] != false || rd["seed"] == nil {
		t.Fatalf("start: %d %v", code, rd)
	}
	rid := rd["id"].(string)
	play := func(tok, id string, log string) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/rounds/"+id+"/plays", tok, js(map[string]any{"log": log}), "application/json")
	}

	// bob sees the round as a moment; a stranger cannot see it
	_, ms := do(t, "GET", ts.URL+"/v1/me/moments", bob, nil, "")
	if m := ms["moments"].([]any); len(m) != 1 || m[0].(map[string]any)["kind"] != "round_started" {
		t.Fatalf("round_started moment: %v", ms)
	}
	dan := register(t, ts, "dan")
	if code, _ := do(t, "GET", ts.URL+"/v1/rounds/"+rid, dan, nil, ""); code != 404 {
		t.Fatalf("a stranger saw the round: %d", code)
	}

	// bob plays and the thread gets a line; a second run, a wrong seed and a forged run are refused
	if code, out := play(bob, rid, runLog(111, "won", 7, 5000)); code != 200 {
		t.Fatalf("bob: %d %v", code, out)
	}
	if code, _ := play(bob, rid, runLog(111, "won", 7, 5000)); code != 409 {
		t.Fatalf("a second run: %d", code)
	}
	if code, _ := play(cat, rid, runLog(222, "won", 4, 5000)); code != 422 {
		t.Fatalf("a different seed: %d", code)
	}
	if code, _ := play(cat, rid, runLog(111, "won", 99999, 5000)); code != 422 {
		t.Fatalf("a forged run: %d", code)
	}
	if code, _ := play(dan, rid, runLog(111, "won", 5, 5000)); code != 404 {
		t.Fatalf("a stranger played: %d", code)
	}
	_, view := do(t, "GET", ts.URL+"/v1/rounds/"+rid, ann, nil, "")
	lines := view["lines"].([]any)
	if len(lines) != 1 || !strings.HasPrefix(lines[0].(map[string]any)["text"].(string), "bob: 7 right on Fog Walk") || view["finished"] != false {
		t.Fatalf("lines: %v", view["lines"])
	}
	_, ms = do(t, "GET", ts.URL+"/v1/me/moments", ann, nil, "")
	if m := ms["moments"].([]any); len(m) != 1 || m[0].(map[string]any)["kind"] != "round_played" {
		t.Fatalf("round_played moment: %v", ms)
	}

	// ann and cat play: everyone has, so the round is over and the best score wins
	play(ann, rid, runLog(111, "won", 9, 6000))
	if code, out := play(cat, rid, runLog(111, "won", 4, 3000)); code != 200 || out["finished"] != true {
		t.Fatalf("cat: %d %v", code, out)
	}
	_, view = do(t, "GET", ts.URL+"/v1/rounds/"+rid, bob, nil, "")
	order := view["order"].([]any)
	if view["winnerId"] != annID || len(order) != 3 || order[0] != annID || order[1] != bobID || order[2] != catID || len(view["lines"].([]any)) != 3 {
		t.Fatalf("finished round: %v", view)
	}
	_, list := do(t, "GET", ts.URL+"/v1/rounds?target=chat:thread-1", ann, nil, "")
	if items := list["items"].([]any); len(items) != 1 {
		t.Fatalf("rounds for the thread: %v", list)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/rounds?target=bogus", ann, nil, ""); code != 400 {
		t.Fatalf("a bad target: %d", code)
	}

	// a story ranks by the ending (best first), then the score
	_, srd := start(ann, chat(story, bobID, catID))
	sid := srd["id"].(string)
	play(bob, sid, stateLog(5, 10, 100, map[string]any{"ending": "exile", "choices_used": 4, "secret": "x"}))
	play(cat, sid, stateLog(5, 1, 100, map[string]any{"ending": "king", "choices_used": 9}))
	_, out := play(ann, sid, stateLog(5, 50, 100, map[string]any{"ending": "pauper", "choices_used": 2}))
	o, _ := out["order"].([]any)
	if len(o) != 3 || out["winnerId"] != catID || o[0] != catID || o[1] != annID || o[2] != bobID {
		t.Fatalf("story order: %v", out)
	}
	if res := out["plays"].(map[string]any)[bobID].(map[string]any)["result"].(map[string]any); res["secret"] != nil || res["ending"] != "exile" {
		t.Fatalf("only the named end state is kept: %v", res)
	}
	if l := out["lines"].([]any); l[0].(map[string]any)["text"] != "bob: exile in 4 choices." {
		t.Fatalf("story line: %v", l[0])
	}

	// an opinion game has no winner: agreement per pair, and from the game's own endpoint
	if code, _ := do(t, "GET", ts.URL+"/v1/games/"+opinion+"/agreement?with="+bobID, ann, nil, ""); code != 409 {
		t.Fatalf("agreement before anyone played: %d", code)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/games/"+quiz+"/agreement?with="+bobID, ann, nil, ""); code != 422 {
		t.Fatalf("agreement on a scored game: %d", code)
	}
	_, ord := start(ann, chat(opinion, bobID, catID))
	oid := ord["id"].(string)
	play(ann, oid, stateLog(7, 0, 100, map[string]any{"picks": []any{"audi", "bmw", "kia", "ford"}}))
	play(bob, oid, stateLog(7, 0, 100, map[string]any{"picks": []any{"audi", "bmw", "fiat", "ford"}}))
	_, out = play(cat, oid, stateLog(7, 0, 100, map[string]any{"picks": []any{"audi", "volvo", "kia", "opel"}}))
	if out["winnerId"] != nil || out["order"] != nil || out["finished"] != true {
		t.Fatalf("an opinion round has no winner: %v", out)
	}
	_, view = do(t, "GET", ts.URL+"/v1/rounds/"+oid, ann, nil, "")
	ag, _ := view["agreement"].([]any)
	if len(ag) != 2 {
		t.Fatalf("agreement in the round: %v", view["agreement"])
	}
	want := map[string]float64{bobID: 75, catID: 50}
	for _, a := range ag {
		m := a.(map[string]any)
		if m["percent"].(float64) != want[m["userId"].(string)] {
			t.Fatalf("pair agreement: %v", ag)
		}
	}
	code, agr := do(t, "GET", ts.URL+"/v1/games/"+opinion+"/agreement?with="+bobID, ann, nil, "")
	if code != 200 || agr["agreement"].(float64) != 75 || agr["players"].(float64) != 2 || len(agr["items"].([]any)) != 4 {
		t.Fatalf("agreement with bob: %d %v", code, agr)
	}
	_, agr = do(t, "GET", ts.URL+"/v1/games/"+opinion+"/agreement?scope=friends", ann, nil, "")
	items, _ := agr["items"].([]any)
	if len(items) != 4 {
		t.Fatalf("agreement with friends: %v", agr)
	}
	second := items[1].(map[string]any) // ann picked bmw; bob bmw, cat volvo
	if agr["agreement"].(float64) != 63 || agr["players"].(float64) != 3 || second["item"] != "2" || second["mine"] != "bmw" || second["share"].(float64) != 0.5 {
		t.Fatalf("agreement with friends: %v", agr)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/games/"+opinion+"/agreement?with=0123456789abcdef01234567", ann, nil, ""); code != 403 {
		t.Fatalf("agreement with a stranger: %d", code)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/games/"+opinion+"/agreement", ann, nil, ""); code != 400 {
		t.Fatalf("agreement with nothing to compare: %d", code)
	}
}
