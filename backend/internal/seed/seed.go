// Package seed puts the demo world on the server: the cast of people (as accounts that can't sign in),
// who is friends with whom, the Group and Event they belong to, the app's seed games, and what each person
// scores on them. It replaces the demo data the app used to keep locally, so the feed, search, Group Blend and
// the recommender work on real records. Running it again changes nothing that is already there.
//
// The data under data/ is copied from the app (FacebookClone/Bubbles/Seeds; SOURCE_COMMIT says which commit).
// data/scores.json comes from real bot runs of the game runtime: see tools/make-scores.cjs.
package seed

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

//go:embed data
var dataFS embed.FS

// Publisher stores a game from its manifest (the API server does).
type Publisher interface {
	PublishManifest(ctx context.Context, owner *model.User, manifest []byte, bots []model.BotRun) (*model.Game, error)
}

// Report says what a run did.
type Report struct {
	Users, Friendships, Groups, Members, Games, Scores int
	Skipped                                            int // games that were already on the server
}

const makerID = "demo-maker"

type world struct {
	Group struct {
		ID, Name, Category, About string
		IsPrivate                 bool   `json:"is_private"`
		CoverSeed                 string `json:"cover_seed"`
	} `json:"group"`
	Event struct {
		ID, Title, Category, Details string
		LocationName                 string `json:"location_name"`
		CoverSeed                    string `json:"cover_seed"`
	} `json:"event"`
	People []struct {
		ID            string
		FirstName     string `json:"first_name"`
		LastName      string `json:"last_name"`
		Intro         string
		GoingToPicnic bool `json:"going_to_picnic"`
	} `json:"people"`
}

func username(id string) string { return strings.ReplaceAll(id, "-", "_") }

