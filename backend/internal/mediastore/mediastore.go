// Package mediastore keeps the photos and videos people upload to make a game from (POST /v1/media). It lives
// next to the package store, on the same volume, but in its own folder that the games server never serves:
//
//	<root>/<ownerID>/<mediaID>/meta.json    the item: kind, size, frames, the games made from it, Muse's description
//	                          /source.<ext>  the file as uploaded
//	                          /image.jpg     a photo, downscaled to at most 1024 px
//	                          /thumb.jpg     about 320 px, for the app's strip
//	                          /fNN.jpg       a video's key frames (about 480 px), named in meta.json
//
// Everything is scoped to the owner: every read takes the owner's id, so one person can never reach another's
// uploads. Media are the person's own content; deleting the game deletes the media it was made from.
package mediastore

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("media not found")

const (
	KindPhoto = "photo"
	KindVideo = "video"
)

// Frame is one key frame of a video: its time in the clip and its file (fNN.jpg).
type Frame struct {
	T     int64  `json:"t"` // milliseconds from the start
	File  string `json:"file"`
	Cut   bool   `json:"cut,omitempty"` // a scene change starts here
	Width int    `json:"w,omitempty"`
	Hgt   int    `json:"h,omitempty"`
}

// Item is one upload.
type Item struct {
	ID          string          `json:"id"`
	OwnerID     string          `json:"ownerId"`
	Kind        string          `json:"kind"`
	Mime        string          `json:"mime"`
	Source      string          `json:"source"` // file name of the upload
	Width       int             `json:"width"`
	Height      int             `json:"height"`
	DurationMs  int64           `json:"durationMs"`
	Bytes       int64           `json:"bytes"` // everything on disk for this item
	Frames      []Frame         `json:"frames,omitempty"`
	Cuts        []int64         `json:"cuts,omitempty"`
	GameIDs     []string        `json:"gameIds,omitempty"`
	Description json.RawMessage `json:"description,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
}

// Store is the media folder. Limits are per owner.
type Store struct {
	root     string
	MaxItems int
	MaxBytes int64
	mu       sync.Mutex // one writer at a time per process: quota checks and meta.json updates
}

var idRe = regexp.MustCompile(`^[0-9a-f]{24}$`)
var fileRe = regexp.MustCompile(`^[a-z0-9]+(\.[a-z0-9]+)?$`)

// ValidID reports whether id has the server-made shape.
func ValidID(id string) bool { return idRe.MatchString(id) }

func New(root string, maxItems int, maxBytes int64) (*Store, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root, MaxItems: maxItems, MaxBytes: maxBytes}, nil
}

func (s *Store) ownerDir(owner string) (string, error) {
	if owner == "" || strings.ContainsAny(owner, `/\.`) {
		return "", errors.New("mediastore: bad owner id")
	}
	return filepath.Join(s.root, owner), nil
}

func (s *Store) dir(owner, id string) (string, error) {
	if !ValidID(id) {
		return "", ErrNotFound
	}
	d, err := s.ownerDir(owner)
	if err != nil {
		return "", err
	}
	return filepath.Join(d, id), nil
}

// Usage is how many items and bytes an owner has stored.
func (s *Store) Usage(owner string) (items int, bytes int64, err error) {
	d, err := s.ownerDir(owner)
	if err != nil {
		return 0, 0, err
	}
	ents, err := os.ReadDir(d)
	if errors.Is(err, os.ErrNotExist) {
		return 0, 0, nil
	} else if err != nil {
		return 0, 0, err
	}
	for _, e := range ents {
		if !e.IsDir() || !ValidID(e.Name()) {
			continue
		}
		it, err := s.Get(owner, e.Name())
		if err != nil {
			continue
		}
		items++
		bytes += it.Bytes
	}
	return items, bytes, nil
}

// QuotaError says which per-owner limit an upload would pass.
type QuotaError struct{ Msg string }

func (e *QuotaError) Error() string { return e.Msg }

// Reserve checks the owner's quota for an upload of n bytes and makes the item's folder. Call Commit with the
// finished item, or Delete to give the space back.
func (s *Store) Reserve(owner, id string, n int64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, used, err := s.Usage(owner)
	if err != nil {
		return "", err
	}
	if s.MaxItems > 0 && items >= s.MaxItems {
		return "", &QuotaError{fmt.Sprintf("you can keep up to %d photos and videos; delete some first", s.MaxItems)}
	}
	if s.MaxBytes > 0 && used+n > s.MaxBytes {
		return "", &QuotaError{fmt.Sprintf("your uploads are limited to %d MB in all; delete some first", s.MaxBytes>>20)}
	}
	d, err := s.dir(owner, id)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(d, 0o755); err != nil {
		return "", err
	}
	// A placeholder so the reservation counts against the quota until Commit replaces it.
	return d, writeJSON(filepath.Join(d, "meta.json"), Item{ID: id, OwnerID: owner, Bytes: n, CreatedAt: time.Now().UTC()})
}

// Commit writes the item's meta.json, with Bytes counted from the folder.
func (s *Store) Commit(it *Item) error {
	d, err := s.dir(it.OwnerID, it.ID)
	if err != nil {
		return err
	}
	var total int64
	filepath.WalkDir(d, func(_ string, e os.DirEntry, err error) error {
		if err == nil && !e.IsDir() && e.Name() != "meta.json" {
			if fi, err := e.Info(); err == nil {
				total += fi.Size()
			}
		}
		return nil
	})
	it.Bytes = total
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSON(filepath.Join(d, "meta.json"), it)
}

// Path is the path of one file in an item's folder (for writing during an upload, or reading).
func (s *Store) Path(owner, id, name string) (string, error) {
	if !fileRe.MatchString(name) {
		return "", ErrNotFound
	}
	d, err := s.dir(owner, id)
	if err != nil {
		return "", err
	}
	return filepath.Join(d, name), nil
}

// Get reads an item; ErrNotFound when it isn't the owner's.
func (s *Store) Get(owner, id string) (*Item, error) {
	d, err := s.dir(owner, id)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(d, "meta.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	var it Item
	if err := json.Unmarshal(b, &it); err != nil {
		return nil, err
	}
	if it.OwnerID != owner {
		return nil, ErrNotFound
	}
	return &it, nil
}

// ReadFile reads one of an item's files.
func (s *Store) ReadFile(owner, id, name string) ([]byte, error) {
	p, err := s.Path(owner, id, name)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

// Update changes an item's meta.json under the lock.
func (s *Store) Update(owner, id string, change func(*Item)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	it, err := s.Get(owner, id)
	if err != nil {
		return err
	}
	change(it)
	d, _ := s.dir(owner, id)
	return writeJSON(filepath.Join(d, "meta.json"), it)
}

// Delete removes an item and every file in it.
func (s *Store) Delete(owner, id string) error {
	d, err := s.dir(owner, id)
	if err != nil {
		return err
	}
	if _, err := os.Stat(d); errors.Is(err, os.ErrNotExist) {
		return ErrNotFound
	}
	return os.RemoveAll(d)
}

// DeleteForGame removes the owner's items a game was made from, and returns their ids.
func (s *Store) DeleteForGame(owner, gameID string) ([]string, error) {
	d, err := s.ownerDir(owner)
	if err != nil {
		return nil, err
	}
	ents, err := os.ReadDir(d)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var gone []string
	for _, e := range ents {
		it, err := s.Get(owner, e.Name())
		if err != nil {
			continue
		}
		for _, g := range it.GameIDs {
			if g == gameID {
				if err := s.Delete(owner, it.ID); err == nil {
					gone = append(gone, it.ID)
				}
				break
			}
		}
	}
	sort.Strings(gone)
	return gone, nil
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
