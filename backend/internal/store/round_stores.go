package store

import (
	"context"
	"slices"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

const cRounds = "gamerounds"

func cloneRound(r *model.Round) model.Round {
	c := *r
	c.Members = append([]string(nil), r.Members...)
	c.Lines = append([]model.RoundLine(nil), r.Lines...)
	c.Plays = make(map[string]model.RoundEntry, len(r.Plays))
	for k, v := range r.Plays {
		if v.Result != nil {
			res := make(map[string]any, len(v.Result))
			for a, b := range v.Result {
				res[a] = b
			}
			v.Result = res
		}
		c.Plays[k] = v
	}
	return c
}

func newestRounds(out []model.Round, limit int) []model.Round {
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (m *Memory) InsertRound(ctx context.Context, r *model.Round) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.rounds[r.ID]; ok {
		return ErrConflict
	}
	c := cloneRound(r)
	m.rounds[r.ID] = &c
	return nil
}

func (m *Memory) RoundByID(ctx context.Context, id string) (*model.Round, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rounds[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := cloneRound(r)
	return &c, nil
}

func (m *Memory) ReplaceRound(ctx context.Context, r *model.Round) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.rounds[r.ID]; !ok {
		return ErrNotFound
	}
	c := cloneRound(r)
	m.rounds[r.ID] = &c
	return nil
}

func (m *Memory) RoundsForUser(ctx context.Context, userID string, limit int) ([]model.Round, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Round
	for _, r := range m.rounds {
		if slices.Contains(r.Members, userID) {
			out = append(out, cloneRound(r))
		}
	}
	return newestRounds(out, limit), nil
}

func (m *Memory) RoundsForTarget(ctx context.Context, kind, id string, limit int) ([]model.Round, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Round
	for _, r := range m.rounds {
		if r.TargetKind == kind && r.TargetID == id {
			out = append(out, cloneRound(r))
		}
	}
	return newestRounds(out, limit), nil
}

func (m *Memory) RoundsForGame(ctx context.Context, gameID string, limit int) ([]model.Round, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Round
	for _, r := range m.rounds {
		if r.GameID == gameID {
			out = append(out, cloneRound(r))
		}
	}
	return newestRounds(out, limit), nil
}

func (m *Mongo) InsertRound(ctx context.Context, r *model.Round) error {
	_, err := m.coll(cRounds).InsertOne(ctx, r)
	return mapErr(err)
}

func (m *Mongo) RoundByID(ctx context.Context, id string) (*model.Round, error) {
	var r model.Round
	if err := m.coll(cRounds).FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&r); err != nil {
		return nil, mapErr(err)
	}
	return &r, nil
}

func (m *Mongo) ReplaceRound(ctx context.Context, r *model.Round) error {
	res, err := m.coll(cRounds).ReplaceOne(ctx, bson.D{{Key: "_id", Value: r.ID}}, r)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) findRounds(ctx context.Context, filter bson.D, limit int) ([]model.Round, error) {
	cur, err := m.coll(cRounds).Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Round
	return out, cur.All(ctx, &out)
}

func (m *Mongo) RoundsForUser(ctx context.Context, userID string, limit int) ([]model.Round, error) {
	return m.findRounds(ctx, bson.D{{Key: "members", Value: userID}}, limit)
}

func (m *Mongo) RoundsForTarget(ctx context.Context, kind, id string, limit int) ([]model.Round, error) {
	return m.findRounds(ctx, bson.D{{Key: "targetKind", Value: kind}, {Key: "targetId", Value: id}}, limit)
}

func (m *Mongo) RoundsForGame(ctx context.Context, gameID string, limit int) ([]model.Round, error) {
	return m.findRounds(ctx, bson.D{{Key: "gameId", Value: gameID}}, limit)
}
