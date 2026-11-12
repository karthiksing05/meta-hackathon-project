package srv

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Tool wraps the native sgtool CLI (validate / replay).
type Tool struct{ Path string }

type ToolIssue struct {
	Path string `json:"path"`
	Msg  string `json:"msg"`
}

type ValidateResult struct {
	OK       bool        `json:"ok"`
	Errors   []ToolIssue `json:"errors"`
	Warnings []ToolIssue `json:"warnings"`
}

func (t *Tool) Available() bool {
	st, err := os.Stat(t.Path)
	return err == nil && !st.IsDir()
}

func (t *Tool) run(cmd string, req any) ([]byte, error) {
	if !t.Available() {
		return nil, errors.New("sgtool unavailable")
	}
	in, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, t.Path, cmd)
	c.Stdin = bytes.NewReader(in)
	var out bytes.Buffer
	c.Stdout = &out
	if err := c.Run(); err != nil {
		return nil, fmt.Errorf("sgtool %s failed: %w", cmd, err)
	}
	return out.Bytes(), nil
}

func (t *Tool) Validate(manifest, content json.RawMessage) (*ValidateResult, error) {
	out, err := t.run("validate", map[string]any{"manifest": manifest, "content": content})
	if err != nil {
		return nil, err
	}
	var r ValidateResult
	if err := json.Unmarshal(out, &r); err != nil {
		return nil, errors.New("sgtool validate: unreadable output")
	}
	return &r, nil
}

type ReplayResult struct {
	OK    *bool  `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
	Score int    `json:"score"`
	Ticks int    `json:"ticks"`
}

func (t *Tool) Replay(manifest, content json.RawMessage, seed uint32, inputs json.RawMessage) (*ReplayResult, error) {
	if len(inputs) == 0 {
		inputs = json.RawMessage("[]")
	}
	out, err := t.run("replay", map[string]any{"manifest": manifest, "content": content, "seed": seed, "inputs": inputs})
	if err != nil {
		return nil, err
	}
	var r ReplayResult
	if err := json.Unmarshal(out, &r); err != nil {
		return nil, errors.New("sgtool replay: unreadable output")
	}
	if r.OK != nil && !*r.OK {
		return nil, fmt.Errorf("sgtool replay: %s", r.Error)
	}
	return &r, nil
}

func (r *ValidateResult) Summary() string {
	var parts []string
	for _, e := range r.Errors {
		parts = append(parts, e.Path+": "+e.Msg)
	}
	return strings.Join(parts, "\n")
}
