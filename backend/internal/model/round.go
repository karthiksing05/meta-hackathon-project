package model

import "time"

// Round is a same-seed round: one game, one seed, and a set of people who each play it when they like. The server
// keeps each person's replay-checked result and the result lines that a chat thread or a Group shows. There are no
// server chats, so the round is the thread.
type Round struct {
	ID         string                `bson:"_id" json:"id"`
	GameID     string                `bson:"gameId" json:"gameId"`
	CreatorID  string                `bson:"creatorId" json:"creatorId"`
	TargetKind string                `bson:"targetKind" json:"targetKind"` // chat or group
	TargetID   string                `bson:"targetId" json:"targetId"`
	Members    []string              `bson:"members" json:"members"` // user ids, the creator included
	Mode       string                `bson:"mode" json:"mode"`
	Seed       int64                 `bson:"seed" json:"seed"`                           // picked by the server
	LogSeed    string                `bson:"logSeed,omitempty" json:"logSeed,omitempty"` // the seed the engine ran on, set by the first run
	Length     int                   `bson:"length,omitempty" json:"length,omitempty"`   // seconds a run should take (the game's group_play.round_seconds)
	Plays      map[string]RoundEntry `bson:"plays" json:"plays"`                         // by user id
	Lines      []RoundLine           `bson:"lines" json:"lines"`
	WinnerID   string                `bson:"winnerId,omitempty" json:"winnerId,omitempty"`
	CreatedAt  time.Time             `bson:"createdAt" json:"createdAt"`
	ClosesAt   time.Time             `bson:"closesAt" json:"closesAt"`
	FinishedAt *time.Time            `bson:"finishedAt,omitempty" json:"finishedAt,omitempty"`
}

// RoundEntry is one person's checked run of a Round: what the replay computed, not what the phone claimed.
type RoundEntry struct {
	Score  int64          `bson:"score" json:"score"`
	TimeMs int64          `bson:"timeMs" json:"timeMs"`
	DNF    bool           `bson:"dnf,omitempty" json:"dnf,omitempty"`
	Result map[string]any `bson:"result,omitempty" json:"result,omitempty"` // the end state the game names in group_play.result.state
	At     time.Time      `bson:"at" json:"at"`
}

// RoundLine is one line the thread shows ("Ana: 1:02.4 on Toast Pong. Your turn.").
type RoundLine struct {
	UserID string    `bson:"userId" json:"userId"`
	Text   string    `bson:"text" json:"text"`
	At     time.Time `bson:"at" json:"at"`
}
