package api_test

import (
	"strings"
	"testing"
)

func TestSessions(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	ann, bob, cat, dan := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat"), register(t, ts, "dan")
	annID, bobID, catID := meID(t, ts, ann), meID(t, ts, bob), meID(t, ts, cat)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")

	post := func(tok, path string, body any) (int, map[string]any) {
		return do(t, "POST", ts.URL+path, tok, js(body), "application/json")
	}
	chat := map[string]any{"kind": "question", "title": "Picnic Trivia", "ask": "Add a question about the picnic",
		"target": map[string]any{"kind": "chat", "id": "thread-1"}, "members": []string{bobID}}

	// ---- starting ----
	if code, _ := post(ann, "/v1/sessions", map[string]any{"kind": "nope", "title": "x", "target": chat["target"], "members": []string{bobID}}); code != 400 {
		t.Fatalf("bad kind: %d", code)
	}
	if code, _ := post(ann, "/v1/sessions", map[string]any{"kind": "words", "title": "x", "target": chat["target"], "members": []string{catID}}); code != 400 {
		t.Fatalf("a chat session with a stranger: %d", code)
	}
	if code, _ := post(ann, "/v1/sessions", map[string]any{"kind": "words", "title": "x", "target": chat["target"]}); code != 400 {
		t.Fatalf("a chat session with no one in it: %d", code)
	}
	if code, _ := post("", "/v1/sessions", chat); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	code, se := post(ann, "/v1/sessions", chat)
	if code != 201 || se["status"] != "open" || se["kind"] != "question" || se["starter"].(map[string]any)["id"] != annID ||
		len(se["members"].([]any)) != 2 || len(se["entries"].([]any)) != 0 || se["target"].(map[string]any)["id"] != "thread-1" {
		t.Fatalf("start: %d %v", code, se)
	}
	sid := se["id"].(string)

	// bob is invited
	items := inbox(t, ts, bob, "")["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["kind"] != "session_invite" || items[0].(map[string]any)["sessionId"] != sid {
		t.Fatalf("bob's invite: %v", items)
	}

	// ---- access: members only ----
	if code, _ := do(t, "GET", ts.URL+"/v1/sessions/"+sid, cat, nil, ""); code != 404 {
		t.Fatalf("a stranger saw the session: %d", code)
	}
	if code, _ := post(cat, "/v1/sessions/"+sid+"/entries", map[string]any{"text": "hi"}); code != 404 {
		t.Fatalf("a stranger added: %d", code)
	}
	_, list := do(t, "GET", ts.URL+"/v1/sessions?target=chat:thread-1", cat, nil, "")
	if n := len(list["items"].([]any)); n != 0 {
		t.Fatalf("a stranger listed it: %v", list)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/sessions", bob, nil, ""); code != 400 {
		t.Fatalf("a list needs a target: %d", code)
	}

	// ---- entries ----
	if code, _ := post(ann, "/v1/sessions/"+sid+"/make", nil); code != 409 {
		t.Fatalf("make with nothing added: %d", code)
	}
	if code, _ := post(bob, "/v1/sessions/"+sid+"/entries", map[string]any{"text": "  "}); code != 400 {
		t.Fatalf("an empty entry: %d", code)
	}
	if code, _ := post(bob, "/v1/sessions/"+sid+"/entries", map[string]any{"text": strings.Repeat("x", 300)}); code != 400 {
		t.Fatalf("a long entry: %d", code)
	}
	code, se = post(bob, "/v1/sessions/"+sid+"/entries", map[string]any{"text": "Who brought the lemonade?"})
	if code != 200 || len(se["entries"].([]any)) != 1 {
		t.Fatalf("bob adds: %d %v", code, se)
	}
	e0 := se["entries"].([]any)[0].(map[string]any)
	if e0["maker"].(map[string]any)["id"] != bobID || e0["text"] != "Who brought the lemonade?" || e0["id"] == "" || e0["at"] == nil {
		t.Fatalf("entry: %v", e0)
	}
	post(ann, "/v1/sessions/"+sid+"/entries", map[string]any{"text": "What color was the blanket?"})
	_, list = do(t, "GET", ts.URL+"/v1/sessions?target=chat:thread-1", bob, nil, "")
	if its := list["items"].([]any); len(its) != 1 || len(its[0].(map[string]any)["entries"].([]any)) != 2 {
		t.Fatalf("bob's list: %v", list)
	}

	// ---- make: the starter only, through /v1/generate ----
	if code, _ := post(bob, "/v1/sessions/"+sid+"/make", nil); code != 403 {
		t.Fatalf("a member made it: %d", code)
	}
	code, mk := post(ann, "/v1/sessions/"+sid+"/make", nil)
	if code != 202 || mk["jobId"] == nil {
		t.Fatalf("make: %d %v", code, mk)
	}
	job := waitJob(t, ts, ann, mk["jobId"].(string), "done")
	gameID := job["game"].(map[string]any)["id"].(string)
	gen.mu.Lock()
	sent := strings.Join(gen.requests, "\n")
	gen.mu.Unlock()
	if !strings.Contains(sent, "Who brought the lemonade?") || !strings.Contains(sent, "Picnic Trivia") {
		t.Fatalf("the generator didn't get the entries: %s", sent)
	}
	_, se = do(t, "GET", ts.URL+"/v1/sessions/"+sid, bob, nil, "")
	if se["status"] != "made" || se["gameId"] != gameID || se["game"] == nil {
		t.Fatalf("made: %v", se)
	}
	if code, _ := post(ann, "/v1/sessions/"+sid+"/make", nil); code != 409 {
		t.Fatalf("made twice: %d", code)
	}
	if code, _ := post(bob, "/v1/sessions/"+sid+"/entries", map[string]any{"text": "late"}); code != 409 {
		t.Fatalf("added after it was made: %d", code)
	}

	// ---- a Group session: anyone in the Group, and the job is made for the Group ----
	_, grp := post(ann, "/v1/groups", map[string]any{"name": "Picnic club"})
	gid := grp["id"].(string)
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", cat, nil, "")
	gs := map[string]any{"kind": "words", "title": "Club Words", "target": map[string]any{"kind": "group", "id": gid}}
	if code, _ := post(dan, "/v1/sessions", gs); code != 403 {
		t.Fatalf("a Group you are not in: %d", code)
	}
	if code, _ := post(ann, "/v1/sessions", map[string]any{"kind": "words", "title": "x", "target": gs["target"], "members": []string{bobID}}); code != 400 {
		t.Fatalf("inviting someone outside the Group: %d", code)
	}
	code, se = post(ann, "/v1/sessions", gs)
	if code != 201 || len(se["members"].([]any)) != 2 {
		t.Fatalf("group start: %d %v", code, se)
	}
	gsid := se["id"].(string)
	if code, _ := do(t, "GET", ts.URL+"/v1/sessions/"+gsid, bob, nil, ""); code != 404 {
		t.Fatalf("a non-member saw a Group session: %d", code)
	}
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", dan, nil, "") // joins after it started: can still add
	if code, se := post(dan, "/v1/sessions/"+gsid+"/entries", map[string]any{"text": "sandwich"}); code != 200 || len(se["members"].([]any)) != 3 {
		t.Fatalf("a later member adds: %d %v", code, se)
	}
	gen.mu.Lock()
	gen.requests = nil
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "club-words", 1)
	gen.mu.Unlock()
	code, mk = post(ann, "/v1/sessions/"+gsid+"/make", nil)
	if code != 202 {
		t.Fatalf("group make: %d %v", code, mk)
	}
	waitJob(t, ts, ann, mk["jobId"].(string), "done")
	gen.mu.Lock()
	sent = strings.Join(gen.requests, "\n")
	gen.mu.Unlock()
	if !strings.Contains(sent, gid) || !strings.Contains(sent, "sandwich") {
		t.Fatalf("the Group job wasn't scoped to the Group: %s", sent)
	}
	_ = catID
}

