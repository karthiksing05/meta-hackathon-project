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
	UserByUsername(ctx context.Context, username string) (*model.User, error)
	UsersByIDs(ctx context.Context, ids []string) ([]model.User, error)
	// SearchUsers finds people whose username starts with q, or a word of whose display name does (q lowercase).
	SearchUsers(ctx context.Context, q string, limit int) ([]model.User, error)

	// Friendships are mutual: adding one adds both directions.
	AddFriend(ctx context.Context, a, b string) error
	RemoveFriend(ctx context.Context, a, b string) error
	Friends(ctx context.Context, userID string) ([]string, error)

	// Groups and Events.
	UpsertGroup(ctx context.Context, g *model.Group) error
	GroupByID(ctx context.Context, id string) (*model.Group, error)
	ListGroups(ctx context.Context, limit int) ([]model.Group, error)
	AddGroupMember(ctx context.Context, m model.GroupMember) error // idempotent
	RemoveGroupMember(ctx context.Context, groupID, userID string) error
	GroupMembers(ctx context.Context, groupID string) ([]model.GroupMember, error)
	GroupsOfUser(ctx context.Context, userID string) ([]model.Group, error)
	GamesByGroup(ctx context.Context, groupID string, limit int) ([]model.Game, error)

	// RecentScores returns the latest best scores set by the given people, newest first.
	RecentScores(ctx context.Context, userIDs []string, limit int) ([]model.Score, error)

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

	// Saves seen from the other side: the games a person saved (newest first) and the people who saved a game.
	LikedGameIDs(ctx context.Context, userID string, limit int) ([]string, error)
	GameLikers(ctx context.Context, gameID string, limit int) ([]string, error)

	// Challenges ("beat my score"): those a person sent or received, newest first.
	InsertChallenge(ctx context.Context, c *model.Challenge) error
	ChallengesFor(ctx context.Context, userID string, limit int) ([]model.Challenge, error)
	// MomentsWith returns off-feed moment events (events with a kind) that name userID in `with`, newest first.
	MomentsWith(ctx context.Context, userID string, limit int) ([]model.Event, error)

	// SetGameUnlisted lists a game (false) or makes it a draft (true); DeleteGame removes a game, its saves and its scores.
	SetGameUnlisted(ctx context.Context, gameID string, unlisted bool) error
	DeleteGame(ctx context.Context, gameID string) error

	// SetGameSponsor marks a game as a brand's ad, or takes the mark off (nil).
	SetGameSponsor(ctx context.Context, gameID string, sp *model.Sponsor) error

	// Sounds: loops that play behind games. Files are a published package; these keep the records, saves and use counts.
	InsertSound(ctx context.Context, s *model.Sound) error
	SoundByID(ctx context.Context, id string) (*model.Sound, error)
	SoundsByIDs(ctx context.Context, ids []string) ([]model.Sound, error)
	FindSounds(ctx context.Context, q SoundQuery) ([]model.Sound, error)
	SetSoundSaved(ctx context.Context, soundID, userID string, saved bool) (int64, error)
	SoundsSavedSet(ctx context.Context, userID string, ids []string) (map[string]bool, error)
	AddSoundUse(ctx context.Context, soundID string, delta int64) error
	SetGameSound(ctx context.Context, gameID string, gs *model.GameSound) error // nil takes the sound off
	GamesBySound(ctx context.Context, soundID, order string, limit int) ([]model.Game, error)

	// Rounds: a game, a seed and a set of people who each play it on their own time (chat or Group).
	InsertRound(ctx context.Context, r *model.Round) error
	RoundByID(ctx context.Context, id string) (*model.Round, error)
	ReplaceRound(ctx context.Context, r *model.Round) error
	RoundsForUser(ctx context.Context, userID string, limit int) ([]model.Round, error) // newest first
	RoundsForTarget(ctx context.Context, kind, id string, limit int) ([]model.Round, error)
	RoundsForGame(ctx context.Context, gameID string, limit int) ([]model.Round, error)

	// Series: best-of-N between two friends with server-checked scores.
	InsertSeries(ctx context.Context, s *model.Series) error
	SeriesByID(ctx context.Context, id string) (*model.Series, error)
	ReplaceSeries(ctx context.Context, s *model.Series) error
	SeriesForUser(ctx context.Context, userID string, limit int) ([]model.Series, error) // newest first

	GameStats(ctx context.Context, since time.Time) ([]model.GameStats, error)
	Interleave(ctx context.Context, since time.Time) (model.Interleave, error)
	ExportEvents(ctx context.Context, since time.Time, limit int) ([]model.Event, error) // oldest first

	SubmitScore(ctx context.Context, s model.Score) error // keeps the user's best (a plain game: points, higher first)
	// Board, ScoreOf and PutScore are for games with a score model: sorted by its direction and tie-break, one person's
	// score, and writing it as the API decided (best, latest, lower is better).
	Board(ctx context.Context, gameID string, limit int, order model.BoardOrder) ([]model.Score, error)
	ScoreOf(ctx context.Context, gameID, userID string) (*model.Score, error)
	PutScore(ctx context.Context, s model.Score) error
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
