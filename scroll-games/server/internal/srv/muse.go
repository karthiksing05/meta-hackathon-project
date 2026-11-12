package srv

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	ModelWonder = "muse-wonder-1.0"
	ModelEmber  = "muse-ember-1.0"
)

var (
	ErrBudget = errors.New("spend cap reached")
	ErrNoKey  = errors.New("muse not configured")
)

// HTTPError is a non-2xx answer from Muse (body is truncated; never contains credentials).
type HTTPError struct {
	Status int
	Body   string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("muse http %d: %s", e.Status, e.Body) }

type ChatReq struct {
	Model      string
	Purpose    string
	System     string
	User       string
	MaxTokens  int
	SchemaName string
	Schema     map[string]any
	Reasoning  string
}

type ChatResult struct {
	Content          string
	PromptTokens     int
	CompletionTokens int
	CostUSD          float64
	MS               int64
}

// Caps records whether optional request fields were accepted ("untested","accepted","rejected").
type Caps struct {
	ReasoningEffort string `json:"reasoning_effort"`
	ResponseFormat  string `json:"response_format"`
}

type Muse struct {
	baseURL string
	key     string
	client  *http.Client
	budget  *Budget

	mu   sync.Mutex
	caps map[string]*Caps
}

func NewMuse(cfg Config, b *Budget) *Muse {
	return &Muse{
		baseURL: strings.TrimRight(cfg.MuseBaseURL, "/"),
		key:     cfg.MuseKey,
		client:  newMuseClient(),
		budget:  b,
		caps:    map[string]*Caps{},
	}
}

func (m *Muse) Configured() bool { return m.key != "" }

func (m *Muse) Capabilities() map[string]Caps {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]Caps{}
	for k, v := range m.caps {
		out[k] = *v
	}
	return out
}

func (m *Muse) capsFor(model string) *Caps {
	c, ok := m.caps[model]
	if !ok {
		c = &Caps{ReasoningEffort: "untested", ResponseFormat: "untested"}
		m.caps[model] = c
	}
	return c
}

func (m *Muse) setCap(model string, reasoning bool, v string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.capsFor(model)
	if reasoning {
		c.ReasoningEffort = v
	} else {
		c.ResponseFormat = v
	}
}

func (m *Muse) rejected(model string, reasoning bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.capsFor(model)
	if reasoning {
		return c.ReasoningEffort == "rejected"
	}
	return c.ResponseFormat == "rejected"
}

const jsonOnlySuffix = "\nRespond with ONLY one JSON object. No markdown, no commentary."

