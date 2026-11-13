package harness

import (
	"context"
	"errors"
	"time"
)

// Built is steps 1–4 for one request: the context pack, the generator's context with its plan attached,
// and the plan on its own (for the app's clarifying questions).
type Built struct {
	Pack    ContextPack `json:"pack"`
	Context GenContext  `json:"context"`
	Plan    *Plan       `json:"plan"`
	PlanMs  int64       `json:"plan_ms"`
}

// Fragments are the catalog's fragment tools, which the anatomy calls "known".
func (ix *Index) Fragments() []GameTool {
	var out []GameTool
	for _, t := range ix.tools {
		if t.Kind == "fragment" {
			out = append(out, t)
		}
	}
	return out
}

// Unbuilt are the catalog's planned and gap tools.
func (ix *Index) Unbuilt() []GameTool {
	var out []GameTool
	for _, t := range ix.tools {
		if t.Status == "planned" || t.Status == "gap" {
			out = append(out, t)
		}
	}
	return out
}

// Build runs understand → retrieve → look up → plan. Any failure is an error and no context: the caller
// then makes the game the old way.
func (h *Harness) Build(ctx context.Context, req Request, planner *Planner) (*Built, error) {
	if planner == nil {
		return nil, errors.New("harness: no planner")
	}
	pack, err := h.Context(ctx, req)
	if err != nil {
		return nil, err
	}
	gc, err := BuildContext(pack)
	if err != nil {
		return nil, err
	}
	gc.Preferences = req.Preferences
	t := time.Now()
	plan, err := planner.Plan(ctx, PlanInput{Request: req.Text, Pack: pack, Context: gc, Fragments: h.Index().Fragments(), Unbuilt: h.Index().Unbuilt(), Group: req.Group})
	if err != nil {
		return nil, err
	}
	if err := AttachPlan(&gc, plan); err != nil {
		return nil, err
	}
	b := &Built{Pack: pack, Context: gc, Plan: plan, PlanMs: ms(time.Since(t))}
	b.Pack.Timings.Total += b.PlanMs
	return b, nil
}

// BuildGiven is Build for a game-spec the person already agreed: steps 1 to 3 run as usual, but the plan is not made
// again. The given spec is the plan's spec, and the types come from retrieval. It is used when the app sends `spec`.
func (h *Harness) BuildGiven(ctx context.Context, req Request, spec *Spec) (*Built, error) {
	pack, err := h.Context(ctx, req)
	if err != nil {
		return nil, err
	}
	gc, err := BuildContext(pack)
	if err != nil {
		return nil, err
	}
	gc.Preferences = req.Preferences
	plan := &Plan{Spec: spec, Notes: []string{"the person agreed this spec: it was not planned again"}}
	for _, t := range gc.Types {
		if len(plan.TypeIDs) < 3 {
			plan.TypeIDs = append(plan.TypeIDs, t.ID)
		}
	}
	if err := AttachPlan(&gc, plan); err != nil {
		return nil, err
	}
	return &Built{Pack: pack, Context: gc, Plan: plan}, nil
}
