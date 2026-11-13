package model

// GroupPlay is how a game is played together (the manifest's top-level `group_play`): friends each play the same
// single-player run on the same seed, and the results are compared afterwards. The server stores it as the game's
// own, so the app knows what "send this game" starts.
type GroupPlay struct {
	Mode         string          `bson:"mode" json:"mode"` // same_seed_async, series, group_round, weekly_board or opinion_compare
	Modes        []string        `bson:"modes,omitempty" json:"modes,omitempty"`
	RoundSeconds int             `bson:"roundSeconds,omitempty" json:"round_seconds,omitempty"`
	Result       GroupPlayResult `bson:"result" json:"result"`
	ShareLine    string          `bson:"shareLine,omitempty" json:"share_line,omitempty"`
	BestOf       int             `bson:"bestOf,omitempty" json:"best_of,omitempty"`
	SameSeed     bool            `bson:"sameSeed" json:"same_seed"`
}

// GroupPlayResult says what one run's result is and how two results compare.
type GroupPlayResult struct {
	Kind    string   `bson:"kind,omitempty" json:"kind,omitempty"`
	Compare string   `bson:"compare" json:"compare"` // score, ending, agreement or none
	Display string   `bson:"display,omitempty" json:"display,omitempty"`
	Endings []string `bson:"endings,omitempty" json:"endings,omitempty"` // best first, for compare "ending"
	State   []string `bson:"state,omitempty" json:"state,omitempty"`     // the end-state variables the replay reports
}
