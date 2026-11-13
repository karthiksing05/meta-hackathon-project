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
	Bio          string    `bson:"bio,omitempty" json:"bio,omitempty"`
}

type RefreshToken struct {
	Hash      string    `bson:"_id"` // sha256 hex of the opaque token
	UserID    string    `bson:"userId"`
	ExpiresAt time.Time `bson:"expiresAt"` // TTL index removes expired rows
}

// Game is the stored metadata. Package files live in the PackageStore under StorageKey;
// only relative paths are stored, the public hostname is applied when responding.
type Game struct {
	ID            string      `bson:"_id"`
	OwnerID       string      `bson:"ownerId"`
	OwnerUsername string      `bson:"ownerUsername"`
	Title         string      `bson:"title"`
	Description   string      `bson:"description"`
	Tags          []string    `bson:"tags"`
	Formula       string      `bson:"formula"`
	StorageKey    string      `bson:"storageKey"`   // = game id; directory under published/
	ManifestPath  string      `bson:"manifestPath"` // relative to StorageKey
	CoverPath     string      `bson:"coverPath,omitempty"`
	HasSource     bool        `bson:"hasSource"`
	RemixOf       string      `bson:"remixOf,omitempty"`
	Slug          string      `bson:"slug,omitempty"` // the manifest's own id, unique when set; apps use it as a stable name
	GroupID       string      `bson:"groupId,omitempty"`
	EventID       string      `bson:"eventId,omitempty"`
	Mood          []string    `bson:"mood,omitempty"` // from the manifest's brief; what the recommender describes a game by
	Energy        string      `bson:"energy,omitempty"`
	Competition   string      `bson:"competition,omitempty"`
	Look          string      `bson:"look,omitempty"`
	Scope         string      `bson:"scope,omitempty"` // "everyone", "group" or "event"
	Level         int         `bson:"level,omitempty"` // position in a chain of levels (2 and up are later levels)
	IsDaily       bool        `bson:"isDaily,omitempty"`
	Bots          []BotRun    `bson:"bots,omitempty"` // the playtest bots' runs, for the recommender's quality prior
	Likes         int64       `bson:"likes"`          // "saves are the likes": one counter
	Plays         int64       `bson:"plays"`
	Finishes      int64       `bson:"finishes"`
	CreatedAt     time.Time   `bson:"createdAt"`
	Score         *ScoreModel `bson:"score,omitempty"`     // what the board ranks and how (nil: points, higher first)
	GroupPlay     *GroupPlay  `bson:"groupPlay,omitempty"` // how friends play it together (same seed, compare after)
	Sound         *GameSound  `bson:"sound,omitempty"`     // the sound that plays behind it
	Sponsor       *Sponsor    `bson:"sponsor,omitempty"`   // a brand's playable ad
	Unlisted      bool        `bson:"unlisted,omitempty"`  // a draft: reachable by id and in its owner's creations, but not in the feed, search or Group lists
}

