package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// The Facebook surfaces on a real MongoDB (MONGO_TEST_URI, see mongo_integration_test.go).
func TestMongoFBStore(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set")
	}
	ctx := context.Background()
	m, err := store.ConnectMongo(ctx, uri, "fb_test_"+time.Now().Format("150405"))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(ctx)
	defer m.DropDatabase(ctx)

	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Millisecond)
	post := model.FBPost{ID: "p1", Kind: "post", AuthorID: "a", Text: "hi", CreatedAt: at,
		Comments: []model.FBComment{{ID: "c1", AuthorID: "b", Text: "yo", CreatedAt: at.Add(time.Minute)}}}
	bare := model.FBPost{ID: "p2", Kind: "post", AuthorID: "a", Text: "no comments", CreatedAt: at}
	if err := m.FBInsertPosts(ctx, []model.FBPost{post, bare}); err != nil {
		t.Fatal(err)
	}
	if err := m.FBInsertStories(ctx, []model.FBStory{{ID: "s1", AuthorID: "a", Text: "x", CreatedAt: at}}); err != nil {
		t.Fatal(err)
	}
	if err := m.FBSetReaction(ctx, "p1", "u1", "love"); err != nil {
		t.Fatal(err)
	}
	if err := m.FBShiftTimes(ctx, []string{"p1", "p2"}, []string{"s1"}, 72*time.Hour); err != nil {
		t.Fatal(err)
	}
	got, err := m.FBPostByID(ctx, "p1")
	if err != nil {
		t.Fatal(err)
	}
	want := at.Add(72 * time.Hour)
	if !got.CreatedAt.Equal(want) || !got.Comments[0].CreatedAt.Equal(want.Add(time.Minute)) || got.ReactionsBy["u1"] != "love" {
		t.Fatalf("shifted post: %+v", got)
	}
	if p2, _ := m.FBPostByID(ctx, "p2"); !p2.CreatedAt.Equal(want) || len(p2.Comments) != 0 {
		t.Fatalf("shifted bare post: %+v", p2)
	}
	if ss, _ := m.FBStories(ctx, time.Now(), 0); len(ss) != 1 || !ss[0].CreatedAt.Equal(want) {
		t.Fatalf("shifted story: %+v", ss)
	}
}
