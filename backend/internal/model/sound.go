package model

import "time"

// Sound is a loop that plays behind a game, like a TikTok sound. Its files are a published package (the same store and
// host as games): StorageKey is the package id, AudioPath and CoverPath are relative to it.
type Sound struct {
	ID            string `bson:"_id"`
	Title         string `bson:"title"`
	OwnerID       string `bson:"ownerId"`
	OwnerUsername string `bson:"ownerUsername"`
	Kind          string `bson:"kind"` // library or original
	DurationMs    int64  `bson:"durationMs,omitempty"`
	BPM           int    `bson:"bpm,omitempty"`
	StorageKey    string `bson:"storageKey"`
	AudioPath     string `bson:"audioPath"`
	CoverPath     string `bson:"coverPath,omitempty"`
	// Credit for library tracks made by someone other than the uploader (CC BY needs it shown wherever the track
	// plays): the artist shown as the sound's creator, the licence, the full attribution line and the source page.
	Artist      string    `bson:"artist,omitempty"`
	License     string    `bson:"license,omitempty"`
	Attribution string    `bson:"attribution,omitempty"`
	SourceURL   string    `bson:"sourceUrl,omitempty"`
	Tags        []string  `bson:"tags,omitempty"` // mood, energy, game style: "hype", "chill", "retro"
	UseCount    int64     `bson:"useCount"`       // games using it
	Saves       int64     `bson:"saves"`
	CreatedAt   time.Time `bson:"createdAt"`
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
	// Credit (library tracks by other artists): shown on the sound's page.
	License     string   `json:"license,omitempty"`
	Attribution string   `json:"attribution,omitempty"`
	SourceURL   string   `json:"sourceUrl,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// Credit is who a sound shows as its creator: the artist for a credited library track, else the uploader.
func (s Sound) Credit() string {
	if s.Artist != "" {
		return s.Artist
	}
	return s.OwnerUsername
}

// GameSoundView is the sound on a game, with what the player needs to play it.
type GameSoundView struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Creator  string `json:"creator"`
	AudioURL string `json:"audioUrl"`
	CoverURL string `json:"coverUrl,omitempty"`
	// Attribution is the credit line a CC BY track needs wherever it plays.
	Attribution string  `json:"attribution,omitempty"`
	OffsetMs    int64   `json:"offsetMs"`
	Mix         float64 `json:"mix"`
}
