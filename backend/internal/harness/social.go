package harness

import (
	"fmt"
	"regexp"
	"strings"
)

// Group play (docs/harness-gaps/group-play.md): there is no live multiplayer. Every game is a single-player
// run that people play on the same seed, whenever they like, in a chat thread or a Group, and the results are
// compared afterwards: who won the round, a best-of series, the Group's round or its weekly board, or, for
// games with no right answer, how closely people agree. The spec's `social` part says how this game does it.

// Social is the spec's social part.
type Social struct {
	Mode         string     `json:"mode"`              // SocialModes: what a send into a chat or Group starts
	Modes        []string   `json:"modes,omitempty"`   // every mode the result supports (Go fills it)
	RoundSeconds int        `json:"round_seconds"`     // one turn in a chat: about 30-90 s
	Result       PlayResult `json:"result"`            // what a run leaves behind and how two runs compare
	ShareLine    string     `json:"share_line"`        // spoiler-free line posted back to the thread, with {result}
	BestOf       int        `json:"best_of,omitempty"` // 3 or 5 when mode is series
	Board        string     `json:"board"`             // how the Group board reads
	SameSeed     bool       `json:"same_seed"`         // always true: everyone plays the same course
	Reason       string     `json:"reason,omitempty"`  // why Muse moved off the default compare
	// Older plans wrote these; Share becomes ShareLine.
	Share     string `json:"share,omitempty"`
	Challenge string `json:"challenge,omitempty"`
}

// PlayResult is what one run leaves behind and how runs compare.
type PlayResult struct {
	Kind    string   `json:"kind"`              // ResultKinds
	Compare string   `json:"compare"`           // ResultCompares
	Display string   `json:"display"`           // the result line: "{score}", "{ending} in {choices} choices", "{agreement}% in sync"
	Endings []string `json:"endings,omitempty"` // ending names, best first, when compare is ending
	State   []string `json:"state,omitempty"`   // the game state holding the result at the end (ending, choices_used, picks)
}

var (
	// SocialModes: same_seed_async (send it, everyone plays when they like, the thread shows who won),
	// series (best of 3 or 5 on fresh seeds), group_round (everyone in a Group or group chat ranked),
	// weekly_board (the Group's week), opinion_compare (no right answer: agreement with each other and the group).
	SocialModes = []string{"same_seed_async", "series", "group_round", "weekly_board", "opinion_compare"}
	// ResultKinds: score (a number), ending (which ending, and what it took), picks (ratings, ranks, choices
	// with no right answer), creation (something made; shown, not ranked).
	ResultKinds = []string{"score", "ending", "picks", "creation"}
	// ResultCompares: score (the score model ranks), ending (the best ending first, then the score),
	// agreement (how closely picks match a friend's or the group's), none (shown side by side).
	ResultCompares = []string{"score", "ending", "agreement", "none"}
)

// Round length that suits a chat.
const (
	RoundMinSeconds    = 30
	RoundMaxSeconds    = 90
	RoundHardMaxSecond = 180 // a run that can't end within this is not a chat round
	ShareLineMax       = 140
)

// DefaultShareLine is the line posted back to the thread when the plan gives none that carries the result.
const DefaultShareLine = "{name}: {result} on {title}. Your turn."

// familyMode is the mode a send starts by default, per family.
var familyMode = map[string]string{
	"duel_battle": "series", "sports": "series", "racing": "series", "reaction": "series", "aim_throw": "series",
	"arcade_shooter": "series", "runner": "series", "platformer": "series", "dodge_survive": "series",
	"daily_puzzle": "group_round", "word": "group_round", "trivia": "group_round", "knowledge_quiz": "group_round",
	"logic_puzzle": "group_round", "number_math": "group_round", "party_social": "group_round",
	"guess_your_friends": "group_round", "learning": "group_round", "deduction": "group_round", "memory": "group_round",
}

