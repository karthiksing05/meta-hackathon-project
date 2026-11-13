package api_test

import (
	"net/url"
	"testing"
)

func TestFBPostsReelsReactionsComments(t *testing.T) {
	ts, _ := newServer(t)
	// signed out: the seeded feed, newest first, paged
	code, out := do(t, "GET", ts.URL+"/v1/fb/posts?limit=5", "", nil, "")
	items, _ := out["items"].([]any)
	if code != 200 || len(items) != 5 || out["cursor"] == "" {
		t.Fatalf("posts: %d %v", code, out)
	}
	first := items[0].(map[string]any)
	if first["author"].(map[string]any)["firstName"] == "" || first["kind"] != "post" {
		t.Fatalf("post shape: %v", first)
	}
	code, out2 := do(t, "GET", ts.URL+"/v1/fb/posts?limit=5&cursor="+url.QueryEscape(out["cursor"].(string)), "", nil, "")
	if code != 200 || out2["items"].([]any)[0].(map[string]any)["id"] == first["id"] {
		t.Fatalf("second page: %d %v", code, out2)
	}
	// a Group's posts
	_, g := do(t, "GET", ts.URL+"/v1/fb/posts?groupId=group-newinsf&limit=50", "", nil, "")
	if n := len(g["items"].([]any)); n < 10 {
		t.Fatalf("group posts: %d", n)
	}
	// reels are separate
	_, reels := do(t, "GET", ts.URL+"/v1/fb/reels", "", nil, "")
	r0 := reels["items"].([]any)[0].(map[string]any)
	if r0["kind"] != "reel" || r0["media"].([]any)[0].(map[string]any)["videoUrl"] == "" {
		t.Fatalf("reel: %v", r0)
	}

	tok := register(t, ts, "fbann")
	id := first["id"].(string)
	before := first["reactions"].(map[string]any)["love"]
	code, p := do(t, "PUT", ts.URL+"/v1/fb/posts/"+id+"/reaction", tok, js(map[string]string{"type": "love"}), "application/json")
	if code != 200 || p["myReaction"] != "love" || p["reactions"].(map[string]any)["love"] != before {
		t.Fatalf("react: %d %v", code, p)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/fb/posts/"+id+"/reaction", tok, js(map[string]string{"type": "meh"}), "application/json"); code != 400 {
		t.Fatalf("bad reaction: %d", code)
	}
	// someone else sees my reaction in the counts, not as theirs
	_, other := do(t, "GET", ts.URL+"/v1/fb/posts/"+id, "", nil, "")
	if other["myReaction"] != nil {
		t.Fatalf("myReaction leaked: %v", other)
	}
	code, p = do(t, "DELETE", ts.URL+"/v1/fb/posts/"+id+"/reaction", tok, nil, "")
	if code != 200 || p["myReaction"] != nil {
		t.Fatalf("unreact: %d %v", code, p)
	}
	code, c := do(t, "POST", ts.URL+"/v1/fb/posts/"+id+"/comments", tok, js(map[string]string{"text": "Welcome!"}), "application/json")
	if code != 201 || c["author"].(map[string]any)["isMe"] != true {
		t.Fatalf("comment: %d %v", code, c)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/fb/posts/nope/comments", tok, js(map[string]string{"text": "x"}), "application/json"); code != 404 {
		t.Fatalf("comment on missing post: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/fb/posts/"+id+"/reaction", "", js(map[string]string{"type": "like"}), "application/json"); code != 401 {
		t.Fatalf("signed out react: %d", code)
	}

	// my own post goes on top
	code, mine := do(t, "POST", ts.URL+"/v1/fb/posts", tok, js(map[string]any{"text": "Hello from the test", "groupId": "group-newinsf"}), "application/json")
	if code != 201 || mine["author"].(map[string]any)["isMe"] != true {
		t.Fatalf("create post: %d %v", code, mine)
	}
	_, top := do(t, "GET", ts.URL+"/v1/fb/posts?limit=1", tok, nil, "")
	if top["items"].([]any)[0].(map[string]any)["id"] != mine["id"] {
		t.Fatalf("my post is not first: %v", top)
	}
	code, game := do(t, "POST", ts.URL+"/v1/fb/posts", tok, js(map[string]any{"text": "Made a Curio: Hill Hopper", "gameId": "hill-hopper"}), "application/json")
	if code != 201 || game["gameId"] != "hill-hopper" {
		t.Fatalf("game post: %d %v", code, game)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/fb/posts", tok, js(map[string]any{"text": "  "}), "application/json"); code != 400 {
		t.Fatalf("empty post: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/fb/posts", tok, js(map[string]any{"photoUrls": []string{"javascript:alert(1)"}}), "application/json"); code != 400 {
		t.Fatalf("bad photo url: %d", code)
	}
}

func TestFBStories(t *testing.T) {
	ts, _ := newServer(t)
	_, out := do(t, "GET", ts.URL+"/v1/fb/stories", "", nil, "")
	tray := out["items"].([]any)
	if len(tray) < 5 || len(tray[0].(map[string]any)["items"].([]any)) == 0 {
		t.Fatalf("tray: %v", out)
	}
	tok := register(t, ts, "fbbob")
	code, st := do(t, "POST", ts.URL+"/v1/fb/stories", tok, js(map[string]any{"text": "Fog today", "background": 2}), "application/json")
	if code != 201 || st["text"] != "Fog today" {
		t.Fatalf("create story: %d %v", code, st)
	}
	_, out = do(t, "GET", ts.URL+"/v1/fb/stories", tok, nil, "")
	if a := out["items"].([]any)[0].(map[string]any)["author"].(map[string]any); a["isMe"] != true {
		t.Fatalf("my story should lead the tray: %v", a)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/fb/stories", tok, js(map[string]any{}), "application/json"); code != 400 {
		t.Fatalf("empty story: %d", code)
	}
}

func TestFBMessenger(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "fbcat")
	if code, _ := do(t, "GET", ts.URL+"/v1/fb/threads", "", nil, ""); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	code, out := do(t, "GET", ts.URL+"/v1/fb/threads", tok, nil, "")
	threads := out["items"].([]any)
	if code != 200 || len(threads) < 6 {
		t.Fatalf("threads: %d %v", code, out)
	}
	// the demo chats are given once
	_, again := do(t, "GET", ts.URL+"/v1/fb/threads", tok, nil, "")
	if len(again["items"].([]any)) != len(threads) {
		t.Fatalf("threads copied twice")
	}
	th := threads[0].(map[string]any)
	if len(th["messages"].([]any)) == 0 || len(th["members"].([]any)) == 0 {
		t.Fatalf("thread shape: %v", th)
	}
	tid := th["id"].(string)
	code, sent := do(t, "POST", ts.URL+"/v1/fb/threads/"+tid+"/messages", tok, js(map[string]string{"text": "Hi!"}), "application/json")
	if code != 201 || sent["message"].(map[string]any)["text"] != "Hi!" || sent["reply"] == nil {
		t.Fatalf("send: %d %v", code, sent)
	}
	_, msgs := do(t, "GET", ts.URL+"/v1/fb/threads/"+tid+"/messages", tok, nil, "")
	list := msgs["items"].([]any)
	if list[len(list)-1].(map[string]any)["id"] != sent["reply"].(map[string]any)["id"] {
		t.Fatalf("reply should be last: %v", list[len(list)-1])
	}
	// someone else can't read it
	dog := register(t, ts, "fbdog")
	if code, _ := do(t, "GET", ts.URL+"/v1/fb/threads/"+tid+"/messages", dog, nil, ""); code != 404 {
		t.Fatalf("stranger read: %d", code)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/fb/threads/"+tid+"/read", tok, nil, ""); code != 204 {
		t.Fatalf("read: %d", code)
	}
	// a new chat with a demo person; asking again returns the same one
	code, nt := do(t, "POST", ts.URL+"/v1/fb/threads", tok, js(map[string]any{"memberIds": []string{"fb-zoe-patel"}}), "application/json")
	if code != 201 {
		t.Fatalf("new thread: %d %v", code, nt)
	}
	code, same := do(t, "POST", ts.URL+"/v1/fb/threads", tok, js(map[string]any{"memberIds": []string{"fb-zoe-patel"}}), "application/json")
	if code != 200 || same["id"] != nt["id"] {
		t.Fatalf("existing thread: %d %v", code, same)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/fb/threads", tok, js(map[string]any{"memberIds": []string{"nobody-here"}}), "application/json"); code != 400 {
		t.Fatalf("unknown member: %d", code)
	}
	// people lookup
	_, ppl := do(t, "GET", ts.URL+"/v1/fb/people?ids=sf-maya-okafor,nobody", "", nil, "")
	if items := ppl["items"].([]any); len(items) != 1 || items[0].(map[string]any)["lastName"] != "Okafor" {
		t.Fatalf("people: %v", ppl)
	}
}
