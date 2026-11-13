package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// The game-making harness (docs/HARNESS_V2.md, steps 1–4): before a new game is composed, the API
// understands the request, retrieves game types and tools from the catalog, looks up unknown games and
// plans the game, then hands the generator that `context`. It is on by default (HARNESS_CONTEXT=0 or off
// turns it off) and best-effort: on any failure the job runs exactly as before, with no context.
//
//	POST /v1/harness/plan {request} -> {plan, clarify, spec, types, timings}
//
// lets the app's anatomy step show the plan and ask its 0–2 clarifying questions before the build.

// harnessBudget bounds steps 1–4 for one job: understanding (25 s), a lookup (about 30 s) and the plan (90 s)
// rarely all run long together; past this the job goes ahead without a context.
const harnessBudget = 100 * time.Second

// planEndpointBudget is the plan endpoint's limit. It stays under the HTTP server's 2-minute write timeout;
// the endpoint detaches from the router's 60-second request timeout because the plan alone may take 90 s.
const planEndpointBudget = 115 * time.Second

// harnessContext returns the generator context for a new game, or nil when the harness is off, the job
// changes an existing game, or anything fails.
func (s *Server) harnessContext(ctx context.Context, job model.Job, media []map[string]any) map[string]any {
	if !s.HarnessContext || s.Harness == nil || s.Planner == nil || job.BaseGameID != "" || len(job.Context) > 0 {
		return nil
	}
	var given *harness.Spec
	req := harness.Request{Text: job.Request, Media: mediaRequestText(media)}
	if job.Preferences != "" {
		_ = json.Unmarshal([]byte(job.Preferences), &req.Preferences)
	}
	if job.Sponsor != nil { // a brand's game: the plan puts the sponsor in spec.theme even when the request doesn't name it
		req.Sponsor = &harness.Sponsor{Name: job.Sponsor.Name}
	}
	if job.Spec != "" {
		given = new(harness.Spec)
		if json.Unmarshal([]byte(job.Spec), given) != nil {
			given = nil
		}
	}
	log := s.Log.With("job", job.ID)
	ctx, cancel := context.WithTimeout(ctx, harnessBudget)
	defer cancel()
	var b *harness.Built
	var err error
	if given != nil {
		b, err = s.Harness.BuildGiven(ctx, req, given)
	} else {
		b, err = s.Harness.Build(ctx, req, s.Planner)
	}
	if err == nil && len(job.Answers) > 0 && b.Plan != nil {
		foldAnswers(b.Plan, job.Answers)
		err = harness.AttachPlan(&b.Context, b.Plan)
	}
	if err != nil {
		log.Warn("harness: no context for this job", "err", err)
		return nil
	}
	raw, err := json.Marshal(b.Context)
	if err != nil || len(raw) > harness.ContextMaxBytes {
		log.Warn("harness: context unusable", "bytes", len(raw), "err", err)
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	t := b.Pack.Timings
	log.Info("harness: context ready", "types", len(b.Context.Types), "tools", len(b.Context.Tools), "bytes", len(raw),
		"understand_ms", t.Understand, "lookup_ms", t.Lookup, "plan_ms", b.PlanMs, "understood_by", b.Pack.Understood)
	return m
}

type harnessPlanIn struct {
	Request     string               `json:"request"`
	Preferences []harness.Preference `json:"preferences"` // the person's earlier picks between versions
	mediaIn                          // the person's own photos and video (media.go)
}

// maxPreferences caps the picks a request may carry (one per axis is the usual; variants.md keeps the latest per axis).
const maxPreferences = 20

func (s *Server) harnessPlan(w http.ResponseWriter, r *http.Request) {
	if !s.HarnessContext || s.Harness == nil || s.Planner == nil {
		writeErr(w, 404, "planning is not turned on on this server")
		return
	}
	var in harnessPlanIn
	if !decode(w, r, &in) {
		return
	}
	in.Request = strings.TrimSpace(in.Request)
	if n := len([]rune(in.Request)); n == 0 || n > maxRequestChars {
		writeErr(w, 400, fmt.Sprintf("request must be 1 to %d characters", maxRequestChars))
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), planEndpointBudget)
	defer cancel()
	if len(in.Preferences) > maxPreferences {
		writeErr(w, 400, fmt.Sprintf("preferences can hold up to %d picks", maxPreferences))
		return
	}
	items, msg := s.checkMedia(userFrom(r).ID, &in.mediaIn)
	if msg != "" {
		writeErr(w, 400, msg)
		return
	}
	var media []map[string]any
	if len(items) > 0 {
		s.describeMedia(ctx, items, in.MediaNote)
		media = mediaContext(items, in.MediaNote, in.MediaRestyle)
	}
	b, err := s.Harness.Build(ctx, harness.Request{Text: in.Request, Media: mediaRequestText(media), Preferences: in.Preferences}, s.Planner)
	switch {
	case errors.Is(err, harness.ErrMuseNotConfigured):
		writeErr(w, 503, "Muse is not set up on this server yet")
		return
	case err != nil:
		s.Log.Warn("harness plan failed", "err", err)
		writeErr(w, 502, "Muse couldn't plan this game, try again")
		return
	}
	types := make([]map[string]any, 0, len(b.Context.Types))
	for _, t := range b.Context.Types {
		types = append(types, map[string]any{"id": t.ID, "name": t.Name, "family": t.Family, "score": t.Match.Score})
	}
	timings := b.Pack.Timings
	out := map[string]any{
		"plan":    b.Plan,
		"clarify": b.Plan.Clarify,
		"spec":    b.Plan.Spec,
		"types":   types,
		"timings": map[string]int64{"understand_ms": timings.Understand, "retrieve_ms": timings.Retrieve,
			"lookup_ms": timings.Lookup, "plan_ms": b.PlanMs, "total_ms": timings.Total},
	}
	if len(media) > 0 {
		out["media"] = media
	}
	writeJSON(w, 200, out)
}

