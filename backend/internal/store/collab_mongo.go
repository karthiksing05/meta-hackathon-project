package store

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

const cChallenges = "challenges"

func (m *Mongo) LikedGameIDs(ctx context.Context, userID string, limit int) ([]string, error) {
	cur, err := m.coll(cLikes).Find(ctx, bson.D{{Key: "userId", Value: userID}},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		GameID string `bson:"gameId"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.GameID
	}
	return out, nil
}

func (m *Mongo) GameLikers(ctx context.Context, gameID string, limit int) ([]string, error) {
	cur, err := m.coll(cLikes).Find(ctx, bson.D{{Key: "gameId", Value: gameID}},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		UserID string `bson:"userId"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.UserID
	}
	return out, nil
}

func (m *Mongo) InsertChallenge(ctx context.Context, c *model.Challenge) error {
	_, err := m.coll(cChallenges).InsertOne(ctx, c)
	return mapErr(err)
}

func (m *Mongo) ChallengesFor(ctx context.Context, userID string, limit int) ([]model.Challenge, error) {
	cur, err := m.coll(cChallenges).Find(ctx,
		bson.D{{Key: "$or", Value: bson.A{bson.D{{Key: "fromId", Value: userID}}, bson.D{{Key: "toIds", Value: userID}}}}},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Challenge
	return out, cur.All(ctx, &out)
}

func (m *Mongo) MomentsWith(ctx context.Context, userID string, limit int) ([]model.Event, error) {
	cur, err := m.coll(cEvents).Find(ctx,
		bson.D{{Key: "with", Value: userID}, {Key: "kind", Value: bson.D{{Key: "$exists", Value: true}}}},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Event
	return out, cur.All(ctx, &out)
}
