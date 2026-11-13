package model

import "time"

// RunLog is the run behind a person's counted score on a game: what a friend or a Group-mate watches from the board.
// There is one per person and game, replaced whenever their board score changes. Replay is the runtime's replay log
// (`{seed, tick_rate, total_ticks, inputs, length?}`, what the player plays as a Burst); EngineLog is the engine's
// `microgame-log/1` the server replayed to count the score (empty for a game without a score model).
type RunLog struct {
	GameID    string    `bson:"gameId" json:"gameId"`
	UserID    string    `bson:"userId" json:"userId"`
	Username  string    `bson:"username" json:"username"`
	Score     int64     `bson:"score" json:"score"` // the board score this run set; a row offers it only while the two match
	Replay    string    `bson:"replay" json:"-"`
	EngineLog string    `bson:"engineLog,omitempty" json:"-"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}
