// Package fbseed holds the synthetic demo world for the Facebook surfaces (posts, reels, stories, Messenger):
// invented people and Pages with cartoon avatars, scenery photos and CC0 sample videos. world.json is built by
// make_world.py from the app's New in SF world (FacebookClone/Bubbles/Seeds/bubble-demo-world.json); ids match the
// app's, so a Group post here lands in the app's New in SF Group. Times are minutes before the moment of seeding.
package fbseed

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

//go:embed world.json
var worldJSON []byte

// Me stands for the signed-in person in the thread templates.
const Me = "@me"

type seedComment struct {
	AuthorID   string `json:"authorId"`
	Text       string `json:"text"`
	MinutesAgo int    `json:"minutesAgo"`
}

type seedPost struct {
	model.FBPost
	MinutesAgo  int            `json:"minutesAgo"`
	Reactions   map[string]int `json:"reactions"`
	SeedComment []seedComment  `json:"comments"`
}

type seedStory struct {
	model.FBStory
	MinutesAgo int `json:"minutesAgo"`
}

type seedMessage struct {
	SenderID   string `json:"senderId"`
	Text       string `json:"text"`
	MinutesAgo int    `json:"minutesAgo"`
}

type seedThread struct {
	ID       string        `json:"id"`
	Members  []string      `json:"members"`
	Name     string        `json:"name"`
	Theme    string        `json:"theme"`
	Emoji    string        `json:"emoji"`
	Messages []seedMessage `json:"messages"`
}

type World struct {
	Personas []model.Persona `json:"personas"`
	Posts    []seedPost      `json:"posts"`
	Stories  []seedStory     `json:"stories"`
	Threads  []seedThread    `json:"threads"`
}

// Load decodes the embedded world.
func Load() (*World, error) {
	var w World
	if err := json.Unmarshal(worldJSON, &w); err != nil {
		return nil, fmt.Errorf("fbseed: %w", err)
	}
	return &w, nil
}

func ago(now time.Time, minutes int) time.Time {
	return now.Add(-time.Duration(minutes) * time.Minute).Truncate(time.Millisecond)
}

// PostsAt returns the posts and reels with times relative to now.
func (w *World) PostsAt(now time.Time) []model.FBPost {
	out := make([]model.FBPost, 0, len(w.Posts))
	for _, sp := range w.Posts {
		p := sp.FBPost
		p.CreatedAt = ago(now, sp.MinutesAgo)
		p.BaseReactions = sp.Reactions
		p.Comments = nil
		for i, c := range sp.SeedComment {
			p.Comments = append(p.Comments, model.FBComment{ID: fmt.Sprintf("%s-c%d", p.ID, i), AuthorID: c.AuthorID, Text: c.Text,
				CreatedAt: ago(now, c.MinutesAgo)})
		}
		out = append(out, p)
	}
	return out
}

// StoriesAt returns the stories with times relative to now. They have no expiry, so the tray is never empty.
func (w *World) StoriesAt(now time.Time) []model.FBStory {
	out := make([]model.FBStory, 0, len(w.Stories))
	for _, s := range w.Stories {
		st := s.FBStory
		st.CreatedAt = ago(now, s.MinutesAgo)
		out = append(out, st)
	}
	return out
}

// ThreadsFor copies the template chats for one person: their id replaces Me, thread and message ids are prefixed
// with a short form of theirs so each person has their own copies.
func (w *World) ThreadsFor(userID string, now time.Time) ([]model.FBThread, []model.FBMessage) {
	short := userID
	if len(short) > 12 {
		short = short[:12]
	}
	sub := func(id string) string {
		if id == Me {
			return userID
		}
		return id
	}
	var threads []model.FBThread
	var msgs []model.FBMessage
	for _, t := range w.Threads {
		th := model.FBThread{ID: t.ID + "-" + short, Name: t.Name, Theme: strings.ToUpper(t.Theme), Emoji: t.Emoji, OwnerID: userID}
		for _, m := range t.Members {
			th.Members = append(th.Members, sub(m))
		}
		for i, m := range t.Messages {
			at := ago(now, m.MinutesAgo)
			msgs = append(msgs, model.FBMessage{ID: fmt.Sprintf("%s-m%d", th.ID, i), ThreadID: th.ID, SenderID: sub(m.SenderID), Text: m.Text, SentAt: at})
			if at.After(th.LastAt) {
				th.LastAt, th.LastText = at, m.Text
			}
		}
		// a thread whose last message is mine reads as read; one ending with someone else's is unread
		if n := len(t.Messages); n > 0 && t.Messages[n-1].SenderID == Me {
			th.ReadAt = map[string]time.Time{userID: th.LastAt}
		} else if n > 1 {
			th.ReadAt = map[string]time.Time{userID: ago(now, t.Messages[n-2].MinutesAgo)}
		}
		threads = append(threads, th)
	}
	return threads, msgs
}
