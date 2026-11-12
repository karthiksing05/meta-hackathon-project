package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Runs against a real MongoDB when MONGO_TEST_URI is set, for example:
//
//	docker run -d --rm -p 127.0.0.1:27018:27017 mongo:8.0
//	MONGO_TEST_URI=mongodb://127.0.0.1:27018 go test ./internal/store
//
// It uses a throwaway database and drops it afterwards.
func TestMongoStore(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set")
	}
	ctx := context.Background()
	dbName := "bubbles_test_" + time.Now().Format("150405")
	m, err := store.ConnectMongo(ctx, uri, dbName)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(ctx)
	defer m.DropDatabase(ctx)
	if err := m.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	if err := m.EnsureIndexes(ctx); err != nil { // idempotent
		t.Fatal(err)
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	u := &model.User{ID: "u1", Email: "a@example.com", Username: "a", CreatedAt: now}
	if err := m.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	if err := m.CreateUser(ctx, &model.User{ID: "u2", Email: "a@example.com", Username: "b"}); err != store.ErrConflict {
		t.Fatalf("duplicate email: %v", err)
	}
	for i, title := range []string{"Fog Words", "Hill Drift", "Fog Runner"} {
		id := string(rune('a'+i)) + "0123456789abcdef0123456" // 24 hex characters
		g := &model.Game{ID: id, OwnerID: "u1", Title: title, Description: "a game", Tags: []string{"cozy"},
			StorageKey: id, ManifestPath: "manifest.json", CreatedAt: now.Add(time.Duration(i) * time.Second)}
		if err := m.InsertGame(ctx, g); err != nil {
			t.Fatal(err)
		}
	}
	feed, err := m.Feed(ctx, 2, store.Cursor{})
	if err != nil || len(feed) != 2 || feed[0].Title != "Fog Runner" {
		t.Fatalf("feed: %v %v", feed, err)
	}
	next, _ := m.Feed(ctx, 5, store.Cursor{At: feed[1].CreatedAt, ID: feed[1].ID})
	if len(next) != 1 || next[0].Title != "Fog Words" {
		t.Fatalf("page 2: %v", next)
	}
	res, err := m.Search(ctx, "fog", "", 10, 0)
	if err != nil || len(res) != 2 {
		t.Fatalf("text search: %v %v", res, err)
	}
	if res, _ := m.Search(ctx, "", "cozy", 10, 0); len(res) != 3 {
		t.Fatalf("tag search: %d", len(res))
	}
	id := feed[0].ID
	for i := 0; i < 2; i++ {
		if n, err := m.SetLike(ctx, id, "u1", true); err != nil || n != 1 {
			t.Fatalf("like: %d %v", n, err)
		}
	}
	if n, _ := m.SetLike(ctx, id, "u1", false); n != 0 {
		t.Fatalf("unlike: %d", n)
	}
	m.AddEvents(ctx, []model.Event{{ID: "e1", UserID: "u1", GameID: id, Type: "play", CreatedAt: now}})
	if g, _ := m.GameByID(ctx, id); g.Plays != 1 {
		t.Fatalf("plays: %d", g.Plays)
	}
	m.SubmitScore(ctx, model.Score{GameID: id, UserID: "u1", Username: "a", Score: 9, UpdatedAt: now})
	m.SubmitScore(ctx, model.Score{GameID: id, UserID: "u1", Username: "a", Score: 3, UpdatedAt: now})
	if lb, _ := m.Leaderboard(ctx, id, 5); len(lb) != 1 || lb[0].Score != 9 {
		t.Fatalf("leaderboard: %v", lb)
	}
	m.PutRefresh(ctx, model.RefreshToken{Hash: "h", UserID: "u1", ExpiresAt: now.Add(time.Hour)})
	if _, err := m.TakeRefresh(ctx, "h"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.TakeRefresh(ctx, "h"); err != store.ErrNotFound {
		t.Fatalf("second take: %v", err)
	}
}
