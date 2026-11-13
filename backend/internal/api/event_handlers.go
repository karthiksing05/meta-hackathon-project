package api

import (
	"encoding/json"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

var (
	gameKeyRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) // a server id or a slug
	kindRE    = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
	eventIDRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`)
)

const maxEventsPerBatch = 100

// eventIn is one event as a phone sends it. Three shapes share it:
//
//	legacy:  {gameId, type: "play", value?, at?}
//	page:    one per feed page shown, with the recommender's fields and no type or kind
//	moment:  {kind: "challenge_accepted", gameID, with, day}, for things that happen off the feed
//
// Decoding is case-insensitive, so gameId and gameID are the same field.
type eventIn struct {
	EventID      string   `json:"eventID"`
	UserID       string   `json:"userID"`
	SessionID    string   `json:"sessionID"`
	Day          *int     `json:"day"`
	TS           string   `json:"ts"`
	At           *int64   `json:"at"` // legacy: client time in unix ms
	FeedItemID   string   `json:"feedItemID"`
	GameID       string   `json:"gameID"`
	Position     *int     `json:"position"`
	Reason       string   `json:"reason"`
	Team         string   `json:"team"`
	Score        *float64 `json:"score"`
	Propensity   *float64 `json:"propensity"`
	DwellSec     float64  `json:"dwellSec"`
	TookOver     bool     `json:"tookOver"`
	RunsFinished int      `json:"runsFinished"`
	Replays      int      `json:"replays"`
	Saved        bool     `json:"saved"`
	Liked        bool     `json:"liked"`
	Floated      bool     `json:"floated"`
	OpenedBoard  bool     `json:"openedBoard"`
	AddedFriend  bool     `json:"addedFriend"`
	Remixed      bool     `json:"remixed"`
	QuitMidRun   bool     `json:"quitMidRun"`
	EndedSession bool     `json:"endedSession"`
	Social       []string `json:"social"`
	With         []string `json:"with"`
	Satisfied    *bool    `json:"satisfied"` // optional: the phone's own call on whether the page paid off
	Kind         string   `json:"kind"`
	Type         string   `json:"type"`
	Value        float64  `json:"value"`
}

// normTeam maps the names phones use onto the stored "A" (the formula) and "B" (the control).
func normTeam(t string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "":
		return "", true
	case "a", "formula":
		return "A", true
	case "b", "control", "baseline":
		return "B", true
	}
	return "", false
}

func shortStr(s string) bool { return len(s) <= 64 }

func goodList(l []string, shape *regexp.Regexp) bool {
	if len(l) > 20 {
		return false
	}
	for _, x := range l {
		if x == "" || !shortStr(x) || (shape != nil && !shape.MatchString(x)) {
			return false
		}
	}
	return true
}

// buildEvent validates one incoming event and derives its flags. The error text is safe to return.
func buildEvent(in eventIn, actor, userID, deviceID string, now time.Time) (model.Event, string) {
	if !gameKeyRE.MatchString(in.GameID) {
		return model.Event{}, "gameID is required (a game id or slug)"
	}
	team, ok := normTeam(in.Team)
	if !ok {
		return model.Event{}, "team must be A, B or empty"
	}
	if in.EventID != "" && !eventIDRE.MatchString(in.EventID) {
		return model.Event{}, "eventID must be 1 to 64 letters, digits or _.:-"
	}
	if !shortStr(in.UserID) || !shortStr(in.SessionID) || !shortStr(in.FeedItemID) || !shortStr(in.Reason) {
		return model.Event{}, "an id field is too long"
	}
	if !goodList(in.Social, kindRE) || !goodList(in.With, nil) {
		return model.Event{}, "social and with are limited to 20 short entries"
	}
	if in.Day != nil && (*in.Day < 0 || *in.Day > 200000) ||
		in.Position != nil && (*in.Position < 0 || *in.Position > 10000) ||
		in.RunsFinished < 0 || in.RunsFinished > 1000 || in.Replays < 0 || in.Replays > 1000 ||
		in.DwellSec < 0 || in.DwellSec > 86400 || math.IsNaN(in.DwellSec) || math.IsNaN(in.Value) {
		return model.Event{}, "a numeric field is out of range"
	}
	if in.Propensity != nil && (math.IsNaN(*in.Propensity) || *in.Propensity < 0 || *in.Propensity > 1) {
		return model.Event{}, "propensity must be between 0 and 1"
	}
	if in.Score != nil && (math.IsNaN(*in.Score) || math.IsInf(*in.Score, 0)) {
		return model.Event{}, "score must be a number"
	}

	e := model.Event{
		ClientEventID: in.EventID, Actor: actor, UserID: userID, DeviceID: deviceID, ClientUserID: in.UserID,
		GameID: in.GameID, Value: in.Value, SessionID: in.SessionID, Day: in.Day,
		FeedItemID: in.FeedItemID, Position: in.Position, Reason: in.Reason, Team: team,
		RankScore: in.Score, Propensity: in.Propensity, DwellSec: in.DwellSec, TookOver: in.TookOver,
		RunsFinished: in.RunsFinished, Replays: in.Replays, Saved: in.Saved, Liked: in.Liked, Floated: in.Floated,
		OpenedBoard: in.OpenedBoard, AddedFriend: in.AddedFriend, Remixed: in.Remixed, QuitMidRun: in.QuitMidRun,
		EndedSession: in.EndedSession, Social: in.Social, With: in.With, CreatedAt: now,
	}
	// The app has no separate like: its Save button is the only one, and it reports both flags for the one tap. Counting
	// liked on top of saved would weigh a single save twice, so a like is read as a save.
	if e.Liked {
		e.Saved, e.Liked = true, false
	}
	if in.EventID != "" {
		e.ID = actor + "|" + in.EventID // sending the same eventID again is a no-op
	} else {
		e.ID = auth.NewID(12)
	}

	// The phone's clock counts only within a sane window; otherwise the server's time is used.
	var at *time.Time
	if in.TS != "" {
		if t, err := time.Parse(time.RFC3339, in.TS); err == nil {
			t = t.UTC()
			at = &t
		}
	} else if in.At != nil {
		t := time.UnixMilli(*in.At).UTC()
		at = &t
	}
	if at != nil && at.After(now.Add(-30*24*time.Hour)) && at.Before(now.Add(time.Minute)) {
		e.CreatedAt = at.Truncate(time.Millisecond)
	}

	switch {
	case in.Type != "" && model.EventTypes[in.Type]: // legacy event
		e.Type = in.Type
		switch in.Type {
		case "view":
			e.Impression = true
		case "play":
			e.TookOver = true
		case "finish":
			e.RunsFinished = max(e.RunsFinished, 1)
		case "replay":
			e.Replays = max(e.Replays, 1)
		}
		e.Credit = in.Type == "finish" || in.Type == "replay" || in.Type == "like" || in.Type == "share" || in.Type == "remix"
	case in.Type != "" || in.Kind != "": // an off-feed moment; unknown kinds are stored, not rejected
		k := in.Kind
		if k == "" {
			k = in.Type
		}
		if !kindRE.MatchString(k) {
			return model.Event{}, "kind must be short snake_case, such as challenge_accepted"
		}
		e.Kind = k
		e.SocialMoment = true
		e.Credit = true
	case in.FeedItemID != "" || in.Position != nil: // a feed page
		e.Impression = true
		e.SocialMoment = len(in.Social) > 0
		e.Credit = in.RunsFinished > 0 || in.Replays > 0 || in.Saved || in.Liked || in.Floated || in.AddedFriend || in.Remixed || len(in.Social) > 0
	default:
		return model.Event{}, "an event needs a type, a kind, or a feedItemID or position"
	}
	e.Satisfied = e.Credit && e.Kind == "" // off-feed moments are counted as socialMoments, not as satisfied pages
	if in.Satisfied != nil {
		e.Satisfied = *in.Satisfied
	}
	return e, ""
}

func (s *Server) feedEvents(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DeviceID string    `json:"deviceId"`
		Events   []eventIn `json:"events"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Events) == 0 || len(in.Events) > maxEventsPerBatch {
		writeErr(w, 400, "send between 1 and 100 events")
		return
	}
	u := userFrom(r)
	if u == nil && (in.DeviceID == "" || len(in.DeviceID) > 64) {
		writeErr(w, 400, "deviceId is required when not signed in")
		return
	}
	actor, userID, deviceID := "d:"+in.DeviceID, "", in.DeviceID
	if u != nil {
		actor, userID, deviceID = "u:"+u.ID, u.ID, ""
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	evs := make([]model.Event, 0, len(in.Events))
	for i, ein := range in.Events {
		e, msg := buildEvent(ein, actor, userID, deviceID, now)
		if msg != "" {
			writeErr(w, 400, "event "+strconv.Itoa(i)+": "+msg)
			return
		}
		evs = append(evs, e)
	}
	added, err := s.Store.AddEvents(r.Context(), evs)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if u != nil { // a signed-in person's model learns from what happened
		s.learnFromEvents(r.Context(), u.ID, added)
	}
	writeJSON(w, 202, map[string]int{"accepted": len(added), "duplicates": len(evs) - len(added)})
}

