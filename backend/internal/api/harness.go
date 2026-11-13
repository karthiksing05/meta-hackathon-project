package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
func (s *Server) harnessContext(ctx context.Context, job model.Job) map[string]any {
	if !s.HarnessContext || s.Harness == nil || s.Planner == nil || job.BaseGameID != "" || len(job.Context) > 0 {
		return nil
	}
	log := s.Log.With("job", job.ID)
	ctx, cancel := context.WithTimeout(ctx, harnessBudget)
	defer cancel()
	b, err := s.Harness.Build(ctx, harness.Request{Text: job.Request}, s.Planner)
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
	Request string `json:"request"`
}

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
	b, err := s.Harness.Build(ctx, harness.Request{Text: in.Request}, s.Planner)
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
	writeJSON(w, 200, map[string]any{
		"plan":    b.Plan,
		"clarify": b.Plan.Clarify,
		"spec":    b.Plan.Spec,
		"types":   types,
		"timings": map[string]int64{"understand_ms": timings.Understand, "retrieve_ms": timings.Retrieve,
			"lookup_ms": timings.Lookup, "plan_ms": b.PlanMs, "total_ms": timings.Total},
	})
}
