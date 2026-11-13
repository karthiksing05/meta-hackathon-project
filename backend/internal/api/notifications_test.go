package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// fakePush records the pushes the server sends, and fails them on request.
type fakePush struct {
	mu    sync.Mutex
	sent  []sentPush
	fails map[string][]error // by token: the errors to return, in order, before succeeding
}

type sentPush struct {
	Env, Token string
	Payload    map[string]any
}

type pushErr struct {
	bad, retry bool
	msg        string
}

func (e *pushErr) Error() string   { return e.msg }
func (e *pushErr) BadToken() bool  { return e.bad }
func (e *pushErr) Retryable() bool { return e.retry }

func (f *fakePush) Send(ctx context.Context, env, token string, payload []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if q := f.fails[token]; len(q) > 0 {
		f.fails[token] = q[1:]
		return q[0]
	}
	var p map[string]any
	_ = json.Unmarshal(payload, &p)
	f.sent = append(f.sent, sentPush{env, token, p})
	return nil
}

func (f *fakePush) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

func serverWithPush(t *testing.T, genURL string, push api.PushSender) *httptest.Server {
	t.Helper()
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
		GeneratorURL: genURL, GenerateConcurrent: 2, GeneratePerHour: 20, Push: push,
	})
	ctx, cancel := context.WithCancel(context.Background())
	go s.RunPush(ctx)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(func() { cancel(); ts.Close() })
	return ts
}

