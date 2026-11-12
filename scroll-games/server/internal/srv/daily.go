package srv

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net/http"
	"sort"
	"time"
)

const dateLayout = "2006-01-02"

func dateOf(t time.Time) string { return t.UTC().Format(dateLayout) }

// dailySeed is the same for everyone on a given UTC date.
func dailySeed(date string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte("daily:" + date))
	return h.Sum32()
}

func hashMod(s string, n uint32) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return h.Sum32() % n
}

func nextReset(now time.Time) time.Time {
	d, _ := time.Parse(dateLayout, dateOf(now))
	return d.AddDate(0, 0, 1)
}

// dailyGameIDLocked returns the game of the day, pinned in the store so later publishes
// do not change it mid-day. Candidates are published games whose manifest has seed_scope
// "daily" (all published games if there are none), sorted by id and rotated by day index.
// Callers hold the write lock.
func (a *App) dailyGameIDLocked(date string) string {
	if id, ok := a.store.d.Daily[date]; ok {
		if _, ok := a.store.d.Games[id]; ok {
			return id
		}
	}
	var daily, all []string
	for id, g := range a.store.d.Games {
		if g.Status != "published" || a.hiddenFromOthersLocked(g) {
			continue
		}
		all = append(all, id)
		if manifestSeedScope(g.Manifest) == "daily" {
			daily = append(daily, id)
		}
	}
	if len(daily) > 0 {
		all = daily
	}
	if len(all) == 0 {
		return ""
	}
	sort.Strings(all)
	day, _ := time.Parse(dateLayout, date)
	id := all[int(day.Unix()/86400)%len(all)]
	a.store.d.Daily[date] = id
	return id
}

func manifestSeedScope(raw []byte) string {
	var m struct {
		SeedScope string `json:"seed_scope"`
	}
	_ = json.Unmarshal(raw, &m)
	return m.SeedScope
}

