package harness

// Requirements (docs/HARNESS_V2.md "Requirements"): every explicit number, name and rule in the request,
// kept as spec.requirements so the plan and the built game can be checked against the person's own words.
//
// The code lives in one place, authoring/expander/requirements.mjs (compose and the checks use it too).
// Like internal/recs, the backend runs that exact file in goja instead of porting it: seedRequirements
// (the code pass), requirementsPrompt and REQUIREMENTS_SYSTEM (one Muse call), mergeRequirements, and
// planContradictions (a plan that says a different number than a quote).
//
// HARNESS_REQUIREMENTS: on by default; "0" (or off/false/no) turns the Muse extraction off and keeps the
// code pass. A missing script turns the whole stage off with a note.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/repo"
)

// Requirement is one thing the person stated, quoted exactly (requirements.mjs).
type Requirement struct {
	ID     string          `json:"id"`
	Quote  string          `json:"quote"`
	Kind   string          `json:"kind"`
	Target json.RawMessage `json:"target"`
	Must   bool            `json:"must"`
	Verify string          `json:"verify"`
	Note   string          `json:"note,omitempty"`
}

// requirementsRel is the one copy of the requirements code in the repository.
const requirementsRel = "authoring/expander/requirements.mjs"

// RequirementsOn reads HARNESS_REQUIREMENTS: on unless "0", "off", "false" or "no".
func RequirementsOn(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "off", "false", "no":
		return false
	}
	return true
}

// ReqJS runs requirements.mjs in goja. A runtime isn't safe for concurrent use, so calls take a lock;
// each call is a few milliseconds.
type ReqJS struct {
	mu sync.Mutex
	rt *goja.Runtime
	fn goja.Callable
}

var (
	reqJSOnce sync.Once
	reqJS     *ReqJS
	reqJSErr  error
)

