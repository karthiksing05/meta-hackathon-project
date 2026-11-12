package srv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

type GenerateReq struct {
	Prompt   string          `json:"prompt"`
	Brief    json.RawMessage `json:"brief"`
	MediaIDs []string        `json:"media_ids"`
}

// Event is one SSE stage event.
type Event struct {
	Stage  string `json:"stage"`
	Status string `json:"status"`
	MS     int64  `json:"ms"`
	Count  *int   `json:"count,omitempty"`
}

type Emit func(Event)

type genCached struct {
	Manifest json.RawMessage `json:"manifest"`
	Content  json.RawMessage `json:"content"`
}

// genOut is the finished result of a generation job (before the draft is saved).
type genOut struct {
	Manifest, Content  json.RawMessage
	Source             string
	Cost               float64
	Prompt, Completion int
	Notes              []string
	Stages             map[string]int64
}

// genJob is one memoized generation run. It may be started speculatively when the brief is
// returned; Generate then joins it, replaying the stage events it missed.
type genJob struct {
	mu      sync.Mutex
	events  []Event
	changed chan struct{}
	done    bool
	out     genOut
}

func newGenJob() *genJob { return &genJob{changed: make(chan struct{})} }

func (j *genJob) emit(e Event) {
	j.mu.Lock()
	j.events = append(j.events, e)
	close(j.changed)
	j.changed = make(chan struct{})
	j.mu.Unlock()
}

func (j *genJob) finish(out genOut) {
	j.mu.Lock()
	j.out, j.done = out, true
	close(j.changed)
	j.changed = make(chan struct{})
	j.mu.Unlock()
}

// follow forwards every event (including those already emitted) and returns the result.
func (j *genJob) follow(ctx context.Context, emit Emit) (genOut, error) {
	idx := 0
	for {
		j.mu.Lock()
		evs := append([]Event(nil), j.events[idx:]...)
		idx += len(evs)
		done, ch, out := j.done, j.changed, j.out
		j.mu.Unlock()
		for _, e := range evs {
			emit(e)
		}
		if done {
			return out, nil
		}
		select {
		case <-ch:
		case <-ctx.Done():
			return genOut{}, ctx.Err()
		}
	}
}

// prepare normalizes the brief against server-known media and returns the dedupe key.
func (a *App) prepare(req GenerateReq) (Brief, json.RawMessage, []Media, string, error) {
	var brief Brief
	if len(req.Brief) > 0 {
		var err error
		if brief, err = DecodeBrief(req.Brief); err != nil {
			return brief, nil, nil, "", fmt.Errorf("invalid brief: %w", err)
		}
	}
	ids := req.MediaIDs
	if len(ids) == 0 {
		ids = brief.ContentSource.MediaIDs
	}
	media := a.mediaByIDs(ids)
	if len(req.Brief) == 0 {
		if strings.TrimSpace(req.Prompt) == "" {
			return brief, nil, nil, "", errors.New("prompt or brief required")
		}
		brief = TemplateBrief(req.Prompt, "remix", media)
	} else {
		brief.Normalize(brief.Level, media)
	}
	briefJSON, _ := json.Marshal(brief)
	mids := make([]string, len(media))
	for i, m := range media {
		mids[i] = m.ID
	}
	sort.Strings(mids)
	return brief, briefJSON, media, "gen2:" + hashKey(string(briefJSON), strings.Join(mids, ",")), nil
}

// getOrStart returns the running job for key, a persisted result, or starts a new job.
func (a *App) getOrStart(key string, brief Brief, media []Media) (*genJob, *genOut) {
	a.jobsMu.Lock()
	defer a.jobsMu.Unlock()
	if j, ok := a.jobs[key]; ok {
		return j, nil
	}
	if raw, ok := a.cache.Get(key); ok {
		var c genCached
		if json.Unmarshal(raw, &c) == nil && len(c.Manifest) > 0 && len(c.Content) > 0 {
			return nil, &genOut{Manifest: c.Manifest, Content: c.Content, Source: "cache", Stages: map[string]int64{}}
		}
	}
	j := newGenJob()
	a.jobs[key] = j
	go func() {
		out := a.runGen(brief, media, j.emit)
		if out.Source == "muse" {
			a.cache.Put(key, genCached{Manifest: out.Manifest, Content: out.Content})
		}
		a.jobsMu.Lock()
		delete(a.jobs, key)
		a.jobsMu.Unlock()
		j.finish(out)
	}()
	return j, nil
}

