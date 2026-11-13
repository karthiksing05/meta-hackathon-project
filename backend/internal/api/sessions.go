package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Making a game together (co-making sessions). Someone asks a chat or a Group for questions, words, scenes or levels;
// the people there add entries; the starter has Muse make one game from all of them, through the same path as
// POST /v1/generate (with groupId when the session lives in a Group).
//
//	POST /v1/sessions {kind, title, ask, target: {kind: "chat"|"group", id}, members?: [userId]}  -> 201 the session
//	GET  /v1/sessions?target=chat:<id>|group:<id>                                                  -> {items}
//	GET  /v1/sessions/{id}
//	POST /v1/sessions/{id}/entries {text}                                                          -> the session
//	POST /v1/sessions/{id}/make          (the starter only)                                        -> 202 {jobId}
//
// Only the people in the chat or the Group can see a session or add to it: a chat session's members (the starter's
// friends), or anyone in the Group. Everyone invited gets a session_invite notification.
const (
	maxSessionMembers    = 50
	maxSessionEntries    = 40
	maxSessionEntryRunes = 280
	maxSessionTitleRunes = 80
	maxSessionAskRunes   = 200
	sessionBriefBytes    = 7 << 10 // under the generator's 8 KB brief limit
)

var sessionKinds = map[string]string{"question": "questions", "words": "words", "scene": "scenes", "level": "levels"}

type sessionEntryView struct {
	ID    string    `json:"id"`
	Maker profile   `json:"maker"`
	Text  string    `json:"text"`
	At    time.Time `json:"at"`
}

