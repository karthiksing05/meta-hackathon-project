package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Notifications: an inbox per person, which is also the push outbox, and the triggers that fill it.
//
//	GET  /v1/me/notifications?limit=&cursor=      -> {items:[{id,kind,title,body,gameId?,groupId?,challengeId?,seriesId?,roundId?,sessionId?,createdAt,readAt?}], nextCursor?, unreadCount}
//	PUT  /v1/me/notifications/{id}/read {read}    (read defaults to true)    -> {unreadCount}
//	PUT  /v1/me/notifications/read                mark everything read       -> {unreadCount}
//	PUT  /v1/me/push-devices/{installationId} {token, environment: sandbox|production}
//	DELETE /v1/me/push-devices/{installationId}
//	POST /v1/groups/{id}/game-shares {gameId, eventId}   a member shares a game into the Group; retry-safe on eventId
//
// Kinds: group_game (a Group post), friend_challenge (a challenge or a series), leaderboard_lost (first place taken),
// viral_match (a game many people play that fits your taste), session_invite (make a game together: sessions.go),
// round_started and round_played (a same-seed round you are in: rounds.go). A (person, source) pair makes one row at most, so a retried
// trigger never notifies twice. The inbox works with no push configured; pushes go out only when APNs is set up
// (APNS_* in api.env) and the person has a registered device.
const (
	maxNotifPage      = 50
	maxShareMembers   = 500
	pushLease         = 2 * time.Minute
	pushMaxAttempts   = 6
	pushBatch         = 50
	pushPollInterval  = 5 * time.Second
	maxNotifTextRunes = 180
)

var (
	installationRE = regexp.MustCompile(`^[A-Za-z0-9._-]{8,80}$`)
	deviceTokenRE  = regexp.MustCompile(`^[0-9a-fA-F]{32,200}$`)
	shareEventRE   = regexp.MustCompile(`^[A-Za-z0-9._:-]{4,100}$`)
)

// PushSender delivers one payload to one device (internal/apns.Client). A nil sender turns pushes off.
type PushSender interface {
	Send(ctx context.Context, env, token string, payload []byte) error
}

// PushError is a failed push, as the sender reports it.
type PushError interface {
	error
	BadToken() bool
	Retryable() bool
}

// notify stores one notification and queues its push. It never fails the request that caused it: an error is logged.
func (s *Server) notify(ctx context.Context, n model.Notification) {
	ctx = context.WithoutCancel(ctx)
	n.ID, n.CreatedAt = auth.NewID(12), time.Now().UTC().Truncate(time.Millisecond)
	n.Title, n.Body = clipText(n.Title, maxNotifTextRunes), clipText(n.Body, maxNotifTextRunes)
	if s.Push != nil {
		if ds, err := s.Store.PushDevicesFor(ctx, n.UserID); err == nil && len(ds) > 0 {
			n.PushState, n.NextPushAt = model.PushPending, n.CreatedAt
		}
	}
	created, err := s.Store.InsertNotification(ctx, &n)
	if err != nil {
		s.Log.Error("notify: could not store a notification", "kind", n.Kind, "err", err)
		return
	}
	if created && n.PushState == model.PushPending {
		s.wakePush()
	}
}

func (s *Server) wakePush() {
	select {
	case s.pushWake <- struct{}{}:
	default:
	}
}

type notifView struct {
	model.Notification
}

func encodeCursor(n model.Notification) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(n.CreatedAt.UnixNano(), 10) + "|" + n.ID))
}

func decodeCursor(c string) (*store.NotifCursor, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return nil, false
	}
	ns, id, ok := strings.Cut(string(raw), "|")
	if !ok || id == "" {
		return nil, false
	}
	n, err := strconv.ParseInt(ns, 10, 64)
	if err != nil {
		return nil, false
	}
	return &store.NotifCursor{At: time.Unix(0, n).UTC(), ID: id}, true
}

