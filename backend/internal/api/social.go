package api

import (
	"context"
	"errors"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// People, friends and Groups. Everything the app used to keep as local demo data (the cast, who is a
// friend, which Groups and Events exist and who is in them) is served from here, so the recommender and
// Group Blend work on the real graph.
//
//	GET    /v1/users/{id}                  a person's public profile
//	GET    /v1/me/friends                  my friends
//	PUT    /v1/me/friends/{id}             add a friend (mutual, immediate)
//	DELETE /v1/me/friends/{id}             remove one
//	GET    /v1/groups                      Groups and Events (kind=group|event, mine=1)
//	POST   /v1/groups                      create one
//	GET    /v1/groups/{id}                 one, with its members
//	PATCH  /v1/groups/{id}                 the owner changes its settings (groupjoin.go)
//	PUT    /v1/groups/{id}/members/me      join (open), or ask to (request); DELETE leaves or withdraws
//	PUT    /v1/groups/{id}/members/{uid}   a member adds someone; the owner approves a request (groupjoin.go)
//	GET    /v1/groups/{id}/requests        the owner's list of people asking to join (groupjoin.go)
//	GET    /v1/groups/{id}/games           games made for it
//	POST   /v1/groups/{id}/blend           Blend for the group's members
//	GET    /v1/groups/{id}/blend-inputs    each member's skill, taste and recent games

type profile struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Bio         string `json:"bio,omitempty"`
	AvatarURL   string `json:"avatarUrl,omitempty"`  // only when the person set one
	CoverColor  string `json:"coverColor,omitempty"` // "#RRGGBB"
	IsFriend    bool   `json:"isFriend,omitempty"`
}

func profileOf(u model.User, friends map[string]bool) profile {
	return profile{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Bio: u.Bio, AvatarURL: u.AvatarURL,
		CoverColor: u.CoverColor, IsFriend: friends[u.ID]}
}

func idSet(ids []string) map[string]bool {
	m := make(map[string]bool, len(ids))
	for _, id := range ids {
		m[id] = true
	}
	return m
}

func (s *Server) friendSet(ctx context.Context, userID string) (map[string]bool, error) {
	ids, err := s.Store.Friends(ctx, userID)
	return idSet(ids), err
}

func (s *Server) getUser(w http.ResponseWriter, r *http.Request) {
	u, err := s.Store.UserByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "person not found")
		} else {
			s.serverErr(w, r, err)
		}
		return
	}
	var friends map[string]bool
	if me := userFrom(r); me != nil {
		friends, _ = s.friendSet(r.Context(), me.ID)
	}
	// The profile page shows "N friends"; without the count every account read as 0.
	theirs, err := s.Store.Friends(r.Context(), u.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, struct {
		profile
		FriendCount int `json:"friendCount"`
	}{profileOf(*u, friends), len(theirs)})
}

func (s *Server) listFriends(w http.ResponseWriter, r *http.Request) {
	ids, err := s.Store.Friends(r.Context(), userFrom(r).ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	users, err := s.Store.UsersByIDs(r.Context(), ids)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	all := idSet(ids)
	items := make([]profile, len(users))
	for i, u := range users {
		items[i] = profileOf(u, all)
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) setFriend(add bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, other := userFrom(r), chi.URLParam(r, "id")
		if other == me.ID {
			writeErr(w, 400, "you can't friend yourself")
			return
		}
		if _, err := s.Store.UserByID(r.Context(), other); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, 404, "person not found")
			} else {
				s.serverErr(w, r, err)
			}
			return
		}
		var err error
		if add {
			err = s.Store.AddFriend(r.Context(), me.ID, other)
		} else {
			err = s.Store.RemoveFriend(r.Context(), me.ID, other)
		}
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"friendID": other, "isFriend": add})
	}
}

// ---- Groups and Events ----

type groupView struct {
	model.Group
	MemberCount  int  `json:"memberCount"`
	IsMember     bool `json:"isMember"`
	Requested    bool `json:"requested,omitempty"`    // I asked to join and wait for the owner
	RequestCount int  `json:"requestCount,omitempty"` // for the owner: people waiting
}

