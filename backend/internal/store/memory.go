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
	mu         sync.Mutex
	users      map[string]*model.User
	refresh    map[string]model.RefreshToken
	games      map[string]*model.Game
	likes      map[string]bool // gameID|userID
	scores     map[string]model.Score
	events     []model.Event
	eventID    map[string]bool
	jobs       map[string]*model.Job
	recs       map[string]model.RecsRecord
	friends    map[string]map[string]bool // user -> friends
	groups     map[string]*model.Group
	members    map[string]map[string]model.GroupMember // group -> user -> member
	challenges []model.Challenge
	series     map[string]*model.Series
	rounds     map[string]*model.Round
	notifs     map[string]*model.Notification
	devices    map[string]model.PushDevice
	sounds     map[string]*model.Sound
	soundSaves map[string]bool         // soundID|userID
	runLogs    map[string]model.RunLog // gameID:userID (runlog_stores.go)
}

func NewMemory() *Memory {
	return &Memory{
		users: map[string]*model.User{}, refresh: map[string]model.RefreshToken{},
		games: map[string]*model.Game{}, likes: map[string]bool{}, scores: map[string]model.Score{},
		eventID: map[string]bool{}, jobs: map[string]*model.Job{}, recs: map[string]model.RecsRecord{},
		friends: map[string]map[string]bool{}, groups: map[string]*model.Group{}, members: map[string]map[string]model.GroupMember{},
		series: map[string]*model.Series{},
		rounds: map[string]*model.Round{},
		notifs: map[string]*model.Notification{}, devices: map[string]model.PushDevice{},
		sounds: map[string]*model.Sound{}, soundSaves: map[string]bool{},
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
	if g.Slug != "" {
		for _, x := range m.games {
			if x.Slug == g.Slug {
				return ErrConflict
			}
		}
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

func (m *Memory) GameBySlug(ctx context.Context, slug string) (*model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, g := range m.games {
		if g.Slug != "" && g.Slug == slug {
			c := *g
			return &c, nil
		}
	}
	return nil, ErrNotFound
}

func (m *Memory) AllGames(ctx context.Context, limit int) ([]model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sorted(func(g *model.Game) bool { return !g.Unlisted }, limit, Cursor{}), nil
}

// gameFor resolves a game key (server id or slug) to the stored game. Callers hold the lock.
func (m *Memory) gameFor(key string) *model.Game {
	if g, ok := m.games[key]; ok {
		return g
	}
	for _, g := range m.games {
		if g.Slug != "" && g.Slug == key {
			return g
		}
	}
	return nil
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
	return m.sorted(func(g *model.Game) bool { return !g.Unlisted }, limit, cur), nil
}

func (m *Memory) Search(ctx context.Context, q, tag string, limit, offset int) ([]model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	q, tag = strings.ToLower(q), strings.ToLower(tag)
	words := strings.Fields(q)
	keep := func(g *model.Game) bool {
		if g.Unlisted {
			return false
		}
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

func (m *Memory) AddEvents(ctx context.Context, evs []model.Event) ([]model.Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var added []model.Event
	for _, e := range evs {
		if m.eventID[e.ID] {
			continue
		}
		m.eventID[e.ID] = true
		m.events = append(m.events, e)
		added = append(added, e)
		if g := m.gameFor(e.GameID); g != nil {
			if e.TookOver {
				g.Plays++
			}
			g.Finishes += int64(e.RunsFinished)
		}
	}
	return added, nil
}

func (m *Memory) GameStats(ctx context.Context, since time.Time) ([]model.GameStats, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	by := map[string]*model.GameStats{}
	for _, e := range m.events {
		if e.CreatedAt.Before(since) {
			continue
		}
		g := by[e.GameID]
		if g == nil {
			g = &model.GameStats{Key: e.GameID}
			by[e.GameID] = g
		}
		if e.Impression {
			g.Impressions++
		}
		if e.TookOver {
			g.Takeovers++
		}
		g.Finishes += int64(e.RunsFinished)
		if e.Satisfied {
			g.Satisfied++
		}
		g.Replays += int64(e.Replays)
		if e.SocialMoment {
			g.SocialMoments++
		}
	}
	out := make([]model.GameStats, 0, len(by))
	for _, g := range by {
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

func (m *Memory) Interleave(ctx context.Context, since time.Time) (model.Interleave, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	type credit struct{ a, b int }
	sessions := map[string]*credit{}
	for _, e := range m.events {
		if e.CreatedAt.Before(since) || (e.Team != "A" && e.Team != "B") {
			continue
		}
		k := e.Actor + "|" + e.SessionID
		c := sessions[k]
		if c == nil {
			c = &credit{}
			sessions[k] = c
		}
		if e.Credit {
			if e.Team == "A" {
				c.a++
			} else {
				c.b++
			}
		}
	}
	var out model.Interleave
	for _, c := range sessions {
		out.Sessions++
		switch {
		case c.a > c.b:
			out.FormulaWins++
		case c.b > c.a:
			out.ControlWins++
		default:
			out.Ties++
		}
	}
	return out, nil
}

func (m *Memory) ExportEvents(ctx context.Context, since time.Time, limit int) ([]model.Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Event
	for _, e := range m.events {
		if !e.CreatedAt.Before(since) {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
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

func cloneJob(j *model.Job) model.Job {
	c := *j
	c.Events = append([]model.JobEvent(nil), j.Events...)
	return c
}

func (m *Memory) InsertJob(ctx context.Context, j *model.Job) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.jobs[j.ID]; ok {
		return ErrConflict
	}
	c := cloneJob(j)
	m.jobs[j.ID] = &c
	return nil
}

func (m *Memory) JobByID(ctx context.Context, id string) (*model.Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if j, ok := m.jobs[id]; ok {
		c := cloneJob(j)
		return &c, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) JobsByOwner(ctx context.Context, ownerID string, limit int) ([]model.Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Job
	for _, j := range m.jobs {
		if j.OwnerID == ownerID {
			out = append(out, cloneJob(j))
		}
	}
	sort.Slice(out, func(i, k int) bool { return out[i].CreatedAt.After(out[k].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) CountJobsSince(ctx context.Context, ownerID string, since time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, j := range m.jobs {
		if j.OwnerID == ownerID && !j.CreatedAt.Before(since) {
			n++
		}
	}
	return n, nil
}

func (m *Memory) HasActiveJob(ctx context.Context, ownerID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, j := range m.jobs {
		if j.OwnerID == ownerID && (j.Status == model.JobQueued || j.Status == model.JobRunning) {
			return true, nil
		}
	}
	return false, nil
}

func (m *Memory) AppendJobEvent(ctx context.Context, id string, e model.JobEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return ErrNotFound
	}
	j.Events = append(j.Events, e)
	j.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *Memory) SetJobStatus(ctx context.Context, id, status string, u model.JobUpdate) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	j.Status, j.UpdatedAt = status, now
	if u.GameID != "" {
		j.GameID = u.GameID
	}
	if u.Error != "" {
		j.Error = u.Error
	}
	if u.Stats != nil {
		j.Stats = u.Stats
	}
	if status == model.JobDone || status == model.JobFailed {
		j.FinishedAt = &now
	}
	return nil
}

func (m *Memory) FailStaleJobs(ctx context.Context, reason string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	now := time.Now().UTC().Truncate(time.Millisecond)
	for _, j := range m.jobs {
		if j.Status == model.JobQueued || j.Status == model.JobRunning {
			j.Status, j.Error, j.UpdatedAt, j.FinishedAt = model.JobFailed, reason, now, &now
			n++
		}
	}
	return n, nil
}

func (m *Memory) RecsUserIDs(ctx context.Context, limit int) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rows := make([]model.RecsRecord, 0, len(m.recs))
	for _, r := range m.recs {
		rows = append(rows, r)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].UpdatedAt.After(rows[j].UpdatedAt) })
	var out []string
	for _, r := range rows {
		if len(out) >= limit {
			break
		}
		out = append(out, r.UserID)
	}
	return out, nil
}

func (m *Memory) GetRecs(ctx context.Context, userID string) (*model.RecsRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.recs[userID]
	if !ok {
		return nil, ErrNotFound
	}
	r.Feed = append([]string(nil), r.Feed...)
	r.FeedKeys = append([]string(nil), r.FeedKeys...)
	return &r, nil
}

func (m *Memory) PutRecs(ctx context.Context, r *model.RecsRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := *r
	c.Feed = append([]string(nil), r.Feed...)
	c.FeedKeys = append([]string(nil), r.FeedKeys...)
	m.recs[r.UserID] = c
	return nil
}

func (m *Memory) UserByUsername(ctx context.Context, username string) (*model.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.Username == username {
			c := *u
			return &c, nil
		}
	}
	return nil, ErrNotFound
}

func (m *Memory) UsersByIDs(ctx context.Context, ids []string) ([]model.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.User
	for _, id := range ids {
		if u, ok := m.users[id]; ok {
			out = append(out, *u)
		}
	}
	return out, nil
}

func (m *Memory) AddFriend(ctx context.Context, a, b string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range [][2]string{{a, b}, {b, a}} {
		if m.friends[p[0]] == nil {
			m.friends[p[0]] = map[string]bool{}
		}
		m.friends[p[0]][p[1]] = true
	}
	return nil
}

func (m *Memory) RemoveFriend(ctx context.Context, a, b string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.friends[a], b)
	delete(m.friends[b], a)
	return nil
}

func (m *Memory) Friends(ctx context.Context, userID string) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for id := range m.friends[userID] {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}

func (m *Memory) UpsertGroup(ctx context.Context, g *model.Group) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := *g
	m.groups[g.ID] = &c
	return nil
}

func (m *Memory) GroupByID(ctx context.Context, id string) (*model.Group, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if g, ok := m.groups[id]; ok {
		c := *g
		return &c, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) ListGroups(ctx context.Context, limit int) ([]model.Group, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Group
	for _, g := range m.groups {
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) AddGroupMember(ctx context.Context, gm model.GroupMember) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.members[gm.GroupID] == nil {
		m.members[gm.GroupID] = map[string]model.GroupMember{}
	}
	if _, ok := m.members[gm.GroupID][gm.UserID]; !ok {
		m.members[gm.GroupID][gm.UserID] = gm
	}
	return nil
}

func (m *Memory) RemoveGroupMember(ctx context.Context, groupID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.members[groupID], userID)
	return nil
}

func (m *Memory) GroupMembers(ctx context.Context, groupID string) ([]model.GroupMember, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.GroupMember
	for _, gm := range m.members[groupID] {
		out = append(out, gm)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UserID < out[j].UserID })
	return out, nil
}

func (m *Memory) GroupsOfUser(ctx context.Context, userID string) ([]model.Group, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Group
	for gid, ms := range m.members {
		if _, ok := ms[userID]; ok {
			if g, ok := m.groups[gid]; ok {
				out = append(out, *g)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (m *Memory) GamesByGroup(ctx context.Context, groupID string, limit int) ([]model.Game, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sorted(func(g *model.Game) bool { return !g.Unlisted && (g.GroupID == groupID || g.EventID == groupID) }, limit, Cursor{}), nil
}

func (m *Memory) RecentScores(ctx context.Context, userIDs []string, limit int) ([]model.Score, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	want := map[string]bool{}
	for _, id := range userIDs {
		want[id] = true
	}
	var out []model.Score
	for _, sc := range m.scores {
		if want[sc.UserID] {
			out = append(out, sc)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