// opinionRequest: words that say a game has no right answer (rate, rank as taste, tier list, favourite).
var opinionRequest = regexp.MustCompile(`(?i)\b(rate|rating|ratings|tier ?lists?|tiers|favou?rites?|would you rather|this or that|hot takes?|opinions?|vibe check|compare (my|your|our) (list|picks|ranking|ratings)|(vs|versus|compared? (to|with)) everyone|agree with)\b|\bwhich .{1,40}\b(better|best|worse|worst)\b`)

// opinionType: a type whose own text says there is no right answer.
var opinionType = regexp.MustCompile(`(?i)\b(consensus|no right answer|opinion|taste|agreement|agree|tier list|rate each|your ranking)\b`)

// DefaultSocial is the social part a type and request imply: the result compare from the request and the
// type, the mode from the family.
func DefaultSocial(t ContextType, request string) Social {
	s := Social{SameSeed: true, Result: PlayResult{Kind: "score", Compare: "score", Display: "{score}"}}
	switch {
	case opinionRequest.MatchString(request) || opinionType.MatchString(t.Name+" "+t.Summary+" "+t.Scoring):
		s.Result = PlayResult{Kind: "picks", Compare: "agreement", Display: "{agreement}% in sync with {name}"}
	case t.Family == "story_choice":
		s.Result = PlayResult{Kind: "ending", Compare: "ending", Display: "{ending} in {choices} choices"}
	}
	s.Mode = familyMode[t.Family]
	if s.Mode == "" {
		s.Mode = "same_seed_async"
	}
	if s.Result.Compare == "agreement" {
		s.Mode = "opinion_compare"
	}
	if s.Mode == "series" {
		s.BestOf = 3
	}
	return s
}

// modesFor are the modes a result supports: any comparable result works in every async mode.
func modesFor(compare string) []string {
	switch compare {
	case "agreement":
		return []string{"opinion_compare", "group_round"}
	case "none":
		return []string{"same_seed_async"}
	}
	return []string{"same_seed_async", "series", "group_round", "weekly_board"}
}