type sessionDoc struct {
	ID        string             `json:"id"`
	Kind      string             `json:"kind"`
	Title     string             `json:"title"`
	Ask       string             `json:"ask"`
	Starter   profile            `json:"starter"`
	Target    map[string]string  `json:"target"`
	Members   []profile          `json:"members"`
	Entries   []sessionEntryView `json:"entries"`
	Status    string             `json:"status"` // open, making, made or failed
	JobID     string             `json:"jobId,omitempty"`
	GameID    string             `json:"gameId,omitempty"`
	Game      *model.GameView    `json:"game,omitempty"`
	Error     string             `json:"error,omitempty"`
	CreatedAt time.Time          `json:"createdAt"`
	UpdatedAt time.Time          `json:"updatedAt"`
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind   string `json:"kind"`
		Title  string `json:"title"`
		Ask    string `json:"ask"`
		Target struct {
			Kind string `json:"kind"`
			ID   string `json:"id"`
		} `json:"target"`
		Members []string `json:"members"`
	}
	if !decode(w, r, &in) {
		return
	}
	ctx, me := r.Context(), userFrom(r)
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	if _, ok := sessionKinds[kind]; !ok {
		writeErr(w, 400, "kind must be question, words, scene or level")
		return
	}
	title, ask := strings.TrimSpace(in.Title), strings.TrimSpace(in.Ask)
	if title == "" || len([]rune(title)) > maxSessionTitleRunes {
		writeErr(w, 400, fmt.Sprintf("title must be 1 to %d characters", maxSessionTitleRunes))
		return
	}
	if len([]rune(ask)) > maxSessionAskRunes {
		writeErr(w, 400, fmt.Sprintf("ask can be up to %d characters", maxSessionAskRunes))
		return
	}
	tkind := strings.ToLower(strings.TrimSpace(in.Target.Kind))
	tid := strings.TrimSpace(in.Target.ID)
	if (tkind != "chat" && tkind != "group") || tid == "" || len(tid) > 80 {
		writeErr(w, 400, "target needs a kind (chat or group) and an id")
		return
	}
	members := map[string]bool{me.ID: true}
	switch tkind {
	case "group":
		grp, err := s.Store.GroupByID(ctx, tid)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, 404, "Group not found")
			} else {
				s.serverErr(w, r, err)
			}
			return
		}
		if !s.isMember(ctx, grp.ID, me.ID) {
			writeErr(w, 403, "you are not in that Group")
			return
		}
		ms, err := s.Store.GroupMembers(ctx, tid)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		inGroup := map[string]bool{}
		for _, m := range ms {
			inGroup[m.UserID] = true
		}
		if len(in.Members) == 0 {
			for _, m := range ms { // the whole Group is invited (the first ones, for a big Group)
				if len(members) >= maxSessionMembers {
					break
				}
				members[m.UserID] = true
			}
		} else {
			for _, id := range in.Members {
				if !inGroup[id] {
					writeErr(w, 400, "everyone you invite must be in the Group")
					return
				}
				members[id] = true
			}
		}
	case "chat":
		if len(in.Members) == 0 {
			writeErr(w, 400, "a chat session needs the people in the chat (members)")
			return
		}
		fs, err := s.friendSet(ctx, me.ID)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		for _, id := range in.Members {
			if !fs[id] && id != me.ID {
				writeErr(w, 400, "you can only make a game together with friends")
				return
			}
			members[id] = true
		}
		if len(members) < 2 {
			writeErr(w, 400, "a chat session needs at least one friend")
			return
		}
	}
	if len(members) > maxSessionMembers {
		writeErr(w, 400, fmt.Sprintf("a session has up to %d people", maxSessionMembers))
		return
	}
	ids := make([]string, 0, len(members))
	for id := range members {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	now := time.Now().UTC().Truncate(time.Millisecond)
	se := &model.Session{ID: auth.NewID(12), Kind: kind, Title: title, Ask: ask, StarterID: me.ID, TargetKind: tkind, TargetID: tid,
		Members: ids, Entries: []model.SessionEntry{}, Status: model.SessionOpen, CreatedAt: now, UpdatedAt: now}
	if err := s.Store.InsertSession(ctx, se); err != nil {
		s.serverErr(w, r, err)
		return
	}
	name := shownName(*me)
	body := name + " started " + title
	if ask != "" {
		body += ": " + ask
	}
	for _, id := range ids {
		if id == me.ID {
			continue
		}
		n := model.Notification{UserID: id, Kind: model.NotifSessionInvite, SessionID: se.ID, Source: "session:" + se.ID,
			Title: name + " wants to make a Curio with you", Body: body}
		if tkind == "group" {
			n.GroupID = tid
		}
		s.notify(ctx, n)
	}
	v, err := s.sessionFor(r, se)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, v)
}

// canSeeSession: a chat session's members, or anyone in the session's Group.
func (s *Server) canSeeSession(r *http.Request, se *model.Session) bool {
	me := userFrom(r)
	if slices.Contains(se.Members, me.ID) {
		return true
	}
	return se.TargetKind == "group" && s.isMember(r.Context(), se.TargetID, me.ID)
}

func (s *Server) sessionOr404(w http.ResponseWriter, r *http.Request) (*model.Session, bool) {
	se, err := s.Store.SessionByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil || !s.canSeeSession(r, se) { // never reveal other people's sessions
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.serverErr(w, r, err)
		} else {
			writeErr(w, 404, "session not found")
		}
		return nil, false
	}
	return se, true
}

// settleSession follows the session's job: the game once it is done, or the failure. It reports whether it changed.
func (s *Server) settleSession(r *http.Request, se *model.Session) bool {
	if se.Status != model.SessionMaking || se.JobID == "" {
		return false
	}
	j, err := s.Store.JobByID(r.Context(), se.JobID)
	if err != nil {
		return false
	}
	switch {
	case j.Status == model.JobDone && j.GameID != "":
		se.Status, se.GameID, se.Error = model.SessionMade, j.GameID, ""
	case j.Status == model.JobDone || j.Status == model.JobFailed:
		se.Status, se.Error = model.SessionFailed, firstNonEmpty(j.Error, "the game wasn't made")
	default:
		return false
	}
	se.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	return true
}

