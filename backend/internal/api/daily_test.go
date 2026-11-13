package api_test

import (
	"strings"
	"testing"
)

func TestGroupDaily(t *testing.T) {
	gen := newFakeGenerator(t)
	ts := serverWithPush(t, gen.URL, nil)
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")

	// a Group with a stable id; the id can't be taken twice or be malformed
	code, grp := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"id": "group-newinsf", "name": "New in SF", "coverSeed": "newinsf-bay"}), "application/json")
	if code != 201 || grp["id"] != "group-newinsf" || grp["coverSeed"] != "newinsf-bay" {
		t.Fatalf("create with id: %d %v", code, grp)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/groups", bob, js(map[string]any{"id": "group-newinsf", "name": "Squat"}), "application/json"); code != 409 {
		t.Fatalf("taken id: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/groups", bob, js(map[string]any{"id": "Bad_ID", "name": "Bad"}), "application/json"); code != 400 {
		t.Fatalf("bad id: %d", code)
	}
	gid := "group-newinsf"
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", bob, nil, "")
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", cat, nil, "")

	_, out := startJob(t, ts, ann, map[string]any{"request": "a daily game"})
	gameID := waitJob(t, ts, ann, out["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)

	if code, _ := do(t, "GET", ts.URL+"/v1/groups/"+gid+"/daily", bob, nil, ""); code != 404 {
		t.Fatalf("no daily yet: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/groups/"+gid+"/daily", bob, js(map[string]any{"gameId": gameID}), "application/json"); code != 403 {
		t.Fatalf("a member can't set it: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/groups/"+gid+"/daily", ann, js(map[string]any{"gameId": gameID, "date": "13-11-2026"}), "application/json"); code != 400 {
		t.Fatalf("bad date: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/groups/"+gid+"/daily", ann, js(map[string]any{"gameId": "aaaaaaaaaaaaaaaaaaaaaaaa"}), "application/json"); code != 404 {
		t.Fatalf("unknown game: %d", code)
	}
	code, set := do(t, "POST", ts.URL+"/v1/groups/"+gid+"/daily", ann, js(map[string]any{"gameId": gameID, "date": "2026-11-13"}), "application/json")
	if code != 201 || set["date"] != "2026-11-13" || set["recipients"].(float64) != 2 || set["game"].(map[string]any)["id"] != gameID {
		t.Fatalf("set: %d %v", code, set)
	}
	// a retry notifies nobody twice
	do(t, "POST", ts.URL+"/v1/groups/"+gid+"/daily", ann, js(map[string]any{"gameId": gameID, "date": "2026-11-13"}), "application/json")

	for _, tok := range []string{bob, cat} {
		items := inbox(t, ts, tok, "")["items"].([]any)
		n := 0
		for _, it := range items {
			m := it.(map[string]any)
			if m["kind"] == "daily_ready" {
				n++
				if m["gameId"] != gameID || m["groupId"] != gid || !strings.Contains(m["title"].(string), "New in SF") {
					t.Fatalf("notification: %v", m)
				}
			}
		}
		if n != 1 {
			t.Fatalf("want one daily_ready, got %d: %v", n, items)
		}
	}
	for _, it := range inbox(t, ts, ann, "")["items"].([]any) {
		if it.(map[string]any)["kind"] == "daily_ready" {
			t.Fatal("the owner who set it isn't notified")
		}
	}

	// today's, and the latest before a later date
	code, got := do(t, "GET", ts.URL+"/v1/groups/"+gid+"/daily?date=2026-11-13", "", nil, "")
	if code != 200 || got["isToday"] != true || got["gameId"] != gameID {
		t.Fatalf("get: %d %v", code, got)
	}
	code, got = do(t, "GET", ts.URL+"/v1/groups/"+gid+"/daily?date=2026-11-14", "", nil, "")
	if code != 200 || got["isToday"] != false || got["date"] != "2026-11-13" {
		t.Fatalf("latest: %d %v", code, got)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/groups/"+gid+"/daily?date=2026-11-12", "", nil, ""); code != 404 {
		t.Fatalf("before any: %d", code)
	}

	// Events have no Daily
	_, ev := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"kind": "event", "name": "Picnic"}), "application/json")
	if code, _ := do(t, "POST", ts.URL+"/v1/groups/"+ev["id"].(string)+"/daily", ann, js(map[string]any{"gameId": gameID}), "application/json"); code != 422 {
		t.Fatalf("event daily: %d", code)
	}
}
