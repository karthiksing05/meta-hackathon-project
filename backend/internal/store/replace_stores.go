package store

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func (m *Memory) ReplaceGameContent(ctx context.Context, g *model.Game) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	old, ok := m.games[g.ID]
	if !ok {
		return ErrNotFound
	}
	if g.Slug != "" && g.Slug != old.Slug {
		for _, o := range m.games {
			if o.ID != g.ID && o.Slug == g.Slug {
				return ErrConflict
			}
		}
	}
	old.Title, old.Description, old.Tags, old.Formula = g.Title, g.Description, g.Tags, g.Formula
	old.StorageKey, old.ManifestPath, old.CoverPath, old.HasSource = g.StorageKey, g.ManifestPath, g.CoverPath, g.HasSource
	old.Slug, old.GroupID, old.EventID, old.Mood, old.Energy, old.Competition = g.Slug, g.GroupID, g.EventID, g.Mood, g.Energy, g.Competition
	old.Look, old.Scope, old.Level, old.IsDaily, old.Bots = g.Look, g.Scope, g.Level, g.IsDaily, g.Bots
	old.Score, old.GroupPlay, old.RemixOf = g.Score, g.GroupPlay, g.RemixOf
	return nil
}

func (m *Mongo) ReplaceGameContent(ctx context.Context, g *model.Game) error {
	set := bson.D{
		{Key: "title", Value: g.Title}, {Key: "description", Value: g.Description}, {Key: "tags", Value: g.Tags},
		{Key: "formula", Value: g.Formula}, {Key: "storageKey", Value: g.StorageKey}, {Key: "manifestPath", Value: g.ManifestPath},
		{Key: "hasSource", Value: g.HasSource}, {Key: "scope", Value: g.Scope},
	}
	unset := bson.D{}
	opt := func(key string, empty bool, v any) {
		if empty {
			unset = append(unset, bson.E{Key: key, Value: ""})
		} else {
			set = append(set, bson.E{Key: key, Value: v})
		}
	}
	opt("coverPath", g.CoverPath == "", g.CoverPath)
	opt("slug", g.Slug == "", g.Slug) // a sparse unique index: an empty slug must not be stored
	opt("groupId", g.GroupID == "", g.GroupID)
	opt("eventId", g.EventID == "", g.EventID)
	opt("mood", len(g.Mood) == 0, g.Mood)
	opt("energy", g.Energy == "", g.Energy)
	opt("competition", g.Competition == "", g.Competition)
	opt("look", g.Look == "", g.Look)
	opt("level", g.Level == 0, g.Level)
	opt("isDaily", !g.IsDaily, g.IsDaily)
	opt("bots", len(g.Bots) == 0, g.Bots)
	opt("score", g.Score == nil, g.Score)
	opt("groupPlay", g.GroupPlay == nil, g.GroupPlay)
	opt("remixOf", g.RemixOf == "", g.RemixOf)
	update := bson.D{{Key: "$set", Value: set}}
	if len(unset) > 0 {
		update = append(update, bson.E{Key: "$unset", Value: unset})
	}
	r, err := m.coll(cGames).UpdateOne(ctx, bson.D{{Key: "_id", Value: g.ID}}, update)
	if err != nil {
		return mapErr(err)
	}
	if r.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}