// sessionFor is a session as the app shows it, after following its job.
func (s *Server) sessionFor(r *http.Request, se *model.Session) (sessionDoc, error) {
	ctx := r.Context()
	if s.settleSession(r, se) {
		if err := s.Store.ReplaceSession(ctx, se); err != nil {
			return sessionDoc{}, err
		}
	}
	cache := map[string]profile{}
	v := sessionDoc{ID: se.ID, Kind: se.Kind, Title: se.Title, Ask: se.Ask, Starter: s.displayName(ctx, se.StarterID, cache),
		Target: map[string]string{"kind": se.TargetKind, "id": se.TargetID}, Members: []profile{}, Entries: []sessionEntryView{},
		Status: se.Status, JobID: se.JobID, GameID: se.GameID, Error: se.Error, CreatedAt: se.CreatedAt, UpdatedAt: se.UpdatedAt}
	for _, id := range se.Members {
		v.Members = append(v.Members, s.displayName(ctx, id, cache))
	}
	for _, e := range se.Entries {
		v.Entries = append(v.Entries, sessionEntryView{ID: e.ID, Maker: s.displayName(ctx, e.MakerID, cache), Text: e.Text, At: e.At})
	}
	if se.GameID != "" {
		if g, err := s.Store.GameByID(ctx, se.GameID); err == nil {
			if views, err := s.views(r, []model.Game{*g}); err == nil && len(views) == 1 {
				v.Game = &views[0]
			}
		}
	}
	return v, nil
}

