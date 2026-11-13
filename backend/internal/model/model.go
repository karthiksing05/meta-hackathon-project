// Package model holds the stored and wire types shared by the store and the HTTP layer.
package model

import "time"

type User struct {
	ID           string    `bson:"_id" json:"id"`
	Email        string    `bson:"email" json:"email,omitempty"` // lowercased, unique
	Username     string    `bson:"username" json:"username"`     // lowercased, unique
	DisplayName  string    `bson:"displayName" json:"displayName"`
	PasswordHash string    `bson:"passwordHash" json:"-"`
	CreatedAt    time.Time `bson:"createdAt" json:"createdAt"`
}

type RefreshToken struct {
	Hash      string    `bson:"_id"` // sha256 hex of the opaque token
	UserID    string    `bson:"userId"`
	ExpiresAt time.Time `bson:"expiresAt"` // TTL index removes expired rows
}

// Game is the stored metadata. Package files live in the PackageStore under StorageKey;
// only relative paths are stored, the public hostname is applied when responding.
type Game struct {
	ID            string    `bson:"_id"`
	OwnerID       string    `bson:"ownerId"`
	OwnerUsername string    `bson:"ownerUsername"`
	Title         string    `bson:"title"`
	Description   string    `bson:"description"`
	Tags          []string  `bson:"tags"`
	Formula       string    `bson:"formula"`
	StorageKey    string    `bson:"storageKey"`   // = game id; directory under published/
	ManifestPath  string    `bson:"manifestPath"` // relative to StorageKey
	CoverPath     string    `bson:"coverPath,omitempty"`
	HasSource     bool      `bson:"hasSource"`
	RemixOf       string    `bson:"remixOf,omitempty"`
	Slug          string    `bson:"slug,omitempty"` // the manifest's own id, unique when set; apps use it as a stable name
	GroupID       string    `bson:"groupId,omitempty"`
	EventID       string    `bson:"eventId,omitempty"`
	Likes         int64     `bson:"likes"` // "saves are the likes": one counter
	Plays         int64     `bson:"plays"`
	Finishes      int64     `bson:"finishes"`
	CreatedAt     time.Time `bson:"createdAt"`
}