// speculate starts generation for a fresh brief so Generate can reuse it while the creator reviews the brief.
func (a *App) speculate(b Brief, media []Media) {
	if !a.cfg.Speculate || !a.muse.Configured() || !a.tool.Available() {
		return
	}
	req := GenerateReq{Brief: nil, MediaIDs: nil}
	briefJSON, _ := json.Marshal(b)
	req.Brief = briefJSON
	for _, m := range media {
		req.MediaIDs = append(req.MediaIDs, m.ID)
	}
	brief, _, media2, key, err := a.prepare(req)
	if err != nil {
		return
	}
	a.jobsMu.Lock()
	running := len(a.jobs)
	a.jobsMu.Unlock()
	if running >= 4 {
		return
	}
	a.getOrStart(key, brief, media2)
}

// Generate runs (or joins) the plan/content pipeline and saves a draft game.
func (a *App) Generate(ctx context.Context, userID string, req GenerateReq, emit Emit) (*Game, error) {
	t0 := time.Now()
	brief, briefJSON, media, key, err := a.prepare(req)
	if err != nil {
		return nil, err
	}
	job, cached := a.getOrStart(key, brief, media)
	var out genOut
	if cached != nil {
		out = *cached
		n := glueCount(out.Manifest)
		for _, s := range []string{"plan", "content", "glue", "validate"} {
			emit(Event{Stage: s, Status: "start"})
			ev := Event{Stage: s, Status: "done"}
			if s == "glue" {
				ev.Count = &n
			}
			emit(ev)
		}
	} else if out, err = job.follow(ctx, emit); err != nil {
		return nil, err
	}

	gen := GenInfo{Source: out.Source, CostUSD: out.Cost, PromptTokens: out.Prompt, CompletionTokens: out.Completion,
		Notes: out.Notes, Stages: map[string]int64{}}
	for k, v := range out.Stages {
		gen.Stages[k] = v
	}
	emit(Event{Stage: "save", Status: "start"})
	ss := time.Now()
	g := a.saveDraft(userID, brief, briefJSON, out.Manifest, out.Content, gen, t0)
	ms := time.Since(ss).Milliseconds()
	emit(Event{Stage: "save", Status: "done", MS: ms})
	a.store.mu.Lock()
	g.Gen.Stages["save"] = ms
	a.store.mu.Unlock()
	return g, nil
}

