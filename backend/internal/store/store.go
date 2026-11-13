// Package store defines the persistence interface and its implementations
// (MongoDB for production, in-memory for local development and tests).
package store

import (
	"context"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("already exists")
)

type Store interface {
	Ping(ctx context.Context) error

	CreateUser(ctx context.Context, u *model.User) error // ErrConflict on duplicate email or username
	UserByEmail(ctx context.Context, email string) (*model.User, error)
	UserByID(ctx context.Context, id string) (*model.User, error)

	PutRefresh(ctx context.Context, t model.RefreshToken) error
	TakeRefresh(ctx context.Context, hash string) (*model.RefreshToken, error) // single use
	DeleteRefresh(ctx context.Context, hash string) error

	InsertGame(ctx context.Context, g *model.Game) error
	GameByID(ctx context.Context, id string) (*model.Game, error)
	GameBySlug(ctx context.Context, slug string) (*model.Game, error)
	AllGames(ctx context.Context, limit int) ([]model.Game, error) // newest first
	GamesByOwner(ctx context.Context, ownerID string, limit int, cursor Cursor) ([]model.Game, error)
	Feed(ctx context.Context, limit int, cursor Cursor) ([]model.Game, error)
	Search(ctx context.Context, q, tag string, limit, offset int) ([]model.Game, error)

	// SetLike adds or removes a like (a save). It returns the new like count.
	SetLike(ctx context.Context, gameID, userID string, liked bool) (int64, error)
	LikedSet(ctx context.Context, userID string, gameIDs []string) (map[string]bool, error)

	// AddEvents stores events and returns the ones that were new. Events whose id was already stored
	// (a phone resending a batch) are skipped and do not count twice.
	AddEvents(ctx context.Context, evs []model.Event) ([]model.Event, error)

	// Recommender state, one record per person.
	GetRecs(ctx context.Context, userID string) (*model.RecsRecord, error)
	PutRecs(ctx context.Context, r *model.RecsRecord) error
	// Game generation jobs.
	InsertJob(ctx context.Context, j *model.Job) error
	JobByID(ctx context.Context, id string) (*model.Job, error)
	JobsByOwner(ctx context.Context, ownerID string, limit int) ([]model.Job, error) // newest first
	CountJobsSince(ctx context.Context, ownerID string, since time.Time) (int, error)
	HasActiveJob(ctx context.Context, ownerID string) (bool, error)
	AppendJobEvent(ctx context.Context, id string, e model.JobEvent) error
	SetJobStatus(ctx context.Context, id, status string, u model.JobUpdate) error
	FailStaleJobs(ctx context.Context, reason string) (int, error) // queued or running jobs left by a restart

	GameStats(ctx context.Context, since time.Time) ([]model.GameStats, error)
	Interleave(ctx context.Context, since time.Time) (model.Interleave, error)
	ExportEvents(ctx context.Context, since time.Time, limit int) ([]model.Event, error) // oldest first

	SubmitScore(ctx context.Context, s model.Score) error // keeps the user's best
	Leaderboard(ctx context.Context, gameID string, limit int) ([]model.Score, error)
}

// LooksLikeID reports whether a game key has the shape of a server-generated id (24 lowercase hex).
func LooksLikeID(s string) bool {
	if len(s) != 24 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// Cursor is a keyset position in a createdAt-descending list.
type Cursor struct {
	At time.Time
	ID string
}

func (c Cursor) IsZero() bool { return c.ID == "" }

func (c Cursor) Encode() string {
	if c.IsZero() {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(c.At.UnixMilli(), 10) + ":" + c.ID))
}

func DecodeCursor(s string) (Cursor, error) {
	if s == "" {
		return Cursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return Cursor{}, errors.New("bad cursor")
	}
	ms, id, ok := strings.Cut(string(raw), ":")
	n, perr := strconv.ParseInt(ms, 10, 64)
	if !ok || perr != nil || id == "" {
		return Cursor{}, errors.New("bad cursor")
	}
	return Cursor{At: time.UnixMilli(n).UTC(), ID: id}, nil
}

// Before reports whether (at,id) sorts after the cursor in createdAt-desc, id-desc order.
func (c Cursor) allows(at time.Time, id string) bool {
	if c.IsZero() {
		return true
	}
	return at.Before(c.At) || (at.Equal(c.At) && id < c.ID)
}
