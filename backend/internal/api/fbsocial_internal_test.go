package api

import (
	"context"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// The demo world moves forward when it has drifted more than an hour, and keeps comments with their posts.
func TestFreshenFBKeepsTheDemoWorldRecent(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemory()
	s := New(Options{Store: mem})
	st := s.fbSeed()
	if err := s.seedFB(ctx, mem, st); err != nil {
		t.Fatal(err)
	}
	id, minutesAgo, _ := st.world.Anchor()
	before, _ := mem.FBPostByID(ctx, id)

	// 30 minutes later: no change
	if err := s.freshenFB(ctx, mem, st.world, time.Now().UTC().Add(30*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p, _ := mem.FBPostByID(ctx, id); !p.CreatedAt.Equal(before.CreatedAt) {
		t.Fatalf("moved too early: %v -> %v", before.CreatedAt, p.CreatedAt)
	}

	// three days later: everything is as recent as when seeded
	later := time.Now().UTC().Add(72 * time.Hour)
	if err := s.freshenFB(ctx, mem, st.world, later); err != nil {
		t.Fatal(err)
	}
	p, _ := mem.FBPostByID(ctx, id)
	if got := later.Sub(p.CreatedAt); got < time.Duration(minutesAgo)*time.Minute-time.Second || got > time.Duration(minutesAgo)*time.Minute+time.Second {
		t.Fatalf("anchor is %v old, want %d minutes", got, minutesAgo)
	}
	intro, _ := mem.FBPostByID(ctx, "world-intro-sf-maya-okafor")
	if len(intro.Comments) == 0 || intro.Comments[0].CreatedAt.Before(intro.CreatedAt.Add(-48*time.Hour)) {
		t.Fatalf("comments did not move with their post: %+v", intro.Comments)
	}
	stories, _ := mem.FBStories(ctx, later, 0)
	if len(stories) == 0 || later.Sub(stories[0].CreatedAt) > 24*time.Hour {
		t.Fatalf("stories did not move: %v", stories[0].CreatedAt)
	}
}