// parseSince reads ?since= as RFC3339 or unix milliseconds. Empty means the beginning.
func parseSince(r *http.Request) (time.Time, bool) {
	v := r.URL.Query().Get("since")
	if v == "" {
		return time.Time{}, true
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		return time.UnixMilli(n).UTC(), true
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t.UTC(), true
	}
	return time.Time{}, false
}

type gameQuality struct {
	BotGatePassed bool `json:"botGatePassed"`
	Fragments     int  `json:"fragments"`
	Reports       int  `json:"reports"`
}

type gameStatsOut struct {
	GameID        string      `json:"gameID"`
	ID            string      `json:"id,omitempty"`
	Slug          string      `json:"slug,omitempty"`
	Impressions   int64       `json:"impressions"`
	Takeovers     int64       `json:"takeovers"`
	Finishes      int64       `json:"finishes"`
	Satisfied     int64       `json:"satisfied"`
	Replays       int64       `json:"replays"`
	SocialMoments int64       `json:"socialMoments"`
	CreatedDay    *int64      `json:"createdDay"`
	CreatedAt     *time.Time  `json:"createdAt"`
	CreatorID     string      `json:"creatorID,omitempty"`
	GroupID       *string     `json:"groupID"`
	Quality       gameQuality `json:"quality"`
}

