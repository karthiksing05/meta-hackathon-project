package store

import (
	"context"
	"sort"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

const (
	cNotifications = "notifications"
	cPushDevices   = "pushdevices"
)

// NotifCursor is where the next page of a person's inbox starts: strictly after this row, newest first.
type NotifCursor struct {
	At time.Time
	ID string
}

func after(n model.Notification, c *NotifCursor) bool {
	if c == nil {
		return true
	}
	if !n.CreatedAt.Equal(c.At) {
		return n.CreatedAt.Before(c.At)
	}
	return n.ID < c.ID
}

// ---- memory ----

func (m *Memory) InsertNotification(ctx context.Context, n *model.Notification) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, o := range m.notifs {
		if o.UserID == n.UserID && o.Source == n.Source {
			return false, nil
		}
	}
	c := *n
	m.notifs[n.ID] = &c
	return true, nil
}

func (m *Memory) NotificationsFor(ctx context.Context, userID string, limit int, cur *NotifCursor) ([]model.Notification, error) {
	m.mu.Lock()
	var out []model.Notification
	for _, n := range m.notifs {
		if n.UserID == userID && after(*n, cur) {
			out = append(out, *n)
		}
	}
	m.mu.Unlock()
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.After(out[j].CreatedAt)
		}
		return out[i].ID > out[j].ID
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) CountUnreadNotifications(ctx context.Context, userID string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	for _, x := range m.notifs {
		if x.UserID == userID && x.ReadAt == nil {
			n++
		}
	}
	return n, nil
}

func (m *Memory) SetNotificationRead(ctx context.Context, userID, id string, read bool, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	n, ok := m.notifs[id]
	if !ok || n.UserID != userID {
		return ErrNotFound
	}
	if !read {
		n.ReadAt = nil
	} else if n.ReadAt == nil {
		t := now
		n.ReadAt = &t
	}
	return nil
}

func (m *Memory) MarkAllNotificationsRead(ctx context.Context, userID string, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, n := range m.notifs {
		if n.UserID == userID && n.ReadAt == nil {
			t := now
			n.ReadAt = &t
		}
	}
	return nil
}

func (m *Memory) PutPushDevice(ctx context.Context, d model.PushDevice) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.devices[d.InstallationID] = d
	return nil
}

func (m *Memory) DeletePushDevice(ctx context.Context, installationID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if d, ok := m.devices[installationID]; ok && (userID == "" || d.UserID == userID) {
		delete(m.devices, installationID)
	}
	return nil
}

func (m *Memory) DeletePushDevicesFor(ctx context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, d := range m.devices {
		if d.UserID == userID {
			delete(m.devices, id)
		}
	}
	return nil
}

func (m *Memory) PushDevicesFor(ctx context.Context, userID string) ([]model.PushDevice, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.PushDevice
	for _, d := range m.devices {
		if d.UserID == userID {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].InstallationID < out[j].InstallationID })
	return out, nil
}

func (m *Memory) DuePushes(ctx context.Context, now time.Time, limit int) ([]model.Notification, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []model.Notification
	for _, n := range m.notifs {
		if n.PushState == model.PushPending && !n.NextPushAt.After(now) {
			out = append(out, *n)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].NextPushAt.Before(out[j].NextPushAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) UpdatePush(ctx context.Context, id, state string, attempts int, next time.Time, errMsg string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	n, ok := m.notifs[id]
	if !ok {
		return ErrNotFound
	}
	n.PushState, n.PushAttempts, n.NextPushAt, n.PushError = state, attempts, next, errMsg
	return nil
}

// ---- mongo ----

// InsertNotification stores n unless the same (user, source) is already stored (a retried trigger).
// It's an upsert on (userId, source), so it stays idempotent even where the notif_user_source unique
// index hasn't been created yet (dbinit is a separate deploy step); the index still guards races.
func (m *Mongo) InsertNotification(ctx context.Context, n *model.Notification) (bool, error) {
	res, err := m.coll(cNotifications).UpdateOne(ctx,
		bson.M{"userId": n.UserID, "source": n.Source},
		bson.M{"$setOnInsert": n},
		options.UpdateOne().SetUpsert(true))
	if err != nil {
		if mapErr(err) == ErrConflict { // two inserts raced; the index kept one
			return false, nil
		}
		return false, err
	}
	return res.UpsertedCount == 1, nil
}

func (m *Mongo) NotificationsFor(ctx context.Context, userID string, limit int, cur *NotifCursor) ([]model.Notification, error) {
	filter := bson.D{{Key: "userId", Value: userID}}
	if cur != nil {
		filter = append(filter, bson.E{Key: "$or", Value: bson.A{
			bson.D{{Key: "createdAt", Value: bson.D{{Key: "$lt", Value: cur.At}}}},
			bson.D{{Key: "createdAt", Value: cur.At}, {Key: "_id", Value: bson.D{{Key: "$lt", Value: cur.ID}}}},
		}})
	}
	c, err := m.coll(cNotifications).Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Notification
	return out, c.All(ctx, &out)
}

func (m *Mongo) CountUnreadNotifications(ctx context.Context, userID string) (int64, error) {
	return m.coll(cNotifications).CountDocuments(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "readAt", Value: bson.D{{Key: "$exists", Value: false}}}})
}

