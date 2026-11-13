package store

import (
	"context"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// sortScores orders a board in place: best first in the game's direction, then the tie-break.
func sortScores(rows []model.Score, o model.BoardOrder) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if o.Recent {
			return a.UpdatedAt.After(b.UpdatedAt)
		}
		if a.Score != b.Score {
			if o.Lower {
				return a.Score < b.Score
			}
			return a.Score > b.Score
		}
		if o.TieByTime && a.TimeMs != b.TimeMs {
			return a.TimeMs < b.TimeMs
		}
		return a.UpdatedAt.Before(b.UpdatedAt)
	})
}

func (m *Memory) Board(ctx context.Context, gameID string, limit int, o model.BoardOrder) ([]model.Score, error) {
	m.mu.Lock()
	var out []model.Score
	for _, s := range m.scores {
		if s.GameID == gameID {
			out = append(out, s)
		}
	}
	m.mu.Unlock()
	sortScores(out, o)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) ScoreOf(ctx context.Context, gameID, userID string) (*model.Score, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.scores[gameID+"|"+userID]
	if !ok {
		return nil, ErrNotFound
	}
	return &s, nil
}

func (m *Memory) PutScore(ctx context.Context, s model.Score) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.scores[s.GameID+"|"+s.UserID] = s
	return nil
}

func (m *Mongo) Board(ctx context.Context, gameID string, limit int, o model.BoardOrder) ([]model.Score, error) {
	dir := -1
	if o.Lower {
		dir = 1
	}
	order := bson.D{{Key: "score", Value: dir}}
	if o.TieByTime {
		order = append(order, bson.E{Key: "timeMs", Value: 1})
	}
	order = append(order, bson.E{Key: "updatedAt", Value: 1})
	if o.Recent {
		order = bson.D{{Key: "updatedAt", Value: -1}}
	}
	cur, err := m.coll(cScores).Find(ctx, bson.D{{Key: "gameId", Value: gameID}}, options.Find().SetSort(order).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Score
	return out, cur.All(ctx, &out)
}

func (m *Mongo) ScoreOf(ctx context.Context, gameID, userID string) (*model.Score, error) {
	var s model.Score
	if err := m.coll(cScores).FindOne(ctx, bson.D{{Key: "_id", Value: gameID + ":" + userID}}).Decode(&s); err != nil {
		return nil, mapErr(err)
	}
	return &s, nil
}

func (m *Mongo) PutScore(ctx context.Context, s model.Score) error {
	_, err := m.coll(cScores).ReplaceOne(ctx, bson.D{{Key: "_id", Value: s.GameID + ":" + s.UserID}},
		bson.D{
			{Key: "gameId", Value: s.GameID}, {Key: "userId", Value: s.UserID}, {Key: "username", Value: s.Username},
			{Key: "score", Value: s.Score}, {Key: "timeMs", Value: s.TimeMs}, {Key: "updatedAt", Value: s.UpdatedAt},
		},
		options.Replace().SetUpsert(true))
	return err
}