// gameStats rolls the event log up per game and adds the game's own metadata. Games with no
// events yet are included (with zero counts), so a new game can be given a cold-start prior.
func (s *Server) gameStats(w http.ResponseWriter, r *http.Request) {
	since, ok := parseSince(r)
	if !ok {
		writeErr(w, 400, "since must be RFC3339 or unix milliseconds")
		return
	}
	rows, err := s.Store.GameStats(r.Context(), since)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	games, err := s.Store.AllGames(r.Context(), 5000)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	out := map[string]*gameStatsOut{}
	byKey := map[string]string{} // id or slug -> output key
	for _, g := range games {
		key := g.ID
		if g.Slug != "" {
			key = g.Slug
		}
		day := g.CreatedAt.Unix() / 86400
		created := g.CreatedAt
		o := &gameStatsOut{GameID: key, ID: g.ID, Slug: g.Slug, CreatedDay: &day, CreatedAt: &created, CreatorID: g.OwnerID}
		if g.GroupID != "" {
			gid := g.GroupID
			o.GroupID = &gid
		}
		out[key] = o
		byKey[g.ID] = key
		if g.Slug != "" {
			byKey[g.Slug] = key
		}
	}
	for _, st := range rows {
		key, known := byKey[st.Key]
		if !known {
			key = st.Key
			out[key] = &gameStatsOut{GameID: key}
		}
		o := out[key]
		o.Impressions += st.Impressions
		o.Takeovers += st.Takeovers
		o.Finishes += st.Finishes
		o.Satisfied += st.Satisfied
		o.Replays += st.Replays
		o.SocialMoments += st.SocialMoments
	}
	list := make([]gameStatsOut, 0, len(out))
	for _, o := range out {
		list = append(list, *o)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].GameID < list[j].GameID })
	writeJSON(w, 200, map[string]any{"games": list})
}

