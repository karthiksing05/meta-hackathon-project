package api

import "testing"

func TestOnlyStateHashDiffers(t *testing.T) {
	rec := &struct {
		Phase  string  `json:"phase"`
		Score  float64 `json:"score"`
		TimeMs float64 `json:"time_ms"`
	}{Phase: "won", Score: 50, TimeMs: 16533}
	hash := `final.state_hash: log says "01b6", replay gives "a84f"`
	cases := []struct {
		name string
		v    verifyResult
		want bool
	}{
		{"only the state hash", verifyResult{GameHashOK: true, Problems: []string{hash}, Recomputed: rec}, true},
		{"already ok", verifyResult{OK: true, GameHashOK: true, Recomputed: rec}, false},
		{"score differs too", verifyResult{GameHashOK: true, Problems: []string{hash, "final.score: log says 90, replay gives 50"}, Recomputed: rec}, false},
		{"another game", verifyResult{GameHashOK: false, Problems: []string{hash}, Recomputed: rec}, false},
		{"no replay result", verifyResult{GameHashOK: true, Problems: []string{hash}}, false},
		{"no problems listed", verifyResult{GameHashOK: true, Recomputed: rec}, false},
	}
	for _, c := range cases {
		if got := onlyStateHashDiffers(&c.v); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
