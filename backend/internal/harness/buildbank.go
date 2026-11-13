package harness

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// The answer-bank lane of Build (bank.go): it starts with the job when the raw request reads like a rarity or
// naming game, so it runs alongside understand, retrieve and plan; otherwise it starts after the plan, only when
// the plan needs a bank. Either way the job waits for it at most BankBudget.

type bankRun struct {
	key     BankKey
	started int64 // ms from the job's start
	done    chan struct{}
	cancel  context.CancelFunc
	bank    *AnswerBank
	stats   BankStats
	endMs   int64
}

func (h *Harness) startBank(ctx context.Context, key BankKey, request string, t0 time.Time) *bankRun {
	bctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), BankBudget)
	r := &bankRun{key: key, started: ms(time.Since(t0)), done: make(chan struct{}), cancel: cancel}
	go func() {
		defer close(r.done)
		defer cancel()
		r.bank, r.stats = h.lookup.Bank(bctx, key, request)
		r.endMs = ms(time.Since(t0))
	}()
	return r
}

// speculativeBank starts the lane at once when the request reads like a rarity game.
func (h *Harness) speculativeBank(ctx context.Context, req Request, t0 time.Time) *bankRun {
	if h.lookup == nil || req.NoLookup || !LooksLikeBank(req.Text) {
		return nil
	}
	key := RawBankKey(req.Text, nil)
	if key.Empty() {
		return nil
	}
	return h.startBank(ctx, key, req.Text, t0)
}

// finishBank decides whether the plan needs the bank, waits for (or starts) the lane, and puts the bank, its
// stats and its lanes into the context. It never fails the build.
func (h *Harness) finishBank(ctx context.Context, run *bankRun, req Request, pack ContextPack, gc *GenContext, plan *Plan, t0 time.Time) {
	need, why := NeedsBank(plan, gc.Types)
	if !need {
		if run != nil {
			run.cancel()
			gc.Lookup = &BankStats{Reason: "started early, but the plan needs no answer bank", Pages: []string{}, Tiers: map[string]int{}}
		}
		return
	}
	if h.lookup == nil || req.NoLookup {
		gc.Lookup = &BankStats{Reason: why + "; the web lookup is off", Pages: []string{}, Tiers: map[string]int{}}
		return
	}
	if run == nil {
		key := RawBankKey(req.Text, pack.Understanding.Theme)
		if key.Empty() {
			gc.Lookup = &BankStats{Reason: why + "; no topic or category to look up", Pages: []string{}, Tiers: map[string]int{}}
			return
		}
		run = h.startBank(ctx, key, req.Text, t0)
	}
	select {
	case <-run.done:
	case <-ctx.Done():
		run.cancel()
		<-run.done
	}
	st := run.stats
	st.Reason = why
	gc.Lookup = &st
	note := ""
	if run.bank != nil {
		note = fmt.Sprintf("%d answers from %d page(s)", st.Answers, len(st.Pages))
	} else {
		note = "failed: " + clip(st.Error, 120)
	}
	fetchEnd := run.started + st.FetchMs
	gc.Timeline = append(gc.Timeline, Lane{Lane: "lookup", Stage: "bank fetch (Wikipedia lists)", StartMs: run.started, EndMs: fetchEnd, Note: strings.Join(st.Pages, "; ")})
	if run.endMs > fetchEnd {
		gc.Timeline = append(gc.Timeline, Lane{Lane: "lookup", Stage: "bank tiering (" + orDefault(st.TierBy, "muse") + ")", StartMs: fetchEnd, EndMs: run.endMs, Note: note})
	}
	if run.bank == nil {
		gc.Notes = append(gc.Notes, "answer-bank lookup "+note+"; Muse writes the answers")
		return
	}
	b := run.bank
	// keep the context within its limit: drop the deepest cuts first
	for {
		gc.Content = &ContextContent{AnswerBank: b, TAAnswers: b.TALine()}
		if size(*gc) < ContextMaxBytes-2*1024 { // the plan is attached already; leave room for its new note
			break
		}
		trimmed := false
		for i := len(BankTiers) - 1; i >= 0 && !trimmed; i-- {
			if l := b.Tiers[BankTiers[i]]; len(l) > 3 {
				b.Tiers[BankTiers[i]] = l[:len(l)*3/4]
				trimmed = true
			}
		}
		if !trimmed {
			break
		}
	}
	gc.Notes = append(gc.Notes, "answer bank: "+note+" ("+strings.Join(st.Pages, ", ")+"), tiered by "+st.TierBy)
	plan.Notes = append(plan.Notes, "answer bank from the web: "+note+"; use context.content.answer_bank as the accepted answers")
}

func orDefault(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}

// harnessLanes are the main lane's stages from the context pack's timings (understand, retrieve and look up run
// one after another from the start), then the plan.
func harnessLanes(t Timings, planStart, planEnd int64) []Lane {
	u, r := t.Understand, t.Understand+t.Retrieve
	out := []Lane{
		{Lane: "harness", Stage: "understand", StartMs: 0, EndMs: u, Note: t.UnderstoodBy},
		{Lane: "harness", Stage: "retrieve", StartMs: u, EndMs: r},
	}
	if t.Lookup > 0 {
		out = append(out, Lane{Lane: "harness", Stage: "game lookup", StartMs: r, EndMs: r + t.Lookup})
	}
	if planEnd > planStart {
		out = append(out, Lane{Lane: "harness", Stage: "plan", StartMs: planStart, EndMs: planEnd})
	}
	return out
}