func (s *Server) groupViews(ctx context.Context, groups []model.Group, me *model.User) ([]groupView, error) {
	mine := map[string]bool{}
	if me != nil {
		gs, err := s.Store.GroupsOfUser(ctx, me.ID)
		if err != nil {
			return nil, err
		}
		for _, g := range gs {
			mine[g.ID] = true
		}
	}
	out := make([]groupView, len(groups))
	for i, g := range groups {
		ms, err := s.Store.GroupMembers(ctx, g.ID)
		if err != nil {
			return nil, err
		}
		g.JoinPolicy = model.JoinPolicyOf(g)
		v := groupView{Group: g, MemberCount: len(ms), IsMember: mine[g.ID]}
		if me != nil {
			v.Requested = !v.IsMember && fbHas(g.Requests, me.ID)
			if g.OwnerID == me.ID {
				v.RequestCount = len(g.Requests)
			}
		}
		out[i] = v
	}
	return out, nil
}

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r)
	var groups []model.Group
	var err error
	if r.URL.Query().Get("mine") == "1" && me != nil {
		groups, err = s.Store.GroupsOfUser(r.Context(), me.ID)
	} else {
		groups, err = s.Store.ListGroups(r.Context(), 200)
	}
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if kind := r.URL.Query().Get("kind"); kind != "" {
		kept := groups[:0:0]
		for _, g := range groups {
			if g.Kind == kind {
				kept = append(kept, g)
			}
		}
		groups = kept
	}
	views, err := s.groupViews(r.Context(), groups, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": views})
}

func (s *Server) groupOr404(w http.ResponseWriter, r *http.Request) (*model.Group, bool) {
	g, err := s.Store.GroupByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "group not found")
		} else {
			s.serverErr(w, r, err)
		}
		return nil, false
	}
	return g, true
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID, Kind, Name, Category, About, CoverSeed, CoverColor, JoinPolicy string
		Private, Recruiting                                                bool
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if n := len([]rune(in.Name)); n < 2 || n > 80 || len(in.About) > 500 || len(in.Category) > 40 || len(in.CoverSeed) > 60 {
		writeErr(w, 400, "a group needs a name of 2 to 80 characters")
		return
	}
	if in.Kind != "event" {
		in.Kind = "group"
	}
	if !validJoinPolicy(in.JoinPolicy) || !validColor(in.CoverColor) {
		writeErr(w, 400, `joinPolicy must be "open", "request" or "invite", and coverColor "#RRGGBB"`)
		return
	}
	id := "grp_" + auth.NewID(8)
	if in.ID != "" {
		// a stable id the app's other surfaces already use (the demo world's "group-newinsf"); never an existing one
		if !groupIDRE.MatchString(in.ID) {
			writeErr(w, 400, "id must be 3 to 48 lowercase letters, digits or dashes, starting with a letter")
			return
		}
		if _, err := s.Store.GroupByID(r.Context(), in.ID); err == nil {
			writeErr(w, 409, "that id is taken")
			return
		} else if !errors.Is(err, store.ErrNotFound) {
			s.serverErr(w, r, err)
			return
		}
		id = in.ID
	}
	me := userFrom(r)
	now := time.Now().UTC().Truncate(time.Millisecond)
	g := &model.Group{ID: id, Kind: in.Kind, Name: in.Name, Category: in.Category, About: in.About, CoverSeed: in.CoverSeed, Private: in.Private, OwnerID: me.ID, CreatedAt: now,
		JoinPolicy: in.JoinPolicy, Recruiting: in.Recruiting, CoverColor: in.CoverColor}
	if err := s.Store.UpsertGroup(r.Context(), g); err != nil {
		s.serverErr(w, r, err)
		return
	}
	if err := s.Store.AddGroupMember(r.Context(), model.GroupMember{GroupID: g.ID, UserID: me.ID, Role: "owner", JoinedAt: now}); err != nil {
		s.serverErr(w, r, err)
		return
	}
	views, _ := s.groupViews(r.Context(), []model.Group{*g}, me)
	writeJSON(w, 201, views[0])
}

func (s *Server) getGroup(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	me := userFrom(r)
	if g.Private && (me == nil || !s.isMember(r.Context(), g.ID, me.ID)) {
		writeErr(w, 404, "group not found") // private groups are invisible to outsiders
		return
	}
	members, err := s.Store.GroupMembers(r.Context(), g.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	ids := make([]string, len(members))
	role := map[string]string{}
	for i, m := range members {
		ids[i], role[m.UserID] = m.UserID, m.Role
	}
	users, err := s.Store.UsersByIDs(r.Context(), ids)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	var friends map[string]bool
	if me != nil {
		friends, _ = s.friendSet(r.Context(), me.ID)
	}
	type member struct {
		profile
		Role string `json:"role,omitempty"`
	}
	ms := make([]member, len(users))
	for i, u := range users {
		ms[i] = member{profileOf(u, friends), role[u.ID]}
	}
	views, _ := s.groupViews(r.Context(), []model.Group{*g}, me)
	writeJSON(w, 200, map[string]any{"group": views[0], "members": ms})
}

func (s *Server) isMember(ctx context.Context, groupID, userID string) bool {
	ms, err := s.Store.GroupMembers(ctx, groupID)
	if err != nil {
		return false
	}
	for _, m := range ms {
		if m.UserID == userID {
			return true
		}
	}
	return false
}

func (s *Server) setMembership(join bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		g, ok := s.groupOr404(w, r)
		if !ok {
			return
		}
		me := userFrom(r)
		var err error
		if join {
			if s.isMember(r.Context(), g.ID, me.ID) {
				writeJSON(w, 200, map[string]any{"groupID": g.ID, "isMember": true})
				return
			}
			switch model.JoinPolicyOf(*g) {
			case model.JoinInvite:
				if g.Private {
					writeErr(w, 403, "this group is private")
				} else {
					writeJSON(w, 403, apiError{Error: "this group is invite only: a member can add you", Code: "invite_only"})
				}
				return
			case model.JoinRequest:
				if err := s.addJoinRequest(r.Context(), g.ID, me.ID); err != nil {
					s.serverErr(w, r, err)
					return
				}
				writeJSON(w, 202, map[string]any{"groupID": g.ID, "isMember": false, "requested": true})
				return
			}
			err = s.Store.AddGroupMember(r.Context(), model.GroupMember{GroupID: g.ID, UserID: me.ID, JoinedAt: time.Now().UTC().Truncate(time.Millisecond)})
		} else {
			err = s.dropJoinRequest(r.Context(), g.ID, me.ID)
			if err == nil {
				err = s.Store.RemoveGroupMember(r.Context(), g.ID, me.ID)
			}
		}
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"groupID": g.ID, "isMember": join})
	}
}

