package api

import (
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// The feed's page rules. The recommender decides the order; these rules decide what may be on a page at all:
//
//   - One entry per game family. A base game, its Group copies (same slug plus a Group suffix), its remixes
//     (remixOf) and same-titled variants with the same formula and sponsor are one family. The feed shows the
//     member that suits the viewer best and tags every item with the family's `baseId`.
//   - Never the same family twice in one session. The session is the caller's sessionID: a signed-in person's
//     list is kept with their model (RecsRecord.FeedSeen), a guest's in memory here (anonFeeds). That list is the
//     feed's cursor: pages can't overlap however the recommender's scores move between calls. When every family
//     has been shown the feed is at its end (an empty page).
//   - Sponsored games only at fixed positions: every adEvery-th card of a session (0-based positions 4, 9, 14,
//     ...). An ad slot with no sponsored game left takes a regular game; once the regular games run out the
//     remaining sponsored games fill the end. An ad is a family like any other, so it never repeats a game shown.

const (
	adEvery        = 5    // every fifth card of a session is an ad slot
	maxSessionSeen = 2000 // ids remembered per session (games shown plus their base ids)
	maxAnonFeeds   = 5000 // guest sessions kept in memory
)

// isAdSlot reports whether the 0-based session position p is an ad slot.
func isAdSlot(p int) bool { return p%adEvery == adEvery-1 }

// normTitle is a title reduced to lower-case letters and digits, for spotting same-titled variants.
func normTitle(t string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(t) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// familyBases maps each game id to its family's base id: the family's oldest original (neither a remix nor a
// Group copy), else its oldest game; the id breaks ties.
func familyBases(games []model.Game) map[string]string {
	parent := map[string]string{}
	find := func(x string) string {
		if _, ok := parent[x]; !ok {
			parent[x] = x
		}
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(a, b string) {
		if ra, rb := find(a), find(b); ra != rb {
			parent[ra] = rb
		}
	}
	bySlug := map[string]string{}
	byTitle := map[string]string{}
	derived := map[string]bool{} // remixes and Group copies
	for _, g := range games {
		find(g.ID)
		if g.Slug != "" {
			bySlug[g.Slug] = g.ID
		}
	}
	for _, g := range games {
		if g.RemixOf != "" && g.RemixOf != g.ID {
			union(g.ID, g.RemixOf)
			derived[g.ID] = true
		}
		// A Group copy's slug is the base slug plus a suffix ("mg-x-6jsk" -> "mg-x-6jsk-newinsf").
		s := g.Slug
		for i := 0; i < 4 && s != ""; i++ {
			cut := strings.LastIndexByte(s, '-')
			if cut < 8 {
				break
			}
			s = s[:cut]
			if id, ok := bySlug[s]; ok && id != g.ID {
				union(g.ID, id)
				derived[g.ID] = true
				break
			}
		}
		if t := normTitle(g.Title); t != "" {
			sponsor := ""
			if g.Sponsor != nil {
				sponsor = strings.ToLower(g.Sponsor.Name)
			}
			key := g.Formula + "|" + sponsor + "|" + t
			if id, ok := byTitle[key]; ok {
				union(g.ID, id)
			} else {
				byTitle[key] = g.ID
			}
		}
	}
	oldest := map[string]model.Game{}
	for _, g := range games {
		root := find(g.ID)
		o, ok := oldest[root]
		better := !ok
		switch {
		case better:
		case derived[g.ID] != derived[o.ID]:
			better = !derived[g.ID]
		case !g.CreatedAt.Equal(o.CreatedAt):
			better = g.CreatedAt.Before(o.CreatedAt)
		default:
			better = g.ID < o.ID
		}
		if better {
			oldest[root] = g
		}
	}
	out := make(map[string]string, len(games))
	for _, g := range games {
		out[g.ID] = oldest[find(g.ID)].ID
	}
	return out
}

// memberTier ranks a family member for a viewer: a copy in one of my Groups, then my own, then a friend's,
// then the open (not Group-scoped) game, then other Groups' copies. Lower is better.
func memberTier(g model.Game, sc *socialContext) int {
	switch {
	case sc != nil && ((g.GroupID != "" && sc.groups[g.GroupID]) || (g.EventID != "" && sc.groups[g.EventID])):
		return 0
	case sc != nil && sc.me != "" && g.OwnerID == sc.me:
		return 1
	case sc != nil && sc.friends[g.OwnerID]:
		return 2
	case g.GroupID == "" && g.EventID == "":
		return 3
	}
	return 4
}

// newestFirst sorts games newest first with the id breaking ties, so every order built on it is deterministic.
func newestFirst(games []model.Game) {
	sort.SliceStable(games, func(i, j int) bool {
		if !games[i].CreatedAt.Equal(games[j].CreatedAt) {
			return games[i].CreatedAt.After(games[j].CreatedAt)
		}
		return games[i].ID > games[j].ID
	})
}

// feedPool is what a page may be built from.
type feedPool struct {
	bases     map[string]string // game id -> base id
	organic   []model.Game      // one per unseen family, newest first
	sponsored []model.Game      // the same, for sponsored families
}

// buildPool collapses games into families, picks each family's best member for the viewer, and drops families
// already seen this session or excluded by the caller (ids or slugs of any member).
func buildPool(games []model.Game, sc *socialContext, seen map[string]bool, exclude []string) feedPool {
	games = append([]model.Game(nil), games...)
	newestFirst(games)
	bases := familyBases(games)
	members := map[string][]model.Game{}
	var order []string
	for _, g := range games {
		b := bases[g.ID]
		if _, ok := members[b]; !ok {
			order = append(order, b)
		}
		members[b] = append(members[b], g)
	}
	skip := map[string]bool{}
	if len(exclude) > 0 {
		ex := map[string]bool{}
		for _, id := range exclude {
			ex[id] = true
		}
		for _, g := range games {
			if ex[g.ID] || (g.Slug != "" && ex[g.Slug]) {
				skip[bases[g.ID]] = true
			}
		}
	}
	pool := feedPool{bases: bases}
	for _, b := range order {
		if skip[b] || seen[b] {
			continue
		}
		ms := members[b]
		hit := false
		for _, m := range ms {
			if seen[m.ID] {
				hit = true
				break
			}
		}
		if hit {
			continue
		}
		best := ms[0]
		for _, m := range ms[1:] {
			tb, tm := memberTier(best, sc), memberTier(m, sc)
			pb, pm := best.Plays+best.Likes, m.Plays+m.Likes
			switch {
			case tm != tb:
				if tm < tb {
					best = m
				}
			case pm != pb:
				if pm > pb {
					best = m
				}
			case !m.CreatedAt.Equal(best.CreatedAt):
				if m.CreatedAt.Before(best.CreatedAt) {
					best = m
				}
			case m.ID < best.ID:
				best = m
			}
		}
		if best.Sponsor != nil {
			pool.sponsored = append(pool.sponsored, best)
		} else {
			pool.organic = append(pool.organic, best)
		}
	}
	return pool
}

// layoutPage fills count positions starting at session position start: sponsored games only in ad slots, regular
// games everywhere else; once the regular games are gone the sponsored ones fill the end.
func layoutPage[T any](organic, sponsored []T, start, count int) []T {
	var out []T
	for i := 0; i < count; i++ {
		switch {
		case isAdSlot(start+i) && len(sponsored) > 0:
			out, sponsored = append(out, sponsored[0]), sponsored[1:]
		case len(organic) > 0:
			out, organic = append(out, organic[0]), organic[1:]
		case len(sponsored) > 0:
			out, sponsored = append(out, sponsored[0]), sponsored[1:]
		default:
			return out
		}
	}
	return out
}

// seenSet is a session's shown ids (games and their base ids) as a set.
func seenSet(ids []string) map[string]bool {
	m := make(map[string]bool, len(ids))
	for _, id := range ids {
		m[id] = true
	}
	return m
}

// appendSeen records a shown game and its base, keeping the newest maxSessionSeen ids.
func appendSeen(seen []string, gameID, baseID string) []string {
	seen = append(seen, gameID)
	if baseID != "" && baseID != gameID {
		seen = append(seen, baseID)
	}
	if n := len(seen) - maxSessionSeen; n > 0 {
		seen = seen[n:]
	}
	return seen
}

// anonFeed is a guest session's feed: what it was shown and how many cards so far.
type anonFeed struct {
	seen  []string
	shown int
	at    time.Time
}

// anonFeeds keeps guest sessions in memory, keyed by sessionID. Idle sessions expire after sessionGap.
type anonFeeds struct {
	mu sync.Mutex
	m  map[string]*anonFeed
}

// get returns a copy of the session's state (empty for a new or expired one).
func (a *anonFeeds) get(id string, now time.Time) anonFeed {
	a.mu.Lock()
	defer a.mu.Unlock()
	if f, ok := a.m[id]; ok && now.Sub(f.at) <= sessionGap {
		return anonFeed{seen: append([]string(nil), f.seen...), shown: f.shown, at: f.at}
	}
	return anonFeed{}
}

func (a *anonFeeds) put(id string, f anonFeed) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.m == nil {
		a.m = map[string]*anonFeed{}
	}
	if _, ok := a.m[id]; !ok && len(a.m) >= maxAnonFeeds {
		var oldestID string
		var oldestAt time.Time
		for k, v := range a.m {
			if f.at.Sub(v.at) > sessionGap {
				delete(a.m, k)
				continue
			}
			if oldestID == "" || v.at.Before(oldestAt) {
				oldestID, oldestAt = k, v.at
			}
		}
		if len(a.m) >= maxAnonFeeds && oldestID != "" {
			delete(a.m, oldestID)
		}
	}
	a.m[id] = &f
}
