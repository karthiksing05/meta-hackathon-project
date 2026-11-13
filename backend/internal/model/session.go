package model

import "time"

// Session states.
const (
	SessionOpen   = "open"   // taking entries
	SessionMaking = "making" // the starter asked Muse to make it; JobID is the job
	SessionMade   = "made"   // the game is out; GameID is it
	SessionFailed = "failed" // the job failed; the starter can make it again
)

// Session is a co-making session: someone asks a chat or a Group for questions, words, scenes or levels, the people
// there add entries, and the starter has Muse make one game from all of them.
type Session struct {
	ID         string         `bson:"_id"`
	Kind       string         `bson:"kind"` // question, words, scene or level
	Title      string         `bson:"title"`
	Ask        string         `bson:"ask"`
	StarterID  string         `bson:"starterId"`
	TargetKind string         `bson:"targetKind"` // chat or group
	TargetID   string         `bson:"targetId"`
	Members    []string       `bson:"members"` // user ids, the starter included
	Entries    []SessionEntry `bson:"entries"`
	Status     string         `bson:"status"`
	JobID      string         `bson:"jobId,omitempty"`
	GameID     string         `bson:"gameId,omitempty"`
	Error      string         `bson:"error,omitempty"` // why the last make failed
	CreatedAt  time.Time      `bson:"createdAt"`
	UpdatedAt  time.Time      `bson:"updatedAt"`
}

// SessionEntry is one person's addition to a Session.
type SessionEntry struct {
	ID      string    `bson:"id"`
	MakerID string    `bson:"makerId"`
	Text    string    `bson:"text"`
	At      time.Time `bson:"at"`
}
