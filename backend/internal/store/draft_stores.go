package store

import (
	"context"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func (m *Memory) SetGameUnlisted(ctx context.Context, gameID string, unlisted bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.games[gameID]
	if !ok {
		return ErrNotFound
	}
	g.Unlisted = unlisted
	return nil
}

func (m *Memory) DeleteGame(ctx context.Context, gameID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.games[gameID]; !ok {
		return ErrNotFound
	}
	delete(m.games, gameID)
	for k := range m.likes {
		if strings.HasPrefix(k, gameID+"|") {
			delete(m.likes, k)
		}
	}
	for k, s := range m.scores {
		if s.GameID == gameID {
			delete(m.scores, k)
		}
	}
	return nil
}

func (m *Mongo) SetGameUnlisted(ctx context.Context, gameID string, unlisted bool) error {
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "unlisted", Value: unlisted}}}}
	if !unlisted {
		update = bson.D{{Key: "$unset", Value: bson.D{{Key: "unlisted", Value: ""}}}}
	}
	r, err := m.coll(cGames).UpdateOne(ctx, bson.D{{Key: "_id", Value: gameID}}, update)
	if err != nil {
		return err
	}
	if r.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) DeleteGame(ctx context.Context, gameID string) error {
	r, err := m.coll(cGames).DeleteOne(ctx, bson.D{{Key: "_id", Value: gameID}})
	if err != nil {
		return err
	}
	if r.DeletedCount == 0 {
		return ErrNotFound
	}
	by := bson.D{{Key: "gameId", Value: gameID}}
	if _, err := m.coll(cLikes).DeleteMany(ctx, by); err != nil {
		return err
	}
	_, err = m.coll(cScores).DeleteMany(ctx, by)
	return err
}

var _ = model.Game{}
