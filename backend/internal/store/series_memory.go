package store

import (
	"context"
	"sort"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func cloneSeries(s *model.Series) model.Series {
	c := *s
	c.Rounds = make([]model.SeriesRound, len(s.Rounds))
	for i, r := range s.Rounds {
		r.Plays = cloneMap(r.Plays)
		c.Rounds[i] = r
	}
	return c
}

func cloneMap(m map[string]model.RoundPlay) map[string]model.RoundPlay {
	out := make(map[string]model.RoundPlay, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func (m *Memory) InsertSeries(ctx context.Context, s *model.Series) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.series[s.ID]; ok {
		return ErrConflict
	}
	c := cloneSeries(s)
	m.series[s.ID] = &c
	return nil
}

func (m *Memory) SeriesByID(ctx context.Context, id string) (*model.Series, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.series[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := cloneSeries(s)
	return &c, nil
}

func (m *Memory) ReplaceSeries(ctx context.Context, s *model.Series) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.series[s.ID]; !ok {
		return ErrNotFound
	}
	c := cloneSeries(s)
	m.series[s.ID] = &c
	return nil
}

func (m *Memory) SeriesForUser(ctx context.Context, userID string, limit int) ([]model.Series, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Series
	for _, s := range m.series {
		if s.PlayerA == userID || s.PlayerB == userID {
			out = append(out, cloneSeries(s))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
