// Package model holds the stored and wire types shared by the store and the HTTP layer.
package model

import "time"

type User struct {
	ID           string    `bson:"_id" json:"id"`
	Email        string    `bson:"email" json:"email,omitempty"` // lowercased, unique
	Username     string    `bson:"username" json:"username"`     // lowercased, unique
	DisplayName  string    `bson:"displayName" json:"displayName"`
	PasswordHash string    `bson:"passwordHash" json:"-"`
	CreatedAt    time.Time `bson:"createdAt" json:"createdAt"`
}

type RefreshToken struct {
	Hash      string    `bson:"_id"` // sha256 hex of the opaque token
	UserID    string    `bson:"userId"`
	ExpiresAt time.Time `bson:"expiresAt"` // TTL index removes expired rows
}

// Game is the stored metadata. Package files live in the PackageStore under StorageKey;
// only relative paths are stored, the public hostname is applied when responding.
type Game struct {
	ID            string    `bson:"_id"`
	OwnerID       string    `bson:"ownerId"`
	OwnerUsername string    `bson:"ownerUsername"`
	Title         string    `bson:"title"`
	Description   string    `bson:"description"`
	Tags          []string  `bson:"tags"`
	Formula       string    `bson:"formula"`
	StorageKey    string    `bson:"storageKey"`   // = game id; directory under published/
	ManifestPath  string    `bson:"manifestPath"` // relative to StorageKey
	CoverPath     string    `bson:"coverPath,omitempty"`
	HasSource     bool      `bson:"hasSource"`
	RemixOf       string    `bson:"remixOf,omitempty"`
	Likes         int64     `bson:"likes"` // "saves are the likes": one counter
	Plays         int64     `bson:"plays"`
	Finishes      int64     `bson:"finishes"`
	CreatedAt     time.Time `bson:"createdAt"`
}

type GameView struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	Tags          []string  `json:"tags"`
	Formula       string    `json:"formula"`
	OwnerID       string    `json:"ownerId"`
	OwnerUsername string    `json:"ownerUsername"`
	Likes         int64     `json:"likes"`
	Plays         int64     `json:"plays"`
	Finishes      int64     `json:"finishes"`
	LikedByMe     bool      `json:"likedByMe"`
	RemixOf       string    `json:"remixOf,omitempty"`
	PackageURL    string    `json:"packageUrl"`
	ManifestURL   string    `json:"manifestUrl"`
	CoverURL      string    `json:"coverUrl,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

type Event struct {
	ID        string    `bson:"_id" json:"-"`
	UserID    string    `bson:"userId,omitempty" json:"-"`
	DeviceID  string    `bson:"deviceId,omitempty" json:"deviceId,omitempty"`
	GameID    string    `bson:"gameId" json:"gameId"`
	Type      string    `bson:"type" json:"type"`
	Value     float64   `bson:"value,omitempty" json:"value,omitempty"`
	CreatedAt time.Time `bson:"createdAt" json:"-"`
}

var EventTypes = map[string]bool{
	"view": true, "play": true, "finish": true, "quit": true, "skip": true,
	"replay": true, "like": true, "unlike": true, "share": true, "remix": true,
}

type Score struct {
	GameID    string    `bson:"gameId" json:"-"`
	UserID    string    `bson:"userId" json:"userId"`
	Username  string    `bson:"username" json:"username"`
	Score     float64   `bson:"score" json:"score"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}