// Chat performs one metered chat completion, adapting to rejected optional fields.
func (m *Muse) Chat(ctx context.Context, r ChatReq) (*ChatResult, error) {
	if m.key == "" {
		return nil, ErrNoKey
	}
	est := EstimateMicro(r.Model, len(r.System)+len(r.User), r.MaxTokens)
	if !m.budget.Reserve(est) {
		return nil, ErrBudget
	}
	settled := false
	defer func() {
		if !settled {
			m.budget.Release(est)
		}
	}()

	useReason := r.Reasoning != "" && !m.rejected(r.Model, true)
	useSchema := r.Schema != nil && !m.rejected(r.Model, false)
	start := time.Now()
	retried429 := false

	for attempt := 0; attempt < 4; attempt++ {
		system := r.System
		if !useSchema {
			system += jsonOnlySuffix
		}
		body := map[string]any{
			"model":      r.Model,
			"max_tokens": r.MaxTokens,
			"messages": []map[string]string{
				{"role": "system", "content": system},
				{"role": "user", "content": r.User},
			},
		}
		if useReason {
			body["reasoning_effort"] = r.Reasoning
		}
		if useSchema {
			body["response_format"] = map[string]any{
				"type":        "json_schema",
				"json_schema": map[string]any{"name": r.SchemaName, "schema": r.Schema, "strict": false},
			}
		}
		status, resp, retryAfter, err := m.post(ctx, body)
		if err != nil {
			return nil, err
		}
		switch {
		case status == 200:
			var parsed struct {
				Choices []struct {
					Message struct {
						Content json.RawMessage `json:"content"`
					} `json:"message"`
				} `json:"choices"`
				Usage struct {
					PromptTokens     int `json:"prompt_tokens"`
					CompletionTokens int `json:"completion_tokens"`
				} `json:"usage"`
			}
			if err := json.Unmarshal(resp, &parsed); err != nil || len(parsed.Choices) == 0 {
				return nil, fmt.Errorf("muse: unreadable response")
			}
			if useReason {
				m.setCap(r.Model, true, "accepted")
			}
			if useSchema {
				m.setCap(r.Model, false, "accepted")
			}
			ms := time.Since(start).Milliseconds()
			m.budget.Record(est, Call{Model: r.Model, Purpose: r.Purpose, PromptTokens: parsed.Usage.PromptTokens,
				CompletionTokens: parsed.Usage.CompletionTokens, MS: ms, Status: "ok"})
			settled = true
			micro := CostMicro(r.Model, parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens)
			return &ChatResult{
				Content:          contentString(parsed.Choices[0].Message.Content),
				PromptTokens:     parsed.Usage.PromptTokens,
				CompletionTokens: parsed.Usage.CompletionTokens,
				CostUSD:          float64(micro) / 1e6,
				MS:               ms,
			}, nil
		case status == 429 && !retried429:
			retried429 = true
			wait := retryAfter
			if wait <= 0 {
				wait = time.Second
			}
			wait += time.Duration(rand.Int63n(int64(wait)/2 + 1))
			if dl, ok := ctx.Deadline(); ok && time.Until(dl) < wait {
				return nil, &HTTPError{Status: status, Body: truncate(string(resp), 300)}
			}
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		case status == 400 && (useReason || useSchema):
			low := strings.ToLower(string(resp))
			schemaHint := strings.Contains(low, "response_format") || strings.Contains(low, "json_schema") || strings.Contains(low, "schema")
			reasonHint := strings.Contains(low, "reasoning")
			if useSchema && schemaHint && !(useReason && reasonHint) {
				m.setCap(r.Model, false, "rejected")
				useSchema = false
			} else if useReason {
				m.setCap(r.Model, true, "rejected")
				useReason = false
			} else {
				m.setCap(r.Model, false, "rejected")
				useSchema = false
			}
		default:
			m.budget.Record(est, Call{Model: r.Model, Purpose: r.Purpose, MS: time.Since(start).Milliseconds(), Status: fmt.Sprintf("http %d", status)})
			settled = true
			return nil, &HTTPError{Status: status, Body: truncate(string(resp), 500)}
		}
	}
	return nil, errors.New("muse: too many retries")
}

func (m *Muse) post(ctx context.Context, body map[string]any) (int, []byte, time.Duration, error) {
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return 0, nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+m.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, 0, ctx.Err()
		}
		return 0, nil, 0, errors.New("muse request failed")
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	var ra time.Duration
	if v := resp.Header.Get("Retry-After"); v != "" {
		if secs, err := strconv.ParseFloat(v, 64); err == nil {
			ra = time.Duration(secs * float64(time.Second))
		}
	}
	return resp.StatusCode, data, ra, nil
}

func contentString(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) == nil {
		var sb strings.Builder
		for _, p := range parts {
			sb.WriteString(p.Text)
		}
		return sb.String()
	}
	return string(raw)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ExtractJSONObject returns the first balanced top-level {...} in s.
func ExtractJSONObject(s string) (json.RawMessage, error) {
	start := strings.IndexByte(s, '{')
	if start < 0 {
		return nil, errors.New("no JSON object in model output")
	}
	depth, inStr, esc := 0, false, false
	for i := start; i < len(s); i++ {
		c := s[i]
		if inStr {
			switch {
			case esc:
				esc = false
			case c == '\\':
				esc = true
			case c == '"':
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				obj := s[start : i+1]
				if !json.Valid([]byte(obj)) {
					return nil, errors.New("invalid JSON in model output")
				}
				return json.RawMessage(obj), nil
			}
		}
	}
	return nil, errors.New("unterminated JSON in model output")
}

// newMuseClient returns a client with a keep-alive pool so calls reuse warm TLS connections.
func newMuseClient() *http.Client {
	return &http.Client{Transport: &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        16,
		MaxIdleConnsPerHost: 8,
		IdleConnTimeout:     5 * time.Minute,
		TLSHandshakeTimeout: 10 * time.Second,
	}}
}

// Prewarm opens (and pools) a connection to the Muse host so the first real call skips DNS and TLS.
func (m *Muse) Prewarm(ctx context.Context) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, m.baseURL, nil)
	if err != nil {
		return
	}
	if resp, err := m.client.Do(req); err == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
}
