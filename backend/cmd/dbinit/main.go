// Command dbinit creates the MongoDB indexes and seeds the game catalog (game_types, game_tools) from
// authoring/catalog/ (or $HARNESS_CATALOG). It is run by hand (or by deploy/dbinit.sh), never as part of a
// routine API restart. It is idempotent: seeding upserts seed and reviewed entries and never overwrites
// learned ones.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func main() {
	uri, db := os.Getenv("MONGO_URI"), os.Getenv("MONGO_DB")
	if db == "" {
		db = "bubbles"
	}
	if uri == "" {
		fmt.Fprintln(os.Stderr, "MONGO_URI is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	m, err := store.ConnectMongo(ctx, uri, db)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	defer m.Close(context.Background())
	if err := m.EnsureIndexes(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("indexes ok")

	if _, ok := harness.FindCatalogDir(); !ok {
		fmt.Println("catalog: not found, skipped (set HARNESS_CATALOG)")
		return
	}
	src := &harness.DirSource{}
	cat, err := src.Load(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "catalog:", err)
		os.Exit(1)
	}
	rep, err := harness.SeedMongo(ctx, m.Database(), cat)
	if err != nil {
		fmt.Fprintln(os.Stderr, "catalog:", err)
		os.Exit(1)
	}
	fmt.Printf("catalog ok: %d types, %d tools seeded; %d learned kept, %d learned added; %d invalid skipped\n",
		rep.Types, rep.Tools, rep.KeptLearned, rep.LearnedAdded, len(src.Skipped))
}