func (s *Server) listNotifications(w http.ResponseWriter, r *http.Request) {
	ctx, me := r.Context(), userFrom(r)
	limit := limitParam(r, 20, maxNotifPage)
	var cur *store.NotifCursor
	if c := r.URL.Query().Get("cursor"); c != "" {
		var ok bool
		if cur, ok = decodeCursor(c); !ok {
			writeErr(w, 400, "invalid cursor")
			return
		}
	}
	rows, err := s.Store.NotificationsFor(ctx, me.ID, limit+1, cur)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	out := map[string]any{}
	if len(rows) > limit {
		rows = rows[:limit]
		out["nextCursor"] = encodeCursor(rows[len(rows)-1])
	}
	unread, err := s.Store.CountUnreadNotifications(ctx, me.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if rows == nil {
		rows = []model.Notification{}
	}
	out["items"], out["unreadCount"] = rows, unread
	writeJSON(w, 200, out)
}

func (s *Server) unreadReply(w http.ResponseWriter, r *http.Request) {
	n, err := s.Store.CountUnreadNotifications(r.Context(), userFrom(r).ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"unreadCount": n})
}

func (s *Server) readNotification(w http.ResponseWriter, r *http.Request) {
	read := true
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
	if len(strings.TrimSpace(string(body))) > 0 {
		var in struct {
			Read *bool `json:"read"`
		}
		if json.Unmarshal(body, &in) != nil {
			writeErr(w, 400, "invalid JSON body")
			return
		}
		if in.Read != nil {
			read = *in.Read
		}
	}
	err := s.Store.SetNotificationRead(r.Context(), userFrom(r).ID, chi.URLParam(r, "id"), read, time.Now().UTC().Truncate(time.Millisecond))
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, 404, "notification not found")
	case err != nil:
		s.serverErr(w, r, err)
	default:
		s.unreadReply(w, r)
	}
}

func (s *Server) readAllNotifications(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.MarkAllNotificationsRead(r.Context(), userFrom(r).ID, time.Now().UTC().Truncate(time.Millisecond)); err != nil {
		s.serverErr(w, r, err)
		return
	}
	s.unreadReply(w, r)
}