const (
	maxSpecBytes   = 32 << 10
	maxAnswers     = 12
	maxAnswerChars = 300
)

// checkSpecAnswers validates the optional spec and answers on a generate request (a new game only). It returns the
// spec as JSON text, the cleaned answers, or a message for a 400.
func checkSpecAnswers(in *generateIn, isChange bool) (string, map[string]string, string) {
	hasSpec := len(in.Spec) > 0 && string(in.Spec) != "null"
	if !hasSpec && len(in.Answers) == 0 {
		return "", nil, ""
	}
	if isChange {
		return "", nil, "spec and answers are for a new game, not a change"
	}
	var specJSON string
	if hasSpec {
		if len(in.Spec) > maxSpecBytes {
			return "", nil, "spec is too large"
		}
		var sp harness.Spec
		if err := json.Unmarshal(in.Spec, &sp); err != nil {
			return "", nil, "spec is not a game-spec/1"
		}
		if problems, _ := sp.Validate(); len(problems) > 0 {
			return "", nil, "spec is not usable: " + problems[0]
		}
		fixed, _ := json.Marshal(sp) // Validate may have repaired it; keep the repaired one
		specJSON = string(fixed)
	}
	answers := map[string]string{}
	for k, v := range in.Answers {
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if k == "" || v == "" {
			continue
		}
		if len(answers) >= maxAnswers || len([]rune(k)) > 40 || len([]rune(v)) > maxAnswerChars {
			return "", nil, fmt.Sprintf("answers: up to %d, a slot name up to 40 and an answer up to %d characters", maxAnswers, maxAnswerChars)
		}
		answers[k] = v
	}
	if len(answers) == 0 {
		answers = nil
	}
	return specJSON, answers, ""
}

// foldAnswers puts the person's answers into the plan's clarify slots: an answered slot is no longer a guess.
func foldAnswers(p *harness.Plan, answers map[string]string) {
	done := map[string]bool{}
	for i := range p.Clarify {
		if v, ok := answers[p.Clarify[i].Slot]; ok {
			p.Clarify[i].Value, p.Clarify[i].Guessed, p.Clarify[i].Question, p.Clarify[i].Choices = v, false, "", nil
			done[p.Clarify[i].Slot] = true
		}
	}
	slots := make([]string, 0, len(answers))
	for k := range answers {
		if !done[k] {
			slots = append(slots, k)
		}
	}
	sort.Strings(slots)
	for _, k := range slots {
		p.Clarify = append(p.Clarify, harness.Clarify{Slot: k, Value: answers[k]})
	}
}
