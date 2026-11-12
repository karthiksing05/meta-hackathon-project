package srv

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// price is USD per 1M tokens, which equals micro-USD per token.
type price struct{ in, out float64 }

var prices = map[string]price{
	"muse-ember-1.0":  {0.10, 0.50},
	"muse-wonder-1.0": {4.00, 20.00},
}

func priceFor(model string) price {
	if p, ok := prices[model]; ok {
		return p
	}
	return prices["muse-wonder-1.0"] // unknown models are costed conservatively
}

// CostMicro returns the cost in micro-USD, rounded up.
func CostMicro(model string, prompt, completion int) int64 {
	p := priceFor(model)
	return int64(math.Ceil(float64(prompt)*p.in + float64(completion)*p.out))
}

// EstimateMicro is the pre-call worst case: ~3 chars/token input plus max_tokens output.
func EstimateMicro(model string, inputChars, maxTokens int) int64 {
	return CostMicro(model, inputChars/3+1, maxTokens)
}

// Call is one metered Muse call.
type Call struct {
	Time             time.Time `json:"time"`
	Model            string    `json:"model"`
	Purpose          string    `json:"purpose"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	CostUSD          float64   `json:"cost_usd"`
	MS               int64     `json:"ms"`
	Status           string    `json:"status"`
}

// ModelUsage aggregates per model.
type ModelUsage struct {
	Calls            int     `json:"calls"`
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	CostUSD          float64 `json:"cost_usd"`
}

type usageFile struct {
	SpentMicro int64                 `json:"spent_micro"`
	Calls      []Call                `json:"calls"`
	ByModel    map[string]ModelUsage `json:"by_model"`
}

// Budget enforces the hard spend cap, persisted across restarts.
type Budget struct {
	mu       sync.Mutex
	path     string
	capMicro int64
	reserved int64
	data     usageFile
}

const maxStoredCalls = 200

func NewBudget(path string, capUSD float64) *Budget {
	b := &Budget{path: path, capMicro: int64(math.Round(capUSD * 1e6))}
	b.data.ByModel = map[string]ModelUsage{}
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &b.data)
		if b.data.ByModel == nil {
			b.data.ByModel = map[string]ModelUsage{}
		}
	}
	return b
}

// Reserve holds est micro-USD; it refuses when spent+reserved+est would exceed the cap.
func (b *Budget) Reserve(est int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.data.SpentMicro+b.reserved+est > b.capMicro {
		return false
	}
	b.reserved += est
	return true
}

func (b *Budget) Release(est int64) {
	b.mu.Lock()
	b.reserved -= est
	b.mu.Unlock()
}

// Record settles a reservation with the actual usage and persists.
func (b *Budget) Record(est int64, c Call) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.reserved -= est
	micro := CostMicro(c.Model, c.PromptTokens, c.CompletionTokens)
	b.data.SpentMicro += micro
	c.CostUSD = float64(micro) / 1e6
	c.Time = time.Now().UTC()
	b.data.Calls = append(b.data.Calls, c)
	if len(b.data.Calls) > maxStoredCalls {
		b.data.Calls = b.data.Calls[len(b.data.Calls)-maxStoredCalls:]
	}
	m := b.data.ByModel[c.Model]
	m.Calls++
	m.PromptTokens += c.PromptTokens
	m.CompletionTokens += c.CompletionTokens
	m.CostUSD += c.CostUSD
	b.data.ByModel[c.Model] = m
	b.saveLocked()
}

func (b *Budget) Spent() float64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return float64(b.data.SpentMicro) / 1e6
}

// Snapshot is the GET /api/usage payload body.
func (b *Budget) Snapshot() map[string]any {
	b.mu.Lock()
	defer b.mu.Unlock()
	calls := append([]Call{}, b.data.Calls...)
	return map[string]any{
		"spent_usd": float64(b.data.SpentMicro) / 1e6,
		"cap_usd":   float64(b.capMicro) / 1e6,
		"calls":     calls,
		"by_model":  b.data.ByModel,
	}
}

func (b *Budget) saveLocked() {
	if b.path == "" {
		return
	}
	_ = writeJSONAtomic(b.path, b.data)
}

func writeJSONAtomic(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	tmp.Close()
	return os.Rename(tmp.Name(), path)
}
