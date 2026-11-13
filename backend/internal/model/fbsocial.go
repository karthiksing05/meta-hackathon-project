package model

import "time"

// The wider Facebook surfaces: people, posts and reels, stories and Messenger. Authors and chat members are either
// server accounts (24-hex ids) or Personas: the synthetic people of the demo world (ids like "sf-maya-okafor"),
// loaded from internal/fbseed. Personas are invented; their avatars are cartoons.

// Persona is a synthetic person or Page of the demo world.
type Persona struct {
	ID        string `bson:"_id" json:"id"`
	FirstName string `bson:"firstName" json:"firstName"`
	LastName  string `bson:"lastName,omitempty" json:"lastName,omitempty"`
	Kind      string `bson:"kind" json:"kind"` // person or page
	Category  string `bson:"category,omitempty" json:"category,omitempty"`
	AvatarURL string `bson:"avatarUrl,omitempty" json:"avatarUrl,omitempty"`
	CoverURL  string `bson:"coverUrl,omitempty" json:"coverUrl,omitempty"`
	Bio       string `bson:"bio,omitempty" json:"bio,omitempty"`
	City      string `bson:"city,omitempty" json:"city,omitempty"`
	Work      string `bson:"work,omitempty" json:"work,omitempty"`
	Verified  bool   `bson:"verified,omitempty" json:"verified,omitempty"`
}

// FBMedia is one photo or video on a post, reel or story.
type FBMedia struct {
	Kind     string  `bson:"kind" json:"kind"` // photo or video
	URL      string  `bson:"url,omitempty" json:"url,omitempty"`
	VideoURL string  `bson:"videoUrl,omitempty" json:"videoUrl,omitempty"`
	Aspect   float64 `bson:"aspect,omitempty" json:"aspect,omitempty"` // width / height
	Duration float64 `bson:"duration,omitempty" json:"duration,omitempty"`
}

type FBPollOption struct {
	ID    string `bson:"id" json:"id"`
	Title string `bson:"title" json:"title"`
	Votes int    `bson:"votes" json:"votes"`
}

type FBComment struct {
	ID        string    `bson:"id" json:"id"`
	AuthorID  string    `bson:"authorId" json:"authorId"`
	Text      string    `bson:"text" json:"text"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
}

// FBPost is a feed post (Kind "post") or a reel (Kind "reel").
type FBPost struct {
	ID         string         `bson:"_id" json:"id"`
	Kind       string         `bson:"kind" json:"kind"`
	AuthorID   string         `bson:"authorId" json:"authorId"`
	GroupID    string         `bson:"groupId,omitempty" json:"groupId,omitempty"`
	Text       string         `bson:"text" json:"text"`
	Background *int           `bson:"background,omitempty" json:"background,omitempty"`
	Media      []FBMedia      `bson:"media,omitempty" json:"media,omitempty"`
	Poll       []FBPollOption `bson:"poll,omitempty" json:"poll,omitempty"`
	Feeling    string         `bson:"feeling,omitempty" json:"feeling,omitempty"`
	Location   string         `bson:"location,omitempty" json:"location,omitempty"`
	Life       string         `bson:"lifeEvent,omitempty" json:"lifeEvent,omitempty"`
	Audio      string         `bson:"audio,omitempty" json:"audio,omitempty"`
	Sponsored  bool           `bson:"sponsored,omitempty" json:"sponsored,omitempty"`
	// AllowsGames marks a post the app may turn into a game (the New in SF intros).
	AllowsGames bool `bson:"allowsGames,omitempty" json:"allowsGames,omitempty"`
	// GameID is the game a post carries as a playable card (a Curio posted from Muse Studio).
	GameID string `bson:"gameId,omitempty" json:"gameId,omitempty"`
	// Reactions seeded with the demo world (type -> count), plus each signed-in person's own reaction.
	BaseReactions map[string]int    `bson:"baseReactions,omitempty" json:"-"`
	ReactionsBy   map[string]string `bson:"reactionsBy,omitempty" json:"-"` // user id -> type
	Comments      []FBComment       `bson:"comments,omitempty" json:"-"`
	Shares        int               `bson:"shares,omitempty" json:"shares"`
	Views         int               `bson:"views,omitempty" json:"views"`
	CreatedAt     time.Time         `bson:"createdAt" json:"createdAt"`
}

// FBStory is one story item; the tray groups them by author.
type FBStory struct {
	ID         string     `bson:"_id" json:"id"`
	AuthorID   string     `bson:"authorId" json:"authorId"`
	Media      *FBMedia   `bson:"media,omitempty" json:"media,omitempty"`
	Text       string     `bson:"text,omitempty" json:"text,omitempty"`
	Background int        `bson:"background,omitempty" json:"background,omitempty"`
	Caption    string     `bson:"caption,omitempty" json:"caption,omitempty"`
	CreatedAt  time.Time  `bson:"createdAt" json:"createdAt"`
	ExpiresAt  *time.Time `bson:"expiresAt,omitempty" json:"expiresAt,omitempty"` // nil for the demo world's stories
}

// FBThread is a Messenger chat: one-to-one or a group chat. OwnerID is the account it was made for (a demo thread
// copied for a new person) or that started it.
type FBThread struct {
	ID       string    `bson:"_id" json:"id"`
	Members  []string  `bson:"members" json:"members"`
	Name     string    `bson:"name,omitempty" json:"name,omitempty"`
	Theme    string    `bson:"theme,omitempty" json:"theme,omitempty"` // hex like "0A7CFF"
	Emoji    string    `bson:"emoji,omitempty" json:"emoji,omitempty"`
	OwnerID  string    `bson:"ownerId" json:"-"`
	LastAt   time.Time `bson:"lastAt" json:"lastAt"`
	LastText string    `bson:"lastText,omitempty" json:"lastText,omitempty"`
	// ReadAt is when each member last read the thread; unread counts come from it.
	ReadAt map[string]time.Time `bson:"readAt,omitempty" json:"-"`
}

type FBMessage struct {
	ID       string    `bson:"_id" json:"id"`
	ThreadID string    `bson:"threadId" json:"threadId"`
	SenderID string    `bson:"senderId" json:"senderId"`
	Text     string    `bson:"text,omitempty" json:"text,omitempty"`
	ImageURL string    `bson:"imageUrl,omitempty" json:"imageUrl,omitempty"`
	Emoji    string    `bson:"emoji,omitempty" json:"emoji,omitempty"` // a big emoji
	SentAt   time.Time `bson:"sentAt" json:"sentAt"`
}
