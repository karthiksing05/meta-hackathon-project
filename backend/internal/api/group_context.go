package api

import (
	"context"
	"strings"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// groupForGame is the Group or Event a game is made for, as the plan and the compose see it: its id, kind, name and
// up to harness.GroupMaxMembers members by display name, the maker first. Only display names: no emails,
// usernames or bios. A failed member lookup still returns the Group with no members.
func (s *Server) groupForGame(ctx context.Context, g *model.Group, makerID string) *harness.Group {
	if g == nil {
		return nil
	}
	kind := "group"
	if g.Kind == "event" {
		kind = "event"
	}
	out := &harness.Group{ID: g.ID, Kind: kind, Name: strings.TrimSpace(g.Name)}
	ms, err := s.Store.GroupMembers(ctx, g.ID)
	if err != nil || len(ms) == 0 {
		return out
	}
	ids := make([]string, 0, len(ms))
	for _, m := range ms {
		if m.UserID == makerID {
			ids = append([]string{m.UserID}, ids...)
		} else {
			ids = append(ids, m.UserID)
		}
	}
	users, err := s.Store.UsersByIDs(ctx, ids)
	if err != nil {
		return out
	}
	byID := make(map[string]string, len(users))
	for _, u := range users {
		byID[u.ID] = strings.TrimSpace(u.DisplayName)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		name := byID[id]
		if name == "" || seen[name] || strings.Contains(name, "@") {
			continue
		}
		seen[name] = true
		out.Members = append(out.Members, harness.GroupMember{Name: name})
		if len(out.Members) >= harness.GroupMaxMembers {
			break
		}
	}
	return out
}

// jobGroup is the Group a job is for, looked up again when the job runs (the name and members as they are now).
// When the lookup fails it is just the id and kind, as the job stored them.
func (s *Server) jobGroup(ctx context.Context, job model.Job) *harness.Group {
	if job.GroupID == "" {
		return nil
	}
	if g, err := s.Store.GroupByID(ctx, job.GroupID); err == nil {
		return s.groupForGame(ctx, g, job.OwnerID)
	}
	kind := "group"
	if job.GroupKind == "event" {
		kind = "event"
	}
	return &harness.Group{ID: job.GroupID, Kind: kind}
}

// groupContext is context.group for the generator: {id, kind, name?, members?: [{name}]}
// (authoring/expander/group-play.mjs structureFor, story-compose.mjs storyCast, prompts.mjs groupNote).
func groupContext(g *harness.Group) map[string]any {
	out := map[string]any{"id": g.ID, "kind": g.Kind}
	if g.Name != "" {
		out["name"] = g.Name
	}
	if len(g.Members) > 0 {
		ms := make([]map[string]any, len(g.Members))
		for i, m := range g.Members {
			ms[i] = map[string]any{"name": m.Name}
		}
		out["members"] = ms
	}
	return out
}
