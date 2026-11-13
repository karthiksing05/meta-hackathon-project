package harness

import (
	"context"
	"fmt"
	"os"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

// NewForServer wires the harness the way the API runs it: the catalog from Mongo (game_types and
// game_tools, seeded by cmd/dbinit) or, when db is nil or still empty, from authoring/catalog; learned types
// in Mongo (or memory); Muse through the generator for understanding, lookup and planning; and the
// clarification checklists from the catalog folder.
func NewForServer(ctx context.Context, db *mongo.Database, generatorURL string) (*Harness, *Planner, error) {
	var src Source = &DirSource{}
	var learned LearnedStore = NewMemoryLearned()
	if db != nil {
		ms := &MongoSource{DB: db}
		if cat, err := ms.Load(ctx); err == nil && len(cat.Types) > 0 {
			src = ms
		}
		learned = MongoLearned{DB: db}
	}
	h, err := New(ctx, Config{
		Source:       src,
		Understander: MuseUnderstander{Muse: UnderstandMuse(generatorURL)},
		Lookup:       NewLookup(LookupMuse(generatorURL)),
		Learned:      learned,
	})
	if err != nil {
		return nil, nil, err
	}
	planner := &Planner{Muse: PlanMuse(generatorURL), Visual: VisualOn(os.Getenv("HARNESS_VISUAL"))}
	if dir, ok := FindCatalogDir(); ok {
		lists, _, err := LoadChecklists(dir)
		if err != nil {
			return nil, nil, fmt.Errorf("harness: checklists: %w", err)
		}
		planner.Checklists = lists
	}
	return h, planner, nil
}