func (s *Server) groupGames(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	games, err := s.Store.GamesByGroup(r.Context(), g.ID, limitParam(r, 50, 100))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items, err := s.views(r, games)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

// membersForBlend turns a group's members into Blend members, with friend flags and skill from the server.
func (s *Server) membersForBlend(ctx context.Context, g *model.Group, me *model.User) ([]blendMember, error) {
	ms, err := s.Store.GroupMembers(ctx, g.ID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(ms))
	for i, m := range ms {
		ids[i] = m.UserID
	}
	users, err := s.Store.UsersByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	friends, err := s.friendSet(ctx, me.ID)
	if err != nil {
		return nil, err
	}
	out := make([]blendMember, 0, len(users))
	for _, u := range users {
		bm := blendMember{UserID: u.ID, Name: u.DisplayName, IsFriend: friends[u.ID], Bio: u.Bio}
		out = append(out, bm)
	}
	return out, nil
}

func (s *Server) groupBlend(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	me := userFrom(r)
	if !s.isMember(r.Context(), g.ID, me.ID) {
		writeErr(w, 403, "join the group to blend it")
		return
	}
	var in struct{ Count int }
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	members, err := s.membersForBlend(r.Context(), g, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if len(members) > maxBlendMember {
		members = members[:maxBlendMember] // the recommender blends a handful of people at a time
		hasMe := false
		for _, m := range members {
			hasMe = hasMe || m.UserID == me.ID
		}
		if !hasMe {
			members[len(members)-1] = blendMember{UserID: me.ID, Name: me.DisplayName}
		}
	}
	var req blendIn
	req.Group.ID, req.Group.Name, req.Members, req.Count = g.ID, g.Name, members, in.Count
	s.runBlend(w, r, req)
}

// groupBlendInputs is the contract Kevin asked for: what a Blend would use, per member.
func (s *Server) groupBlendInputs(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	me := userFrom(r)
	if !s.isMember(r.Context(), g.ID, me.ID) {
		writeErr(w, 403, "join the group to see this")
		return
	}
	members, err := s.membersForBlend(r.Context(), g, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	type out struct {
		ID          string         `json:"id"`
		Name        string         `json:"name"`
		IsFriend    bool           `json:"isFriend"`
		Skill       map[string]any `json:"skill"`
		Taste       []float64      `json:"taste,omitempty"`
		RecentGames []string       `json:"recentGames"`
	}
	res := make([]out, 0, len(members))
	for _, m := range members {
		o := out{ID: m.UserID, Name: m.Name, IsFriend: m.IsFriend, Skill: skillOf(m.Skill), RecentGames: []string{}}
		if rec, err := s.Store.GetRecs(r.Context(), m.UserID); err == nil {
			o.RecentGames = nonNil(lastN(rec.Feed, 10))
			if p := s.memberProfile(r.Context(), m); p != nil {
				if t, ok := p["taste"].([]any); ok {
					for _, v := range t {
						if f, ok := v.(float64); ok {
							o.Taste = append(o.Taste, f)
						}
					}
				}
			}
		}
		res = append(res, o)
	}
	sort.Slice(res, func(i, j int) bool { return res[i].ID < res[j].ID })
	writeJSON(w, 200, map[string]any{"group": map[string]any{"id": g.ID, "name": g.Name}, "members": res})
}

func lastN(l []string, n int) []string {
	if len(l) > n {
		return l[len(l)-n:]
	}
	return l
}

// socialContext is the facts the feed's candidates come from: who the person's friends are, which
// Groups and Events they are in, and what those people have scored.
type socialContext struct {
	me      string
	friends map[string]bool
	groups  map[string]bool            // Groups and Events I am in
	peers   map[string]bool            // everyone in my Groups and Events
	scores  map[string][]model.Score   // game id -> scores by friends and peers, best first
	inGroup map[string]map[string]bool // group id -> member ids
}

func (s *Server) loadSocial(ctx context.Context, me *model.User) *socialContext {
	sc := &socialContext{friends: map[string]bool{}, groups: map[string]bool{}, peers: map[string]bool{}, scores: map[string][]model.Score{}, inGroup: map[string]map[string]bool{}}
	if me == nil {
		return sc
	}
	sc.me = me.ID
	if f, err := s.friendSet(ctx, me.ID); err == nil {
		sc.friends = f
	}
	gs, _ := s.Store.GroupsOfUser(ctx, me.ID)
	for _, g := range gs {
		sc.groups[g.ID] = true
		sc.inGroup[g.ID] = map[string]bool{}
		ms, _ := s.Store.GroupMembers(ctx, g.ID)
		for _, m := range ms {
			sc.inGroup[g.ID][m.UserID] = true
			if m.UserID != me.ID {
				sc.peers[m.UserID] = true
			}
		}
	}
	var ids []string
	for id := range sc.friends {
		ids = append(ids, id)
	}
	for id := range sc.peers {
		if !sc.friends[id] {
			ids = append(ids, id)
		}
	}
	if len(ids) > 0 {
		recent, _ := s.Store.RecentScores(ctx, ids, 800)
		for _, sc2 := range recent {
			sc.scores[sc2.GameID] = append(sc.scores[sc2.GameID], sc2)
		}
		for gid := range sc.scores {
			sort.Slice(sc.scores[gid], func(i, j int) bool { return sc.scores[gid][i].Score > sc.scores[gid][j].Score })
		}
	}
	return sc
}

// candidatesFor makes the feed's candidates: each is a game plus why it could be shown and how much that
// reason counts. It only supplies facts from the real data (who played what, which Groups, what is new);
// the order is decided entirely by the recommender. The reasons and weights are the ones the app's own
// feed generator used before ranking moved to the server.
func candidatesFor(games []model.Game, sc *socialContext, now time.Time) []map[string]any {
	var out []map[string]any
	add := func(g model.Game, reason string, run *model.Score, weight float64) {
		var runUser any
		if run != nil {
			runUser = run.UserID
		}
		out = append(out, map[string]any{"gameID": g.ID, "reason": reason, "runUserID": runUser, "weight": weight})
	}
	first := func(l ...[]model.Score) *model.Score {
		for _, x := range l {
			if len(x) > 0 {
				return &x[0]
			}
		}
		return nil
	}
	for _, g := range games {
		board := sc.scores[g.ID]
		var friendRuns, memberRuns []model.Score
		for _, b := range board {
			switch {
			case sc.friends[b.UserID]:
				friendRuns = append(friendRuns, b)
			case (g.GroupID != "" && sc.inGroup[g.GroupID][b.UserID]) || (g.EventID != "" && sc.inGroup[g.EventID][b.UserID]):
				memberRuns = append(memberRuns, b)
			}
		}
		if g.IsDaily {
			add(g, "daily", first(friendRuns, memberRuns), 3)
		}
		if g.EventID != "" {
			add(g, "icebreaker", first(memberRuns, friendRuns), 2)
		}
		if sc.me != "" && g.OwnerID == sc.me {
			add(g, "yours", first(board), 0.6)
		}
		for i := range friendRuns[:min(3, len(friendRuns))] {
			add(g, "friendBurst", &friendRuns[i], 2.2)
		}
		for i := range memberRuns[:min(2, len(memberRuns))] {
			add(g, "groupBurst", &memberRuns[i], 1.6)
		}
		if now.Sub(g.CreatedAt) < 72*time.Hour && !sc.friends[g.OwnerID] && g.OwnerID != sc.me {
			add(g, "nearby", first(board), 1.8)
		}
		if g.Level > 1 {
			add(g, "nextLevel", first(friendRuns, board), 1.2)
		}
		add(g, "popular", first(board), 0.8*popularity(g))
	}
	return out
}

// popularity scales the "popular" reason by how much everyone has engaged with a game: 0.6 for a game nobody has
// touched up to 1.8 (a fresh game's weight) for one with thousands of plays, finishes and likes, on a log scale. It
// is a fact the recommender weighs like the other reasons; its own model only sees one person's history.
func popularity(g model.Game) float64 {
	eng := float64(g.Plays) + 2*float64(g.Finishes) + 3*float64(g.Likes)
	return 0.6 + 1.2*math.Min(1, math.Log1p(eng)/math.Log1p(3000))
}