// validateSocial checks and fixes the social part against the score and the end. Called by Validate.
func (s *Spec) validateSocial(bad, fix func(part, f string, a ...any)) {
	so := &s.Social
	empty := func(x string) bool { return strings.TrimSpace(x) == "" }
	if !so.SameSeed {
		fix("social", "same_seed set: everyone plays the same course")
		so.SameSeed = true
	}
	if empty(so.ShareLine) && !empty(so.Share) {
		so.ShareLine = so.Share
	}
	r := &so.Result
	unranked := s.Score.Ranked != nil && !*s.Score.Ranked
	if empty(r.Compare) {
		switch {
		case r.Kind == "picks":
			r.Compare = "agreement"
		case r.Kind == "creation":
			r.Compare = "none"
		case r.Kind == "ending":
			r.Compare = "ending"
		case unranked:
			r.Compare = "none"
		default:
			r.Compare = "score"
		}
		fix("social", "result.compare set to %s", r.Compare)
	}
	if !oneOf(r.Compare, ResultCompares) {
		bad("social", "result.compare %q is not one of %v", r.Compare, ResultCompares)
		return
	}
	if empty(r.Kind) {
		r.Kind = map[string]string{"score": "score", "ending": "ending", "agreement": "picks", "none": "creation"}[r.Compare]
	}
	if !oneOf(r.Kind, ResultKinds) {
		bad("social", "result.kind %q is not one of %v", r.Kind, ResultKinds)
	}
	switch r.Compare {
	case "agreement":
		if r.Kind != "picks" {
			fix("social", "result.kind %q set to picks: agreement compares picks", r.Kind)
			r.Kind = "picks"
		}
		if !unranked {
			fix("score", "ranked set to false: an opinion game has no right answer, so it compares agreement, not a score")
			f := false
			s.Score.Ranked = &f
		}
		if so.Mode != "opinion_compare" && so.Mode != "group_round" {
			fix("social", "mode %q set to opinion_compare for an agreement result", so.Mode)
			so.Mode = "opinion_compare"
		}
	case "ending":
		if r.Kind != "ending" {
			fix("social", "result.kind %q set to ending", r.Kind)
			r.Kind = "ending"
		}
		if len(r.Endings) < 2 {
			bad("social", "an ending compare needs result.endings: at least 2 ending names, best first")
		}
	case "score":
		if unranked {
			fix("social", "result.compare set to none: the score is unranked")
			r.Compare = "none"
		}
	}
	if r.Compare != "agreement" && so.Mode == "opinion_compare" {
		fix("social", "mode opinion_compare set to same_seed_async: only an agreement result compares opinions")
		so.Mode = "same_seed_async"
	}
	if empty(so.Mode) {
		so.Mode = modesFor(r.Compare)[0]
	}
	if !oneOf(so.Mode, SocialModes) {
		fix("social", "mode %q set to %s", so.Mode, modesFor(r.Compare)[0])
		so.Mode = modesFor(r.Compare)[0]
	}
	if !oneOf(so.Mode, modesFor(r.Compare)) {
		fix("social", "mode %s doesn't suit a %s result; set to %s", so.Mode, r.Compare, modesFor(r.Compare)[0])
		so.Mode = modesFor(r.Compare)[0]
	}
	so.Modes = modesFor(r.Compare)
	switch {
	case so.Mode == "series" && so.BestOf != 3 && so.BestOf != 5:
		if so.BestOf != 0 {
			fix("social", "best_of %d set to 3", so.BestOf)
		}
		so.BestOf = 3
	case so.Mode != "series":
		so.BestOf = 0
	}
	if empty(r.Display) {
		r.Display = map[string]string{"score": "{score}", "ending": "{ending}", "agreement": "{agreement}% in sync", "none": "{result}"}[r.Compare]
	}
	// the round: about 30-90 s, inside the run's own length
	ss := s.End.SessionSeconds
	if len(ss) == 2 && ss[0] > RoundHardMaxSecond {
		bad("end", "a run takes at least %d s; a chat round is %d-%d s (at most %d): shorten the run or split it into rounds", ss[0], RoundMinSeconds, RoundMaxSeconds, RoundHardMaxSecond)
	}
	if so.RoundSeconds <= 0 && len(ss) == 2 {
		so.RoundSeconds = min(max(ss[1], RoundMinSeconds), RoundMaxSeconds)
		if so.RoundSeconds < ss[0] {
			so.RoundSeconds = ss[0]
		}
	}
	if len(ss) == 2 && ss[1] >= ss[0] && ss[0] > 0 {
		if so.RoundSeconds > ss[1] {
			fix("social", "round_seconds %d set to %d, the run's longest", so.RoundSeconds, ss[1])
			so.RoundSeconds = ss[1]
		}
		if so.RoundSeconds < ss[0] {
			fix("social", "round_seconds %d set to %d, the run's shortest", so.RoundSeconds, ss[0])
			so.RoundSeconds = ss[0]
		}
	}
	// the share line: spoiler-free, one line, carries the result
	line := strings.TrimSpace(so.ShareLine)
	switch {
	case line == "":
		bad("social", "share_line is empty")
	case !strings.Contains(line, "{result}") && !strings.Contains(line, "{score}"):
		fix("social", "share_line %q has no {result}; set to the default line", line)
		so.ShareLine = DefaultShareLine
	case len(line) > ShareLineMax || strings.Contains(line, "\n"):
		bad("social", "share_line is one line of at most %d characters", ShareLineMax)
	}
	if r.Compare == "ending" {
		for _, e := range r.Endings {
			if len(e) > 3 && strings.Contains(strings.ToLower(line), strings.ToLower(e)) {
				bad("social", "share_line names the ending %q: it spoils the story; use {ending}", e)
				break
			}
		}
	}
}

// ---- checks that need the request (run by finishSpec after Validate) ----

// exampleLeaks are phrases the prompt has used as examples; a goal that repeats one whose key word isn't in
// the request or the game type copied the example instead of describing this game (Kevin32, 2026-11-12).
var exampleLeaks = []struct{ phrase, key string }{
	{"clear every tile", "tile"},
	{"find the rarest answer", "rare"},
	{"clear 20 orders", "order"},
	{"orders completed", "order"},
	{"rarity points", "rar"},
}

