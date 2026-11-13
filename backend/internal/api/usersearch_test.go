package api_test

import "testing"

func TestUserSearch(t *testing.T) {
	ts := serverWithRecs(t, false)
	me := register(t, ts, "annabel")
	register(t, ts, "anders")
	bob := register(t, ts, "bob_anne") // matches "ann" by no prefix; "anne" is inside the name
	cat := register(t, ts, "cat")
	catID := meID(t, ts, cat)
	_ = bob
	do(t, "PUT", ts.URL+"/v1/me/friends/"+catID, me, nil, "")

	names := func(q string) (int, []string) {
		code, out := do(t, "GET", ts.URL+"/v1/users?q="+q, me, nil, "")
		var got []string
		if items, ok := out["items"].([]any); ok {
			for _, it := range items {
				m := it.(map[string]any)
				if m["email"] != nil {
					t.Fatalf("email leaked: %v", m)
				}
				got = append(got, m["username"].(string))
			}
		}
		return code, got
	}
	if code, got := names("an"); code != 200 || len(got) != 1 || got[0] != "anders" { // not me, not bob_anne
		t.Fatalf("prefix search: %d %v", code, got)
	}
	if _, got := names("ANDERS"); len(got) != 1 { // case-insensitive
		t.Fatalf("case: %v", got)
	}
	if code, got := names("c"); code != 400 || got != nil { // too short
		t.Fatalf("one letter: %d %v", code, got)
	}
	code, out := do(t, "GET", ts.URL+"/v1/users?q=cat", me, nil, "")
	if code != 200 || out["items"].([]any)[0].(map[string]any)["isFriend"] != true {
		t.Fatalf("friend flag: %d %v", code, out)
	}
	if _, got := names("zzz"); len(got) != 0 {
		t.Fatalf("no match: %v", got)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/users?q=an", "", nil, ""); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	// regex characters are text, not patterns
	if code, got := names("a.*"); code != 200 || len(got) != 0 {
		t.Fatalf("regex injection: %d %v", code, got)
	}
}

func TestGroupWeeklyBoard(t *testing.T) {
	ts := serverWithRecs(t, false)
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	annID, bobID := meID(t, ts, ann), meID(t, ts, bob)
	_, g := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Board club"}), "application/json")
	gid := g["id"].(string)
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", bob, nil, "")

	make := func(slug string) string {
		m := `{"id":"` + slug + `","title":"` + slug + `","one_line_rule":"x","formula":"guess","brief":{"mood":["cozy"]},"structure":{"scope":"group:` + gid + `"}}`
		code, out := publish(t, ts.URL, ann, m)
		if code != 201 {
			t.Fatalf("publish %s: %d %v", slug, code, out)
		}
		return out["id"].(string)
	}
	g1, g2 := make("board-game-one"), make("board-game-two")
	score := func(tok, game string, n int) {
		do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", tok, js(map[string]any{"score": n}), "application/json")
	}
	score(ann, g1, 50)
	score(bob, g1, 30)
	score(cat, g1, 99) // not in the Group
	score(bob, g2, 9)

	url := ts.URL + "/v1/groups/" + gid + "/leaderboard"
	code, out := do(t, "GET", url, ann, nil, "")
	items, _ := out["items"].([]any)
	if code != 200 || len(items) != 2 || out["week"] == "" || out["games"].(float64) != 2 {
		t.Fatalf("board: %d %v", code, out)
	}
	first, second := items[0].(map[string]any), items[1].(map[string]any)
	// game one: ann 10, bob 7; game two: bob 10. bob 17 in two games, ann 10 in one.
	if first["user"].(map[string]any)["id"] != bobID || first["points"].(float64) != 17 || first["gamesPlayed"].(float64) != 2 || first["rank"].(float64) != 1 ||
		second["user"].(map[string]any)["id"] != annID || second["points"].(float64) != 10 || second["rank"].(float64) != 2 || second["rankChange"].(float64) != 0 {
		t.Fatalf("rows: %v", items)
	}
	if code, o := do(t, "GET", url+"?week=2020-W01", ann, nil, ""); code != 200 || len(o["items"].([]any)) != 0 || o["week"] != "2020-W01" {
		t.Fatalf("an old week is empty: %d %v", code, o)
	}
	for _, q := range []string{"?week=nope", "?week=2026-W00", "?week=2026-W54", "?week=2025-W53"} {
		if code, _ := do(t, "GET", url+q, ann, nil, ""); code != 400 {
			t.Fatalf("%s: %d", q, code)
		}
	}
	if code, _ := do(t, "GET", url, cat, nil, ""); code != 403 {
		t.Fatalf("a non-member: %d", code)
	}
	if code, _ := do(t, "GET", url, "", nil, ""); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
}
