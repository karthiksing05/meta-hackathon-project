package store

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func (m *Memory) SetGameSponsor(ctx context.Context, gameID string, sp *model.Sponsor) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.games[gameID]
	if !ok {
		return ErrNotFound
	}
	if sp == nil {
		g.Sponsor = nil
	} else {
		c := *sp
		g.Sponsor = &c
	}
	return nil
}

func (m *Mongo) SetGameSponsor(ctx context.Context, gameID string, sp *model.Sponsor) error {
	update := bson.D{{Key: "$unset", Value: bson.D{{Key: "sponsor", Value: ""}}}}
	if sp != nil {
		update = bson.D{{Key: "$set", Value: bson.D{{Key: "sponsor", Value: sp}}}}
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
