package store

import (
	"context"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

const cSessions = "gamesessions"

func cloneSession(s *model.Session) model.Session {
	c := *s
	c.Members = append([]string(nil), s.Members...)
	c.Entries = append([]model.SessionEntry(nil), s.Entries...)
	return c
}

func (m *Memory) InsertSession(ctx context.Context, s *model.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions == nil {
		m.sessions = map[string]*model.Session{}
	}
	if _, ok := m.sessions[s.ID]; ok {
		return ErrConflict
	}
	c := cloneSession(s)
	m.sessions[s.ID] = &c
	return nil
}

func (m *Memory) SessionByID(ctx context.Context, id string) (*model.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := cloneSession(s)
	return &c, nil
}

func (m *Memory) ReplaceSession(ctx context.Context, s *model.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[s.ID]; !ok {
		return ErrNotFound
	}
	c := cloneSession(s)
	m.sessions[s.ID] = &c
	return nil
}

func (m *Memory) SessionsForTarget(ctx context.Context, kind, id string, limit int) ([]model.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Session
	for _, s := range m.sessions {
		if s.TargetKind == kind && s.TargetID == id {
			out = append(out, cloneSession(s))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Mongo) InsertSession(ctx context.Context, s *model.Session) error {
	_, err := m.coll(cSessions).InsertOne(ctx, s)
	return mapErr(err)
}

func (m *Mongo) SessionByID(ctx context.Context, id string) (*model.Session, error) {
	var s model.Session
	if err := m.coll(cSessions).FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&s); err != nil {
		return nil, mapErr(err)
	}
	return &s, nil
}

func (m *Mongo) ReplaceSession(ctx context.Context, s *model.Session) error {
	res, err := m.coll(cSessions).ReplaceOne(ctx, bson.D{{Key: "_id", Value: s.ID}}, s)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) SessionsForTarget(ctx context.Context, kind, id string, limit int) ([]model.Session, error) {
	cur, err := m.coll(cSessions).Find(ctx, bson.D{{Key: "targetKind", Value: kind}, {Key: "targetId", Value: id}},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Session
	return out, cur.All(ctx, &out)
}
