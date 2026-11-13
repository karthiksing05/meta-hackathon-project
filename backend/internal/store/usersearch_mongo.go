package store

import (
	"context"
	"regexp"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func (m *Mongo) SearchUsers(ctx context.Context, q string, limit int) ([]model.User, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	esc := regexp.QuoteMeta(q)
	filter := bson.D{{Key: "$or", Value: bson.A{
		bson.D{{Key: "username", Value: bson.Regex{Pattern: "^" + esc}}}, // usernames are stored lowercase: uses the unique index
		bson.D{{Key: "displayName", Value: bson.Regex{Pattern: `(^|\s)` + esc, Options: "i"}}},
	}}}
	cur, err := m.coll(cUsers).Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "username", Value: 1}}).SetLimit(int64(limit)).
		SetProjection(bson.D{{Key: "passwordHash", Value: 0}}))
	if err != nil {
		return nil, err
	}
	var out []model.User
	return out, cur.All(ctx, &out)
}
