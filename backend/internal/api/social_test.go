package api_test

import (
	"fmt"
	"net/http/httptest"
	"testing"
)

func meID(t *testing.T, ts *httptest.Server, tok string) string {
	t.Helper()
	_, me := do(t, "GET", ts.URL+"/v1/auth/me", tok, nil, "")
	return me["id"].(string)
}

func TestFriends(t *testing.T) {
	ts := serverWithRecs(t, false)
	a, b := register(t, ts, "ann"), register(t, ts, "bob")
	aID, bID := meID(t, ts, a), meID(t, ts, b)

	if code, _ := do(t, "PUT", ts.URL+"/v1/me/friends/"+aID, a, nil, ""); code != 400 {
		t.Fatalf("friending yourself: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/me/friends/nobody", a, nil, ""); code != 404 {
		t.Fatalf("unknown person: %d", code)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/me/friends", "", nil, ""); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	for i := 0; i < 2; i++ { // idempotent
		if code, out := do(t, "PUT", ts.URL+"/v1/me/friends/"+bID, a, nil, ""); code != 200 || out["isFriend"] != true {
			t.Fatalf("add: %d %v", code, out)
		}
	}
	_, mine := do(t, "GET", ts.URL+"/v1/me/friends", a, nil, "")
	if items := mine["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != bID || items[0].(map[string]any)["username"] != "bob" {
		t.Fatalf("my friends: %v", mine)
	}
	_, theirs := do(t, "GET", ts.URL+"/v1/me/friends", b, nil, "") // mutual and immediate
	if items := theirs["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != aID {
		t.Fatalf("their friends: %v", theirs)
	}
	if _, p := do(t, "GET", ts.URL+"/v1/users/"+bID, a, nil, ""); p["isFriend"] != true || p["displayName"] == nil || p["email"] != nil {
		t.Fatalf("profile (and no email): %v", p)
	}
	do(t, "DELETE", ts.URL+"/v1/me/friends/"+bID, a, nil, "")
	if _, mine := do(t, "GET", ts.URL+"/v1/me/friends", a, nil, ""); len(mine["items"].([]any)) != 0 {
		t.Fatalf("after removing: %v", mine)
	}
}

func TestGroups(t *testing.T) {
	ts := serverWithRecs(t, true)
	a, b, c := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	aID, bID := meID(t, ts, a), meID(t, ts, b)

	code, g := do(t, "POST", ts.URL+"/v1/groups", a, js(map[string]any{"name": "New in SF", "category": "Social"}), "application/json")
	if code != 201 || g["memberCount"].(float64) != 1 || g["isMember"] != true || g["kind"] != "group" {
		t.Fatalf("create: %d %v", code, g)
	}
	gid := g["id"].(string)
	if code, _ := do(t, "POST", ts.URL+"/v1/groups", a, js(map[string]any{"name": "x"}), "application/json"); code != 400 {
		t.Fatalf("name too short: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", b, nil, ""); code != 200 {
		t.Fatalf("join: %d", code)
	}
	_, one := do(t, "GET", ts.URL+"/v1/groups/"+gid, b, nil, "")
	if len(one["members"].([]any)) != 2 || one["group"].(map[string]any)["isMember"] != true {
		t.Fatalf("group: %v", one)
	}
	_, list := do(t, "GET", ts.URL+"/v1/groups?mine=1", c, nil, "")
	if len(list["items"].([]any)) != 0 {
		t.Fatalf("cat is in no group: %v", list)
	}
	_, all := do(t, "GET", ts.URL+"/v1/groups?kind=group", "", nil, "")
	if len(all["items"].([]any)) != 1 {
		t.Fatalf("signed-out list: %v", all)
	}

	// a private group is invisible and closed to outsiders
	_, pg := do(t, "POST", ts.URL+"/v1/groups", a, js(map[string]any{"name": "Secret club", "private": true}), "application/json")
	pid := pg["id"].(string)
	if code, _ := do(t, "GET", ts.URL+"/v1/groups/"+pid, c, nil, ""); code != 404 {
		t.Fatalf("private group seen by outsider: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+pid+"/members/me", c, nil, ""); code != 403 {
		t.Fatalf("joining a private group: %d", code)
	}

	// games made for the group
	m := fmt.Sprintf(`{"id":"sf-game","title":"SF Game","one_line_rule":"x","formula":"guess","brief":{"mood":["cozy"]},"structure":{"scope":"group:%s"}}`, gid)
	if code, out := publish(t, ts.URL, a, m); code != 201 || out["groupId"] != gid {
		t.Fatalf("publish for the group: %d %v", code, out)
	}
	if _, gg := do(t, "GET", ts.URL+"/v1/groups/"+gid+"/games", "", nil, ""); len(gg["items"].([]any)) != 1 {
		t.Fatalf("group games: %v", gg)
	}

	// Blend for the group's members comes from the server's data
	code, bl := do(t, "POST", ts.URL+"/v1/groups/"+gid+"/blend", a, js(map[string]any{"count": 2}), "application/json")
	if code != 200 || len(bl["picks"].([]any)) != 1 || bl["spec"] == nil {
		t.Fatalf("group blend: %d %v", code, bl)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/groups/"+gid+"/blend", c, js(map[string]any{}), "application/json"); code != 403 {
		t.Fatalf("outsider blend: %d", code)
	}
	code, bi := do(t, "GET", ts.URL+"/v1/groups/"+gid+"/blend-inputs", a, nil, "")
	members := bi["members"].([]any)
	if code != 200 || len(members) != 2 || members[0].(map[string]any)["skill"] == nil || members[0].(map[string]any)["recentGames"] == nil {
		t.Fatalf("blend-inputs: %d %v", code, bi)
	}
	ids := map[any]bool{members[0].(map[string]any)["id"]: true, members[1].(map[string]any)["id"]: true}
	if !ids[aID] || !ids[bID] {
		t.Fatalf("blend-inputs members: %v", members)
	}

	// leaving
	do(t, "DELETE", ts.URL+"/v1/groups/"+gid+"/members/me", b, nil, "")
	if _, one := do(t, "GET", ts.URL+"/v1/groups/"+gid, a, nil, ""); len(one["members"].([]any)) != 1 {
		t.Fatalf("after leaving: %v", one)
	}
}

// A friend's score becomes a "friendBurst" candidate for that game, so the feed can say it is from your people.
func TestFeedKnowsFriends(t *testing.T) {
	ts := serverWithRecs(t, true)
	maker := register(t, ts, "maker")
	ids := publishGames(t, ts, maker)
	friend, me := register(t, ts, "friendly"), register(t, ts, "viewer")
	do(t, "POST", ts.URL+"/v1/games/"+ids[2]+"/scores", friend, js(map[string]any{"score": 77}), "application/json")
	_, before := feedPage(t, ts, me, map[string]any{"count": 6, "sessionID": "s0"})
	for _, it := range before {
		if it["reason"] == "friendBurst" {
			t.Fatalf("a stranger's score must not count: %v", it)
		}
	}
	do(t, "PUT", ts.URL+"/v1/me/friends/"+meID(t, ts, friend), me, nil, "")
	_, after := feedPage(t, ts, me, map[string]any{"count": 6, "sessionID": "s1"})
	found := false
	for _, it := range after {
		if it["id"] == ids[2] && it["reason"] == "friendBurst" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the friend's game should come from your people: %v", after)
	}
}