// runGen executes the whole pipeline: plan and content in parallel, validate, one repair, template fallback.
func (a *App) runGen(brief Brief, media []Media, emit Emit) genOut {
	acc := &runAcc{}
	stages := map[string]int64{}
	var stMu sync.Mutex
	stage := func(name string, ms int64) {
		stMu.Lock()
		stages[name] = ms
		stMu.Unlock()
	}
	type result struct {
		raw json.RawMessage
		err error
	}
	planCh := make(chan result, 1)
	contentCh := make(chan result, 1)

	emit(Event{Stage: "plan", Status: "start"})
	emit(Event{Stage: "glue", Status: "start"})
	emit(Event{Stage: "content", Status: "start"})
	go func() {
		s := time.Now()
		pctx, cancel := context.WithTimeout(context.Background(), a.cfg.PlanTimeout)
		defer cancel()
		raw, err := a.planManifest(pctx, acc, brief)
		ms := time.Since(s).Milliseconds()
		stage("plan", ms)
		emit(Event{Stage: "plan", Status: "done", MS: ms})
		n := 0
		if err == nil {
			n = glueCount(raw)
		}
		stage("glue", ms)
		emit(Event{Stage: "glue", Status: "done", MS: ms, Count: &n})
		planCh <- result{raw, err}
	}()
	go func() {
		s := time.Now()
		cctx, cancel := context.WithTimeout(context.Background(), a.cfg.ContentTimeout)
		defer cancel()
		raw, err := a.planContent(cctx, acc, brief, media)
		ms := time.Since(s).Milliseconds()
		stage("content", ms)
		emit(Event{Stage: "content", Status: "done", MS: ms})
		contentCh <- result{raw, err}
	}()
	plan, cont := <-planCh, <-contentCh

	var manifest, content json.RawMessage
	source := "muse"
	var planFB, contentFB bool
	if plan.err != nil {
		source, planFB = fallbackSource(plan.err), true
		manifest = a.templateManifest(brief)
	} else {
		manifest = plan.raw
	}
	if cont.err != nil {
		if source == "muse" {
			source = fallbackSource(cont.err)
		}
		contentFB = true
		content = a.templateContent(brief, media)
	} else {
		content = cont.raw
	}

	emit(Event{Stage: "validate", Status: "start"})
	vs := time.Now()
	vr, verr := a.tool.Validate(manifest, content)
	stage("validate", time.Since(vs).Milliseconds())
	var needRepair bool
	switch {
	case verr != nil:
		acc.note(verr.Error())
		if !planFB {
			planFB, source = true, "fallback"
			manifest = a.templateManifest(brief)
		}
		if !contentFB {
			contentFB = true
			content = a.templateContent(brief, media)
		}
	case !vr.OK && !planFB:
		acc.note("validate: " + truncate(vr.Summary(), 600))
		needRepair = true
	case !vr.OK && planFB && !contentFB:
		contentFB, source = true, "fallback"
		content = a.templateContent(brief, media)
	}
	emit(Event{Stage: "validate", Status: "done", MS: stages["validate"]})

	if needRepair {
		emit(Event{Stage: "repair", Status: "start"})
		rs := time.Now()
		rctx, cancel := context.WithTimeout(context.Background(), a.cfg.RepairTimeout)
		fixed, rerr := a.repairManifest(rctx, acc, brief, manifest, vr.Summary())
		cancel()
		repaired := false
		if rerr == nil {
			v2, e2 := a.tool.Validate(fixed, content)
			if e2 == nil && v2.OK {
				manifest, repaired = fixed, true
			} else if e2 == nil {
				acc.note("repair validate: " + truncate(v2.Summary(), 600))
			}
		}
		if !repaired {
			source = "fallback"
			if rerr != nil && errors.Is(rerr, ErrBudget) {
				source = "fallback-budget"
			}
			manifest = a.templateManifest(brief)
			if v3, e3 := a.tool.Validate(manifest, content); e3 != nil || !v3.OK {
				if !contentFB {
					content = a.templateContent(brief, media)
				}
			}
		}
		ms := time.Since(rs).Milliseconds()
		stage("repair", ms)
		emit(Event{Stage: "repair", Status: "done", MS: ms})
	}

	acc.mu.Lock()
	defer acc.mu.Unlock()
	stMu.Lock()
	defer stMu.Unlock()
	return genOut{Manifest: manifest, Content: content, Source: source, Cost: acc.cost, Prompt: acc.prompt,
		Completion: acc.completion, Notes: append([]string(nil), acc.notes...), Stages: stages}
}