func TestRoundNotifications(t *testing.T) {
	gen := newFakeGenerator(t)
	ts := serverWithPush(t, gen.URL, nil)
	ann, bob, cat := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat")
	bobID, catID := meID(t, ts, bob), meID(t, ts, cat)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	do(t, "PUT", ts.URL+"/v1/me/friends/"+catID, ann, nil, "")
	_, out := startJob(t, ts, ann, map[string]any{"request": "a game"})
	game := waitJob(t, ts, ann, out["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)

	code, rd := do(t, "POST", ts.URL+"/v1/rounds", ann, js(map[string]any{"gameId": game,
		"target": map[string]any{"kind": "chat", "id": "t1"}, "members": []string{bobID, catID}}), "application/json")
	if code != 201 {
		t.Fatalf("round: %d %v", code, rd)
	}
	rid := rd["id"].(string)
	kinds := func(tok string) map[string]string {
		out := map[string]string{}
		for _, it := range inbox(t, ts, tok, "")["items"].([]any) {
			m := it.(map[string]any)
			if rid2, _ := m["roundId"].(string); rid2 == rid {
				out[m["kind"].(string)] = m["body"].(string)
			}
		}
		return out
	}
	if k := kinds(bob); k["round_started"] == "" {
		t.Fatalf("bob wasn't told the round started: %v", inbox(t, ts, bob, ""))
	}
	if k := kinds(ann); len(k) != 0 {
		t.Fatalf("the starter was notified of their own round: %v", k)
	}
	if code, out := do(t, "POST", ts.URL+"/v1/rounds/"+rid+"/plays", bob, js(map[string]any{"log": stateLog(7, 12, 3000, nil)}), "application/json"); code != 200 {
		t.Fatalf("bob plays: %d %v", code, out)
	}
	if k := kinds(cat); k["round_played"] == "" || k["round_started"] == "" {
		t.Fatalf("cat wasn't told bob played: %v", k)
	}
	if k := kinds(ann); k["round_played"] == "" {
		t.Fatalf("ann wasn't told bob played: %v", k)
	}
	if k := kinds(bob); k["round_played"] != "" {
		t.Fatalf("bob was told about his own run: %v", k)
	}
}
