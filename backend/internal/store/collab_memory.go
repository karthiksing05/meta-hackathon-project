package store

import (
	"context"
	"sort"
	"strings"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func (m *Memory) LikedGameIDs(ctx context.Context, userID string, limit int) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var gs []*model.Game
	for k := range m.likes {
		gid, uid, _ := strings.Cut(k, "|")
		if uid == userID {
			if g, ok := m.games[gid]; ok {
				gs = append(gs, g)
			}
		}
	}
	sort.Slice(gs, func(i, j int) bool { return gs[i].CreatedAt.After(gs[j].CreatedAt) })
	var out []string
	for _, g := range gs {
		if len(out) >= limit {
			break
		}
		out = append(out, g.ID)
	}
	return out, nil
}

func (m *Memory) GameLikers(ctx context.Context, gameID string, limit int) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for k := range m.likes {
		gid, uid, _ := strings.Cut(k, "|")
		if gid == gameID {
			out = append(out, uid)
		}
	}
	sort.Strings(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) InsertChallenge(ctx context.Context, c *model.Challenge) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *c
	cp.ToIDs = append([]string(nil), c.ToIDs...)
	m.challenges = append(m.challenges, cp)
	return nil
}

func (m *Memory) ChallengesFor(ctx context.Context, userID string, limit int) ([]model.Challenge, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Challenge
	for i := len(m.challenges) - 1; i >= 0 && len(out) < limit; i-- {
		c := m.challenges[i]
		if c.FromID == userID {
			out = append(out, c)
			continue
		}
		for _, to := range c.ToIDs {
			if to == userID {
				out = append(out, c)
				break
			}
		}
	}
	return out, nil
}

func (m *Memory) MomentsWith(ctx context.Context, userID string, limit int) ([]model.Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Event
	for i := len(m.events) - 1; i >= 0 && len(out) < limit; i-- {
		e := m.events[i]
		if e.Kind == "" {
			continue
		}
		for _, w := range e.With {
			if w == userID {
				out = append(out, e)
				break
			}
		}
	}
	return out, nil
}
