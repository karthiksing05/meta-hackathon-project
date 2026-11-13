package store

import (
	"context"
	"sort"
	"strings"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// matchesPerson reports whether a person's username starts with q, or a word of their display name does.
// q is lowercase.
func matchesPerson(u model.User, q string) bool {
	if strings.HasPrefix(u.Username, q) {
		return true
	}
	for _, w := range strings.Fields(strings.ToLower(u.DisplayName)) {
		if strings.HasPrefix(w, q) {
			return true
		}
	}
	return false
}

func (m *Memory) SearchUsers(ctx context.Context, q string, limit int) ([]model.User, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.User
	for _, u := range m.users {
		if matchesPerson(*u, q) {
			out = append(out, *u)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Username < out[j].Username })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
