package store

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// Memory is a non-persistent Store for local development and tests (STORE=memory).
type Memory struct {
	mu      sync.Mutex
	users   map[string]*model.User
	refresh map[string]model.RefreshToken
	games   map[string]*model.Game
	likes   map[string]bool // gameID|userID
	scores  map[string]model.Score
	events  []model.Event
}

func NewMemory() *Memory {
	return &Memory{
		users: map[string]*model.User{}, refresh: map[string]model.RefreshToken{},
		games: map[string]*model.Game{}, likes: map[string]bool{}, scores: map[string]model.Score{},
	}
}

func (m *Memory) Ping(ctx context.Context) error { return nil }

func (m *Memory) CreateUser(ctx context.Context, u *model.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, x := range m.users {
		if x.Email == u.Email || x.Username == u.Username {
			return ErrConflict
		}
	}
	c := *u
	m.users[u.ID] = &c
	return nil
}

func (m *Memory) UserByEmail(ctx context.Context, email string) (*model.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.Email == email {
			c := *u
			return &c, nil
		}
	}
	return nil, ErrNotFound
}

func (m *Memory) UserByID(ctx context.Context, id string) (*model.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.users[id]; ok {
		c := *u
		return &c, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) PutRefresh(ctx context.Context, t model.RefreshToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.refresh[t.Hash] = t
	return nil
}

func (m *Memory) TakeRefresh(ctx context.Context, hash string) (*model.RefreshToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.refresh[hash]
	if !ok || time.Now().After(t.ExpiresAt) {
		delete(m.refresh, hash)
		return nil, ErrNotFound
	}
	delete(m.refresh, hash)
	return &t, nil
}

func (m *Memory) DeleteRefresh(ctx context.Context, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.refresh, hash)
	return nil
}

func (m *Memory) InsertGame(ctx context.Context, g *model.Game) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.games[g.ID]; ok {
		return ErrConflict
	}
	c := *g
	m.games[g.ID] = &c
	return nil
}

func (m *Memory) GameByID(ctx context.Context, id string) (*model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if g, ok := m.games[id]; ok {
		c := *g
		return &c, nil
	}
	return nil, ErrNotFound
}

// sorted returns games matching keep, newest first, after the cursor, up to limit.
func (m *Memory) sorted(keep func(*model.Game) bool, limit int, cur Cursor) []model.Game {
	var out []model.Game
	for _, g := range m.games {
		if keep(g) && cur.allows(g.CreatedAt, g.ID) {
			out = append(out, *g)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.After(out[j].CreatedAt)
		}
		return out[i].ID > out[j].ID
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (m *Memory) GamesByOwner(ctx context.Context, ownerID string, limit int, cur Cursor) ([]model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sorted(func(g *model.Game) bool { return g.OwnerID == ownerID }, limit, cur), nil
}

func (m *Memory) Feed(ctx context.Context, limit int, cur Cursor) ([]model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sorted(func(*model.Game) bool { return true }, limit, cur), nil
}

func (m *Memory) Search(ctx context.Context, q, tag string, limit, offset int) ([]model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	q, tag = strings.ToLower(q), strings.ToLower(tag)
	words := strings.Fields(q)
	keep := func(g *model.Game) bool {
		if tag != "" {
			found := false
			for _, t := range g.Tags {
				found = found || strings.ToLower(t) == tag
			}
			if !found {
				return false
			}
		}
		hay := strings.ToLower(g.Title + " " + g.Description + " " + strings.Join(g.Tags, " "))
		for _, w := range words {
			if !strings.Contains(hay, w) {
				return false
			}
		}
		return true
	}
	all := m.sorted(keep, 1<<30, Cursor{})
	if offset >= len(all) {
		return nil, nil
	}
	all = all[offset:]
	if len(all) > limit {
		all = all[:limit]
	}
	return all, nil
}

func (m *Memory) SetLike(ctx context.Context, gameID, userID string, liked bool) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.games[gameID]
	if !ok {
		return 0, ErrNotFound
	}
	k := gameID + "|" + userID
	if liked && !m.likes[k] {
		m.likes[k] = true
		g.Likes++
	} else if !liked && m.likes[k] {
		delete(m.likes, k)
		g.Likes--
	}
	return g.Likes, nil
}

func (m *Memory) LikedSet(ctx context.Context, userID string, ids []string) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]bool{}
	for _, id := range ids {
		if m.likes[id+"|"+userID] {
			out[id] = true
		}
	}
	return out, nil
}

func (m *Memory) AddEvents(ctx context.Context, evs []model.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range evs {
		m.events = append(m.events, e)
		if g, ok := m.games[e.GameID]; ok {
			switch e.Type {
			case "play":
				g.Plays++
			case "finish":
				g.Finishes++
			}
		}
	}
	return nil
}

func (m *Memory) SubmitScore(ctx context.Context, s model.Score) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := s.GameID + "|" + s.UserID
	if old, ok := m.scores[k]; !ok || s.Score > old.Score {
		m.scores[k] = s
	}
	return nil
}

func (m *Memory) Leaderboard(ctx context.Context, gameID string, limit int) ([]model.Score, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Score
	for _, s := range m.scores {
		if s.GameID == gameID {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// EventCount is a test helper.
func (m *Memory) EventCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}
