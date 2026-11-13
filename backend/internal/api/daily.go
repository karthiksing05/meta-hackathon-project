package api

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// A Group's Daily: one game the whole Group plays on a given day, so the board is fair.
//
//	POST /v1/groups/{id}/daily {gameId, date?}   the Group's owner sets the Daily for a date (default today, UTC);
//	                                             every other member gets a daily_ready notification
//	GET  /v1/groups/{id}/daily?date=             the Daily for that date, or the latest before it ({date, game, ...});
//	                                             404 when the Group has none yet
//
// Dates are the caller's calendar day (YYYY-MM-DD): the app sends its own, so "today" means today where the phone is.

var (
	groupIDRE = regexp.MustCompile(`^[a-z][a-z0-9-]{2,47}$`)
	dateRE    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// dailyDate reads a YYYY-MM-DD date, or today in UTC when it's empty.
func dailyDate(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Now().UTC().Format("2006-01-02"), true
	}
	if !dateRE.MatchString(s) {
		return "", false
	}
	if _, err := time.Parse("2006-01-02", s); err != nil {
		return "", false
	}
	return s, true
}

// isGroupOwner reports whether the person owns the Group (its creator, or a member with the owner role).
func (s *Server) isGroupOwner(r *http.Request, g *model.Group, userID string) bool {
	if g.OwnerID == userID {
		return true
	}
	ms, err := s.Store.GroupMembers(r.Context(), g.ID)
	if err != nil {
		return false
	}
	for _, m := range ms {
		if m.UserID == userID && m.Role == "owner" {
			return true
		}
	}
	return false
}

func (s *Server) dailyReply(w http.ResponseWriter, r *http.Request, code int, d *model.GroupDaily, g *model.Game, extra map[string]any) {
	views, err := s.views(r, []model.Game{*g})
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	out := map[string]any{"groupId": d.GroupID, "date": d.Date, "gameId": d.GameID, "setBy": d.SetBy, "createdAt": d.CreatedAt, "game": views[0]}
	for k, v := range extra {
		out[k] = v
	}
	writeJSON(w, code, out)
}

func (s *Server) getGroupDaily(w http.ResponseWriter, r *http.Request) {
	grp, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	me := userFrom(r)
	if grp.Private && (me == nil || !s.isMember(r.Context(), grp.ID, me.ID)) {
		writeErr(w, 404, "group not found")
		return
	}
	date, ok := dailyDate(r.URL.Query().Get("date"))
	if !ok {
		writeErr(w, 400, "date must be YYYY-MM-DD")
		return
	}
	d, err := s.Store.LatestGroupDaily(r.Context(), grp.ID, date)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "this Group has no Daily yet")
		return
	} else if err != nil {
		s.serverErr(w, r, err)
		return
	}
	g, err := s.Store.GameByID(r.Context(), d.GameID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "this Group has no Daily yet") // its game was deleted
		return
	} else if err != nil {
		s.serverErr(w, r, err)
		return
	}
	s.dailyReply(w, r, 200, d, g, map[string]any{"isToday": d.Date == date})
}

func (s *Server) setGroupDaily(w http.ResponseWriter, r *http.Request) {
	grp, ok := s.groupOr404(w, r)
	if !ok {
		return
	}
	var in struct {
		GameID string `json:"gameId"`
		Date   string `json:"date"`
	}
	if !decode(w, r, &in) {
		return
	}
	ctx, me := r.Context(), userFrom(r)
	if grp.Kind != "group" {
		writeErr(w, 422, "a Daily is for a Group, not an Event")
		return
	}
	if !s.isGroupOwner(r, grp, me.ID) {
		writeErr(w, 403, "only the Group's owner can set its Daily")
		return
	}
	date, ok := dailyDate(in.Date)
	if !ok {
		writeErr(w, 400, "date must be YYYY-MM-DD")
		return
	}
	g, err := s.roundGame(ctx, strings.TrimSpace(in.GameID))
	if err != nil || (g.Unlisted && g.OwnerID != me.ID) {
		writeErr(w, 404, "game not found")
		return
	}
	d := model.GroupDaily{GroupID: grp.ID, Date: date, GameID: g.ID, SetBy: me.ID, CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	if err := s.Store.PutGroupDaily(ctx, d); err != nil {
		s.serverErr(w, r, err)
		return
	}
	ms, err := s.Store.GroupMembers(ctx, grp.ID)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	if len(ms) > maxShareMembers {
		ms = ms[:maxShareMembers]
	}
	notified := 0
	for _, m := range ms {
		if m.UserID == me.ID {
			continue
		}
		// one per member, date and game: setting the same Daily again (a retry) notifies nobody twice
		s.notify(ctx, model.Notification{
			UserID: m.UserID, Kind: model.NotifDailyReady, GameID: g.ID, GroupID: grp.ID, Source: "daily:" + grp.ID + ":" + date + ":" + g.ID,
			Title: "Today's Daily in " + grp.Name + " is ready", Body: g.Title + ": everyone in the Group plays the same game today.",
		})
		notified++
	}
	s.dailyReply(w, r, 201, &d, g, map[string]any{"recipients": notified})
}
