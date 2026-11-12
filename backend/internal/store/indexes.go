package store

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func k(pairs ...any) bson.D {
	d := bson.D{}
	for i := 0; i < len(pairs); i += 2 {
		d = append(d, bson.E{Key: pairs[i].(string), Value: pairs[i+1]})
	}
	return d
}

// EnsureIndexes creates every index the API relies on. It is idempotent and is run by
// cmd/dbinit, not by the API at startup.
func (m *Mongo) EnsureIndexes(ctx context.Context) error {
	const day = 24 * 60 * 60
	plan := map[string][]mongo.IndexModel{
		// authentication
		cUsers: {
			{Keys: k("email", 1), Options: options.Index().SetUnique(true).SetName("email_unique")},
			{Keys: k("username", 1), Options: options.Index().SetUnique(true).SetName("username_unique")},
		},
		cRefresh: {
			{Keys: k("userId", 1), Options: options.Index().SetName("refresh_user")},
			{Keys: k("expiresAt", 1), Options: options.Index().SetExpireAfterSeconds(0).SetName("refresh_ttl")},
		},
		// games: feed order, tags, owner pages, full-text search
		cGames: {
			{Keys: k("createdAt", -1, "_id", -1), Options: options.Index().SetName("feed_newest")},
			{Keys: k("tags", 1, "createdAt", -1), Options: options.Index().SetName("tags_newest")},
			{Keys: k("ownerId", 1, "createdAt", -1), Options: options.Index().SetName("owner_newest")},
			{Keys: k("likes", -1), Options: options.Index().SetName("likes_desc")},
			// the manifest's own id: unique when present
			{Keys: k("slug", 1), Options: options.Index().SetUnique(true).SetName("slug_unique").
				SetPartialFilterExpression(bson.D{{Key: "slug", Value: bson.D{{Key: "$exists", Value: true}}}})},
			{Keys: k("groupId", 1, "createdAt", -1), Options: options.Index().SetName("group_newest").
				SetPartialFilterExpression(bson.D{{Key: "groupId", Value: bson.D{{Key: "$exists", Value: true}}}})},
			{Keys: k("title", "text", "tags", "text", "description", "text"),
				Options: options.Index().SetName("games_search").
					SetWeights(bson.D{{Key: "title", Value: 10}, {Key: "tags", Value: 5}, {Key: "description", Value: 1}})},
		},
		// likes (saves)
		cLikes: {
			{Keys: k("userId", 1, "createdAt", -1), Options: options.Index().SetName("likes_by_user")},
			{Keys: k("gameId", 1), Options: options.Index().SetName("likes_by_game")},
		},
		// feed events: per-user history for the recommender, per-game aggregates, 90 day retention
		cEvents: {
			{Keys: k("userId", 1, "createdAt", -1), Options: options.Index().SetName("events_user")},
			{Keys: k("gameId", 1, "type", 1, "createdAt", -1), Options: options.Index().SetName("events_game_type")},
			{Keys: k("createdAt", 1), Options: options.Index().SetExpireAfterSeconds(90 * day).SetName("events_ttl")},
			// the interleaving summary reads only events that carry a team
			{Keys: k("team", 1, "createdAt", 1), Options: options.Index().SetName("events_team").
				SetPartialFilterExpression(bson.D{{Key: "team", Value: bson.D{{Key: "$exists", Value: true}}}})},
		},
		// leaderboards
		cScores: {
			{Keys: k("gameId", 1, "score", -1, "updatedAt", 1), Options: options.Index().SetName("leaderboard")},
			{Keys: k("userId", 1), Options: options.Index().SetName("scores_user")},
		},
	}
	for coll, models := range plan {
		if _, err := m.coll(coll).Indexes().CreateMany(ctx, models); err != nil {
			return fmt.Errorf("indexes for %s: %w", coll, err)
		}
	}
	return nil
}