func (a *App) callManifest(ctx context.Context, acc *runAcc, purpose, system, user string, b Brief) (json.RawMessage, error) {
	res, err := a.muse.Chat(ctx, ChatReq{Model: ModelWonder, Purpose: purpose, System: system, User: user, MaxTokens: a.cfg.PlanMaxTokens,
		SchemaName: "manifest", Schema: manifestSchema(), Reasoning: a.cfg.PlanReasoning})
	acc.add(res, err, purpose)
	if err != nil {
		return nil, err
	}
	obj, err := ExtractJSONObject(res.Content)
	if err != nil {
		acc.add(nil, err, purpose)
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(obj, &m); err != nil {
		return nil, err
	}
	if _, ok := m["concepts"].([]any); !ok {
		return nil, errors.New("manifest has no concepts")
	}
	m["schema"], m["template"], m["level"] = "sg.manifest/1", "quiz", b.Level
	if s, _ := m["title"].(string); strings.TrimSpace(s) == "" {
		m["title"] = b.TitleIdea
	}
	if s, _ := m["seed_scope"].(string); s == "" {
		m["seed_scope"] = b.SeedScope()
	}
	out, _ := json.Marshal(m)
	return out, nil
}

func (a *App) planManifest(ctx context.Context, acc *runAcc, b Brief) (json.RawMessage, error) {
	return a.callManifest(ctx, acc, "plan", planSystem(a.catalog, a.quizManifestTemplate()), planUser(b), b)
}

func (a *App) repairManifest(ctx context.Context, acc *runAcc, b Brief, bad json.RawMessage, errs string) (json.RawMessage, error) {
	user := planUser(b) + "\nYour previous manifest failed validation.\nMANIFEST:\n" + string(bad) + "\nVALIDATOR ERRORS:\n" + truncate(errs, 1500) +
		"\nReturn the corrected full manifest. If a glue script is the problem, simplify it."
	return a.callManifest(ctx, acc, "repair", planSystem(a.catalog, a.quizManifestTemplate()), user, b)
}

// normalizeContent validates Ember output against sg.content/1 and fills ids and media urls; needs >=3 valid items.
func normalizeContent(raw json.RawMessage, media []Media, maxItems int) (json.RawMessage, error) {
	var in struct {
		Items []struct {
			Prompt  string   `json:"prompt"`
			MediaID string   `json:"media_id"`
			Choices []string `json:"choices"`
			Answer  int      `json:"answer"`
			Clue    string   `json:"clue"`
		} `json:"items"`
		Copy map[string]string `json:"copy"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	urls := map[string]string{}
	for _, m := range media {
		urls[m.ID] = m.URL
	}
	items := []map[string]any{}
	for _, it := range in.Items {
		if maxItems > 0 && len(items) >= maxItems {
			break
		}
		if strings.TrimSpace(it.Prompt) == "" || len(it.Choices) != 4 || it.Answer < 0 || it.Answer > 3 {
			continue
		}
		seen := map[string]bool{}
		ok := true
		for _, c := range it.Choices {
			if strings.TrimSpace(c) == "" || seen[c] {
				ok = false
			}
			seen[c] = true
		}
		if !ok {
			continue
		}
		mid, murl := "", ""
		if u, found := urls[it.MediaID]; found {
			mid, murl = it.MediaID, u
		}
		items = append(items, map[string]any{"id": fmt.Sprintf("q%d", len(items)+1), "kind": "question", "prompt": it.Prompt,
			"media_id": mid, "media_url": murl, "choices": it.Choices, "answer": it.Answer, "clue": it.Clue})
	}
	if len(items) < 3 {
		return nil, fmt.Errorf("only %d valid questions", len(items))
	}
	cp := map[string]string{"intro": "Ready?", "win": "Nailed it!", "lose": "Good try, go again!"}
	for k, v := range in.Copy {
		if strings.TrimSpace(v) != "" {
			cp[k] = v
		}
	}
	return json.Marshal(map[string]any{"schema": "sg.content/1", "items": items, "copy": cp})
}

func (a *App) planContent(ctx context.Context, acc *runAcc, b Brief, media []Media) (json.RawMessage, error) {
	var user strings.Builder
	briefJSON, _ := json.Marshal(map[string]any{"title": b.TitleIdea, "intent": b.Intent, "tone": b.Tone, "difficulty": b.Difficulty, "mood": b.Mood})
	fmt.Fprintf(&user, "BRIEF: %s\nQuestions: %d\nPhotos:\n", briefJSON, b.Limits.Rounds)
	for _, m := range media {
		fmt.Fprintf(&user, "%s: %s\n", m.ID, m.Caption)
	}
	res, err := a.muse.Chat(ctx, ChatReq{Model: ModelEmber, Purpose: "content", System: contentSystem, User: user.String(), MaxTokens: 1800,
		SchemaName: "content", Schema: contentSchema(), Reasoning: "minimal"})
	acc.add(res, err, "content")
	if err != nil {
		return nil, err
	}
	obj, err := ExtractJSONObject(res.Content)
	if err != nil {
		acc.add(nil, err, "content")
		return nil, err
	}
	out, err := normalizeContent(obj, media, b.Limits.Rounds)
	if err != nil {
		acc.add(nil, err, "content")
	}
	return out, err
}

func glueCount(manifest json.RawMessage) int {
	var m struct {
		Glue []json.RawMessage `json:"glue"`
	}
	_ = json.Unmarshal(manifest, &m)
	return len(m.Glue)
}

func (a *App) saveDraft(userID string, b Brief, briefJSON, manifest, content json.RawMessage, gen GenInfo, t0 time.Time) *Game {
	gen.MS = time.Since(t0).Milliseconds()
	var title struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	_ = json.Unmarshal(manifest, &title)
	if title.Title == "" {
		title.Title = b.TitleIdea
	}
	g := &Game{ID: newID("g_"), Title: title.Title, Description: title.Description, CreatorID: userID, Status: "draft",
		Manifest: manifest, Content: content, Brief: briefJSON, CreatedAt: time.Now().UTC(), Gen: gen}
	a.store.mu.Lock()
	a.store.d.Games[g.ID] = g
	a.store.saveLocked()
	a.store.mu.Unlock()
	return g
}
