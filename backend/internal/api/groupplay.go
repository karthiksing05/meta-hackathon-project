package api

import (
	"strings"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// manifestGroupPlay is the manifest's `group_play` as written; groupPlayFrom cleans it.
type manifestGroupPlay struct {
	Mode         string   `json:"mode"`
	Modes        []string `json:"modes"`
	RoundSeconds float64  `json:"round_seconds"`
	Result       struct {
		Kind    string   `json:"kind"`
		Compare string   `json:"compare"`
		Display string   `json:"display"`
		Endings []string `json:"endings"`
		State   []string `json:"state"`
	} `json:"result"`
	ShareLine string `json:"share_line"`
	BestOf    int    `json:"best_of"`
	SameSeed  *bool  `json:"same_seed"`
}

var groupModes = map[string]bool{"same_seed_async": true, "series": true, "group_round": true, "weekly_board": true, "opinion_compare": true}
var groupCompares = map[string]bool{"score": true, "ending": true, "agreement": true, "none": true}

// groupPlayFrom normalizes a manifest's group_play. A game without one (or with an unreadable one) has none, and
// is played as before: a score on a board.
func groupPlayFrom(in *manifestGroupPlay) *model.GroupPlay {
	if in == nil {
		return nil
	}
	compare := strings.ToLower(strings.TrimSpace(in.Result.Compare))
	if !groupCompares[compare] {
		return nil
	}
	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	if !groupModes[mode] {
		mode = "same_seed_async"
	}
	gp := &model.GroupPlay{Mode: mode, SameSeed: in.SameSeed == nil || *in.SameSeed, ShareLine: clipText(in.ShareLine, 140)}
	for _, m := range in.Modes {
		if m = strings.ToLower(strings.TrimSpace(m)); groupModes[m] && len(gp.Modes) < len(groupModes) {
			gp.Modes = append(gp.Modes, m)
		}
	}
	if in.RoundSeconds > 0 && in.RoundSeconds < 3600 {
		gp.RoundSeconds = int(in.RoundSeconds + 0.5)
	}
	if mode == "series" {
		gp.BestOf = 3
		if in.BestOf == 5 {
			gp.BestOf = 5
		}
	}
	gp.Result = model.GroupPlayResult{Kind: clipText(in.Result.Kind, 40), Compare: compare, Display: clipText(in.Result.Display, 80),
		Endings: nameList(in.Result.Endings, 12), State: nameList(in.Result.State, 6)}
	return gp
}

// cleanBots keeps up to 20 playtest runs with sane numbers (skill 0 to 1, a score, a time up to an hour).
func cleanBots(in []model.BotRun) []model.BotRun {
	var out []model.BotRun
	for _, b := range in {
		if len(out) >= 20 {
			break
		}
		if b.Skill != b.Skill || b.Skill < 0 || b.Skill > 1 || b.Score < -1e9 || b.Score > 1e9 || b.Sec != b.Sec || b.Sec < 0 || b.Sec > 3600 {
			continue
		}
		out = append(out, b)
	}
	return out
}

// nameList keeps up to max short, non-empty names.
func nameList(in []string, max int) []string {
	var out []string
	for _, s := range in {
		if s = clipText(s, 60); s != "" && len(out) < max {
			out = append(out, s)
		}
	}
	return out
}
