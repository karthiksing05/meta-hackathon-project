package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// The catalog in MongoDB: collections game_types and game_tools, one document per entry with _id = the
// entry's id. Documents hold the catalog JSON as is (the same field names as authoring/catalog), plus two
// bookkeeping fields the catalog types ignore: lookupKeys (the folded names a learned type was looked up
// for) and updatedAt.

// Collection names.
const (
	CollGameTypes = "game_types"
	CollGameTools = "game_tools"
)

// toDoc turns a catalog entry into a BSON document via its JSON form, so the field names stay the
// catalog's.
func toDoc(v any, id string) (bson.D, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var d bson.D
	if err := bson.UnmarshalExtJSON(b, false, &d); err != nil {
		return nil, err
	}
	out := bson.D{{Key: "_id", Value: id}}
	for _, e := range d {
		out = append(out, e)
	}
	return append(out, bson.E{Key: "updatedAt", Value: time.Now().UTC()}), nil
}

// fromDoc decodes a raw document into a catalog entry via relaxed extended JSON.
func fromDoc(raw bson.Raw, v any) error {
	b, err := bson.MarshalExtJSON(raw, false, false)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// MongoSource loads the catalog from MongoDB.
type MongoSource struct {
	DB      *mongo.Database
	Skipped []string
}

// Load implements Source. Entries that don't validate are skipped and listed in Skipped.
func (s *MongoSource) Load(ctx context.Context) (*Catalog, error) {
	s.Skipped = nil
	cat := &Catalog{}
	cur, err := s.DB.Collection(CollGameTypes).Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("harness: reading %s: %w", CollGameTypes, err)
	}
	for cur.Next(ctx) {
		var t GameType
		if err := fromDoc(cur.Current, &t); err != nil {
			s.Skipped = append(s.Skipped, err.Error())
			continue
		}
		if err := t.Validate(); err != nil {
			s.Skipped = append(s.Skipped, err.Error())
			continue
		}
		cat.Types = append(cat.Types, t)
	}
	if err := cur.Err(); err != nil {
		cur.Close(ctx)
		return nil, err
	}
	cur.Close(ctx)
	cur, err = s.DB.Collection(CollGameTools).Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("harness: reading %s: %w", CollGameTools, err)
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var t GameTool
		if err := fromDoc(cur.Current, &t); err != nil {
			s.Skipped = append(s.Skipped, err.Error())
			continue
		}
		if err := t.Validate(); err != nil {
			s.Skipped = append(s.Skipped, err.Error())
			continue
		}
		cat.Tools = append(cat.Tools, t)
	}
	return cat, cur.Err()
}

// MongoLearned is a LearnedStore in the game_types collection: learned types are ordinary catalog
// documents with status "learned", found again by the names they were looked up for.
type MongoLearned struct{ DB *mongo.Database }

// Get implements LearnedStore.
func (s MongoLearned) Get(ctx context.Context, ref string) (GameType, bool, error) {
	var t GameType
	raw, err := s.DB.Collection(CollGameTypes).FindOne(ctx, bson.D{{Key: "lookupKeys", Value: LearnedKey(ref)}}).Raw()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return t, false, nil
	}
	if err != nil {
		return t, false, err
	}
	if err := fromDoc(raw, &t); err != nil {
		return t, false, err
	}
	return t, true, nil
}

// Put implements LearnedStore. It never replaces a seed or reviewed entry: if the id is taken by one, the
// learned type is stored as learned_<id>.
func (s MongoLearned) Put(ctx context.Context, ref string, t GameType) error {
	t.Status = "learned"
	c := s.DB.Collection(CollGameTypes)
	var existing struct {
		Status string `bson:"status"`
	}
	err := c.FindOne(ctx, bson.D{{Key: "_id", Value: t.ID}}).Decode(&existing)
	if err == nil && existing.Status != "learned" {
		t.ID = "learned_" + t.ID
	} else if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return err
	}
	doc, err := toDoc(t, t.ID)
	if err != nil {
		return err
	}
	set := bson.D{}
	for _, e := range doc {
		if e.Key != "_id" {
			set = append(set, e)
		}
	}
	_, err = c.UpdateOne(ctx,
		bson.D{{Key: "_id", Value: t.ID}, {Key: "status", Value: "learned"}},
		bson.D{{Key: "$set", Value: set}, {Key: "$addToSet", Value: bson.D{{Key: "lookupKeys", Value: LearnedKey(ref)}}}},
		options.UpdateOne().SetUpsert(true))
	return err
}

// List implements LearnedStore.
func (s MongoLearned) List(ctx context.Context) ([]GameType, error) {
	cur, err := s.DB.Collection(CollGameTypes).Find(ctx, bson.D{{Key: "status", Value: "learned"}},
		options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []GameType
	for cur.Next(ctx) {
		var t GameType
		if err := fromDoc(cur.Current, &t); err == nil {
			out = append(out, t)
		}
	}
	return out, cur.Err()
}

// SeedReport counts what SeedMongo did.
type SeedReport struct {
	Types, Tools, KeptLearned, LearnedAdded int
}

// SeedMongo upserts the catalog into MongoDB. It is idempotent (cmd/dbinit runs it on every deploy):
// seed and reviewed types and every tool are replaced by their repository version; a document that is
// already "learned" is never overwritten; learned entries from the repository are only inserted if absent.
func SeedMongo(ctx context.Context, db *mongo.Database, cat *Catalog) (SeedReport, error) {
	var rep SeedReport
	types := db.Collection(CollGameTypes)
	for _, t := range cat.Types {
		doc, err := toDoc(t, t.ID)
		if err != nil {
			return rep, err
		}
		if t.Status == "learned" {
			r, err := types.UpdateOne(ctx, bson.D{{Key: "_id", Value: t.ID}}, bson.D{{Key: "$setOnInsert", Value: doc[1:]}}, options.UpdateOne().SetUpsert(true))
			if err != nil {
				return rep, fmt.Errorf("seeding %s: %w", t.ID, err)
			}
			if r.UpsertedCount > 0 {
				rep.LearnedAdded++
			}
			continue
		}
		_, err = types.ReplaceOne(ctx, bson.D{{Key: "_id", Value: t.ID}, {Key: "status", Value: bson.D{{Key: "$ne", Value: "learned"}}}}, doc,
			options.Replace().SetUpsert(true))
		switch {
		case mongo.IsDuplicateKeyError(err):
			rep.KeptLearned++ // a learned document holds this id; keep it
		case err != nil:
			return rep, fmt.Errorf("seeding %s: %w", t.ID, err)
		default:
			rep.Types++
		}
	}
	tools := db.Collection(CollGameTools)
	for _, t := range cat.Tools {
		doc, err := toDoc(t, t.ID)
		if err != nil {
			return rep, err
		}
		if _, err := tools.ReplaceOne(ctx, bson.D{{Key: "_id", Value: t.ID}}, doc, options.Replace().SetUpsert(true)); err != nil {
			return rep, fmt.Errorf("seeding tool %s: %w", t.ID, err)
		}
		rep.Tools++
	}
	return rep, nil
}
