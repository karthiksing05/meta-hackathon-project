package model

// ScoreModel says what a game's board ranks and how (authoring/SPEC.md 2.13). It comes from the top-level `score`
// of manifest.json. A game without one ranks points, higher first, best run, every run counting.
type ScoreModel struct {
	Kind       string       `bson:"kind"`
	Measures   string       `bson:"measures,omitempty"`
	Unit       string       `bson:"unit,omitempty"`
	Direction  string       `bson:"direction"`  // higher or lower
	CountsWhen string       `bson:"countsWhen"` // any or finished
	Aggregate  string       `bson:"aggregate"`  // best, latest or sum_week (sum_week ranks as best for now)
	TieBreak   string       `bson:"tieBreak"`   // "less time" or "earlier"
	Format     string       `bson:"format"`     // "{n} orders", "{n}%", "m:ss.t", "m:ss", "s.t" (times are milliseconds)
	Source     string       `bson:"source,omitempty"`
	Bounds     *ScoreBounds `bson:"bounds,omitempty"`
	Unranked   bool         `bson:"unranked,omitempty"` // the score check could not vouch for the score: the board is just a list
}

// ScoreBounds are what the bots reached, plus headroom. A score outside them is refused before it is checked.
type ScoreBounds struct {
	Min         *int64  `bson:"min,omitempty" json:"min,omitempty"`
	Max         *int64  `bson:"max,omitempty" json:"max,omitempty"`
	MaxRatePerS float64 `bson:"maxRatePerS,omitempty" json:"maxRatePerS,omitempty"`
}

// Lower reports whether a smaller score is better.
func (s *ScoreModel) Lower() bool { return s != nil && s.Direction == "lower" }

// Ranked reports whether the board ranks people (a game without a model does).
func (s *ScoreModel) Ranked() bool { return s == nil || !s.Unranked }

// FinishedOnly reports whether only won runs go on the board.
func (s *ScoreModel) FinishedOnly() bool { return s != nil && s.CountsWhen == "finished" }

// ScoreView is the score model as the app sees it.
type ScoreView struct {
	Kind       string       `json:"kind"`
	Measures   string       `json:"measures,omitempty"`
	Unit       string       `json:"unit,omitempty"`
	Direction  string       `json:"direction"`
	CountsWhen string       `json:"countsWhen"`
	Aggregate  string       `json:"aggregate"`
	TieBreak   string       `json:"tieBreak"`
	Format     string       `json:"format"`
	Bounds     *ScoreBounds `json:"bounds,omitempty"`
	Ranked     bool         `json:"ranked"`
}

// View is the model's public form, or nil for a game without one.
func (s *ScoreModel) View() *ScoreView {
	if s == nil {
		return nil
	}
	return &ScoreView{Kind: s.Kind, Measures: s.Measures, Unit: s.Unit, Direction: s.Direction, CountsWhen: s.CountsWhen,
		Aggregate: s.Aggregate, TieBreak: s.TieBreak, Format: s.Format, Bounds: s.Bounds, Ranked: s.Ranked()}
}

// BoardOrder is how a board is sorted: best first, then the tie-break.
type BoardOrder struct {
	Lower     bool // a smaller score is better
	TieByTime bool // equal scores: the shorter run first (otherwise the earlier one)
	Recent    bool // an unranked board: the newest first
}

// OrderOf is the board order for a game.
func OrderOf(s *ScoreModel) BoardOrder {
	if s == nil {
		return BoardOrder{}
	}
	return BoardOrder{Lower: s.Lower(), TieByTime: s.TieBreak == "less time", Recent: s.Unranked}
}
