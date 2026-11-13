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
	rows := rankWeek(boards, members, start, end)
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
	prev := rankWeek(boards, members, start.AddDate(0, 0, -7), start)
	if len(prev) != 1 || prev[0].UserID != "d" || prev[0].Points != 10 {
		t.Fatalf("last week: %+v", prev)
	}
	if rankPoints(1) != 10 || rankPoints(2) != 7 || rankPoints(3) != 5 || rankPoints(4) != 3 || rankPoints(5) != 2 || rankPoints(6) != 1 || rankPoints(40) != 1 {
		t.Fatal("rank points table")
	}
}
