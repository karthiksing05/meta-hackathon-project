package srv

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

type User struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	AvatarURL string   `json:"avatar_url"`
	IsCreator bool     `json:"is_creator"`
	Follows   []string `json:"follows"`
	Friends   []string `json:"friends"`
}

type Group struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	MemberIDs []string `json:"member_ids"`
	MediaIDs  []string `json:"media_ids"`
}

type Media struct {
	ID      string    `json:"id"`
	URL     string    `json:"url"`
	Caption string    `json:"caption"`
	GroupID string    `json:"group_id"`
	OwnerID string    `json:"owner_id"`
	TakenAt time.Time `json:"taken_at"`
}

type GenInfo struct {
	MS               int64            `json:"ms"`
	Stages           map[string]int64 `json:"stages"`
	Source           string           `json:"source"`
	CostUSD          float64          `json:"cost_usd"`
	PromptTokens     int              `json:"prompt_tokens"`
	CompletionTokens int              `json:"completion_tokens"`
	Notes            []string         `json:"notes,omitempty"`
}

type GameStats struct {
	Plays int `json:"plays"`
	Best  int `json:"best"`
}

type Game struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	CreatorID   string          `json:"creator_id"`
	Status      string          `json:"status"`
	Moderation  *Moderation     `json:"moderation,omitempty"`
	Manifest    json.RawMessage `json:"manifest,omitempty"`
	Content     json.RawMessage `json:"content,omitempty"`
	Brief       json.RawMessage `json:"brief,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	Gen         GenInfo         `json:"gen"`
	Stats       GameStats       `json:"stats"`
}

type Play struct {
	ID          string          `json:"id"`
	GameID      string          `json:"game_id"`
	UserID      string          `json:"user_id"`
	Seed        uint32          `json:"seed"`
	Inputs      json.RawMessage `json:"inputs,omitempty"`
	Score       int             `json:"score"`
	Ticks       int             `json:"ticks"`
	Verified    bool            `json:"verified"`
	ChallengeID string          `json:"challenge_id,omitempty"`
	Daily       bool            `json:"daily,omitempty"`
	Date        string          `json:"date,omitempty"`
	Practice    bool            `json:"practice,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

type Challenge struct {
	ID        string    `json:"id"`
	GameID    string    `json:"game_id"`
	PlayID    string    `json:"play_id"`
	FromID    string    `json:"from_user_id"`
	ToUserIDs []string  `json:"to_user_ids"`
	Seed      uint32    `json:"seed"`
	Score     int       `json:"score"`
	CreatedAt time.Time `json:"created_at"`
}

// FeedItem is the stored form; the API expands actor/game/play/challenge.
type FeedItem struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	ActorID     string    `json:"actor_id"`
	GameID      string    `json:"game_id"`
	PlayID      string    `json:"play_id,omitempty"`
	ChallengeID string    `json:"challenge_id,omitempty"`
	ToUserIDs   []string  `json:"to_user_ids,omitempty"`
	Text        string    `json:"text"`
	CreatedAt   time.Time `json:"created_at"`
}

type data struct {
	Users      []User                `json:"users"`
	Groups     []Group               `json:"groups"`
	Media      []Media               `json:"media"`
	Games      map[string]*Game      `json:"games"`
	Plays      map[string]*Play      `json:"plays"`
	Challenges map[string]*Challenge `json:"challenges"`
	Feed       []FeedItem            `json:"feed"`
	Daily      map[string]string     `json:"daily,omitempty"` // UTC date -> pinned daily game id
	Reports    []Report              `json:"reports,omitempty"`
}

// Store is the in-memory database with atomic JSON persistence.
type Store struct {
	mu   sync.RWMutex
	path string
	d    data
}

func OpenStore(dir string) (*Store, bool) {
	s := &Store{path: filepath.Join(dir, "store.json")}
	if raw, err := os.ReadFile(s.path); err == nil && json.Unmarshal(raw, &s.d) == nil && len(s.d.Users) > 0 {
		s.ensureMaps()
		return s, false
	}
	s.d = data{}
	s.ensureMaps()
	return s, true
}

func (s *Store) ensureMaps() {
	if s.d.Games == nil {
		s.d.Games = map[string]*Game{}
	}
	if s.d.Plays == nil {
		s.d.Plays = map[string]*Play{}
	}
	if s.d.Challenges == nil {
		s.d.Challenges = map[string]*Challenge{}
	}
	if s.d.Daily == nil {
		s.d.Daily = map[string]string{}
	}
}

// saveLocked persists; callers hold s.mu.
func (s *Store) saveLocked() {
	if s.path == "" {
		return
	}
	_ = writeJSONAtomic(s.path, s.d)
}

func (s *Store) user(id string) (User, bool) {
	for _, u := range s.d.Users {
		if u.ID == id {
			return u, true
		}
	}
	return User{}, false
}

func newID(prefix string) string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// Cache is a persisted key/value cache of generation outputs.
type Cache struct {
	mu   sync.Mutex
	path string
	m    map[string]json.RawMessage
}

func OpenCache(dir string) *Cache {
	c := &Cache{path: filepath.Join(dir, "cache.json"), m: map[string]json.RawMessage{}}
	if raw, err := os.ReadFile(c.path); err == nil {
		_ = json.Unmarshal(raw, &c.m)
	}
	return c
}

func (c *Cache) Get(k string) (json.RawMessage, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[k]
	return v, ok
}

func (c *Cache) Put(k string, v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[k] = raw
	_ = writeJSONAtomic(c.path, c.m)
}

var picsumMediaRe = regexp.MustCompile(`https://picsum\.photos/seed/sg-(m\d+)/600/400`)

// migrateLocalMedia rewrites picsum sg-<id> media URLs (in the media list and in stored
// game content) to local /media URLs when the generated file exists. It reports changes.
func (s *Store) migrateLocalMedia() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	swap := func(src []byte) []byte {
		return picsumMediaRe.ReplaceAllFunc(src, func(m []byte) []byte {
			id := string(picsumMediaRe.FindSubmatch(m)[1])
			if localMediaExists(id) {
				return []byte("/media/" + id + ".jpg")
			}
			return m
		})
	}
	changed := false
	for i := range s.d.Media {
		if u := string(swap([]byte(s.d.Media[i].URL))); u != s.d.Media[i].URL {
			s.d.Media[i].URL, changed = u, true
		}
	}
	for _, g := range s.d.Games {
		if len(g.Content) == 0 {
			continue
		}
		if c := swap(g.Content); !bytes.Equal(c, g.Content) {
			g.Content, changed = c, true
		}
	}
	return changed
}
