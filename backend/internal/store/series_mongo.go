package store

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

const cSeries = "series"

func (m *Mongo) InsertSeries(ctx context.Context, s *model.Series) error {
	_, err := m.coll(cSeries).InsertOne(ctx, s)
	return mapErr(err)
}

func (m *Mongo) SeriesByID(ctx context.Context, id string) (*model.Series, error) {
	var s model.Series
	if err := m.coll(cSeries).FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&s); err != nil {
		return nil, mapErr(err)
	}
	return &s, nil
}

func (m *Mongo) ReplaceSeries(ctx context.Context, s *model.Series) error {
	r, err := m.coll(cSeries).ReplaceOne(ctx, bson.D{{Key: "_id", Value: s.ID}}, s)
	if err != nil {
		return err
	}
	if r.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) SeriesForUser(ctx context.Context, userID string, limit int) ([]model.Series, error) {
	cur, err := m.coll(cSeries).Find(ctx,
		bson.D{{Key: "$or", Value: bson.A{bson.D{{Key: "playerA", Value: userID}}, bson.D{{Key: "playerB", Value: userID}}}}},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Series
	return out, cur.All(ctx, &out)
}