// countedDailyLocked returns the counted (non-practice, verified) daily plays for a date.
func (a *App) countedDailyLocked(date string) []*Play {
	out := []*Play{}
	for _, p := range a.store.d.Plays {
		if p.Daily && p.Date == date && p.Verified && !p.Practice {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out
}

func (a *App) hasCountedDaily(uid, date string) bool {
	for _, p := range a.countedDailyLocked(date) {
		if p.UserID == uid {
			return true
		}
	}
	return false
}

// streakLocked counts consecutive UTC days with a counted daily play. If today has not been
// played yet the streak is still alive when it ends yesterday.
func (a *App) streakLocked(uid, today string) int {
	days := map[string]bool{}
	for _, p := range a.store.d.Plays {
		if p.Daily && p.UserID == uid && p.Verified && !p.Practice {
			days[p.Date] = true
		}
	}
	d, err := time.Parse(dateLayout, today)
	if err != nil {
		return 0
	}
	if !days[today] {
		d = d.AddDate(0, 0, -1)
	}
	n := 0
	for days[d.Format(dateLayout)] {
		n++
		d = d.AddDate(0, 0, -1)
	}
	return n
}

// friendRankLocked is the 1-based rank of uid among themselves and their friends for a date (0 if not played).
func (a *App) friendRankLocked(uid, date string) int {
	me, _ := a.store.user(uid)
	circle := map[string]bool{uid: true}
	for _, f := range me.Friends {
		circle[f] = true
	}
	rank := 0
	for _, p := range a.countedDailyLocked(date) {
		if !circle[p.UserID] {
			continue
		}
		rank++
		if p.UserID == uid {
			return rank
		}
	}
	return 0
}

func (a *App) friendsPlayedLocked(uid, date string) int {
	me, _ := a.store.user(uid)
	friends := map[string]bool{}
	for _, f := range me.Friends {
		friends[f] = true
	}
	n := 0
	for _, p := range a.countedDailyLocked(date) {
		if friends[p.UserID] {
			n++
		}
	}
	return n
}

// ensureDailyDemoLocked keeps the synthetic demo alive: today's friends have played, and on a
// store with no daily history u_me gets a 3-day streak ending yesterday. Callers hold the write lock.
func (a *App) ensureDailyDemoLocked(now time.Time) {
	today := dateOf(now)
	if _, ok := a.store.user("u_me"); !ok {
		return
	}
	hasDaily := false
	for _, p := range a.store.d.Plays {
		if p.Daily {
			hasDaily = true
			break
		}
	}
	changed := false
	add := func(user, date string, score int) {
		id := fmt.Sprintf("p_dly_%s_%s", date, user)
		if _, ok := a.store.d.Plays[id]; ok {
			return
		}
		gid := a.dailyGameIDLocked(date)
		if gid == "" {
			return
		}
		day, _ := time.Parse(dateLayout, date)
		a.store.d.Plays[id] = &Play{ID: id, GameID: gid, UserID: user, Seed: dailySeed(date), Score: score, Ticks: 600,
			Verified: true, Daily: true, Date: date, CreatedAt: day.Add(12 * time.Hour)}
		changed = true
	}
	if !hasDaily {
		for i := 1; i <= 3; i++ {
			d := dateOf(now.AddDate(0, 0, -i))
			add("u_me", d, 500+int(hashMod("me"+d, 400)))
		}
	}
	for _, u := range []string{"u_ana", "u_ben", "u_chloe", "u_dev", "u_eli"} {
		if hashMod("plays:"+today+u, 4) != 0 {
			add(u, today, 300+int(hashMod("score:"+today+u, 700)))
		}
	}
	if changed {
		a.store.saveLocked()
	}
}

// checkDailyPlay validates a daily submission and returns the date to record or an error message.
func (a *App) checkDailyPlay(gameID, date string, seed uint32) (string, string) {
	now := a.now().UTC()
	today := dateOf(now)
	if date == "" {
		date = today
	}
	if _, err := time.Parse(dateLayout, date); err != nil {
		return "", "invalid date, want YYYY-MM-DD"
	}
	if date != today {
		return "", "daily date must be today (UTC): " + today
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	a.ensureDailyDemoLocked(now)
	if a.dailyGameIDLocked(today) != gameID {
		return "", "not today's daily game"
	}
	if seed != dailySeed(today) {
		return "", "daily seed mismatch"
	}
	return today, ""
}

// dailyResult is the "daily" object of a play response. Callers hold the lock.
func (a *App) dailyResult(uid string, p *Play, counted bool) map[string]any {
	return map[string]any{"date": p.Date, "counted": counted, "practice": p.Practice,
		"streak": a.streakLocked(uid, p.Date), "rank_among_friends": a.friendRankLocked(uid, p.Date)}
}

type dailyLine struct {
	Rank   int    `json:"rank"`
	User   string `json:"user"`
	UserID string `json:"user_id"`
	Score  int    `json:"score"`
}

func (a *App) daily(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	now := a.now().UTC()
	today := dateOf(now)
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	if _, ok := a.store.user(uid); !ok {
		writeErr(w, 400, "unknown user")
		return
	}
	a.ensureDailyDemoLocked(now)
	gid := a.dailyGameIDLocked(today)
	g, ok := a.store.d.Games[gid]
	if !ok {
		writeErr(w, 404, "no daily game available")
		return
	}
	gs := a.withStats(g)
	gs.Manifest, gs.Content = nil, nil
	top := []dailyLine{}
	var mine *Play
	for i, p := range a.countedDailyLocked(today) {
		if p.UserID == uid {
			mine = p
		}
		if i < 5 {
			top = append(top, dailyLine{Rank: i + 1, User: a.store.userName(p.UserID), UserID: p.UserID, Score: p.Score})
		}
	}
	resp := map[string]any{"date": today, "game": gs, "seed": dailySeed(today),
		"resets_at": nextReset(now).Format(time.RFC3339), "my_streak": a.streakLocked(uid, today),
		"leaderboard_top": top, "friends_played": a.friendsPlayedLocked(uid, today)}
	if mine != nil {
		resp["my_play"] = mine
		resp["my_rank_among_friends"] = a.friendRankLocked(uid, today)
	}
	writeJSON(w, 200, resp)
}

// dailyFeedItem is the pinned "daily" feed entry for the viewer (nil if unavailable).
func (a *App) dailyFeedItem(uid string) *FeedView {
	now := a.now().UTC()
	today := dateOf(now)
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	me, ok := a.store.user(uid)
	if !ok {
		return nil
	}
	a.ensureDailyDemoLocked(now)
	g, ok := a.store.d.Games[a.dailyGameIDLocked(today)]
	if !ok {
		return nil
	}
	gs := a.withStats(g)
	gs.Manifest, gs.Content = nil, nil
	v := &FeedView{ID: "daily_" + today, Type: "daily", Actor: &me, Game: &gs, CreatedAt: now, Band: "daily"}
	for _, p := range a.countedDailyLocked(today) {
		if p.UserID == uid {
			v.Play = p
			v.Text = fmt.Sprintf("You scored %d on today's daily (#%d among friends)", p.Score, a.friendRankLocked(uid, today))
			return v
		}
	}
	v.Text = fmt.Sprintf("Today's daily: %s — %d %s played.", g.Title, a.friendsPlayedLocked(uid, today),
		plural(a.friendsPlayedLocked(uid, today), "friend", "friends"))
	if n := a.streakLocked(uid, today); n > 0 {
		v.Text += fmt.Sprintf(" Keep your %d-day streak.", n)
	} else {
		v.Text += " Start a streak."
	}
	return v
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
