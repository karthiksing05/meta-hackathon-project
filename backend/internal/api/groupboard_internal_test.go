package api

import (
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func TestIsoWeekStart(t *testing.T) {
	for _, c := range []struct {
		year, week int
		want       string
	}{
		{2026, 46, "2026-11-09"}, {2026, 1, "2025-12-29"}, {2025, 1, "2024-12-30"}, {2024, 10, "2024-03-04"},
	} {
		got := isoWeekStart(c.year, c.week)
		if got.Format("2006-01-02") != c.want || got.Weekday() != time.Monday {
			t.Fatalf("%d-W%02d: %v want %s", c.year, c.week, got, c.want)
		}
		if weekLabel(got) != time.Date(c.year, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006")+"-W"+twoDigits(c.week) {
			t.Fatalf("label %s", weekLabel(got))
		}
	}
}

func twoDigits(n int) string {
	if n < 10 {
		return "0" + string(rune('0'+n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

func TestRankWeek(t *testing.T) {
	start := time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 7)
	in := start.Add(24 * time.Hour)
	members := map[string]bool{"a": true, "b": true, "c": true, "d": true}
	boards := map[string][]model.Score{
		"g1": {
			{UserID: "a", Score: 90, UpdatedAt: in}, {UserID: "b", Score: 80, UpdatedAt: in}, {UserID: "c", Score: 80, UpdatedAt: in}, // b and c tie for second
			{UserID: "x", Score: 999, UpdatedAt: in},                   // not a member
			{UserID: "d", Score: 70, UpdatedAt: start.Add(-time.Hour)}, // last week: doesn't count this week
		},
		"g2": {
			{UserID: "b", Score: 5, UpdatedAt: in}, {UserID: "a", Score: 4, UpdatedAt: in},
		},
	}
	rows := rankWeek(boards, members, start, end, nil)
	// g1: a 10, b 7, c 7 (tie shares second); g2: b 10, a 7. a = 17, b = 17, c = 7.
	if len(rows) != 3 || rows[0].Points != 17 || rows[1].Points != 17 || rows[2].UserID != "c" || rows[2].Points != 7 {
		t.Fatalf("rows: %+v", rows)
	}
	if rows[0].GamesPlayed != 2 || rows[2].GamesPlayed != 1 {
		t.Fatalf("games played: %+v", rows)
	}
	// a and b tie on points and games, so they share first place
	if p := placeOf(rows); p["a"] != 1 || p["b"] != 1 || p["c"] != 3 {
		t.Fatalf("places: %v", p)
	}
	// last week only d played
	prev := rankWeek(boards, members, start.AddDate(0, 0, -7), start, nil)
	if len(prev) != 1 || prev[0].UserID != "d" || prev[0].Points != 10 {
		t.Fatalf("last week: %+v", prev)
	}
	if rankPoints(1) != 10 || rankPoints(2) != 7 || rankPoints(3) != 5 || rankPoints(4) != 3 || rankPoints(5) != 2 || rankPoints(6) != 1 || rankPoints(40) != 1 {
		t.Fatal("rank points table")
	}
}

func TestScoreModelFromAndFormat(t *testing.T) {
	// defaults follow the kind
	sm := scoreModelFrom(&manifestScore{Kind: "time_to_complete"})
	if sm.Direction != "lower" || sm.CountsWhen != "finished" || sm.Aggregate != "best" || sm.TieBreak != "earlier" || sm.Format != "m:ss.t" || !sm.Ranked() {
		t.Fatalf("time trial defaults: %+v", sm)
	}
	sm = scoreModelFrom(&manifestScore{Kind: "weird", Direction: "sideways", TieBreak: "less time", Aggregate: "latest"})
	if sm.Kind != "points" || sm.Direction != "higher" || sm.CountsWhen != "any" || sm.TieBreak != "less time" || sm.Aggregate != "latest" || sm.Format != "{n}" {
		t.Fatalf("an unknown value falls back: %+v", sm)
	}
	no := false
	hi, lo := 600000.0, 1000.0
	sm = scoreModelFrom(&manifestScore{Kind: "accuracy", Ranked: &no, Bounds: &struct {
		Min         *float64 `json:"min"`
		Max         *float64 `json:"max"`
		MaxRatePerS *float64 `json:"max_rate_per_s"`
	}{Min: &lo, Max: &hi}})
	if sm.Ranked() || sm.Format != "{n}%" || sm.Bounds == nil || *sm.Bounds.Min != 1000 || *sm.Bounds.Max != 600000 {
		t.Fatalf("unranked accuracy with bounds: %+v %+v", sm, sm.Bounds)
	}
	if scoreModelFrom(nil) != nil {
		t.Fatal("no block, no model")
	}
	for _, c := range []struct {
		n      int64
		format string
		want   string
	}{
		{83400, "m:ss.t", "1:23.4"}, {5200, "m:ss.t", "0:05.2"}, {600000, "m:ss", "10:00"}, {5200, "s.t", "5.2"},
		{12, "{n} orders", "12 orders"}, {87, "{n}%", "87%"}, {9, "", "9"}, {9, "no placeholder", "9"},
	} {
		if got := formatScore(c.n, c.format); got != c.want {
			t.Fatalf("formatScore(%d, %q) = %q, want %q", c.n, c.format, got, c.want)
		}
	}
	// direction and tie-break
	lower := &model.ScoreModel{Direction: "lower", TieBreak: "less time"}
	if !scoreBetter(lower, model.Score{Score: 50}, model.Score{Score: 60}) || scoreBetter(lower, model.Score{Score: 70}, model.Score{Score: 60}) ||
		!scoreBetter(lower, model.Score{Score: 60, TimeMs: 5}, model.Score{Score: 60, TimeMs: 9}) || scoreBetter(&model.ScoreModel{TieBreak: "earlier"}, model.Score{Score: 60, TimeMs: 1}, model.Score{Score: 60, TimeMs: 9}) {
		t.Fatal("scoreBetter")
	}
	if msg := outOfBounds(&model.ScoreModel{Bounds: &model.ScoreBounds{MaxRatePerS: 2}}, 100, 10000); msg == "" { // 10 a second, over the limit
		t.Fatal("max_rate_per_s")
	}
}

func TestRankWeekLowerIsBetterAndUnranked(t *testing.T) {
	start := time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)
	in := start.Add(time.Hour)
	members := map[string]bool{"a": true, "b": true}
	boards := map[string][]model.Score{
		"trial": {{UserID: "a", Score: 5000, UpdatedAt: in}, {UserID: "b", Score: 3000, UpdatedAt: in}}, // lower wins: b first
		"calm":  {{UserID: "a", Score: 99, UpdatedAt: in}},                                              // unranked: no points
	}
	models := map[string]*model.ScoreModel{"trial": {Direction: "lower"}, "calm": {Unranked: true}}
	rows := rankWeek(boards, members, start, start.AddDate(0, 0, 7), models)
	if len(rows) != 2 || rows[0].UserID != "b" || rows[0].Points != 10 || rows[1].UserID != "a" || rows[1].Points != 7 || rows[1].GamesPlayed != 1 {
		t.Fatalf("rows: %+v", rows)
	}
}
