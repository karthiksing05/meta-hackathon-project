package api_test

import (
	"testing"
)

func TestScopedBoardsAndLikes(t *testing.T) {
	ts := serverWithRecs(t, false)
	maker := register(t, ts, "maker")
	ids := publishGames(t, ts, maker)
	game := ids[0]
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	bobID, catID := meID(t, ts, bob), meID(t, ts, cat)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	for tok, score := range map[string]int{ann: 10, bob: 30, cat: 50} {
		do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", tok, js(map[string]any{"score": score}), "application/json")
	}
	rows := func(url, tok string) int {
		code, out := do(t, "GET", url, tok, nil, "")
		if code != 200 {
			t.Fatalf("%s: %d %v", url, code, out)
		}
		return len(out["items"].([]any))
	}
	base := ts.URL + "/v1/games/" + game + "/leaderboard"
	if n := rows(base, ""); n != 3 {
		t.Fatalf("everyone: %d", n)
	}
	if n := rows(base+"?scope=friends", ann); n != 2 { // ann and her friend bob, not cat
		t.Fatalf("friends: %d", n)
	}
	if code, _ := do(t, "GET", base+"?scope=friends", "", nil, ""); code != 401 {
		t.Fatalf("friends board signed out: %d", code)
	}
	if code, _ := do(t, "GET", base+"?scope=nope", ann, nil, ""); code != 400 {
		t.Fatalf("bad scope: %d", code)
	}
	_, g := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Board club"}), "application/json")
	gid := g["id"].(string)
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", cat, nil, "")
	if n := rows(base+"?scope=group&groupId="+gid, ann); n != 2 { // ann and cat
		t.Fatalf("group: %d", n)
	}
	if code, _ := do(t, "GET", base+"?scope=group&groupId="+gid, bob, nil, ""); code != 403 {
		t.Fatalf("group board for a non-member: %d", code)
	}

	// saves from both sides
	do(t, "PUT", ts.URL+"/v1/games/"+game+"/like", bob, nil, "")
	do(t, "PUT", ts.URL+"/v1/games/"+game+"/like", cat, nil, "")
	_, likes := do(t, "GET", ts.URL+"/v1/games/"+game+"/likes", ann, nil, "")
	fr := likes["friends"].([]any)
	if likes["count"].(float64) != 2 || len(fr) != 1 || fr[0].(map[string]any)["id"] != bobID {
		t.Fatalf("who saved it: %v", likes)
	}
	_, mine := do(t, "GET", ts.URL+"/v1/me/likes", bob, nil, "")
	if items := mine["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != game || items[0].(map[string]any)["likedByMe"] != true {
		t.Fatalf("my likes: %v", mine)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/me/likes", "", nil, ""); code != 401 {
		t.Fatalf("likes signed out: %d", code)
	}
	_ = catID
}

func TestChallengesAndMoments(t *testing.T) {
	ts := serverWithRecs(t, false)
	maker := register(t, ts, "maker")
	game := publishGames(t, ts, maker)[1]
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	annID, bobID, catID := meID(t, ts, ann), meID(t, ts, bob), meID(t, ts, cat)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", ann, js(map[string]any{"score": 34}), "application/json")

	post := func(body map[string]any) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/challenges", ann, js(body), "application/json")
	}
	if code, _ := post(map[string]any{"gameId": game, "toUserIds": []string{catID}}); code != 400 {
		t.Fatalf("a stranger can't be challenged: %d", code)
	}
	if code, _ := post(map[string]any{"gameId": game, "toUserIds": []string{annID}}); code != 400 {
		t.Fatalf("yourself: %d", code)
	}
	if code, _ := post(map[string]any{"gameId": "000000000000000000000000", "toUserIds": []string{bobID}}); code != 404 {
		t.Fatalf("unknown game: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/challenges", "", js(map[string]any{}), "application/json"); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	code, c := post(map[string]any{"gameId": game, "toUserIds": []string{bobID, bobID}})
	if code != 201 || c["score"].(float64) != 34 || len(c["toIds"].([]any)) != 1 {
		t.Fatalf("challenge: %d %v", code, c)
	}

	// bob has a moment, and the challenge, before he plays
	_, ms := do(t, "GET", ts.URL+"/v1/me/moments", bob, nil, "")
	moments := ms["moments"].([]any)
	if len(moments) != 1 || moments[0].(map[string]any)["kind"] != "challenge_received" ||
		moments[0].(map[string]any)["from"].(map[string]any)["id"] != annID {
		t.Fatalf("bob's moments: %v", ms)
	}
	_, got := do(t, "GET", ts.URL+"/v1/challenges", bob, nil, "")
	rcv := got["items"].([]any)[0].(map[string]any)
	if rcv["direction"] != "received" || rcv["beaten"] != false || rcv["score"].(float64) != 34 || rcv["game"] == nil {
		t.Fatalf("received: %v", rcv)
	}

	// he beats it; the sender sees how it went
	do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", bob, js(map[string]any{"score": 40}), "application/json")
	_, got = do(t, "GET", ts.URL+"/v1/challenges", bob, nil, "")
	if r := got["items"].([]any)[0].(map[string]any); r["beaten"] != true || r["myScore"].(float64) != 40 {
		t.Fatalf("beaten: %v", r)
	}
	_, sent := do(t, "GET", ts.URL+"/v1/challenges", ann, nil, "")
	s0 := sent["items"].([]any)[0].(map[string]any)
	resp := s0["responses"].([]any)
	if s0["direction"] != "sent" || len(resp) != 1 || resp[0].(map[string]any)["beat"] != true {
		t.Fatalf("sent: %v", s0)
	}
	if r0 := resp[0].(map[string]any); r0["displayName"] == "" || r0["displayName"] == nil || r0["display"] != "40" {
		t.Fatalf("a response carries a name and the shown score: %v", r0)
	}
	_, ams := do(t, "GET", ts.URL+"/v1/me/moments", ann, nil, "")
	if len(ams["moments"].([]any)) != 0 {
		t.Fatalf("the sender gets no moment for their own challenge: %v", ams)
	}

	// an off-feed moment someone else reports with me in it shows up too
	ev := map[string]any{"events": []any{map[string]any{"eventID": "m1", "gameID": game, "kind": "played_together", "with": []string{bobID}}}}
	if code, out := do(t, "POST", ts.URL+"/v1/feed/events", ann, js(ev), "application/json"); code != 200 && code != 202 {
		t.Fatalf("post moment: %d %v", code, out)
	}
	_, ms = do(t, "GET", ts.URL+"/v1/me/moments", bob, nil, "")
	kinds := map[any]bool{}
	for _, m := range ms["moments"].([]any) {
		kinds[m.(map[string]any)["kind"]] = true
	}
	if !kinds["played_together"] || !kinds["challenge_received"] {
		t.Fatalf("moments: %v", ms)
	}
}
