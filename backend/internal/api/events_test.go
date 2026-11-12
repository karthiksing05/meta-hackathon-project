package api_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func publish(t *testing.T, base, tok, manifestJSON string) (int, map[string]any) {
	t.Helper()
	z := makeZip(t, map[string]string{"manifest.json": manifestJSON, "game.js": "1"})
	return do(t, "POST", base+"/v1/creations", tok, bytes.NewReader(z), "application/zip")
}

func post(t *testing.T, base, tok string, body any) (int, map[string]any) {
	t.Helper()
	return do(t, "POST", base+"/v1/feed/events", tok, js(body), "application/json")
}

func TestUnknownKindsAreStoredAndBadOnesRejected(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "kev")
	_, g := publish(t, ts.URL, tok, manifest)
	id := g["id"].(string)

	// an unknown type or kind is stored, not rejected, and the old ones keep working
	body := map[string]any{"events": []map[string]any{
		{"gameId": id, "type": "play"},
		{"gameID": id, "kind": "challenge_accepted", "with": []string{"u7"}, "day": 312},
		{"gameId": id, "type": "brand_new_signal"},
	}}
	if code, out := post(t, ts.URL, tok, body); code != 202 || out["accepted"].(float64) != 3 {
		t.Fatalf("mixed batch: %d %v", code, out)
	}
	for name, ev := range map[string]map[string]any{
		"bad kind shape": {"gameID": id, "kind": "Not Snake Case!"},
		"no game":        {"kind": "share"},
		"bare event":     {"gameID": id},
		"bad team":       {"gameID": id, "feedItemID": "f1", "team": "C"},
		"bad propensity": {"gameID": id, "feedItemID": "f1", "propensity": 1.5},
	} {
		if code, _ := post(t, ts.URL, tok, map[string]any{"events": []any{ev}}); code != 400 {
			t.Errorf("%s: want 400, got %d", name, code)
		}
	}
}

func TestEventIDsDedupe(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "dee")
	_, g := publish(t, ts.URL, tok, manifest)
	id := g["id"].(string)

	page := map[string]any{"eventID": "e1", "gameID": id, "feedItemID": "f1", "position": 0, "tookOver": true, "runsFinished": 1}
	body := map[string]any{"events": []any{page, page}} // a repeat inside one batch
	if _, out := post(t, ts.URL, tok, body); out["accepted"].(float64) != 1 || out["duplicates"].(float64) != 1 {
		t.Fatalf("repeat in batch: %v", out)
	}
	if _, out := post(t, ts.URL, tok, map[string]any{"events": []any{page}}); out["accepted"].(float64) != 0 {
		t.Fatalf("resend must be a no-op: %v", out)
	}
	if _, out := do(t, "GET", ts.URL+"/v1/games/"+id, "", nil, ""); out["plays"].(float64) != 1 || out["finishes"].(float64) != 1 {
		t.Fatalf("counters counted a resend: %v", out)
	}
	// the same eventID from a different person is a different event
	tok2 := register(t, ts, "dee2")
	if _, out := post(t, ts.URL, tok2, map[string]any{"events": []any{page}}); out["accepted"].(float64) != 1 {
		t.Fatalf("eventIDs are per person: %v", out)
	}
}

func TestGameStats(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "sam")
	_, g := publish(t, ts.URL, tok, `{"id":"fog-words","title":"Fog Words","one_line_rule":"x","structure":{"scope":"group:new-in-sf"}}`)
	id := g["id"].(string)
	if g["slug"] != "fog-words" || g["groupId"] != "new-in-sf" {
		t.Fatalf("slug and group from the manifest: %v", g)
	}

	// events may name the game by slug; one more game has no events yet
	_, _ = publish(t, ts.URL, tok, `{"title":"Quiet","one_line_rule":"y"}`)
	post(t, ts.URL, tok, map[string]any{"events": []any{
		map[string]any{"gameID": "fog-words", "feedItemID": "a", "tookOver": true, "runsFinished": 2, "replays": 1},
		map[string]any{"gameID": id, "feedItemID": "b"},
		map[string]any{"gameID": "fog-words", "feedItemID": "c", "tookOver": true, "social": []string{"challenge_sent"}},
		map[string]any{"gameID": "fog-words", "kind": "remix"},
		map[string]any{"gameID": "phone-only-seed", "feedItemID": "d"},
	}})

	code, out := do(t, "GET", ts.URL+"/v1/games/stats", "", nil, "")
	if code != 200 {
		t.Fatalf("stats: %d", code)
	}
	rows := map[string]map[string]any{}
	for _, r := range out["games"].([]any) {
		m := r.(map[string]any)
		rows[m["gameID"].(string)] = m
	}
	fog := rows["fog-words"]
	want := map[string]float64{"impressions": 3, "takeovers": 2, "finishes": 2, "satisfied": 2, "replays": 1, "socialMoments": 2}
	for k, v := range want {
		if fog[k].(float64) != v {
			t.Errorf("fog-words %s = %v, want %v (row %v)", k, fog[k], v, fog)
		}
	}
	if fog["id"] != id || fog["groupID"] != "new-in-sf" || fog["creatorID"] == nil || fog["createdDay"] == nil {
		t.Errorf("metadata: %v", fog)
	}
	if len(rows) != 3 || rows["phone-only-seed"]["impressions"].(float64) != 1 {
		t.Errorf("a phone-only game and a game with no events both appear: %v", rows)
	}

	// since filters out older events
	_, none := do(t, "GET", ts.URL+"/v1/games/stats?since=4102444800000", "", nil, "")
	for _, r := range none["games"].([]any) {
		if r.(map[string]any)["impressions"].(float64) != 0 {
			t.Errorf("since in the future must see no events: %v", r)
		}
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/games/stats?since=yesterday", "", nil, ""); code != 400 {
		t.Errorf("bad since: %d", code)
	}
}

