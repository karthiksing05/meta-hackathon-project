package model

import "time"

// Notification kinds.
const (
	NotifGroupGame       = "group_game"       // someone shared a game into a Group you are in
	NotifFriendChallenge = "friend_challenge" // a friend challenged you, or started a best-of with you
	NotifLeaderboardLost = "leaderboard_lost" // someone took first place from you
	NotifViralMatch      = "viral_match"      // a game many people are playing that fits your taste
)

// Push states of a notification's lock-screen delivery.
const (
	PushNone    = ""        // nothing to send (no registered device, or APNs is not configured)
	PushPending = "pending" // waiting to be sent, or to be retried at NextPushAt
	PushSent    = "sent"
	PushFailed  = "failed" // gave up (too many tries, or the device token was refused)
)

// Notification is one row of a person's inbox. It doubles as the push outbox: PushState says whether the lock-screen
// delivery is still to do. A (user, source) pair is unique, so a retried trigger never makes a second row.
type Notification struct {
	ID          string     `bson:"_id" json:"id"`
	UserID      string     `bson:"userId" json:"-"`
	Kind        string     `bson:"kind" json:"kind"`
	Title       string     `bson:"title" json:"title"`
	Body        string     `bson:"body" json:"body"`
	GameID      string     `bson:"gameId,omitempty" json:"gameId,omitempty"`
	GroupID     string     `bson:"groupId,omitempty" json:"groupId,omitempty"`
	ChallengeID string     `bson:"challengeId,omitempty" json:"challengeId,omitempty"`
	SeriesID    string     `bson:"seriesId,omitempty" json:"seriesId,omitempty"`
	Source      string     `bson:"source" json:"-"` // what caused it; with the user it makes the row unique
	CreatedAt   time.Time  `bson:"createdAt" json:"createdAt"`
	ReadAt      *time.Time `bson:"readAt,omitempty" json:"readAt,omitempty"`

	PushState    string    `bson:"pushState,omitempty" json:"-"`
	PushAttempts int       `bson:"pushAttempts,omitempty" json:"-"`
	NextPushAt   time.Time `bson:"nextPushAt,omitempty" json:"-"`
	PushError    string    `bson:"pushError,omitempty" json:"-"`
}

// PushDevice is one app installation that can get lock-screen notifications. An installation belongs to one person at a
// time: registering it for another account moves it.
type PushDevice struct {
	InstallationID string    `bson:"_id" json:"installationId"`
	UserID         string    `bson:"userId" json:"-"`
	Token          string    `bson:"token" json:"-"`
	Environment    string    `bson:"environment" json:"environment"` // sandbox or production
	UpdatedAt      time.Time `bson:"updatedAt" json:"updatedAt"`
}
