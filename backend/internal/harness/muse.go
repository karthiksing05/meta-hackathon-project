package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Per-step model settings (decided with Max, 2026-11-12). The planner's are here for when it lands.
const (
	ModelSpark  = "muse-spark-1.3"
	ModelWonder = "muse-wonder-1.0"
)

// UnderstandMuse and LookupMuse are the generator transports the API uses for steps 1 and 3:
// muse-spark-1.3, 4000 tokens, 15 s. Effort is "minimal": measured 2026-11-12, "low" spends 500-800
// reasoning tokens and 7-18 s even on a one-line prompt, which misses the 15 s budget; "minimal" answers
// in about 5 s.
func UnderstandMuse(generatorURL string) *GeneratorMuse {
	return &GeneratorMuse{URL: generatorURL, Model: ModelSpark, MaxTokens: 4000, Effort: "minimal", Timeout: 15 * time.Second}
}

// LookupMuse is the transport for the lookup summary.
func LookupMuse(generatorURL string) *GeneratorMuse {
	return &GeneratorMuse{URL: generatorURL, Model: ModelSpark, MaxTokens: 4000, Effort: "minimal", Timeout: 15 * time.Second}
}

// PlanEffort is the planner's reasoning effort.
var PlanEffort = "low"

// PlanMuse is the planner's transport (muse-wonder-1.0, 12000 tokens, 90 s).
func PlanMuse(generatorURL string) *GeneratorMuse {
	return &GeneratorMuse{URL: generatorURL, Model: ModelWonder, MaxTokens: 12000, Effort: PlanEffort, Timeout: 90 * time.Second}
}

// GeneratorMuse is the production MuseJSON transport: the generator service holds the Muse key, and the
// API calls it on the private network:
//
//	POST {GENERATOR_URL}/internal/muse/json {model, system, user, maxTokens?, effort?} -> {content, model}
//
// The API never reads the key.
type GeneratorMuse struct {
	URL       string // GENERATOR_URL, e.g. http://generator:8090
	Model     string
	MaxTokens int
	Effort    string
	Timeout   time.Duration // default 15 s
	HTTP      *http.Client
}

// JSON implements MuseJSON.
func (g *GeneratorMuse) JSON(ctx context.Context, system, user string) (json.RawMessage, error) {
	if strings.TrimSpace(g.URL) == "" {
		return nil, errors.New("harness: GENERATOR_URL is not set")
	}
	timeout := g.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	body := map[string]any{"model": g.Model, "system": system, "user": user}
	if g.MaxTokens > 0 {
		body["maxTokens"] = g.MaxTokens
	}
	if g.Effort != "" {
		body["effort"] = g.Effort
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(g.URL, "/")+"/internal/muse/json", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	hc := g.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}
	res, err := hc.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("harness: Muse (via the generator) didn't answer within %s", timeout)
		}
		return nil, fmt.Errorf("harness: couldn't reach the generator: %w", err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Error == "" {
			e.Error = firstN(string(data), 200)
		}
		return nil, fmt.Errorf("harness: generator answered %d: %s", res.StatusCode, e.Error)
	}
	var reply struct {
		Content string `json:"content"`
		Model   string `json:"model"`
	}
	if err := json.Unmarshal(data, &reply); err != nil {
		return nil, fmt.Errorf("harness: generator reply: %w", err)
	}
	if obj := ExtractObject(reply.Content); obj != nil {
		return obj, nil
	}
	return nil, fmt.Errorf("harness: %s didn't return a JSON object", reply.Model)
}

// MuseClient is a direct MuseJSON transport for the CLI only (the key comes from MUSE_API_KEY): Muse's
// OpenAI-compatible chat API in JSON mode, the same request shape as the generator's muse.mjs. The server
// uses GeneratorMuse instead. The key is never logged or included in an error.
type MuseClient struct {
	APIKey          string
	BaseURL         string        // default https://api.meta.ai/v1
	Model           string        // default muse-spark-1.3
	MaxTokens       int           // default 4000 (the reasoning models come back empty below that)
	ReasoningEffort string        // default "minimal" (see UnderstandMuse)
	Timeout         time.Duration // per call; default 15 s
	HTTP            *http.Client
}

// JSON implements MuseJSON.
func (c *MuseClient) JSON(ctx context.Context, system, user string) (json.RawMessage, error) {
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, errors.New("harness: Muse is not configured (no key)")
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = "https://api.meta.ai/v1"
	}
	model := c.Model
	if model == "" {
		model = "muse-spark-1.3"
	}
	budget := max(c.MaxTokens, 4000)
	effort := c.ReasoningEffort
	if effort == "" {
		effort = "minimal"
	}
	hc := c.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		body := map[string]any{
			"model":           model,
			"messages":        []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": user}},
			"response_format": map[string]string{"type": "json_object"},
			"max_tokens":      budget,
		}
		if effort != "none" {
			body["reasoning_effort"] = effort
		}
		b, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(b))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		res, err := hc.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			lastErr = fmt.Errorf("harness: couldn't reach Muse: %w", err)
			continue
		}
		data, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500 {
			lastErr = fmt.Errorf("harness: Muse answered %d", res.StatusCode)
			select {
			case <-time.After(time.Duration(attempt+1) * time.Second):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			continue
		}
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("harness: Muse answered %d: %s", res.StatusCode, firstN(string(data), 200))
		}
		var reply struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(data, &reply); err != nil || len(reply.Choices) == 0 {
			return nil, errors.New("harness: Muse sent no choices")
		}
		ch := reply.Choices[0]
		if strings.TrimSpace(ch.Message.Content) == "" && ch.FinishReason == "length" {
			budget = min(budget*2, 32000)
			lastErr = errors.New("harness: Muse ran out of tokens")
			continue
		}
		if obj := ExtractObject(ch.Message.Content); obj != nil {
			return obj, nil
		}
		lastErr = fmt.Errorf("harness: %s didn't return a JSON object", model)
	}
	return nil, lastErr
}

// ExtractObject finds the JSON object in a model reply, tolerating code fences and stray prose.
func ExtractObject(text string) json.RawMessage {
	t := strings.TrimSpace(text)
	try := func(s string) json.RawMessage {
		s = strings.TrimSpace(s)
		if !strings.HasPrefix(s, "{") {
			return nil
		}
		var v map[string]any
		if json.Unmarshal([]byte(s), &v) != nil {
			return nil
		}
		return json.RawMessage(s)
	}
	if v := try(t); v != nil {
		return v
	}
	if i := strings.Index(t, "```"); i >= 0 {
		rest := t[i+3:]
		rest = strings.TrimPrefix(rest, "json")
		if j := strings.Index(rest, "```"); j >= 0 {
			if v := try(rest[:j]); v != nil {
				return v
			}
		}
	}
	a, b := strings.Index(t, "{"), strings.LastIndex(t, "}")
	if a >= 0 && b > a {
		return try(t[a : b+1])
	}
	return nil
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