func TestInterleave(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "ilv")
	_, g := publish(t, ts.URL, tok, manifest)
	id := g["id"].(string)

	page := func(session, team string, finished int) map[string]any {
		return map[string]any{"gameID": id, "feedItemID": session + team, "sessionID": session, "team": team, "runsFinished": finished}
	}
	post(t, ts.URL, tok, map[string]any{"events": []any{
		page("s1", "A", 1), page("s1", "A", 1), page("s1", "B", 1), // formula wins
		page("s2", "B", 1), page("s2", "A", 0), // control wins
		page("s3", "A", 1), page("s3", "B", 1), // tie
		page("s4", "A", 0), page("s4", "B", 0), // nobody paid off: tie
		map[string]any{"gameID": id, "feedItemID": "x", "sessionID": "s5", "tookOver": true, "runsFinished": 1}, // no team: ignored
	}})
	_, out := do(t, "GET", ts.URL+"/v1/experiments/interleave", "", nil, "")
	got := out["baseline"].(map[string]any)
	if got["sessions"].(float64) != 4 || got["formulaWins"].(float64) != 1 || got["controlWins"].(float64) != 1 || got["ties"].(float64) != 2 {
		t.Fatalf("interleave: %v", out)
	}
}

func TestExportNeedsAuthAndKeepsShape(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "exp")
	_, g := publish(t, ts.URL, tok, manifest)
	id := g["id"].(string)
	post(t, ts.URL, tok, map[string]any{"events": []any{
		map[string]any{"eventID": "e1", "userID": "u1", "gameID": id, "feedItemID": "f1", "position": 2, "team": "formula",
			"score": 0.71, "propensity": 0.18, "tookOver": true, "saved": true, "social": []string{"challenge_sent"}},
		map[string]any{"eventID": "e2", "userID": "u1", "gameID": id, "kind": "challenge_accepted", "with": []string{"u7"}, "day": 312},
	}})

	if code, _ := do(t, "GET", ts.URL+"/v1/events/export", "", nil, ""); code != 401 {
		t.Fatalf("export without auth: %d", code)
	}
	req, _ := http.NewRequest("GET", ts.URL+"/v1/events/export", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "application/x-ndjson") || res.Header.Get("X-Next-Since") == "" {
		t.Fatalf("headers: %v", res.Header)
	}
	var lines []map[string]any
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("not JSON lines: %v", err)
		}
		lines = append(lines, m)
	}
	if len(lines) != 2 {
		t.Fatalf("lines: %v", lines)
	}
	p := lines[0]
	if p["eventID"] != "e1" || p["userID"] != "u1" || p["team"] != "A" || p["propensity"].(float64) != 0.18 || p["score"].(float64) != 0.71 || p["saved"] != true {
		t.Errorf("page event: %v", p)
	}
	if lines[1]["kind"] != "challenge_accepted" || lines[1]["day"].(float64) != 312 {
		t.Errorf("moment event: %v", lines[1])
	}
}

func TestSlugsAndIntegerScores(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "slug")
	code, g := publish(t, ts.URL, tok, `{"id":"hill-hopper","title":"Hill Hopper","one_line_rule":"hop"}`)
	if code != 201 || g["slug"] != "hill-hopper" {
		t.Fatalf("create with slug: %d %v", code, g)
	}
	if code, _ := publish(t, ts.URL, tok, `{"id":"hill-hopper","title":"Copy","one_line_rule":"hop"}`); code != 422 {
		t.Fatalf("a taken slug must be refused: %d", code)
	}
	// the slug reaches the game, its leaderboard and score submission
	if code, out := do(t, "GET", ts.URL+"/v1/games/hill-hopper", "", nil, ""); code != 200 || out["id"] != g["id"] {
		t.Fatalf("get by slug: %d %v", code, out)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/games/hill-hopper/scores", tok, js(map[string]any{"score": 7.5}), "application/json"); code != 400 {
		t.Fatalf("fractional score: %d", code)
	}
	if code, out := do(t, "POST", ts.URL+"/v1/games/hill-hopper/scores", tok, js(map[string]any{"score": 42}), "application/json"); code != 200 {
		t.Fatalf("whole score: %d %v", code, out)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/games/Not_A_Slug!", "", nil, ""); code != 404 {
		t.Fatalf("junk id: %d", code)
	}
}