type GameView struct {
	ID            string         `json:"id"`
	Slug          string         `json:"slug,omitempty"`
	GroupID       string         `json:"groupId,omitempty"`
	EventID       string         `json:"eventId,omitempty"`
	Title         string         `json:"title"`
	Description   string         `json:"description"`
	Tags          []string       `json:"tags"`
	Formula       string         `json:"formula"`
	OwnerID       string         `json:"ownerId"`
	OwnerUsername string         `json:"ownerUsername"`
	Likes         int64          `json:"likes"`
	Plays         int64          `json:"plays"`
	Finishes      int64          `json:"finishes"`
	LikedByMe     bool           `json:"likedByMe"`
	RemixOf       string         `json:"remixOf,omitempty"`
	PackageURL    string         `json:"packageUrl"`
	ManifestURL   string         `json:"manifestUrl"`
	CoverURL      string         `json:"coverUrl,omitempty"`
	Unlisted      bool           `json:"unlisted,omitempty"`
	Sponsor       *Sponsor       `json:"sponsor,omitempty"`
	GroupPlay     *GroupPlay     `json:"group_play,omitempty"`
	Sound         *GameSoundView `json:"sound,omitempty"`
	Score         *ScoreView     `json:"score,omitempty"`
	CreatedAt     time.Time      `json:"createdAt"`
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
	TimeMs    int64     `bson:"timeMs,omitempty" json:"timeMs,omitempty"` // the run's time, for games whose board reads it
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
	ID      string         `bson:"_id"`
	OwnerID string         `bson:"ownerId"`
	Request string         `bson:"request"`
	Brief   map[string]any `bson:"brief,omitempty"`
	// Context is what the harness worked out before the call (kinds of game, tools, plan). Only the server sets it,
	// never a client: it goes into the generator's system prompt.
	Context    map[string]any    `bson:"context,omitempty"`
	Spec       string            `bson:"spec,omitempty"`       // a game-spec/1 the person already agreed (JSON): the plan is not made again
	Answers    map[string]string `bson:"answers,omitempty"`    // the person's answers to the plan's clarifying questions, by slot
	Anatomy    string            `bson:"anatomy,omitempty"`    // the agreed game anatomy, kept apart from the 2,000 character request
	Sound      *GameSound        `bson:"sound,omitempty"`      // put behind the finished game
	Sponsor    *Sponsor          `bson:"sponsor,omitempty"`    // set on the finished game (brand accounts only)
	Draft      bool              `bson:"draft,omitempty"`      // the finished game starts unlisted
	BaseGameID string            `bson:"baseGameId,omitempty"` // set when the job changes an existing game (a tweak, a new look, a next level, a remix)
	NextLevel  bool              `bson:"nextLevel,omitempty"`
	Level      int               `bson:"level,omitempty"`
	Status     string            `bson:"status"`
	Events     []JobEvent        `bson:"events"`
	GameID     string            `bson:"gameId,omitempty"`
	Error      string            `bson:"error,omitempty"`
	Stats      map[string]any    `bson:"stats,omitempty"`
	CreatedAt  time.Time         `bson:"createdAt"`
	UpdatedAt  time.Time         `bson:"updatedAt"`
	FinishedAt *time.Time        `bson:"finishedAt,omitempty"`
}

// JobUpdate is what finishing a job records.
type JobUpdate struct {
	GameID string
	Error  string
	Stats  map[string]any
}

// BotRun is one playtest bot's run of a game: how skilled the bot is, what it scored, how long it played.
type BotRun struct {
	Skill float64 `bson:"skill" json:"skill"`
	Score int     `bson:"score" json:"score"`
	Sec   float64 `bson:"sec,omitempty" json:"sec,omitempty"`
}

// RecsRecord is one person's recommender state: the model (game-recs.js's own JSON, kept as text) and the
// pages the server has shown them in the current session.
type RecsRecord struct {
	UserID      string    `bson:"_id"`
	State       string    `bson:"state"`
	Feed        []string  `bson:"feed,omitempty"`
	FeedKeys    []string  `bson:"feedKeys,omitempty"`
	FeedSession string    `bson:"feedSession,omitempty"`
	FeedAt      time.Time `bson:"feedAt,omitempty"`
	UpdatedAt   time.Time `bson:"updatedAt"`
}

// Group is a Group or an Event: a set of people the games can be scoped to. Kind is "group" or "event".
type Group struct {
	ID        string    `bson:"_id" json:"id"`
	Kind      string    `bson:"kind" json:"kind"`
	Name      string    `bson:"name" json:"name"`
	Category  string    `bson:"category,omitempty" json:"category,omitempty"`
	About     string    `bson:"about,omitempty" json:"about,omitempty"`
	Private   bool      `bson:"private,omitempty" json:"private,omitempty"`
	CoverSeed string    `bson:"coverSeed,omitempty" json:"coverSeed,omitempty"`
	OwnerID   string    `bson:"ownerId,omitempty" json:"ownerId,omitempty"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
}

// GroupMember is one person in a Group or Event.
type GroupMember struct {
	GroupID  string    `bson:"groupId" json:"groupId"`
	UserID   string    `bson:"userId" json:"userId"`
	Role     string    `bson:"role,omitempty" json:"role,omitempty"` // "owner" or "" for a member
	JoinedAt time.Time `bson:"joinedAt" json:"joinedAt"`
}

// Challenge is "beat my score": one person sends a game to friends with their best score on it.
type Challenge struct {
	ID        string    `bson:"_id" json:"id"`
	GameID    string    `bson:"gameId" json:"gameId"`
	FromID    string    `bson:"fromId" json:"fromId"`
	FromName  string    `bson:"fromName" json:"fromName"`
	ToIDs     []string  `bson:"toIds" json:"toIds"`
	Score     int64     `bson:"score" json:"score"` // the sender's best on the game when they sent it (0 if none)
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
}