func (s *Server) putPushDevice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "installationId")
	if !installationRE.MatchString(id) {
		writeErr(w, 400, "installationId must be 8 to 80 letters, digits, dots, dashes or underscores")
		return
	}
	var in struct {
		Token       string `json:"token"`
		Environment string `json:"environment"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Token, in.Environment = strings.TrimSpace(in.Token), strings.ToLower(strings.TrimSpace(in.Environment))
	if !deviceTokenRE.MatchString(in.Token) {
		writeErr(w, 400, "token must be the device's push token, as hex")
		return
	}
	if in.Environment != "sandbox" && in.Environment != "production" {
		writeErr(w, 400, "environment must be sandbox or production")
		return
	}
	d := model.PushDevice{InstallationID: id, UserID: userFrom(r).ID, Token: strings.ToLower(in.Token), Environment: in.Environment,
		UpdatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	if err := s.Store.PutPushDevice(r.Context(), d); err != nil { // an installation moves to the account that registered it last
		s.serverErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deletePushDevice(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeletePushDevice(r.Context(), chi.URLParam(r, "installationId"), userFrom(r).ID); err != nil {
		s.serverErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- triggers ----

func shownName(u model.User) string {
	return firstNonEmpty(strings.TrimSpace(u.DisplayName), u.Username)
}

// POST /v1/groups/{id}/game-shares: a member shares a game into the Group; everyone else in it is notified once. The
// eventId is the post's stable id: sending it again (a retry) changes nothing.
func (s *Server) shareGameToGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GameID  string `json:"gameId"`
		EventID string `json:"eventId"`
	}
	if !decode(w, r, &in) {
		return
	}
	ctx, me := r.Context(), userFrom(r)
	gid := chi.URLParam(r, "id")
	grp, err := s.Store.GroupByID(ctx, gid)
	if err != nil || grp.Kind != "group" {
		writeErr(w, 404, "Group not found")
		return
	}
	if !s.isMember(ctx, gid, me.ID) {
		writeErr(w, 403, "you are not in that Group")
		return
	}
	in.EventID = strings.TrimSpace(in.EventID)
	if !shareEventRE.MatchString(in.EventID) {
		writeErr(w, 400, "eventId is the post's stable id (4 to 100 letters, digits, dots, colons, dashes or underscores)")
		return
	}
	g, err := s.roundGame(ctx, strings.TrimSpace(in.GameID))
	if err != nil {
		writeErr(w, 404, "game not found")
		return
	}
	if g.Unlisted && g.OwnerID != me.ID {
		writeErr(w, 404, "game not found")
		return
	}
	ms, err := s.Store.GroupMembers(ctx, gid)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if len(ms) > maxShareMembers {
		ms = ms[:maxShareMembers]
	}
	name := shownName(*me)
	notified := 0
	for _, m := range ms {
		if m.UserID == me.ID {
			continue
		}
		s.notify(ctx, model.Notification{
			UserID: m.UserID, Kind: model.NotifGroupGame, GameID: g.ID, GroupID: gid, Source: "group_game:" + gid + ":" + in.EventID,
			Title: grp.Name, Body: name + " shared " + g.Title,
		})
		notified++
	}
	writeJSON(w, 200, map[string]any{"groupId": gid, "gameId": g.ID, "eventId": in.EventID, "recipients": notified})
}

// notifyChallenge tells each friend they were challenged.
func (s *Server) notifyChallenge(ctx context.Context, c *model.Challenge, g *model.Game, from model.User) {
	name := shownName(from)
	body := "Can you beat " + name + " at " + g.Title + "?"
	if c.Score > 0 {
		body = "Beat " + displayScore(g, c.Score) + " on " + g.Title
	}
	for _, id := range c.ToIDs {
		s.notify(ctx, model.Notification{
			UserID: id, Kind: model.NotifFriendChallenge, GameID: g.ID, ChallengeID: c.ID, Source: "challenge:" + c.ID,
			Title: name + " challenged you", Body: body,
		})
	}
}

// notifySeries tells a friend a best-of was started with them.
func (s *Server) notifySeries(ctx context.Context, se *model.Series, first *model.Game, from model.User) {
	name := shownName(from)
	s.notify(ctx, model.Notification{
		UserID: se.PlayerB, Kind: model.NotifFriendChallenge, GameID: first.ID, SeriesID: se.ID, Source: "series:" + se.ID,
		Title: name + " wants a best-of with you", Body: seriesBody(len(se.Rounds), first.Title),
	})
}

// leader is the person in first place on a game's board.
func (s *Server) leader(ctx context.Context, g *model.Game) *model.Score {
	rows, err := s.Store.Board(ctx, g.ID, 1, model.OrderOf(g.Score))
	if err != nil || len(rows) == 0 {
		return nil
	}
	return &rows[0]
}

// watchLeader runs a score write and tells the former first place if the write took it. Writes on one game are serialized
// so two scores arriving together can't hide a change of leader. Unranked boards have no first place.
func (s *Server) watchLeader(ctx context.Context, g *model.Game, write func() error) error {
	if g == nil || !g.Score.Ranked() {
		return write()
	}
	unlock := s.leaderLocks.lock(g.ID)
	defer unlock()
	before := s.leader(ctx, g)
	if err := write(); err != nil {
		return err
	}
	after := s.leader(ctx, g)
	if before == nil || after == nil || before.UserID == after.UserID {
		return nil
	}
	taker := firstNonEmpty(after.Username, "someone")
	if u, err := s.Store.UserByID(ctx, after.UserID); err == nil {
		taker = shownName(*u)
	}
	s.notify(ctx, model.Notification{
		UserID: before.UserID, Kind: model.NotifLeaderboardLost, GameID: g.ID,
		Source: fmt.Sprintf("lost:%s:%s:%s:%d", g.ID, before.UserID, after.UserID, after.UpdatedAt.UnixNano()),
		Title:  taker + " took first place", Body: taker + " beat your score on " + g.Title + ": " + displayScore(g, after.Score),
	})
	return nil
}

// ---- push delivery ----

func pushPayload(n model.Notification) []byte {
	p := map[string]any{
		"aps":            map[string]any{"alert": map[string]string{"title": n.Title, "body": n.Body}, "sound": "default", "thread-id": n.Kind},
		"notificationId": n.ID, "kind": n.Kind,
	}
	for k, v := range map[string]string{"gameId": n.GameID, "groupId": n.GroupID, "challengeId": n.ChallengeID, "seriesId": n.SeriesID,
		"roundId": n.RoundID, "sessionId": n.SessionID} {
		if v != "" {
			p[k] = v
		}
	}
	b, _ := json.Marshal(p)
	return b
}

func pushBackoff(attempt int) time.Duration {
	d := 30 * time.Second << min(attempt, 8)
	return min(d, 30*time.Minute)
}

// RunPush delivers due pushes until ctx ends. It wakes when a notification is queued and polls for retries.
func (s *Server) RunPush(ctx context.Context) {
	if s.Push == nil {
		return
	}
	t := time.NewTicker(pushPollInterval)
	defer t.Stop()
	for {
		s.deliverDue(ctx)
		select {
		case <-ctx.Done():
			return
		case <-s.pushWake:
		case <-t.C:
		}
	}
}

// deliverDue sends the pushes that are due. A notification is leased before it is sent, so a crash or a second server
// can't send it twice; a transient failure is retried with a growing delay, and a refused token drops the device.
func (s *Server) deliverDue(ctx context.Context) {
	now := time.Now().UTC()
	due, err := s.Store.DuePushes(ctx, now, pushBatch)
	if err != nil {
		s.Log.Error("push: could not read the outbox", "err", err)
		return
	}
	for _, n := range due {
		if ctx.Err() != nil {
			return
		}
		attempts := n.PushAttempts + 1
		if err := s.Store.UpdatePush(ctx, n.ID, model.PushPending, attempts, now.Add(pushLease), n.PushError); err != nil {
			continue
		}
		state, next, msg := s.pushOne(ctx, n, attempts)
		if err := s.Store.UpdatePush(ctx, n.ID, state, attempts, next, msg); err != nil {
			s.Log.Error("push: could not record a result", "err", err)
		}
	}
}

func (s *Server) pushOne(ctx context.Context, n model.Notification, attempts int) (state string, next time.Time, msg string) {
	devices, err := s.Store.PushDevicesFor(ctx, n.UserID)
	if err != nil {
		return model.PushPending, time.Now().Add(pushBackoff(attempts)), "could not read devices"
	}
	if len(devices) == 0 {
		return model.PushNone, time.Time{}, ""
	}
	payload := pushPayload(n)
	sent, retry := 0, false
	lastErr := ""
	for _, d := range devices {
		err := s.Push.Send(ctx, d.Environment, d.Token, payload)
		if err == nil {
			sent++
			continue
		}
		var pe PushError
		switch {
		case errors.As(err, &pe) && pe.BadToken():
			_ = s.Store.DeletePushDevice(ctx, d.InstallationID, "") // the token is dead: forget the device
			lastErr = "device token refused"
		case errors.As(err, &pe) && !pe.Retryable():
			lastErr = pe.Error()
		default:
			retry, lastErr = true, "push failed, will retry"
		}
	}
	switch {
	case sent > 0:
		return model.PushSent, time.Time{}, ""
	case retry && attempts < pushMaxAttempts:
		return model.PushPending, time.Now().Add(pushBackoff(attempts)), lastErr
	default:
		return model.PushFailed, time.Time{}, lastErr
	}
}

// seriesBody: "1 game: Ferry Words" or "5 games, starting with Ferry Words".
func seriesBody(n int, first string) string {
	if n == 1 {
		return "1 game: " + first
	}
	return fmt.Sprintf("%d games, starting with %s", n, first)
}