type GameView struct {
	ID            string    `json:"id"`
	Slug          string    `json:"slug,omitempty"`
	GroupID       string    `json:"groupId,omitempty"`
	EventID       string    `json:"eventId,omitempty"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	Tags          []string  `json:"tags"`
	Formula       string    `json:"formula"`
	OwnerID       string    `json:"ownerId"`
	OwnerUsername string    `json:"ownerUsername"`
	Likes         int64     `json:"likes"`
	Plays         int64     `json:"plays"`
	Finishes      int64     `json:"finishes"`
	LikedByMe     bool      `json:"likedByMe"`
	RemixOf       string    `json:"remixOf,omitempty"`
	PackageURL    string    `json:"packageUrl"`
	ManifestURL   string    `json:"manifestUrl"`
	CoverURL      string    `json:"coverUrl,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Event is one row of the feed event log. Three shapes share the collection:
//   - legacy: Type is one of EventTypes (view, play, finish, ...);
//   - page: a feed page the person saw, with the recommender's fields (no Type, no Kind);
//   - moment: an off-feed social moment, Kind is any short snake_case name.
//
// The derived flags (Impression, Satisfied, SocialMoment) are computed once at ingest so that
// per-game stats and the interleaving summary are plain sums.
type Event struct {
	ID            string `bson:"_id"`                     // actor + client event id when given, else random
	ClientEventID string `bson:"clientEventId,omitempty"` // the id the phone sent; resending it is a no-op
	Actor         string `bson:"actor"`                   // "u:<user id>" or "d:<device id>"
	UserID        string `bson:"userId,omitempty"`
	DeviceID      string `bson:"deviceId,omitempty"`
	ClientUserID  string `bson:"clientUserId,omitempty"` // stable id the client uses for the person (demo cast)

	GameID string  `bson:"gameId"` // as sent: a server id or a slug
	Type   string  `bson:"type,omitempty"`
	Kind   string  `bson:"kind,omitempty"`
	Value  float64 `bson:"value,omitempty"`

	SessionID  string   `bson:"sessionId,omitempty"`
	Day        *int     `bson:"day,omitempty"`
	FeedItemID string   `bson:"feedItemId,omitempty"`
	Position   *int     `bson:"position,omitempty"`
	Reason     string   `bson:"reason,omitempty"`
	Team       string   `bson:"team,omitempty"` // "A" (the formula) or "B" (the control) for interleaving
	RankScore  *float64 `bson:"rankScore,omitempty"`
	Propensity *float64 `bson:"propensity,omitempty"`

	DwellSec     float64  `bson:"dwellSec,omitempty"`
	TookOver     bool     `bson:"tookOver,omitempty"`
	RunsFinished int      `bson:"runsFinished,omitempty"`
	Replays      int      `bson:"replays,omitempty"`
	Saved        bool     `bson:"saved,omitempty"`
	Liked        bool     `bson:"liked,omitempty"`
	Floated      bool     `bson:"floated,omitempty"`
	OpenedBoard  bool     `bson:"openedBoard,omitempty"`
	AddedFriend  bool     `bson:"addedFriend,omitempty"`
	Remixed      bool     `bson:"remixed,omitempty"`
	QuitMidRun   bool     `bson:"quitMidRun,omitempty"`
	EndedSession bool     `bson:"endedSession,omitempty"`
	Social       []string `bson:"social,omitempty"`
	With         []string `bson:"with,omitempty"`

	Impression   bool `bson:"impression,omitempty"`
	Satisfied    bool `bson:"satisfied,omitempty"` // counted in per-game stats: the phone's own flag if it sent one
	Credit       bool `bson:"credit,omitempty"`    // a satisfying page for interleaving: finish, replay, save or social moment
	SocialMoment bool `bson:"socialMoment,omitempty"`

	CreatedAt time.Time `bson:"createdAt"`
}

var EventTypes = map[string]bool{
	"view": true, "play": true, "finish": true, "quit": true, "skip": true,
	"replay": true, "like": true, "unlike": true, "share": true, "remix": true,
}

// GameStats is a per-game roll-up of the event log. Key is the game id exactly as events logged it.
type GameStats struct {
	Key           string
	Impressions   int64
	Takeovers     int64
	Finishes      int64
	Satisfied     int64
	Replays       int64
	SocialMoments int64
}

// Interleave summarises team-draft interleaving over every session that carried a team: a
// session goes to the side whose pages earned more credit (finish, replay, save, social moment).
type Interleave struct {
	Sessions    int64 `json:"sessions"`
	FormulaWins int64 `json:"formulaWins"`
	ControlWins int64 `json:"controlWins"`
	Ties        int64 `json:"ties"`
}

type Score struct {
	GameID    string    `bson:"gameId" json:"-"`
	UserID    string    `bson:"userId" json:"userId"`
	Username  string    `bson:"username" json:"username"`
	Score     int64     `bson:"score" json:"score"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Job statuses for game generation.
const (
	JobQueued  = "queued"
	JobRunning = "running"
	JobDone    = "done"
	JobFailed  = "failed"
)

// JobEvent is one step of a generation job, as the generator reported it. Summary is a short
// human-readable line for "Muse at work" screens; Detail holds the rest (issues, round, headline).
type JobEvent struct {
	Seq     int            `bson:"seq" json:"seq"`
	Kind    string         `bson:"kind" json:"kind"`
	Summary string         `bson:"summary" json:"summary"`
	At      time.Time      `bson:"at" json:"at"`
	Detail  map[string]any `bson:"detail,omitempty" json:"-"`
}

// Job is one request to make a game. The app creates it, then polls it.
type Job struct {
	ID         string         `bson:"_id"`
	OwnerID    string         `bson:"ownerId"`
	Request    string         `bson:"request"`
	Brief      map[string]any `bson:"brief,omitempty"`
	Status     string         `bson:"status"`
	Events     []JobEvent     `bson:"events"`
	GameID     string         `bson:"gameId,omitempty"`
	Error      string         `bson:"error,omitempty"`
	Stats      map[string]any `bson:"stats,omitempty"`
	CreatedAt  time.Time      `bson:"createdAt"`
	UpdatedAt  time.Time      `bson:"updatedAt"`
	FinishedAt *time.Time     `bson:"finishedAt,omitempty"`
}

// JobUpdate is what finishing a job records.
type JobUpdate struct {
	GameID string
	Error  string
	Stats  map[string]any
}