// interleave counts every session that carried a team and says which side's pages paid off more.
func (s *Server) interleave(w http.ResponseWriter, r *http.Request) {
	since, ok := parseSince(r)
	if !ok {
		writeErr(w, 400, "since must be RFC3339 or unix milliseconds")
		return
	}
	res, err := s.Store.Interleave(r.Context(), since)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]model.Interleave{"baseline": res})
}

// eventOut is an event on the wire, in the same shape phones send. Booleans appear only when true.
type eventOut struct {
	EventID      string   `json:"eventID,omitempty"`
	UserID       string   `json:"userID"`
	SessionID    string   `json:"sessionID,omitempty"`
	Day          *int     `json:"day,omitempty"`
	TS           string   `json:"ts"`
	FeedItemID   string   `json:"feedItemID,omitempty"`
	GameID       string   `json:"gameID"`
	Position     *int     `json:"position,omitempty"`
	Reason       string   `json:"reason,omitempty"`
	Team         string   `json:"team,omitempty"`
	Score        *float64 `json:"score,omitempty"`
	Propensity   *float64 `json:"propensity,omitempty"`
	DwellSec     float64  `json:"dwellSec,omitempty"`
	TookOver     bool     `json:"tookOver,omitempty"`
	RunsFinished int      `json:"runsFinished,omitempty"`
	Replays      int      `json:"replays,omitempty"`
	Saved        bool     `json:"saved,omitempty"`
	Liked        bool     `json:"liked,omitempty"`
	Floated      bool     `json:"floated,omitempty"`
	OpenedBoard  bool     `json:"openedBoard,omitempty"`
	AddedFriend  bool     `json:"addedFriend,omitempty"`
	Remixed      bool     `json:"remixed,omitempty"`
	QuitMidRun   bool     `json:"quitMidRun,omitempty"`
	EndedSession bool     `json:"endedSession,omitempty"`
	Satisfied    bool     `json:"satisfied,omitempty"`
	Social       []string `json:"social,omitempty"`
	With         []string `json:"with,omitempty"`
	Kind         string   `json:"kind,omitempty"`
	Type         string   `json:"type,omitempty"`
	Value        float64  `json:"value,omitempty"`
}

func toOut(e model.Event) eventOut {
	uid := e.ClientUserID
	if uid == "" {
		uid = e.UserID
	}
	if uid == "" {
		uid = "device:" + e.DeviceID
	}
	return eventOut{
		EventID: e.ClientEventID, UserID: uid, SessionID: e.SessionID, Day: e.Day,
		TS: e.CreatedAt.UTC().Format(time.RFC3339Nano), FeedItemID: e.FeedItemID, GameID: e.GameID,
		Position: e.Position, Reason: e.Reason, Team: e.Team, Score: e.RankScore, Propensity: e.Propensity,
		DwellSec: e.DwellSec, TookOver: e.TookOver, RunsFinished: e.RunsFinished, Replays: e.Replays,
		Saved: e.Saved, Liked: e.Liked, Floated: e.Floated, OpenedBoard: e.OpenedBoard, AddedFriend: e.AddedFriend,
		Remixed: e.Remixed, QuitMidRun: e.QuitMidRun, EndedSession: e.EndedSession, Satisfied: e.Satisfied,
		Social: e.Social, With: e.With, Kind: e.Kind, Type: e.Type, Value: e.Value,
	}
}

// exportEvents streams the event log as JSON Lines, oldest first, for offline benchmarking. It
// needs a signed-in user. X-Next-Since carries the timestamp to pass as ?since= for the next page.
func (s *Server) exportEvents(w http.ResponseWriter, r *http.Request) {
	since, ok := parseSince(r)
	if !ok {
		writeErr(w, 400, "since must be RFC3339 or unix milliseconds")
		return
	}
	limit := limitParam(r, 10000, 100000)
	evs, err := s.Store.ExportEvents(r.Context(), since, limit)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	if len(evs) > 0 {
		w.Header().Set("X-Next-Since", evs[len(evs)-1].CreatedAt.UTC().Format(time.RFC3339Nano))
	}
	w.WriteHeader(200)
	enc := json.NewEncoder(w)
	for _, e := range evs {
		if err := enc.Encode(toOut(e)); err != nil {
			return
		}
	}
}