func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	se, ok := s.sessionOr404(w, r)
	if !ok {
		return
	}
	v, err := s.sessionFor(r, se)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	t := strings.TrimSpace(r.URL.Query().Get("target"))
	kind, id, _ := strings.Cut(t, ":")
	if (kind != "chat" && kind != "group") || id == "" {
		writeErr(w, 400, "target is chat:<id> or group:<id>")
		return
	}
	limit := limitParam(r, 20, 50)
	list, err := s.Store.SessionsForTarget(r.Context(), kind, id, limit*3)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := []sessionDoc{}
	for i := range list {
		se := &list[i]
		if !s.canSeeSession(r, se) {
			continue
		}
		v, err := s.sessionFor(r, se)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		if items = append(items, v); len(items) == limit {
			break
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) addSessionEntry(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &in) {
		return
	}
	text := strings.TrimSpace(in.Text)
	if text == "" || len([]rune(text)) > maxSessionEntryRunes {
		writeErr(w, 400, fmt.Sprintf("text must be 1 to %d characters", maxSessionEntryRunes))
		return
	}
	ctx, me := r.Context(), userFrom(r)
	unlock := s.seriesLocks.lock("session:" + chi.URLParam(r, "id")) // two entries can't overwrite each other
	defer unlock()
	se, ok := s.sessionOr404(w, r)
	if !ok {
		return
	}
	if se.Status != model.SessionOpen && se.Status != model.SessionFailed {
		writeErr(w, 409, "this game is already being made")
		return
	}
	if len(se.Entries) >= maxSessionEntries {
		writeErr(w, 409, fmt.Sprintf("this session is full (%d entries)", maxSessionEntries))
		return
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	se.Entries = append(se.Entries, model.SessionEntry{ID: auth.NewID(8), MakerID: me.ID, Text: text, At: now})
	if !slices.Contains(se.Members, me.ID) { // a Group member who wasn't in the first invite joins by adding
		se.Members = append(se.Members, me.ID)
	}
	se.UpdatedAt = now
	if err := s.Store.ReplaceSession(ctx, se); err != nil {
		s.serverErr(w, r, err)
		return
	}
	v, err := s.sessionFor(r, se)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}

// sessionRequest is the request and brief for the generator: the title, the ask and every entry with who wrote it.
func (s *Server) sessionRequest(r *http.Request, se *model.Session) (string, map[string]any) {
	cache := map[string]profile{}
	noun := sessionKinds[se.Kind]
	type line struct{ name, text string }
	var lines []line
	makers := []string{}
	seen := map[string]bool{}
	for _, e := range se.Entries {
		p := s.displayName(r.Context(), e.MakerID, cache)
		name := firstNonEmpty(p.DisplayName, firstNonEmpty(p.Username, "a friend"))
		lines = append(lines, line{name, e.Text})
		if !seen[name] {
			seen[name] = true
			makers = append(makers, name)
		}
	}
	head := fmt.Sprintf("Make %q, a game made together by friends (%s). Use every one of their %s below, credited to who wrote it.",
		se.Title, strings.Join(makers, ", "), noun)
	if se.Ask != "" {
		head += " The ask was: " + se.Ask + "."
	}
	var b strings.Builder
	b.WriteString(head)
	for _, l := range lines {
		b.WriteString("\n- " + l.name + ": " + l.text)
	}
	request := clipText(b.String(), maxRequestChars)

	contributions := make([]map[string]string, 0, len(lines))
	for _, l := range lines {
		contributions = append(contributions, map[string]string{"maker": l.name, "text": l.text})
	}
	brief := map[string]any{
		"intent": clipText(head, 400), "audience": "friends", "occasion": "made together",
		"together": map[string]any{"kind": se.Kind, "title": se.Title, "ask": se.Ask, "makers": makers, "contributions": contributions},
	}
	for { // keep the brief under the generator's limit: the newest entries go first (they are all in the request too)
		raw, _ := json.Marshal(brief)
		if len(raw) <= sessionBriefBytes || len(contributions) == 0 {
			break
		}
		contributions = contributions[:len(contributions)-1]
		brief["together"].(map[string]any)["contributions"] = contributions
	}
	return request, brief
}

func (s *Server) makeSession(w http.ResponseWriter, r *http.Request) {
	ctx, me := r.Context(), userFrom(r)
	unlock := s.seriesLocks.lock("session:" + chi.URLParam(r, "id"))
	defer unlock()
	se, ok := s.sessionOr404(w, r)
	if !ok {
		return
	}
	if se.StarterID != me.ID {
		writeErr(w, 403, "only the person who started it can make the game")
		return
	}
	if s.settleSession(r, se) {
		_ = s.Store.ReplaceSession(ctx, se)
	}
	switch se.Status {
	case model.SessionMaking:
		writeErr(w, 409, "the game is already being made")
		return
	case model.SessionMade:
		writeErr(w, 409, "the game is already made")
		return
	}
	if len(se.Entries) == 0 {
		writeErr(w, 409, "nobody has added anything yet")
		return
	}
	request, brief := s.sessionRequest(r, se)
	in := map[string]any{"request": request, "brief": brief}
	if se.TargetKind == "group" {
		in["groupId"] = se.TargetID
	}
	// The same path as POST /v1/generate: its checks, its limits, its job.
	body, _ := json.Marshal(in)
	sub, err := http.NewRequestWithContext(ctx, http.MethodPost, "/v1/generate", bytes.NewReader(body))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	sub.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.createJob(rec, sub)
	if rec.Code != http.StatusAccepted {
		for k, v := range rec.Header() {
			w.Header()[k] = v
		}
		w.WriteHeader(rec.Code)
		_, _ = w.Write(rec.Body.Bytes())
		return
	}
	var out struct {
		JobID string `json:"jobId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.JobID == "" {
		s.serverErr(w, r, fmt.Errorf("session make: no job id in %q", rec.Body.String()))
		return
	}
	se.Status, se.JobID, se.GameID, se.Error = model.SessionMaking, out.JobID, "", ""
	se.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	if err := s.Store.ReplaceSession(ctx, se); err != nil {
		s.serverErr(w, r, err)
		return
	}
	w.Header().Set("Location", "/v1/generate/"+out.JobID)
	writeJSON(w, 202, map[string]string{"jobId": out.JobID, "sessionId": se.ID})
}
