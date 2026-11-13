package model

import "time"

// Series is a best-of-N between two friends on the same games and seeds, with scores the server has checked.
type Series struct {
	ID         string        `bson:"_id" json:"id"`
	PlayerA    string        `bson:"playerA" json:"playerA"` // who started it
	PlayerB    string        `bson:"playerB" json:"playerB"`
	Rounds     []SeriesRound `bson:"rounds" json:"rounds"`
	WinsNeeded int           `bson:"winsNeeded" json:"winsNeeded"`
	WinnerID   string        `bson:"winnerId,omitempty" json:"winnerId,omitempty"` // empty with FinishedAt set: a draw
	CreatedAt  time.Time     `bson:"createdAt" json:"createdAt"`
	FinishedAt *time.Time    `bson:"finishedAt,omitempty" json:"finishedAt,omitempty"`
}

type SeriesRound struct {
	N       int                  `bson:"n" json:"n"`
	GameID  string               `bson:"gameId" json:"gameId"`
	Seed    int64                `bson:"seed" json:"seed"`                           // picked by the server
	LogSeed string               `bson:"logSeed,omitempty" json:"logSeed,omitempty"` // the seed the engine ran on, set by the first run
	Plays   map[string]RoundPlay `bson:"plays" json:"plays"`                         // by user id
	Lower   bool                 `bson:"lower,omitempty" json:"lower,omitempty"`     // a smaller score wins (a time trial)
}

// RoundPlay is one person's checked run of a round: what the replay computed, not what the phone claimed.
type RoundPlay struct {
	Score  int64     `bson:"score" json:"score"`
	TimeMs int64     `bson:"timeMs" json:"timeMs"`
	DNF    bool      `bson:"dnf,omitempty" json:"dnf,omitempty"` // the run didn't finish, on a game where only finished runs count
	At     time.Time `bson:"at" json:"at"`
}