func inbox(t *testing.T, ts *httptest.Server, tok, query string) map[string]any {
	t.Helper()
	code, out := do(t, "GET", ts.URL+"/v1/me/notifications"+query, tok, nil, "")
	if code != 200 {
		t.Fatalf("inbox: %d %v", code, out)
	}
	return out
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if ok() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestNotificationTriggersAndInbox(t *testing.T) {
	gen := newFakeGenerator(t)
	ts := serverWithPush(t, gen.URL, nil)
	ann, bob, cat, dan := register(t, ts, "ann"), register(t, ts, "bob"), register(t, ts, "cat"), register(t, ts, "dan")
	annID, bobID, catID := meID(t, ts, ann), meID(t, ts, bob), meID(t, ts, cat)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	do(t, "PUT", ts.URL+"/v1/me/friends/"+catID, ann, nil, "")

	make := func(slug, extra string) string {
		gen.mu.Lock()
		gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", slug, 1)
		if extra != "" {
			gen.manifest = strings.Replace(gen.manifest, `"formula":"microgame"`, `"formula":"microgame",`+extra, 1)
		}
		gen.mu.Unlock()
		_, out := startJob(t, ts, ann, map[string]any{"request": "a game " + slug})
		return waitJob(t, ts, ann, out["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	}
	plain := make("notif-plain", "")

	// ---- a Group share ----
	_, grp := do(t, "POST", ts.URL+"/v1/groups", ann, js(map[string]any{"name": "Board club"}), "application/json")
	gid := grp["id"].(string)
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", bob, nil, "")
	do(t, "PUT", ts.URL+"/v1/groups/"+gid+"/members/me", cat, nil, "")
	share := func(tok, body map[string]any, who string) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/groups/"+gid+"/game-shares", who, js(body), "application/json")
	}
	_ = share
	post := func(who, game, event string) (int, map[string]any) {
		return do(t, "POST", ts.URL+"/v1/groups/"+gid+"/game-shares", who, js(map[string]any{"gameId": game, "eventId": event}), "application/json")
	}
	if code, _ := post(dan, plain, "post-0001"); code != 403 {
		t.Fatalf("a non-member sharing: %d", code)
	}
	if code, _ := post(ann, plain, "x"); code != 400 {
		t.Fatalf("a bad eventId: %d", code)
	}
	if code, _ := post(ann, "000000000000000000000000", "post-0001"); code != 404 {
		t.Fatalf("an unknown game: %d", code)
	}
	if code, out := post(ann, plain, "post-0001"); code != 200 || out["recipients"].(float64) != 2 {
		t.Fatalf("share: %d %v", code, out)
	}
	post(ann, plain, "post-0001") // a retry of the same post
	b := inbox(t, ts, bob, "")
	items := b["items"].([]any)
	first := items[0].(map[string]any)
	if len(items) != 1 || b["unreadCount"].(float64) != 1 || first["kind"] != "group_game" || first["groupId"] != gid || first["gameId"] != plain ||
		first["title"] != "Board club" || first["body"] != "ann shared Fog Walk" || first["readAt"] != nil {
		t.Fatalf("bob's inbox after a share and a retry: %v", b)
	}
	if a := inbox(t, ts, ann, ""); len(a["items"].([]any)) != 0 || a["unreadCount"].(float64) != 0 {
		t.Fatalf("the sender must not be notified: %v", a)
	}
	post(ann, plain, "post-0002")

	// paging: newest first, a cursor continues
	p1 := inbox(t, ts, bob, "?limit=1")
	if len(p1["items"].([]any)) != 1 || p1["nextCursor"] == nil {
		t.Fatalf("page 1: %v", p1)
	}
	p2 := inbox(t, ts, bob, "?limit=1&cursor="+p1["nextCursor"].(string))
	if len(p2["items"].([]any)) != 1 || p2["nextCursor"] != nil || p2["items"].([]any)[0].(map[string]any)["id"] == p1["items"].([]any)[0].(map[string]any)["id"] {
		t.Fatalf("page 2: %v", p2)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/me/notifications?cursor=zzzz", bob, nil, ""); code != 400 {
		t.Fatalf("a bad cursor: %d", code)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/me/notifications", "", nil, ""); code != 401 {
		t.Fatalf("signed out: %d", code)
	}

	// read state: one row, back to unread, a row that is not yours, everything
	id1 := p1["items"].([]any)[0].(map[string]any)["id"].(string)
	if code, out := do(t, "PUT", ts.URL+"/v1/me/notifications/"+id1+"/read", bob, js(map[string]any{"read": true}), "application/json"); code != 200 || out["unreadCount"].(float64) != 1 {
		t.Fatalf("read one: %d %v", code, out)
	}
	if code, out := do(t, "PUT", ts.URL+"/v1/me/notifications/"+id1+"/read", bob, js(map[string]any{"read": false}), "application/json"); code != 200 || out["unreadCount"].(float64) != 2 {
		t.Fatalf("unread: %d %v", code, out)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/me/notifications/"+id1+"/read", cat, nil, ""); code != 404 {
		t.Fatalf("someone else's row: %d", code)
	}
	if code, out := do(t, "PUT", ts.URL+"/v1/me/notifications/read", bob, nil, ""); code != 200 || out["unreadCount"].(float64) != 0 {
		t.Fatalf("read all: %d %v", code, out)
	}
	if b = inbox(t, ts, bob, ""); b["items"].([]any)[0].(map[string]any)["readAt"] == nil {
		t.Fatalf("readAt after reading: %v", b)
	}

	// ---- a challenge and a series ----
	_, ch := do(t, "POST", ts.URL+"/v1/challenges", ann, js(map[string]any{"gameId": plain, "toUserIds": []string{bobID, catID}}), "application/json")
	_, se := do(t, "POST", ts.URL+"/v1/series", ann, js(map[string]any{"opponentId": bobID, "games": []string{plain}}), "application/json")
	cn := ""
	for _, it := range inbox(t, ts, bob, "")["items"].([]any) {
		m := it.(map[string]any)
		if m["kind"] == "friend_challenge" && m["challengeId"] == ch["id"] {
			cn = m["title"].(string)
		}
	}
	if cn != "ann challenged you" {
		t.Fatalf("challenge notification: %q", cn)
	}
	foundSeries := false
	for _, it := range inbox(t, ts, bob, "")["items"].([]any) {
		if m := it.(map[string]any); m["seriesId"] == se["id"] && m["kind"] == "friend_challenge" {
			foundSeries = true
		}
	}
	if !foundSeries {
		t.Fatalf("series notification missing: %v", inbox(t, ts, bob, ""))
	}
	if n := countKind(inbox(t, ts, cat, ""), "friend_challenge"); n != 1 {
		t.Fatalf("cat got %d challenge notifications", n)
	}

	// ---- losing first place ----
	score := func(who, game string, v int) {
		if code, out := do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", who, js(map[string]any{"score": v}), "application/json"); code != 200 {
			t.Fatalf("score: %d %v", code, out)
		}
	}
	lost := func(tok string) int { return countKind(inbox(t, ts, tok, ""), "leaderboard_lost") }
	score(bob, plain, 10)
	if lost(bob) != 0 {
		t.Fatal("the first score takes nobody's place")
	}
	score(ann, plain, 20) // ann takes first from bob
	if lost(bob) != 1 || lost(ann) != 0 {
		t.Fatalf("bob lost first place: bob %d ann %d", lost(bob), lost(ann))
	}
	score(ann, plain, 30) // her own improvement
	score(cat, plain, 5)  // below first
	score(bob, plain, 25) // bob moves up but not to first
	if lost(bob) != 1 || lost(ann) != 0 || lost(cat) != 0 {
		t.Fatalf("no alert for those: bob %d ann %d cat %d", lost(bob), lost(ann), lost(cat))
	}
	score(bob, plain, 40) // bob takes it back
	if lost(ann) != 1 {
		t.Fatalf("ann lost first place: %d", lost(ann))
	}
	n := inbox(t, ts, ann, "")["items"].([]any)[0].(map[string]any)
	if n["kind"] != "leaderboard_lost" || n["gameId"] != plain || n["title"] != "bob took first place" {
		t.Fatalf("the notification: %v", n)
	}

	// a lower-is-better game follows the direction, and an unranked one has no first place
	trial := make("notif-trial", `"score":{"kind":"time_to_complete","format":"m:ss.t"}`)
	calm := make("notif-calm", `"score":{"kind":"points","ranked":false}`)
	run := func(who, game string, ms int) int {
		code, _ := do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", who, js(map[string]any{"log": runLog(1, "won", 0, ms)}), "application/json")
		return code
	}
	b0 := lost(bob)
	if run(bob, trial, 20000) != 200 || run(cat, trial, 25000) != 200 || lost(bob) != b0 || lost(cat) != 0 {
		t.Fatal("a slower time takes nothing")
	}
	if run(cat, trial, 15000) != 200 {
		t.Fatal("cat's faster run")
	}
	if lost(bob) != b0+1 {
		t.Fatalf("a faster time takes first place on a lower-is-better game: %d", lost(bob))
	}
	do(t, "POST", ts.URL+"/v1/games/"+calm+"/scores", bob, js(map[string]any{"log": runLog(1, "won", 5, 1000)}), "application/json")
	do(t, "POST", ts.URL+"/v1/games/"+calm+"/scores", ann, js(map[string]any{"log": runLog(1, "won", 9, 1000)}), "application/json")
	if lost(bob) != b0+1 {
		t.Fatalf("an unranked game has no first place: %d", lost(bob))
	}
	_ = annID
}

func countKind(in map[string]any, kind string) int {
	n := 0
	for _, it := range in["items"].([]any) {
		if it.(map[string]any)["kind"] == kind {
			n++
		}
	}
	return n
}

func TestPushDevicesAndDelivery(t *testing.T) {
	gen := newFakeGenerator(t)
	fp := &fakePush{fails: map[string][]error{}}
	ts := serverWithPush(t, gen.URL, fp)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")
	bobID := meID(t, ts, bob)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	tok := strings.Repeat("ab", 32)
	put := func(who, inst string, body map[string]any) int {
		code, _ := do(t, "PUT", ts.URL+"/v1/me/push-devices/"+inst, who, js(body), "application/json")
		return code
	}
	if put(bob, "x", map[string]any{"token": tok, "environment": "sandbox"}) != 400 {
		t.Fatal("a short installation id")
	}
	if put(bob, "install-bob-1", map[string]any{"token": "nothex!", "environment": "sandbox"}) != 400 {
		t.Fatal("a bad token")
	}
	if put(bob, "install-bob-1", map[string]any{"token": tok, "environment": "staging"}) != 400 {
		t.Fatal("a bad environment")
	}
	if put(bob, "install-bob-1", map[string]any{"token": tok, "environment": "sandbox"}) != 204 {
		t.Fatal("registering a device")
	}
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "push-game", 1)
	gen.mu.Unlock()
	_, o := startJob(t, ts, ann, map[string]any{"request": "a game"})
	game := waitJob(t, ts, ann, o["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)

	// a challenge pushes to bob's device with the agreed payload
	_, ch := do(t, "POST", ts.URL+"/v1/challenges", ann, js(map[string]any{"gameId": game, "toUserIds": []string{bobID}}), "application/json")
	waitFor(t, "the push", func() bool { return fp.count() == 1 })
	p := fp.sent[0]
	aps := p.Payload["aps"].(map[string]any)
	alert := aps["alert"].(map[string]any)
	if p.Env != "sandbox" || p.Token != tok || alert["title"] != "ann challenged you" || aps["sound"] != "default" || aps["thread-id"] != "friend_challenge" ||
		p.Payload["kind"] != "friend_challenge" || p.Payload["challengeId"] != ch["id"] || p.Payload["gameId"] != game || p.Payload["notificationId"] == "" {
		t.Fatalf("payload: %v", p)
	}

	// a transient failure is retried; the inbox row is there either way
	fp.mu.Lock()
	fp.fails[tok] = []error{&pushErr{retry: true, msg: "apns: 503"}}
	fp.mu.Unlock()
	do(t, "POST", ts.URL+"/v1/challenges", ann, js(map[string]any{"gameId": game, "toUserIds": []string{bobID}}), "application/json")
	if n := countKind(inbox(t, ts, bob, ""), "friend_challenge"); n != 2 {
		t.Fatalf("the inbox must not depend on the push: %d", n)
	}

	// a refused token drops the device, so nothing more is sent to it
	fp.mu.Lock()
	fp.fails[tok] = []error{&pushErr{bad: true, msg: "apns: 410 Unregistered"}}
	fp.mu.Unlock()
	before := fp.count()
	do(t, "POST", ts.URL+"/v1/challenges", ann, js(map[string]any{"gameId": game, "toUserIds": []string{bobID}}), "application/json")
	time.Sleep(400 * time.Millisecond)
	do(t, "POST", ts.URL+"/v1/challenges", ann, js(map[string]any{"gameId": game, "toUserIds": []string{bobID}}), "application/json")
	time.Sleep(400 * time.Millisecond)
	if fp.count() > before+1 { // the retried one may land; nothing after the device was dropped
		t.Fatalf("pushes after the device was dropped: %d", fp.count()-before)
	}

	// an installation moves to the account that registered it last, and logout revokes it
	if put(bob, "install-shared-1", map[string]any{"token": tok, "environment": "production"}) != 204 {
		t.Fatal("register again")
	}
	if put(ann, "install-shared-1", map[string]any{"token": tok, "environment": "production"}) != 204 {
		t.Fatal("moving an installation")
	}
	if code, _ := do(t, "DELETE", ts.URL+"/v1/me/push-devices/install-shared-1", bob, nil, ""); code != 204 {
		t.Fatalf("deleting someone else's device is a no-op: %d", code)
	}
	_, login := do(t, "POST", ts.URL+"/v1/auth/login", "", js(map[string]string{"email": "ann@example.com", "password": "correct horse"}), "application/json")
	rt, _ := login["refreshToken"].(string)
	if rt == "" {
		t.Fatalf("login: %v", login)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/auth/logout", "", js(map[string]string{"refreshToken": rt, "installationId": "install-shared-1"}), "application/json"); code != 204 {
		t.Fatalf("logout: %d", code)
	}
	base := fp.count()
	do(t, "POST", ts.URL+"/v1/challenges", bob, js(map[string]any{"gameId": game, "toUserIds": []string{meID(t, ts, ann)}}), "application/json")
	do(t, "PUT", ts.URL+"/v1/me/friends/"+meID(t, ts, ann), bob, nil, "")
	do(t, "POST", ts.URL+"/v1/challenges", bob, js(map[string]any{"gameId": game, "toUserIds": []string{meID(t, ts, ann)}}), "application/json")
	time.Sleep(400 * time.Millisecond)
	if fp.count() != base {
		t.Fatalf("ann's device was revoked at logout, nothing should reach it: %d", fp.count()-base)
	}
	_ = fmt.Sprint
}
