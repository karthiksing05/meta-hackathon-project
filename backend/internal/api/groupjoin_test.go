package api_test

import "testing"

func TestGroupJoinPolicies(t *testing.T) {
	ts, _ := newServer(t)
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	_, me := do(t, "GET", ts.URL+"/v1/auth/me", cat, nil, "")
	catID := me["id"].(string)
	_, me = do(t, "GET", ts.URL+"/v1/auth/me", bob, nil, "")
	bobID := me["id"].(string)

	if code, _ := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Bad", "joinPolicy": "maybe"}), "application/json"); code != 400 {
		t.Fatalf("bad policy: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Bad", "coverColor": "blue"}), "application/json"); code != 400 {
		t.Fatalf("bad color: %d", code)
	}

	// open by default: anyone joins
	_, open := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Open Club", "recruiting": true, "coverColor": "#7A8CFF"}), "application/json")
	if open["joinPolicy"] != "open" || open["recruiting"] != true || open["coverColor"] != "#7A8CFF" {
		t.Fatalf("open: %v", open)
	}
	if code, out := do(t, "PUT", ts.URL+"/v1/groups/"+open["id"].(string)+"/members/me", bob, nil, ""); code != 200 || out["isMember"] != true {
		t.Fatalf("join open: %d %v", code, out)
	}

	// invite: joining is refused, a member adds people
	_, inv := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"id": "team-room", "name": "Team Room", "joinPolicy": "invite"}), "application/json")
	gid := inv["id"].(string)
	if code, out := do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", bob, nil, ""); code != 403 || out["code"] != "invite_only" {
		t.Fatalf("join invite: %d %v", code, out)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/"+catID, bob, nil, ""); code != 403 {
		t.Fatalf("a non-member adds: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/"+bobID, ann, nil, ""); code != 200 {
		t.Fatalf("owner invites: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/"+catID, bob, nil, ""); code != 200 {
		t.Fatalf("member invites: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/nobody00000", bob, nil, ""); code != 404 {
		t.Fatalf("unknown person: %d", code)
	}
	if _, got := do(t, "GET", ts.URL+"/v1/groups/"+gid, cat, nil, ""); len(got["members"].([]any)) != 3 || got["group"].(map[string]any)["isMember"] != true {
		t.Fatalf("invited members: %v", got)
	}

	// request: an ask waits for the owner
	_, req := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Night Club", "joinPolicy": "request"}), "application/json")
	rid := req["id"].(string)
	if code, out := do(t, "PUT", ts.URL+"/v1/groups/"+rid+"/members/me", bob, nil, ""); code != 202 || out["requested"] != true {
		t.Fatalf("ask: %d %v", code, out)
	}
	do(t, "PUT", ts.URL+"/v1/groups/"+rid+"/members/me", bob, nil, "") // asking twice keeps one ask
	do(t, "PUT", ts.URL+"/v1/groups/"+rid+"/members/me", cat, nil, "")
	if _, got := do(t, "GET", ts.URL+"/v1/groups/"+rid, bob, nil, ""); got["group"].(map[string]any)["requested"] != true || got["group"].(map[string]any)["isMember"] == true {
		t.Fatalf("bob waits: %v", got["group"])
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/groups/"+rid+"/requests", bob, nil, ""); code != 403 {
		t.Fatalf("only the owner sees asks: %d", code)
	}
	code, asks := do(t, "GET", ts.URL+"/v1/groups/"+rid+"/requests", ann, nil, "")
	if code != 200 || len(asks["items"].([]any)) != 2 || asks["items"].([]any)[0].(map[string]any)["id"] != bobID {
		t.Fatalf("asks: %d %v", code, asks)
	}
	if _, got := do(t, "GET", ts.URL+"/v1/groups/"+rid, ann, nil, ""); got["group"].(map[string]any)["requestCount"].(float64) != 2 {
		t.Fatalf("owner count: %v", got["group"])
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+rid+"/members/"+bobID, ann, nil, ""); code != 200 {
		t.Fatalf("approve: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+rid+"/members/"+catID, bob, nil, ""); code != 403 {
		t.Fatalf("a member can't approve: %d", code)
	}
	do(t, "DELETE", ts.URL+"/v1/groups/"+rid+"/members/me", cat, nil, "") // cat withdraws
	if _, asks = do(t, "GET", ts.URL+"/v1/groups/"+rid+"/requests", ann, nil, ""); len(asks["items"].([]any)) != 0 {
		t.Fatalf("asks left: %v", asks)
	}

	// the owner changes the settings
	if code, _ := do(t, "PATCH", ts.URL+"/v1/groups/"+rid, bob, js(map[string]any{"recruiting": true}), "application/json"); code != 403 {
		t.Fatalf("a member patches: %d", code)
	}
	code, got := do(t, "PATCH", ts.URL+"/v1/groups/"+rid, ann, js(map[string]any{"joinPolicy": "open", "recruiting": true, "about": "Come in"}), "application/json")
	if code != 200 || got["joinPolicy"] != "open" || got["recruiting"] != true || got["about"] != "Come in" || got["name"] != "Night Club" {
		t.Fatalf("patch: %d %v", code, got)
	}
	if code, _ := do(t, "PATCH", ts.URL+"/v1/groups/"+rid, ann, js(map[string]any{"joinPolicy": "nope"}), "application/json"); code != 400 {
		t.Fatalf("bad patch: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+rid+"/members/me", cat, nil, ""); code != 200 {
		t.Fatalf("join after opening: %d", code)
	}

	// a private Group stays invisible and closed
	_, priv := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Hidden", "private": true}), "application/json")
	if priv["joinPolicy"] != "invite" {
		t.Fatalf("private policy: %v", priv)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/groups/"+priv["id"].(string)+"/members/me", bob, nil, ""); code != 403 {
		t.Fatalf("join private: %d", code)
	}
}

func TestUpdateProfile(t *testing.T) {
	ts, _ := newServer(t)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")
	avatar := "https://api.dicebear.com/9.x/adventurer/png?seed=ann"
	code, me := do(t, "PATCH", ts.URL+"/v1/me/profile", ann, js(map[string]any{"displayName": "Ann Lee", "bio": "Makes puzzle games", "avatarUrl": avatar, "coverColor": "#8FA6FF"}), "application/json")
	if code != 200 || me["displayName"] != "Ann Lee" || me["avatarUrl"] != avatar || me["coverColor"] != "#8FA6FF" {
		t.Fatalf("patch: %d %v", code, me)
	}
	for _, bad := range []map[string]any{{"avatarUrl": "http://x.test/a.png"}, {"coverColor": "red"}, {"displayName": " "}} {
		if code, _ := do(t, "PATCH", ts.URL+"/v1/me/profile", ann, js(bad), "application/json"); code != 400 {
			t.Fatalf("bad %v: %d", bad, code)
		}
	}
	// others see it on the profile and on the Facebook surfaces
	if _, got := do(t, "GET", ts.URL+"/v1/users/"+me["id"].(string), bob, nil, ""); got["avatarUrl"] != avatar || got["bio"] != "Makes puzzle games" {
		t.Fatalf("profile: %v", got)
	}
	// only the fields sent change
	if _, got := do(t, "PATCH", ts.URL+"/v1/me/profile", ann, js(map[string]any{"bio": "Still puzzles"}), "application/json"); got["avatarUrl"] != avatar || got["displayName"] != "Ann Lee" {
		t.Fatalf("partial: %v", got)
	}
}