// limitGoal finds a goal that caps how many of something ("in 10 choices or less", "at most 8 moves").
var limitGoal = regexp.MustCompile(`(?i)\b(?:(?:in|within|under|using|with)\s+)?(\d+)\s+(\w+?)s?\s+or\s+(?:less|fewer)\b|\b(?:at most|no more than|fewer than|under|within)\s+(\d+)\s+(\w+?)s?\b`)

var timeNoun = regexp.MustCompile(`(?i)^(sec|second|s|minute|min|ms|hour|day|lap)$`)
var underLimitWord = regexp.MustCompile(`(?i)\b(left|unused|remaining|spare|saved|fewer|under|ending|end|least)\b`)

// requestChecks are the spec problems only the request and the types can show: copied examples, a score
// that rewards what the goal limits, and an opinion request scored as if it had a right answer.
func requestChecks(s *Spec, in PlanInput) []string {
	var problems []string
	bad := func(part, f string, a ...any) { problems = append(problems, part+": "+fmt.Sprintf(f, a...)) }
	known := strings.ToLower(in.Request)
	for _, t := range in.Context.Types {
		known += " " + strings.ToLower(t.Name+" "+t.Summary+" "+t.CoreLoop+" "+t.Scoring+" "+strings.Join(t.Rules, " "))
	}
	known += " " + strings.ToLower(strings.Join(s.Theme.Named, " ")+" "+strings.Join(s.Theme.Terms, " ")+" "+s.Theme.World)
	for _, field := range []struct{ name, v string }{{"target", s.Goal.Target}, {"measure", s.Goal.Measure}} {
		v := strings.ToLower(field.v)
		for _, l := range exampleLeaks {
			if strings.Contains(v, l.phrase) && !strings.Contains(known, l.key) {
				bad("goal", "%s %q copies a schema example; describe this game's own target and measure", field.name, field.v)
			}
		}
	}
	// a capped goal ("king in 10 choices or less") must not score each use of what it caps
	goal := s.Goal.Text + " " + s.Goal.Target + " " + in.Request
	if m := limitGoal.FindStringSubmatch(goal); m != nil {
		noun := m[2]
		if noun == "" {
			noun = m[4]
		}
		stem := Stem(strings.ToLower(noun))
		if !timeNoun.MatchString(stem) && !timeNoun.MatchString(noun) && s.Score.Direction == "higher" {
			measures := strings.ToLower(s.Score.Measures + " " + s.Score.Unit)
			if strings.Contains(measures, stem) && !underLimitWord.MatchString(measures) {
				bad("score", "the goal caps %s (%q) but the score counts them, so more %s scores higher; score the ending reached plus %s left under the cap", noun, strings.TrimSpace(m[0]), noun, noun)
			}
		}
	}
	// an opinion request scored like a quiz
	if opinionRequest.MatchString(in.Request) && s.Social.Result.Compare != "agreement" && strings.TrimSpace(s.Social.Reason) == "" {
		bad("social", "the request asks for opinions (%q) and has no right answer: result {kind: picks, compare: agreement}, mode opinion_compare, score.ranked false; or give social.reason", opinionRequest.FindString(in.Request))
	}
	return problems
}

// applySocialDefault fills the social part from the default where Muse left it empty.
func applySocialDefault(s *Spec, def Social, plan *Plan) {
	so := &s.Social
	if so.Result.Compare == "" && so.Result.Kind == "" {
		so.Result = def.Result
		plan.Notes = append(plan.Notes, fmt.Sprintf("social: no result given; using the default %s compare", def.Result.Compare))
	}
	if so.Mode == "" {
		so.Mode = def.Mode
		if so.BestOf == 0 {
			so.BestOf = def.BestOf
		}
	}
	if def.Result.Compare == "agreement" && so.Result.Compare != "agreement" && strings.TrimSpace(so.Reason) == "" {
		plan.Notes = append(plan.Notes, fmt.Sprintf("social: compare %s changed back to agreement (an opinion game; no reason given)", so.Result.Compare))
		so.Result = def.Result
		so.Mode = def.Mode
	}
}
