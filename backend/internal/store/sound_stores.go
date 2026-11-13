package store

import (
	"context"
	"regexp"
	"sort"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

const (
	cSounds     = "sounds"
	cSoundSaves = "sound_saves"
)

// SoundQuery picks sounds: Order is "trending" (most used, then newest), "recent" (newest); SavedBy limits to what a
// person saved; Q matches the start of a word in the title or the creator's name.
type SoundQuery struct {
	Order   string
	Q       string
	SavedBy string
	Limit   int
}

func soundMatches(s model.Sound, q string) bool {
	if q == "" {
		return true
	}
	for _, text := range append([]string{s.Title, s.OwnerUsername, s.Artist}, s.Tags...) {
		for _, w := range strings.Fields(strings.ToLower(text)) {
			if strings.HasPrefix(w, q) {
				return true
			}
		}
	}
	return false
}

func sortSounds(out []model.Sound, order string) {
	sort.SliceStable(out, func(i, j int) bool {
		if order != "recent" && out[i].UseCount != out[j].UseCount {
			return out[i].UseCount > out[j].UseCount
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
}

// ---- memory ----

func (m *Memory) InsertSound(ctx context.Context, s *model.Sound) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sounds[s.ID]; ok {
		return ErrConflict
	}
	c := *s
	m.sounds[s.ID] = &c
	return nil
}

func (m *Memory) SoundByID(ctx context.Context, id string) (*model.Sound, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sounds[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := *s
	return &c, nil
}

func (m *Memory) SoundsByIDs(ctx context.Context, ids []string) ([]model.Sound, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Sound
	for _, id := range ids {
		if s, ok := m.sounds[id]; ok {
			out = append(out, *s)
		}
	}
	return out, nil
}

func (m *Memory) FindSounds(ctx context.Context, q SoundQuery) ([]model.Sound, error) {
	needle := strings.ToLower(strings.TrimSpace(q.Q))
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Sound
	for _, s := range m.sounds {
		if q.SavedBy != "" && !m.soundSaves[s.ID+"|"+q.SavedBy] {
			continue
		}
		if soundMatches(*s, needle) {
			out = append(out, *s)
		}
	}
	sortSounds(out, q.Order)
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

func (m *Memory) SetSoundSaved(ctx context.Context, soundID, userID string, saved bool) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sounds[soundID]
	if !ok {
		return 0, ErrNotFound
	}
	k := soundID + "|" + userID
	if saved && !m.soundSaves[k] {
		m.soundSaves[k] = true
		s.Saves++
	} else if !saved && m.soundSaves[k] {
		delete(m.soundSaves, k)
		s.Saves--
	}
	return s.Saves, nil
}

func (m *Memory) SoundsSavedSet(ctx context.Context, userID string, ids []string) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]bool{}
	for _, id := range ids {
		if m.soundSaves[id+"|"+userID] {
			out[id] = true
		}
	}
	return out, nil
}

func (m *Memory) AddSoundUse(ctx context.Context, soundID string, delta int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sounds[soundID]; ok {
		s.UseCount = max(0, s.UseCount+delta)
	}
	return nil
}

func (m *Memory) SetGameSound(ctx context.Context, gameID string, gs *model.GameSound) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.games[gameID]
	if !ok {
		return ErrNotFound
	}
	if gs == nil {
		g.Sound = nil
	} else {
		c := *gs
		g.Sound = &c
	}
	return nil
}

func (m *Memory) GamesBySound(ctx context.Context, soundID, order string, limit int) ([]model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Game
	for _, g := range m.games {
		if g.Sound != nil && g.Sound.ID == soundID && !g.Unlisted {
			out = append(out, *g)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if order == "top" && out[i].Likes != out[j].Likes {
			return out[i].Likes > out[j].Likes
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// ---- mongo ----

func (m *Mongo) InsertSound(ctx context.Context, s *model.Sound) error {
	_, err := m.coll(cSounds).InsertOne(ctx, s)
	return mapErr(err)
}

func (m *Mongo) SoundByID(ctx context.Context, id string) (*model.Sound, error) {
	var s model.Sound
	if err := m.coll(cSounds).FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&s); err != nil {
		return nil, mapErr(err)
	}
	return &s, nil
}

func (m *Mongo) SoundsByIDs(ctx context.Context, ids []string) ([]model.Sound, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	cur, err := m.coll(cSounds).Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var out []model.Sound
	return out, cur.All(ctx, &out)
}

func (m *Mongo) FindSounds(ctx context.Context, q SoundQuery) ([]model.Sound, error) {
	filter := bson.D{}
	if needle := strings.ToLower(strings.TrimSpace(q.Q)); needle != "" {
		re := bson.Regex{Pattern: `(^|\s)` + regexp.QuoteMeta(needle), Options: "i"}
		filter = append(filter, bson.E{Key: "$or", Value: bson.A{
			bson.D{{Key: "title", Value: re}}, bson.D{{Key: "ownerUsername", Value: re}},
			bson.D{{Key: "artist", Value: re}}, bson.D{{Key: "tags", Value: re}},
		}})
	}
	if q.SavedBy != "" {
		cur, err := m.coll(cSoundSaves).Find(ctx, bson.D{{Key: "userId", Value: q.SavedBy}})
		if err != nil {
			return nil, err
		}
		var rows []struct {
			SoundID string `bson:"soundId"`
		}
		if err := cur.All(ctx, &rows); err != nil {
			return nil, err
		}
		ids := make([]string, len(rows))
		for i, r := range rows {
			ids[i] = r.SoundID
		}
		filter = append(filter, bson.E{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}})
	}
	order := bson.D{{Key: "useCount", Value: -1}, {Key: "createdAt", Value: -1}}
	if q.Order == "recent" {
		order = bson.D{{Key: "createdAt", Value: -1}}
	}
	o := options.Find().SetSort(order)
	if q.Limit > 0 {
		o.SetLimit(int64(q.Limit))
	}
	cur, err := m.coll(cSounds).Find(ctx, filter, o)
	if err != nil {
		return nil, err
	}
	var out []model.Sound
	return out, cur.All(ctx, &out)
}

func (m *Mongo) SetSoundSaved(ctx context.Context, soundID, userID string, saved bool) (int64, error) {
	var s model.Sound
	if err := m.coll(cSounds).FindOne(ctx, bson.D{{Key: "_id", Value: soundID}}).Decode(&s); err != nil {
		return 0, mapErr(err)
	}
	id := soundID + ":" + userID
	delta := int64(0)
	if saved {
		_, err := m.coll(cSoundSaves).InsertOne(ctx, bson.D{{Key: "_id", Value: id}, {Key: "soundId", Value: soundID}, {Key: "userId", Value: userID}})
		if err == nil {
			delta = 1
		} else if !mongo.IsDuplicateKeyError(err) {
			return 0, err
		}
	} else {
		r, err := m.coll(cSoundSaves).DeleteOne(ctx, bson.D{{Key: "_id", Value: id}})
		if err != nil {
			return 0, err
		}
		delta = -r.DeletedCount
	}
	if delta == 0 {
		return s.Saves, nil
	}
	err := m.coll(cSounds).FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: soundID}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "saves", Value: delta}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&s)
	return s.Saves, mapErr(err)
}

