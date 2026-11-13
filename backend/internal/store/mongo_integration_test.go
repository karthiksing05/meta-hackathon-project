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
	if _, err := m.AddEvents(ctx, []model.Event{{ID: "e1", UserID: "u1", GameID: id, Type: "play", TookOver: true, CreatedAt: now}}); err != nil {
		t.Fatal(err)
	}
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

// The event log roll-ups run as aggregation pipelines, so they are checked against a real server.
func TestMongoEventLog(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set")
	}
	ctx := context.Background()
	m, err := store.ConnectMongo(ctx, uri, "bubbles_test_events_"+time.Now().Format("150405"))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(ctx)
	defer m.DropDatabase(ctx)
	if err := m.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	id := "a0123456789abcdef0123456"
	g := &model.Game{ID: id, OwnerID: "u1", Title: "Fog", Slug: "fog", StorageKey: id, ManifestPath: "manifest.json", CreatedAt: now}
	if err := m.InsertGame(ctx, g); err != nil {
		t.Fatal(err)
	}
	// a second game may not take the same slug
	dup := *g
	dup.ID = "b0123456789abcdef0123456"
	if err := m.InsertGame(ctx, &dup); err != store.ErrConflict {
		t.Fatalf("duplicate slug: %v", err)
	}
	if got, err := m.GameBySlug(ctx, "fog"); err != nil || got.ID != id {
		t.Fatalf("by slug: %v %v", got, err)
	}

	page := func(eid, actor, session, team string) model.Event {
		return model.Event{ID: actor + "|" + eid, ClientEventID: eid, Actor: actor, GameID: "fog", SessionID: session,
			Team: team, Impression: true, TookOver: true, RunsFinished: 1, Credit: true, Satisfied: true, CreatedAt: now}
	}
	evs := []model.Event{
		page("1", "u:1", "s1", "A"), page("2", "u:1", "s1", "A"), page("3", "u:1", "s1", "B"), // formula wins s1
		page("4", "u:2", "s1", "B"), // same session name, other person: control wins
		{ID: "u:2|5", Actor: "u:2", GameID: "fog", Kind: "remix", SocialMoment: true, Credit: true, CreatedAt: now},
	}
	if n, err := m.AddEvents(ctx, evs); err != nil || n != 5 {
		t.Fatalf("add: %d %v", n, err)
	}
	if n, err := m.AddEvents(ctx, evs); err != nil || n != 0 { // a resent batch is a no-op
		t.Fatalf("resend: %d %v", n, err)
	}
	if g, _ := m.GameByID(ctx, id); g.Plays != 4 || g.Finishes != 4 { // slug events reach the counters once
		t.Fatalf("counters: plays %d finishes %d", g.Plays, g.Finishes)
	}

	stats, err := m.GameStats(ctx, time.Time{})
	if err != nil || len(stats) != 1 {
		t.Fatalf("stats: %v %v", stats, err)
	}
	st := stats[0]
	if st.Key != "fog" || st.Impressions != 4 || st.Takeovers != 4 || st.Finishes != 4 || st.Satisfied != 4 || st.SocialMoments != 1 {
		t.Fatalf("stats row: %+v", st)
	}
	if old, _ := m.GameStats(ctx, now.Add(time.Hour)); len(old) != 0 {
		t.Fatalf("since in the future: %v", old)
	}

	il, err := m.Interleave(ctx, time.Time{})
	if err != nil || il.Sessions != 2 || il.FormulaWins != 1 || il.ControlWins != 1 || il.Ties != 0 {
		t.Fatalf("interleave: %+v %v", il, err)
	}
	if none, err := m.Interleave(ctx, now.Add(time.Hour)); err != nil || none.Sessions != 0 {
		t.Fatalf("empty interleave: %+v %v", none, err)
	}

	out, err := m.ExportEvents(ctx, time.Time{}, 3)
	if err != nil || len(out) != 3 {
		t.Fatalf("export limit: %d %v", len(out), err)
	}
}

// Generation jobs: pushed events, status changes, rate-limit counts and the restart sweep.
func TestMongoJobs(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set")
	}
	ctx := context.Background()
	m, err := store.ConnectMongo(ctx, uri, "bubbles_test_jobs_"+time.Now().Format("150405"))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(ctx)
	defer m.DropDatabase(ctx)
	if err := m.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	j := &model.Job{ID: "j1", OwnerID: "u1", Request: "a game", Brief: map[string]any{"intent": "x"}, Status: model.JobQueued, CreatedAt: now, UpdatedAt: now}
	if err := m.InsertJob(ctx, j); err != nil {
		t.Fatal(err)
	}
	if active, err := m.HasActiveJob(ctx, "u1"); err != nil || !active {
		t.Fatalf("active job: %v %v", active, err)
	}
	if err := m.SetJobStatus(ctx, "j1", model.JobRunning, model.JobUpdate{}); err != nil {
		t.Fatal(err)
	}
	for i, k := range []string{"drafting", "expanding", "done"} {
		if err := m.AppendJobEvent(ctx, "j1", model.JobEvent{Seq: i + 1, Kind: k, Summary: k, At: now, Detail: map[string]any{"round": 1}}); err != nil {
			t.Fatal(err)
		}
	}
	got, err := m.JobByID(ctx, "j1")
	if err != nil || len(got.Events) != 3 || got.Events[2].Kind != "done" || got.Events[0].Detail["round"] == nil || got.Status != model.JobRunning {
		t.Fatalf("job: %+v %v", got, err)
	}
	if err := m.SetJobStatus(ctx, "j1", model.JobDone, model.JobUpdate{GameID: "g1", Stats: map[string]any{"museCalls": 2}}); err != nil {
		t.Fatal(err)
	}
	if got, _ := m.JobByID(ctx, "j1"); got.GameID != "g1" || got.FinishedAt == nil || got.Stats["museCalls"] == nil {
		t.Fatalf("finished job: %+v", got)
	}
	if active, _ := m.HasActiveJob(ctx, "u1"); active {
		t.Fatal("a finished job is not active")
	}
	if n, _ := m.CountJobsSince(ctx, "u1", now.Add(-time.Hour)); n != 1 {
		t.Fatalf("count: %d", n)
	}
	if n, _ := m.CountJobsSince(ctx, "u1", now.Add(time.Hour)); n != 0 {
		t.Fatalf("count in the future: %d", n)
	}
	m.InsertJob(ctx, &model.Job{ID: "j2", OwnerID: "u2", Status: model.JobRunning, CreatedAt: now, UpdatedAt: now})
	if n, err := m.FailStaleJobs(ctx, "restarted"); err != nil || n != 1 {
		t.Fatalf("stale sweep: %d %v", n, err)
	}
	if got, _ := m.JobByID(ctx, "j2"); got.Status != model.JobFailed || got.Error != "restarted" {
		t.Fatalf("stale job: %+v", got)
	}
	if list, err := m.JobsByOwner(ctx, "u1", 10); err != nil || len(list) != 1 {
		t.Fatalf("list: %v %v", list, err)
	}
	if err := m.SetJobStatus(ctx, "nope", model.JobDone, model.JobUpdate{}); err != store.ErrNotFound {
		t.Fatalf("missing job: %v", err)
	}
}