// findRequirementsScript: $HARNESS_REQUIREMENTS_SCRIPT, the image's /app/requirements.mjs, then the repository.
func findRequirementsScript() (string, error) {
	for _, p := range []string{os.Getenv("HARNESS_REQUIREMENTS_SCRIPT"), "/app/requirements.mjs"} {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	if p, ok := repo.Find(requirementsRel); ok {
		return p, nil
	}
	return "", fmt.Errorf("requirements.mjs not found (set HARNESS_REQUIREMENTS_SCRIPT or run inside the repository: %s)", requirementsRel)
}

var (
	reExportList = regexp.MustCompile(`(?m)^export\s*\{[^}]*\};?\s*$`)
	reExportDecl = regexp.MustCompile(`(?m)^export\s+(const|let|function|async function|class)\b`)
	reImportLine = regexp.MustCompile(`(?m)^import\s.*$`)
)

// scriptFromModule turns the ES module into a plain script (goja has no modules): exports become plain
// declarations, and a dispatcher calls a named function with JSON arguments and returns JSON.
func scriptFromModule(src string) string {
	s := reImportLine.ReplaceAllString(src, "")
	s = reExportList.ReplaceAllString(s, "")
	s = reExportDecl.ReplaceAllString(s, "$1")
	return s + `
const __reqFns = { seedRequirements, requirementsPrompt, mergeRequirements, normalizeRequirements, coverageIssues, planContradictions, requirementsSection };
function __reqCall(name, argsJSON) {
  if (name === 'REQUIREMENTS_SYSTEM') return JSON.stringify(REQUIREMENTS_SYSTEM);
  return JSON.stringify(__reqFns[name].apply(null, JSON.parse(argsJSON)));
}
`
}

// LoadReqJS loads requirements.mjs once.
func LoadReqJS() (*ReqJS, error) {
	reqJSOnce.Do(func() {
		path, err := findRequirementsScript()
		if err != nil {
			reqJSErr = err
			return
		}
		b, err := os.ReadFile(path)
		if err != nil {
			reqJSErr = err
			return
		}
		rt := goja.New()
		if _, err := rt.RunString(scriptFromModule(string(b))); err != nil {
			reqJSErr = fmt.Errorf("loading requirements.mjs: %w", err)
			return
		}
		fn, ok := goja.AssertFunction(rt.Get("__reqCall"))
		if !ok {
			reqJSErr = errors.New("requirements.mjs: no dispatcher")
			return
		}
		reqJS = &ReqJS{rt: rt, fn: fn}
	})
	return reqJS, reqJSErr
}

// Call runs a requirements.mjs function with JSON-able args and decodes its JSON result into out.
func (j *ReqJS) Call(out any, name string, args ...any) error {
	a, err := json.Marshal(args)
	if err != nil {
		return err
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	timer := time.AfterFunc(5*time.Second, func() { j.rt.Interrupt("requirements: timeout") })
	defer timer.Stop()
	res, err := j.fn(goja.Undefined(), j.rt.ToValue(name), j.rt.ToValue(string(a)))
	j.rt.ClearInterrupt()
	if err != nil {
		return fmt.Errorf("requirements.mjs %s: %w", name, err)
	}
	return json.Unmarshal([]byte(res.String()), out)
}

// ReqIssue is a requirement problem: a quote not in the request, an uncovered number, a plan contradiction.
type ReqIssue struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	Requirement string `json:"requirement,omitempty"`
	Quote       string `json:"quote,omitempty"`
}

// extracted is what the requirements stage found.
type extracted struct {
	Requirements []Requirement `json:"requirements"`
	Issues       []ReqIssue    `json:"issues"`
	By           string        `json:"-"`
}

// extractRequirements is the code pass, then (when on) one Muse call merged with it. Any Muse failure keeps
// the code pass. A missing script returns nil (the stage is skipped) and a note.
func (p *Planner) extractRequirements(ctx context.Context, request string, plan *Plan) *extracted {
	js, err := LoadReqJS()
	if err != nil {
		plan.Notes = append(plan.Notes, "requirements: skipped ("+err.Error()+")")
		return nil
	}
	var seeds []json.RawMessage
	if err := js.Call(&seeds, "seedRequirements", request); err != nil {
		plan.Notes = append(plan.Notes, "requirements: skipped ("+err.Error()+")")
		return nil
	}
	codeOnly := func(why string) *extracted {
		var ex extracted
		if err := js.Call(&ex, "normalizeRequirements", seeds, request); err != nil {
			plan.Notes = append(plan.Notes, "requirements: skipped ("+err.Error()+")")
			return nil
		}
		var cov []ReqIssue
		if js.Call(&cov, "coverageIssues", request, ex.Requirements) == nil {
			ex.Issues = append(ex.Issues, cov...)
		}
		ex.By = "code" + why
		return &ex
	}
	m := p.ReqMuse
	if m == nil {
		m = p.Muse
	}
	if !p.Requirements || m == nil {
		return codeOnly("")
	}
	var system, user string
	if err := js.Call(&system, "REQUIREMENTS_SYSTEM"); err != nil {
		return codeOnly(" (" + err.Error() + ")")
	}
	if err := js.Call(&user, "requirementsPrompt", request, seeds); err != nil {
		return codeOnly(" (" + err.Error() + ")")
	}
	t := time.Now()
	raw, err := m.JSON(ctx, system, user)
	plan.Calls = append(plan.Calls, CallTiming{Step: "requirements", Ms: ms(time.Since(t))})
	if err != nil {
		return codeOnly(" (muse failed: " + clip(err.Error(), 120) + ")")
	}
	var reply struct {
		Requirements []json.RawMessage `json:"requirements"`
	}
	if json.Unmarshal(raw, &reply) != nil || reply.Requirements == nil {
		return codeOnly(" (muse reply had no requirements list)")
	}
	var ex extracted
	if err := js.Call(&ex, "mergeRequirements", request, reply.Requirements, seeds); err != nil {
		return codeOnly(" (" + err.Error() + ")")
	}
	ex.By = "muse"
	return &ex
}

// requirementsLines are the requirements as the planner prompt shows them.
func requirementsLines(reqs []Requirement) string {
	if len(reqs) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("The person's requirements (spec.requirements; quoted, every part must agree):\n")
	for _, r := range reqs {
		must := "nice"
		if r.Must {
			must = "must"
		}
		t := string(r.Target)
		if t == "" || t == "null" {
			t = "read by a judge"
		}
		fmt.Fprintf(&sb, "- %s (%s, %s): %q -> %s\n", r.ID, must, r.Kind, r.Quote, clip(t, 160))
	}
	return sb.String()
}

// planContradictions are spec parts that say a different number than a requirement.
func planContradictions(reqs []Requirement, spec *Spec) []ReqIssue {
	if len(reqs) == 0 || spec == nil {
		return nil
	}
	js, err := LoadReqJS()
	if err != nil {
		return nil
	}
	var out []ReqIssue
	if js.Call(&out, "planContradictions", reqs, spec) != nil {
		return nil
	}
	return out
}
