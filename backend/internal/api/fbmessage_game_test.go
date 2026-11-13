package api_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// A game shared or challenged into a chat reaches the other account as a card: gameId, kind and score.
func TestFBMessageCarriesGame(t *testing.T) {
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	mem := store.NewMemory()
	ts := httptest.NewServer(api.New(api.Options{
		Store: mem, Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
	}).Handler())
	t.Cleanup(ts.Close)

	alice, bob, cat := register(t, ts, "msgalice"), register(t, ts, "msgbob"), register(t, ts, "msgcat")
	_, bobMe := do(t, "GET", ts.URL+"/v1/auth/me", bob, nil, "")
	code, th := do(t, "POST", ts.URL+"/v1/fb/threads", alice, js(map[string]any{"memberIds": []string{bobMe["id"].(string)}}), "application/json")
	if code != 201 {
		t.Fatalf("thread: %d %v", code, th)
	}
	msgs := ts.URL + "/v1/fb/threads/" + th["id"].(string) + "/messages"
	ids := publishGames(t, ts, alice)
	gameID := ids[0]

	// a share by id, a challenge by slug (stored as the game's id) with a score
	code, sent := do(t, "POST", msgs, alice, js(map[string]any{"text": "Play Game dodge-a with me", "gameId": gameID, "kind": "share"}), "application/json")
	if m := sent["message"].(map[string]any); code != 201 || m["gameId"] != gameID || m["kind"] != "share" || m["score"] != nil {
		t.Fatalf("share: %d %v", code, sent)
	}
	code, sent = do(t, "POST", msgs, alice, js(map[string]any{"gameId": "dodge-a", "kind": "challenge", "score": 34}), "application/json")
	if m := sent["message"].(map[string]any); code != 201 || m["gameId"] != gameID || m["kind"] != "challenge" || m["score"] != float64(34) {
		t.Fatalf("challenge: %d %v", code, sent)
	}
	// no kind means a share
	if code, sent = do(t, "POST", msgs, alice, js(map[string]any{"gameId": gameID}), "application/json"); code != 201 || sent["message"].(map[string]any)["kind"] != "share" {
		t.Fatalf("default kind: %d %v", code, sent)
	}

	// bob's chat list carries the cards
	_, list := do(t, "GET", ts.URL+"/v1/fb/threads", bob, nil, "")
	var cards []map[string]any
	for _, it := range list["items"].([]any) {
		v := it.(map[string]any)
		if v["id"] != th["id"] {
			continue
		}
		if v["lastText"] != "Sent a game" {
			t.Fatalf("lastText: %v", v["lastText"])
		}
		for _, m := range v["messages"].([]any) {
			if mm := m.(map[string]any); mm["gameId"] != nil {
				cards = append(cards, mm)
			}
		}
	}
	if len(cards) != 3 || cards[0]["kind"] != "share" || cards[1]["kind"] != "challenge" || cards[1]["score"] != float64(34) {
		t.Fatalf("bob's cards: %v", cards)
	}

	bad := []map[string]any{
		{"gameId": "no-such-game"},
		{"gameId": "000000000000000000000000"},
	}
	for _, b := range bad {
		if code, out := do(t, "POST", msgs, alice, js(b), "application/json"); code != 404 {
			t.Fatalf("missing game %v: %d %v", b, code, out)
		}
	}
	for _, b := range []map[string]any{
		{"gameId": gameID, "kind": "remix"},
		{"gameId": gameID, "kind": "share", "score": 3},
		{"gameId": gameID, "kind": "challenge", "score": -1},
		{"text": "hi", "kind": "share"},
		{"gameId": strings.Repeat("a", 81)},
	} {
		if code, out := do(t, "POST", msgs, alice, js(b), "application/json"); code != 400 {
			t.Fatalf("bad %v: %d %v", b, code, out)
		}
	}

	// an unlisted game (a draft) goes out only from its owner
	if err := mem.SetGameUnlisted(context.Background(), ids[1], true); err != nil {
		t.Fatal(err)
	}
	if code, _ := do(t, "POST", msgs, bob, js(map[string]any{"gameId": ids[1]}), "application/json"); code != 404 {
		t.Fatalf("someone else's draft: %d", code)
	}
	if code, _ := do(t, "POST", msgs, alice, js(map[string]any{"gameId": ids[1]}), "application/json"); code != 201 {
		t.Fatalf("my own draft: %d", code)
	}
	// someone outside the chat can't post into it
	if code, _ := do(t, "POST", msgs, cat, js(map[string]any{"gameId": gameID}), "application/json"); code != 404 {
		t.Fatalf("stranger: %d", code)
	}
}