// Run seeds the server. It is safe to run again.
func Run(ctx context.Context, st store.Store, pub Publisher, log *slog.Logger) (Report, error) {
	var rep Report
	var w world
	raw, err := dataFS.ReadFile("data/world.json")
	if err != nil || json.Unmarshal(raw, &w) != nil {
		return rep, fmt.Errorf("seed: world.json: %v", err)
	}
	var sc struct {
		Skills map[string]float64            `json:"skills"`
		Scores map[string]map[string]float64 `json:"scores"`
	}
	if raw, err := dataFS.ReadFile("data/scores.json"); err == nil {
		json.Unmarshal(raw, &sc)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)

	// People: accounts with no password, so nobody can sign in as them.
	ensureUser := func(u model.User) error {
		if _, err := st.UserByUsername(ctx, u.Username); err == nil {
			return nil
		}
		u.CreatedAt, u.Synthetic = now, true
		if err := st.CreateUser(ctx, &u); err != nil {
			return err
		}
		rep.Users++
		return nil
	}
	if err := ensureUser(model.User{ID: makerID, Email: makerID + "@cast.invalid", Username: username(makerID), DisplayName: "Demo maker", Bio: "Makes the demo games."}); err != nil {
		return rep, err
	}
	var peopleIDs []string
	for _, p := range w.People {
		peopleIDs = append(peopleIDs, p.ID)
		u := model.User{ID: p.ID, Email: p.ID + "@cast.invalid", Username: username(p.ID), DisplayName: p.FirstName + " " + p.LastName, Bio: p.Intro, Skill: sc.Skills[p.ID]}
		if err := ensureUser(u); err != nil {
			return rep, err
		}
	}

	// Friendships inside the cast.
	var fr struct{ Clusters [][]string }
	if raw, err := dataFS.ReadFile("data/friends.json"); err == nil {
		json.Unmarshal(raw, &fr)
	}
	for _, cl := range fr.Clusters {
		for i := range cl {
			for j := i + 1; j < len(cl); j++ {
				if err := st.AddFriend(ctx, cl[i], cl[j]); err != nil {
					return rep, err
				}
				rep.Friendships++
			}
		}
	}

	// The Group and the Event, with their members.
	groups := []model.Group{
		{ID: w.Group.ID, Kind: "group", Name: w.Group.Name, Category: w.Group.Category, About: w.Group.About, Private: w.Group.IsPrivate, CoverSeed: w.Group.CoverSeed, OwnerID: makerID, CreatedAt: now},
		{ID: w.Event.ID, Kind: "event", Name: w.Event.Title, Category: w.Event.Category, About: w.Event.Details, CoverSeed: w.Event.CoverSeed, OwnerID: makerID, CreatedAt: now},
	}
	for _, g := range groups {
		if err := st.UpsertGroup(ctx, &g); err != nil {
			return rep, err
		}
		rep.Groups++
	}
	for _, p := range w.People {
		if err := st.AddGroupMember(ctx, model.GroupMember{GroupID: w.Group.ID, UserID: p.ID, JoinedAt: now}); err != nil {
			return rep, err
		}
		rep.Members++
		if p.GoingToPicnic {
			if err := st.AddGroupMember(ctx, model.GroupMember{GroupID: w.Event.ID, UserID: p.ID, JoinedAt: now}); err != nil {
				return rep, err
			}
			rep.Members++
		}
	}

	// Games: originals first, then remixes of games that are on the server.
	type seedGame struct {
		slug, remixOf string
		raw           []byte
	}
	var pending []seedGame
	entries, _ := fs.ReadDir(dataFS, "data/games")
	for _, e := range entries {
		raw, err := dataFS.ReadFile("data/games/" + e.Name())
		if err != nil {
			return rep, err
		}
		var m struct {
			ID      string `json:"id"`
			Lineage struct {
				RemixOf string `json:"remix_of"`
			} `json:"lineage"`
		}
		if json.Unmarshal(raw, &m) != nil || m.ID == "" {
			return rep, fmt.Errorf("seed: %s has no id", e.Name())
		}
		pending = append(pending, seedGame{m.ID, m.Lineage.RemixOf, raw})
	}
	sort.Slice(pending, func(i, j int) bool { return pending[i].slug < pending[j].slug })
	ownerOf := func(slug string) *model.User {
		for _, p := range w.People {
			if strings.Contains("-"+slug+"-", "-"+strings.ToLower(p.FirstName)+"-") {
				if u, err := st.UserByID(ctx, p.ID); err == nil {
					return u
				}
			}
		}
		u, _ := st.UserByID(ctx, makerID)
		return u
	}
	onServer := map[string]string{} // slug -> game id
	for len(pending) > 0 {
		progressed := false
		var rest []seedGame
		for _, g := range pending {
			if g.remixOf != "" && onServer[g.remixOf] == "" {
				if _, err := st.GameBySlug(ctx, g.remixOf); err != nil {
					rest = append(rest, g) // wait for its original
					continue
				}
			}
			if existing, err := st.GameBySlug(ctx, g.slug); err == nil {
				onServer[g.slug] = existing.ID
				rep.Skipped++
				progressed = true
				continue
			}
			owner := ownerOf(g.slug)
			if owner == nil {
				return rep, fmt.Errorf("seed: no owner for %s", g.slug)
			}
			stored, err := pub.PublishManifest(ctx, owner, g.raw, nil)
			if err != nil {
				return rep, fmt.Errorf("seed: publishing %s: %w", g.slug, err)
			}
			onServer[g.slug] = stored.ID
			rep.Games++
			progressed = true
			log.Info("seeded game", "slug", g.slug, "id", stored.ID, "owner", owner.Username)
		}
		if !progressed {
			return rep, fmt.Errorf("seed: %d games name an original that is not there", len(rest))
		}
		pending = rest
	}

	// What each person scored, from the bot runs.
	for slug, byPerson := range sc.Scores {
		gameID := onServer[slug]
		if gameID == "" {
			continue
		}
		for person, score := range byPerson {
			u, err := st.UserByID(ctx, person)
			if err != nil {
				continue
			}
			if err := st.SubmitScore(ctx, model.Score{GameID: gameID, UserID: person, Username: u.Username, Score: int64(score), UpdatedAt: now}); err != nil {
				return rep, err
			}
			rep.Scores++
		}
	}
	return rep, nil
}
