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
			{Keys: k("sound.id", 1, "createdAt", -1), Options: options.Index().SetName("sound_games").
				SetPartialFilterExpression(bson.D{{Key: "sound.id", Value: bson.D{{Key: "$exists", Value: true}}}})},
			{Keys: k("groupId", 1, "createdAt", -1), Options: options.Index().SetName("group_newest").
				SetPartialFilterExpression(bson.D{{Key: "groupId", Value: bson.D{{Key: "$exists", Value: true}}}})},
			{Keys: k("title", "text", "tags", "text", "description", "text"),
				Options: options.Index().SetName("games_search").
					SetWeights(bson.D{{Key: "title", Value: 10}, {Key: "tags", Value: 5}, {Key: "description", Value: 1}})},
		},
		cNotifications: {
			{Keys: k("userId", 1, "source", 1), Options: options.Index().SetUnique(true).SetName("notif_user_source")},
			{Keys: k("userId", 1, "createdAt", -1, "_id", -1), Options: options.Index().SetName("notif_inbox")},
			{Keys: k("pushState", 1, "nextPushAt", 1), Options: options.Index().SetName("notif_push_due").
				SetPartialFilterExpression(bson.D{{Key: "pushState", Value: "pending"}})},
		},
		cPushDevices: {
			{Keys: k("userId", 1), Options: options.Index().SetName("push_devices_user")},
		},
		cSounds: {
			{Keys: k("useCount", -1, "createdAt", -1), Options: options.Index().SetName("sounds_trending")},
			{Keys: k("createdAt", -1), Options: options.Index().SetName("sounds_recent")},
		},
		cSoundSaves: {
			{Keys: k("userId", 1), Options: options.Index().SetName("sound_saves_by_user")},
			{Keys: k("soundId", 1), Options: options.Index().SetName("sound_saves_by_sound")},
		},
		cSeries: {
			{Keys: k("playerA", 1, "createdAt", -1), Options: options.Index().SetName("series_a")},
			{Keys: k("playerB", 1, "createdAt", -1), Options: options.Index().SetName("series_b")},
		},
		cChallenges: {
			{Keys: k("fromId", 1, "createdAt", -1), Options: options.Index().SetName("challenges_from")},
			{Keys: k("toIds", 1, "createdAt", -1), Options: options.Index().SetName("challenges_to")},
		},
		// likes (saves)
		cLikes: {
			{Keys: k("userId", 1, "createdAt", -1), Options: options.Index().SetName("likes_by_user")},
			{Keys: k("gameId", 1), Options: options.Index().SetName("likes_by_game")},
		},
		// feed events: per-user history for the recommender, per-game aggregates, 90 day retention
		cEvents: {
			{Keys: k("userId", 1, "createdAt", -1), Options: options.Index().SetName("events_user")},
			{Keys: k("with", 1, "createdAt", -1), Options: options.Index().SetName("events_with").
				SetPartialFilterExpression(bson.D{{Key: "with", Value: bson.D{{Key: "$exists", Value: true}}}})},
			{Keys: k("gameId", 1, "type", 1, "createdAt", -1), Options: options.Index().SetName("events_game_type")},
			{Keys: k("createdAt", 1), Options: options.Index().SetExpireAfterSeconds(90 * day).SetName("events_ttl")},
			// the interleaving summary reads only events that carry a team
			{Keys: k("team", 1, "createdAt", 1), Options: options.Index().SetName("events_team").
				SetPartialFilterExpression(bson.D{{Key: "team", Value: bson.D{{Key: "$exists", Value: true}}}})},
		},
		// generation jobs: a person's recent jobs and rate limits; removed after 30 days
		cJobs: {
			{Keys: k("ownerId", 1, "createdAt", -1), Options: options.Index().SetName("jobs_owner")},
			{Keys: k("status", 1), Options: options.Index().SetName("jobs_status")},
			{Keys: k("createdAt", 1), Options: options.Index().SetExpireAfterSeconds(30 * day).SetName("jobs_ttl")},
		},
		// friendships (one row per direction), Groups and their members
		cFriends: {
			{Keys: k("userId", 1, "friendId", 1), Options: options.Index().SetName("friends_user")},
		},
		cGroups: {
			{Keys: k("kind", 1, "name", 1), Options: options.Index().SetName("groups_kind")},
		},
		cMembers: {
			{Keys: k("groupId", 1, "userId", 1), Options: options.Index().SetName("members_group")},
			{Keys: k("userId", 1), Options: options.Index().SetName("members_user")},
		},
		// leaderboards
		cScores: {
			{Keys: k("gameId", 1, "score", -1, "updatedAt", 1), Options: options.Index().SetName("leaderboard")},
			{Keys: k("userId", 1), Options: options.Index().SetName("scores_user")},
			{Keys: k("userId", 1, "updatedAt", -1), Options: options.Index().SetName("scores_user_recent")},
		},
		// the game-making catalog (internal/harness; _id is the entry id). Seeded by cmd/dbinit.
		"game_types": {
			{Keys: k("family", 1), Options: options.Index().SetName("types_family")},
			{Keys: k("status", 1), Options: options.Index().SetName("types_status")},
			{Keys: k("lookupKeys", 1), Options: options.Index().SetName("types_lookup_keys").
				SetPartialFilterExpression(bson.D{{Key: "lookupKeys", Value: bson.D{{Key: "$exists", Value: true}}}})},
		},
		"game_tools": {
			{Keys: k("kind", 1, "status", 1), Options: options.Index().SetName("tools_kind_status")},
		},
		// the wider Facebook surfaces (fbsocial_stores.go)
		cFBPosts: {
			{Keys: k("kind", 1, "createdAt", -1, "_id", -1), Options: options.Index().SetName("fb_posts_kind_newest")},
			{Keys: k("groupId", 1, "createdAt", -1), Options: options.Index().SetName("fb_posts_group").
				SetPartialFilterExpression(bson.D{{Key: "groupId", Value: bson.D{{Key: "$exists", Value: true}}}})},
			{Keys: k("authorId", 1, "createdAt", -1), Options: options.Index().SetName("fb_posts_author")},
		},
		cFBStories: {
			{Keys: k("createdAt", -1), Options: options.Index().SetName("fb_stories_newest")},
		},
		cFBThreads: {
			{Keys: k("members", 1, "lastAt", -1), Options: options.Index().SetName("fb_threads_member")},
		},
		cFBMessages: {
			{Keys: k("threadId", 1, "sentAt", -1), Options: options.Index().SetName("fb_messages_thread")},
		},
	}
	for coll, models := range plan {
		if _, err := m.coll(coll).Indexes().CreateMany(ctx, models); err != nil {
			return fmt.Errorf("indexes for %s: %w", coll, err)
		}
	}
	return nil
}

// Database is the underlying database, for packages that own their own collections (internal/harness's
// game_types and game_tools).
func (m *Mongo) Database() *mongo.Database { return m.db }