func (m *Mongo) SetNotificationRead(ctx context.Context, userID, id string, read bool, now time.Time) error {
	filter := bson.D{{Key: "_id", Value: id}, {Key: "userId", Value: userID}}
	var update bson.D
	if read {
		// keep the first read time: only set it where it isn't set yet
		r, err := m.coll(cNotifications).UpdateOne(ctx, append(filter, bson.E{Key: "readAt", Value: bson.D{{Key: "$exists", Value: false}}}),
			bson.D{{Key: "$set", Value: bson.D{{Key: "readAt", Value: now}}}})
		if err != nil {
			return err
		}
		if r.MatchedCount == 0 { // already read, or not there
			n, err := m.coll(cNotifications).CountDocuments(ctx, filter)
			if err != nil {
				return err
			}
			if n == 0 {
				return ErrNotFound
			}
		}
		return nil
	}
	update = bson.D{{Key: "$unset", Value: bson.D{{Key: "readAt", Value: ""}}}}
	r, err := m.coll(cNotifications).UpdateOne(ctx, filter, update)
	if err != nil {
		return err
	}
	if r.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) MarkAllNotificationsRead(ctx context.Context, userID string, now time.Time) error {
	_, err := m.coll(cNotifications).UpdateMany(ctx,
		bson.D{{Key: "userId", Value: userID}, {Key: "readAt", Value: bson.D{{Key: "$exists", Value: false}}}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "readAt", Value: now}}}})
	return err
}

func (m *Mongo) PutPushDevice(ctx context.Context, d model.PushDevice) error {
	_, err := m.coll(cPushDevices).ReplaceOne(ctx, bson.D{{Key: "_id", Value: d.InstallationID}}, d, options.Replace().SetUpsert(true))
	return err
}

func (m *Mongo) DeletePushDevice(ctx context.Context, installationID, userID string) error {
	filter := bson.D{{Key: "_id", Value: installationID}}
	if userID != "" {
		filter = append(filter, bson.E{Key: "userId", Value: userID})
	}
	_, err := m.coll(cPushDevices).DeleteOne(ctx, filter)
	return err
}

func (m *Mongo) DeletePushDevicesFor(ctx context.Context, userID string) error {
	_, err := m.coll(cPushDevices).DeleteMany(ctx, bson.D{{Key: "userId", Value: userID}})
	return err
}

func (m *Mongo) PushDevicesFor(ctx context.Context, userID string) ([]model.PushDevice, error) {
	c, err := m.coll(cPushDevices).Find(ctx, bson.D{{Key: "userId", Value: userID}})
	if err != nil {
		return nil, err
	}
	var out []model.PushDevice
	return out, c.All(ctx, &out)
}

func (m *Mongo) DuePushes(ctx context.Context, now time.Time, limit int) ([]model.Notification, error) {
	c, err := m.coll(cNotifications).Find(ctx,
		bson.D{{Key: "pushState", Value: model.PushPending}, {Key: "nextPushAt", Value: bson.D{{Key: "$lte", Value: now}}}},
		options.Find().SetSort(bson.D{{Key: "nextPushAt", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []model.Notification
	return out, c.All(ctx, &out)
}

func (m *Mongo) UpdatePush(ctx context.Context, id, state string, attempts int, next time.Time, errMsg string) error {
	set := bson.D{{Key: "pushState", Value: state}, {Key: "pushAttempts", Value: attempts}, {Key: "nextPushAt", Value: next}}
	unset := bson.D{}
	if errMsg == "" {
		unset = append(unset, bson.E{Key: "pushError", Value: ""})
	} else {
		set = append(set, bson.E{Key: "pushError", Value: errMsg})
	}
	update := bson.D{{Key: "$set", Value: set}}
	if len(unset) > 0 {
		update = append(update, bson.E{Key: "$unset", Value: unset})
	}
	r, err := m.coll(cNotifications).UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, update)
	if err != nil {
		return err
	}
	if r.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}
