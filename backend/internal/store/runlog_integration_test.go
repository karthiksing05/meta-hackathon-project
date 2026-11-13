package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// runLogStore is the part of the store the run logs use.
type runLogStore interface {
	PutRunLog(ctx context.Context, l model.RunLog) error
	RunLogOf(ctx context.Context, gameID, userID string) (*model.RunLog, error)
	RunLogScores(ctx context.Context, gameID string, userIDs []string) (map[string]int64, error)
	InsertGame(ctx context.Context, g *model.Game) error
	DeleteGame(ctx context.Context, gameID string) error
}

func checkRunLogs(t *testing.T, s runLogStore) {
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	if err := s.InsertGame(ctx, &model.Game{ID: "g1", Title: "Burst", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RunLogOf(ctx, "g1", "maya"); err != store.ErrNotFound {
		t.Fatalf("no log yet: %v", err)
	}
	put := func(user string, score int64, replay string) {
		if err := s.PutRunLog(ctx, model.RunLog{GameID: "g1", UserID: user, Username: user, Score: score, Replay: replay, EngineLog: "{}", UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	put("maya", 10, `{"seed":1,"inputs":[]}`)
	put("maya", 20, `{"seed":2,"inputs":[]}`) // replaced, not added
	put("alex", 5, `{"seed":3,"inputs":[]}`)
	l, err := s.RunLogOf(ctx, "g1", "maya")
	if err != nil || l.Score != 20 || l.Replay != `{"seed":2,"inputs":[]}` || l.EngineLog != "{}" {
		t.Fatalf("maya's log: %v %+v", err, l)
	}
	got, err := s.RunLogScores(ctx, "g1", []string{"maya", "alex", "cat"})
	if err != nil || len(got) != 2 || got["maya"] != 20 || got["alex"] != 5 {
		t.Fatalf("scores: %v %v", err, got)
	}
	if got, _ := s.RunLogScores(ctx, "g2", []string{"maya"}); len(got) != 0 {
		t.Fatalf("another game: %v", got)
	}
	if err := s.DeleteGame(ctx, "g1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RunLogOf(ctx, "g1", "maya"); err != store.ErrNotFound {
		t.Fatalf("a deleted game keeps its logs: %v", err)
	}
}

func TestRunLogsMemory(t *testing.T) { checkRunLogs(t, store.NewMemory()) }

func TestRunLogsMongo(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set")
	}
	ctx := context.Background()
	m, err := store.ConnectMongo(ctx, uri, "bubbles_test_runlogs_"+time.Now().Format("150405"))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(ctx)
	defer m.DropDatabase(ctx)
	if err := m.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	checkRunLogs(t, m)
}