func (m *Mongo) SoundsSavedSet(ctx context.Context, userID string, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	cur, err := m.coll(cSoundSaves).Find(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "soundId", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var rows []struct {
		SoundID string `bson:"soundId"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.SoundID] = true
	}
	return out, nil
}

func (m *Mongo) AddSoundUse(ctx context.Context, soundID string, delta int64) error {
	_, err := m.coll(cSounds).UpdateOne(ctx, bson.D{{Key: "_id", Value: soundID}},
		bson.A{bson.D{{Key: "$set", Value: bson.D{{Key: "useCount", Value: bson.D{{Key: "$max", Value: bson.A{0, bson.D{{Key: "$add", Value: bson.A{"$useCount", delta}}}}}}}}}}})
	return err
}

func (m *Mongo) SetGameSound(ctx context.Context, gameID string, gs *model.GameSound) error {
	update := bson.D{{Key: "$unset", Value: bson.D{{Key: "sound", Value: ""}}}}
	if gs != nil {
		update = bson.D{{Key: "$set", Value: bson.D{{Key: "sound", Value: gs}}}}
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

func (m *Mongo) GamesBySound(ctx context.Context, soundID, order string, limit int) ([]model.Game, error) {
	sortBy := newestFirst
	if order == "top" {
		sortBy = bson.D{{Key: "likes", Value: -1}, {Key: "createdAt", Value: -1}}
	}
	return m.findGames(ctx, listed(bson.D{{Key: "sound.id", Value: soundID}}), options.Find().SetSort(sortBy).SetLimit(int64(limit)))
}
