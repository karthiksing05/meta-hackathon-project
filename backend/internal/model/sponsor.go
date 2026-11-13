package model

// Sponsor marks a game as a brand's playable ad. The server decides what is sponsored.
type Sponsor struct {
	Name      string `bson:"name" json:"name"`
	AvatarURL string `bson:"avatarUrl,omitempty" json:"avatarUrl,omitempty"`
	CTA       string `bson:"cta" json:"cta"`
	URL       string `bson:"url,omitempty" json:"url,omitempty"`
}
