package store

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// Mongo is the production Store. It never creates indexes itself; run cmd/dbinit for that, so
// routine API restarts do not touch the schema.
type Mongo struct {
	client *mongo.Client
	db     *mongo.Database
}

func ConnectMongo(ctx context.Context, uri, dbName string) (*Mongo, error) {
	opts := options.Client().ApplyURI(uri).
		SetServerSelectionTimeout(10 * time.Second).
		SetAppName("bubbles-api")
	c, err := mongo.Connect(opts)
	if err != nil {
		return nil, err
	}
	m := &Mongo{client: c, db: c.Database(dbName)}
	pctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := m.Ping(pctx); err != nil {
		c.Disconnect(context.Background())
		return nil, err
	}
	return m, nil
}

// DropDatabase is for tests only.
func (m *Mongo) DropDatabase(ctx context.Context) error { return m.db.Drop(ctx) }

func (m *Mongo) Close(ctx context.Context) error { return m.client.Disconnect(ctx) }

func (m *Mongo) Ping(ctx context.Context) error { return m.client.Ping(ctx, nil) }

// Collection names.
const (
	cUsers   = "users"
	cRefresh = "refresh_tokens"
	cGames   = "games"
	cLikes   = "likes"
	cEvents  = "feed_events"
	cScores  = "scores"
)

func (m *Mongo) coll(n string) *mongo.Collection { return m.db.Collection(n) }

func mapErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, mongo.ErrNoDocuments):
		return ErrNotFound
	case mongo.IsDuplicateKeyError(err):
		return ErrConflict
	}
	return err
}

func (m *Mongo) CreateUser(ctx context.Context, u *model.User) error {
	_, err := m.coll(cUsers).InsertOne(ctx, u)
	return mapErr(err)
}

func (m *Mongo) userBy(ctx context.Context, f bson.D) (*model.User, error) {
	var u model.User
	if err := m.coll(cUsers).FindOne(ctx, f).Decode(&u); err != nil {
		return nil, mapErr(err)
	}
	return &u, nil
}

func (m *Mongo) UserByEmail(ctx context.Context, e string) (*model.User, error) {
	return m.userBy(ctx, bson.D{{Key: "email", Value: e}})
}

func (m *Mongo) UserByID(ctx context.Context, id string) (*model.User, error) {
	return m.userBy(ctx, bson.D{{Key: "_id", Value: id}})
}

func (m *Mongo) PutRefresh(ctx context.Context, t model.RefreshToken) error {
	_, err := m.coll(cRefresh).InsertOne(ctx, t)
	return mapErr(err)
}

func (m *Mongo) TakeRefresh(ctx context.Context, hash string) (*model.RefreshToken, error) {
	var t model.RefreshToken
	err := m.coll(cRefresh).FindOneAndDelete(ctx, bson.D{{Key: "_id", Value: hash}}).Decode(&t)
	if err != nil {
		return nil, mapErr(err)
	}
	if time.Now().After(t.ExpiresAt) {
		return nil, ErrNotFound
	}
	return &t, nil
}

func (m *Mongo) DeleteRefresh(ctx context.Context, hash string) error {
	_, err := m.coll(cRefresh).DeleteOne(ctx, bson.D{{Key: "_id", Value: hash}})
	return err
}

func (m *Mongo) InsertGame(ctx context.Context, g *model.Game) error {
	_, err := m.coll(cGames).InsertOne(ctx, g)
	return mapErr(err)
}

func (m *Mongo) GameByID(ctx context.Context, id string) (*model.Game, error) {
	var g model.Game
	if err := m.coll(cGames).FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&g); err != nil {
		return nil, mapErr(err)
	}
	return &g, nil
}

func cursorFilter(base bson.D, c Cursor) bson.D {
	if c.IsZero() {
		return base
	}
	return append(base, bson.E{Key: "$or", Value: bson.A{
		bson.D{{Key: "createdAt", Value: bson.D{{Key: "$lt", Value: c.At}}}},
		bson.D{{Key: "createdAt", Value: c.At}, {Key: "_id", Value: bson.D{{Key: "$lt", Value: c.ID}}}},
	}})
}

var newestFirst = bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}}

