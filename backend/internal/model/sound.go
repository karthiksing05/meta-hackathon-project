package model

import "time"

// Sound is a loop that plays behind a game, like a TikTok sound. Its files are a published package (the same store and
// host as games): StorageKey is the package id, AudioPath and CoverPath are relative to it.
type Sound struct {
	ID            string    `bson:"_id"`
	Title         string    `bson:"title"`
	OwnerID       string    `bson:"ownerId"`
	OwnerUsername string    `bson:"ownerUsername"`
	Kind          string    `bson:"kind"` // library or original
	DurationMs    int64     `bson:"durationMs,omitempty"`
	BPM           int       `bson:"bpm,omitempty"`
	StorageKey    string    `bson:"storageKey"`
	AudioPath     string    `bson:"audioPath"`
	CoverPath     string    `bson:"coverPath,omitempty"`
	UseCount      int64     `bson:"useCount"` // games using it
	Saves         int64     `bson:"saves"`
	CreatedAt     time.Time `bson:"createdAt"`
}

// GameSound is a sound attached to a game: where in the loop to start, and how loud it is against the game's own sound
// effects (0 is only the game, 1 is only the sound).
type GameSound struct {
	ID       string  `bson:"id" json:"id"`
	OffsetMs int64   `bson:"offsetMs,omitempty" json:"offsetMs"`
	Mix      float64 `bson:"mix" json:"mix"`
}

// SoundView is a sound as the app sees it.
type SoundView struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Creator    string    `json:"creator"`
	CreatorID  string    `json:"creatorId"`
	Kind       string    `json:"kind"`
	DurationMs int64     `json:"durationMs,omitempty"`
	BPM        int       `json:"bpm,omitempty"`
	AudioURL   string    `json:"audioUrl"`
	CoverURL   string    `json:"coverUrl,omitempty"`
	UseCount   int64     `json:"useCount"`
	Saves      int64     `json:"saves"`
	SavedByMe  bool      `json:"savedByMe"`
	CreatedAt  time.Time `json:"createdAt"`
}

// GameSoundView is the sound on a game, with what the player needs to play it.
type GameSoundView struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Creator  string  `json:"creator"`
	AudioURL string  `json:"audioUrl"`
	CoverURL string  `json:"coverUrl,omitempty"`
	OffsetMs int64   `json:"offsetMs"`
	Mix      float64 `json:"mix"`
}
