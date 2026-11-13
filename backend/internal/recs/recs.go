// Package recs runs Kevin's games recommender (game-recs.js) inside the backend.
//
// The recommender is one dependency-free JavaScript file, FacebookClone/Bubbles/Recommend/game-recs.js.
// There is only that one copy: the backend reads it from there in development and tests, and the API's
// Docker image copies it to /app/game-recs.js (override with RECS_SCRIPT). Instead of rewriting its ~1,900
// lines, the backend runs that exact file in goja, a pure-Go JavaScript engine, so the server ranks with the
// same code that Kevin's checks, simulators and the golden test cover. When the file changes, run
// `go test ./internal/recs` (the golden file is regenerated with testdata/gen_golden.mjs).
//
// The file's "app bridge" works on one person ("me") at a time: load that person's state, call
// rank / observe / signal / groupBlend, read the state back. The server keeps each person's state
// in its database. A goja runtime isn't safe for concurrent use, so the engine keeps a small pool
// and each call borrows one runtime for its whole load-call-export round trip.
package recs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/dop251/goja"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/repo"
)

// scriptRel is where the one copy of the recommender lives in the repository.
const scriptRel = "FacebookClone/Bubbles/Recommend/game-recs.js"

// findScript locates game-recs.js: an explicit path, $RECS_SCRIPT, the image's /app/game-recs.js, then the
// repository copy.
func findScript(explicit string) (string, error) {
	for _, p := range []string{explicit, os.Getenv("RECS_SCRIPT"), "/app/game-recs.js"} {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	if p, ok := repo.Find(scriptRel); ok {
		return p, nil
	}
	return "", fmt.Errorf("recs: game-recs.js not found (set RECS_SCRIPT, or run inside the repository: %s)", scriptRel)
}

type vm struct {
	rt  *goja.Runtime
	app *goja.Object
}

func newVM(script string) (*vm, error) {
	rt := goja.New()
	if _, err := rt.RunString(script); err != nil {
		return nil, fmt.Errorf("loading game-recs.js: %w", err)
	}
	api := rt.Get("GameRecs")
	if api == nil || goja.IsUndefined(api) {
		return nil, errors.New("game-recs.js did not define GameRecs")
	}
	app := api.ToObject(rt).Get("app")
	if app == nil || goja.IsUndefined(app) {
		return nil, errors.New("game-recs.js has no app bridge")
	}
	return &vm{rt: rt, app: app.ToObject(rt)}, nil
}

// Engine is a pool of recommender runtimes.
type Engine struct {
	script    string
	version   string
	pool      chan *vm
	overrides string // JSON parameter overrides passed to every load, "" for the defaults
	timeout   time.Duration
}

// Options tune the engine. Overrides is the JSON the file's `load` takes (e.g. {"interleave":{"on":true,"against":"baseline"}});
// the Muse re-rank term is never turned on here: the backend leaves it off.
type Options struct {
	ScriptPath string // game-recs.js; empty finds it (see findScript)
	Runtimes   int
	Overrides  map[string]any
	Timeout    time.Duration // per call; a runaway script is interrupted
}

func New(o Options) (*Engine, error) {
	if o.Runtimes < 1 {
		o.Runtimes = 2
	}
	if o.Timeout <= 0 {
		o.Timeout = 10 * time.Second
	}
	over := ""
	if len(o.Overrides) > 0 {
		b, err := json.Marshal(o.Overrides)
		if err != nil {
			return nil, err
		}
		over = string(b)
	}
	path, err := findScript(o.ScriptPath)
	if err != nil {
		return nil, err
	}
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	e := &Engine{script: string(src), pool: make(chan *vm, o.Runtimes), overrides: over, timeout: o.Timeout}
	for i := 0; i < o.Runtimes; i++ {
		v, err := newVM(e.script)
		if err != nil {
			return nil, err
		}
		if i == 0 {
			e.version = v.rt.Get("GameRecs").ToObject(v.rt).Get("version").String()
		}
		e.pool <- v
	}
	return e, nil
}

// Version is the embedded game-recs.js version.
func (e *Engine) Version() string { return e.version }

// Session is one person's loaded state inside a borrowed runtime. It is valid only inside Run.
type Session struct {
	v *vm
}

func (s *Session) call(method string, args ...string) (string, error) {
	fn, ok := goja.AssertFunction(s.v.app.Get(method))
	if !ok {
		return "", fmt.Errorf("recs: no bridge method %q", method)
	}
	vals := make([]goja.Value, len(args))
	for i, a := range args {
		vals[i] = s.v.rt.ToValue(a)
	}
	res, err := fn(s.v.app, vals...)
	if err != nil {
		return "", fmt.Errorf("recs: %s: %w", method, err)
	}
	return res.String(), nil
}

// Rank orders candidates for the person. Input and output are the file's JSON (see game-recs.js `rank`).
func (s *Session) Rank(input []byte) ([]byte, error) { return s.bytes("rank", input) }

// Describe teaches the loaded runtime what the given games are (summaries is a JSON array of game
// summaries). The recommender keeps those descriptions in memory, not in the saved state, so every
// Run that calls Observe, Signal or GroupBlend on games must Describe them first. It is cheap: a rank
// with no candidates only describes the games.
func (s *Session) Describe(summaries []byte) error {
	in := append([]byte(`{"candidates":[],"count":0,"summaries":`), summaries...)
	in = append(in, '}')
	_, err := s.Rank(in)
	return err
}

// Observe teaches the model what happened on one feed page.
func (s *Session) Observe(impression []byte) ([]byte, error) { return s.bytes("observe", impression) }

// Signal records a save or social moment that happened away from the open feed page.
func (s *Session) Signal(sig []byte) ([]byte, error) { return s.bytes("signal", sig) }

// GroupBlend ranks games for a set of people and builds the Blend game spec.
func (s *Session) GroupBlend(input []byte) ([]byte, error) { return s.bytes("groupBlend", input) }

// Profile is the loaded person's taste profile (what a Blend uses for a real member).
func (s *Session) Profile() ([]byte, error) { return s.bytes("profile") }

// DebugSummary is a small summary of the loaded model: stages, bait lean, pages seen.
func (s *Session) DebugSummary() ([]byte, error) { return s.bytes("debugSummary") }

// InterleaveStats is the on-state interleaving tally (only meaningful when interleaving is on).
func (s *Session) InterleaveStats() ([]byte, error) { return s.bytes("interleaveStats") }

func (s *Session) bytes(method string, args ...[]byte) ([]byte, error) {
	strs := make([]string, len(args))
	for i, a := range args {
		strs[i] = string(a)
	}
	out, err := s.call(method, strs...)
	return []byte(out), err
}

// Run borrows a runtime, loads state ("" starts a new person), runs fn, and returns the updated
// state. fn must not keep the Session.
func (e *Engine) Run(ctx context.Context, state string, fn func(*Session) error) (string, error) {
	var v *vm
	select {
	case v = <-e.pool:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	defer func() { e.pool <- v }()

	timer := time.AfterFunc(e.timeout, func() { v.rt.Interrupt("recommender call took too long") })
	defer func() {
		timer.Stop()
		v.rt.ClearInterrupt()
	}()

	s := &Session{v: v}
	if _, err := s.call("load", state, e.overrides); err != nil {
		return "", err
	}
	if err := fn(s); err != nil {
		return "", err
	}
	return s.call("exportState")
}