func (m *Mongo) findGames(ctx context.Context, f bson.D, o *options.FindOptionsBuilder) ([]model.Game, error) {
	cur, err := m.coll(cGames).Find(ctx, f, o)
	if err != nil {
		return nil, err
	}
	var out []model.Game
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (m *Mongo) GamesByOwner(ctx context.Context, owner string, limit int, c Cursor) ([]model.Game, error) {
	f := cursorFilter(bson.D{{Key: "ownerId", Value: owner}}, c)
	return m.findGames(ctx, f, options.Find().SetSort(newestFirst).SetLimit(int64(limit)))
}

func (m *Mongo) Feed(ctx context.Context, limit int, c Cursor) ([]model.Game, error) {
	return m.findGames(ctx, cursorFilter(bson.D{}, c), options.Find().SetSort(newestFirst).SetLimit(int64(limit)))
}

func (m *Mongo) Search(ctx context.Context, q, tag string, limit, offset int) ([]model.Game, error) {
	f := bson.D{}
	o := options.Find().SetLimit(int64(limit)).SetSkip(int64(offset))
	if q != "" {
		f = append(f, bson.E{Key: "$text", Value: bson.D{{Key: "$search", Value: q}}})
		meta := bson.D{{Key: "$meta", Value: "textScore"}}
		o.SetProjection(bson.D{{Key: "textScore", Value: meta}})
		o.SetSort(bson.D{{Key: "textScore", Value: meta}, {Key: "_id", Value: -1}})
	} else {
		o.SetSort(newestFirst)
	}
	if tag != "" {
		f = append(f, bson.E{Key: "tags", Value: tag})
	}
	return m.findGames(ctx, f, o)
}

func (m *Mongo) SetLike(ctx context.Context, gameID, userID string, liked bool) (int64, error) {
	var g model.Game
	if err := m.coll(cGames).FindOne(ctx, bson.D{{Key: "_id", Value: gameID}}).Decode(&g); err != nil {
		return 0, mapErr(err)
	}
	id := gameID + ":" + userID
	delta := int64(0)
	if liked {
		_, err := m.coll(cLikes).InsertOne(ctx, bson.D{
			{Key: "_id", Value: id}, {Key: "gameId", Value: gameID},
			{Key: "userId", Value: userID}, {Key: "createdAt", Value: time.Now().UTC()},
		})
		if err == nil {
			delta = 1
		} else if !mongo.IsDuplicateKeyError(err) {
			return 0, err
		}
	} else {
		r, err := m.coll(cLikes).DeleteOne(ctx, bson.D{{Key: "_id", Value: id}})
		if err != nil {
			return 0, err
		}
		delta = -r.DeletedCount
	}
	if delta == 0 {
		return g.Likes, nil
	}
	err := m.coll(cGames).FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: gameID}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "likes", Value: delta}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&g)
	return g.Likes, mapErr(err)
}

func (m *Mongo) LikedSet(ctx context.Context, userID string, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	cur, err := m.coll(cLikes).Find(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "gameId", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var rows []struct {
		GameID string `bson:"gameId"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.GameID] = true
	}
	return out, nil
}

func (m *Mongo) AddEvents(ctx context.Context, evs []model.Event) error {
	if len(evs) == 0 {
		return nil
	}
	docs := make([]any, len(evs))
	plays, finishes := map[string]int64{}, map[string]int64{}
	for i, e := range evs {
		docs[i] = e
		switch e.Type {
		case "play":
			plays[e.GameID]++
		case "finish":
			finishes[e.GameID]++
		}
	}
	if _, err := m.coll(cEvents).InsertMany(ctx, docs); err != nil {
		return err
	}
	var writes []mongo.WriteModel
	for id, n := range plays {
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.D{{Key: "_id", Value: id}}).
			SetUpdate(bson.D{{Key: "$inc", Value: bson.D{{Key: "plays", Value: n}}}}))
	}
	for id, n := range finishes {
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.D{{Key: "_id", Value: id}}).
			SetUpdate(bson.D{{Key: "$inc", Value: bson.D{{Key: "finishes", Value: n}}}}))
	}
	if len(writes) > 0 {
		_, err := m.coll(cGames).BulkWrite(ctx, writes)
		return err
	}
	return nil
}

func (m *Mongo) SubmitScore(ctx context.Context, s model.Score) error {
	_, err := m.coll(cScores).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: s.GameID + ":" + s.UserID}},
		bson.D{
			{Key: "$max", Value: bson.D{{Key: "score", Value: s.Score}}},
			{Key: "$set", Value: bson.D{{Key: "gameId", Value: s.GameID}, {Key: "userId", Value: s.UserID},
				{Key: "username", Value: s.Username}, {Key: "updatedAt", Value: s.UpdatedAt}}},
		},
		options.UpdateOne().SetUpsert(true))
	return err
}

func (m *Mongo) Leaderboard(ctx context.Context, gameID string, limit int) ([]model.Score, error) {
	cur, err := m.coll(cScores).Find(ctx, bson.D{{Key: "gameId", Value: gameID}},
		options.Find().SetSort(bson.D{{Key: "score", Value: -1}, {Key: "updatedAt", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Score
	return out, cur.All(ctx, &out)
}
