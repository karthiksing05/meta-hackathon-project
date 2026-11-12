package srv

import (
	"encoding/json"
	"fmt"
	"time"
)

type seedQ struct {
	prompt  string
	choices [4]string
	answer  int
	clue    string
}

func avatar(id string) string { return "https://picsum.photos/seed/sg-" + id + "/96/96" }

func mediaURL(id string) string { return "https://picsum.photos/seed/sg-" + id + "/600/400" }

func quizContent(qs []seedQ, mediaIDs []string) json.RawMessage {
	items := []map[string]any{}
	for i, q := range qs {
		mid, murl := "", ""
		if i < len(mediaIDs) {
			mid, murl = mediaIDs[i], mediaURL(mediaIDs[i])
		}
		items = append(items, map[string]any{"id": fmt.Sprintf("q%d", i+1), "kind": "question", "prompt": q.prompt,
			"media_id": mid, "media_url": murl, "choices": q.choices[:], "answer": q.answer, "clue": q.clue})
	}
	raw, _ := json.Marshal(map[string]any{"schema": "sg.content/1", "items": items,
		"copy": map[string]string{"intro": "Ready?", "win": "Nailed it!", "lose": "So close, go again!"}})
	return raw
}

// seedStore fills the store with synthetic users, groups, media, games, plays and challenges.
func (a *App) seedStore() {
	s := a.store
	now := time.Now().UTC()
	s.d.Users = []User{
		{ID: "u_me", Name: "You", Friends: []string{"u_ana", "u_ben", "u_chloe", "u_dev"}, Follows: []string{"u_nova"}},
		{ID: "u_ana", Name: "Ana Ribeiro", Friends: []string{"u_me", "u_ben", "u_chloe"}},
		{ID: "u_ben", Name: "Ben Okafor", Friends: []string{"u_me", "u_ana", "u_eli"}},
		{ID: "u_chloe", Name: "Chloe Tan", Friends: []string{"u_me", "u_ana", "u_eli"}},
		{ID: "u_dev", Name: "Dev Patel", Friends: []string{"u_me"}},
		{ID: "u_eli", Name: "Eli Novak", Friends: []string{"u_ben", "u_chloe"}},
		{ID: "u_nova", Name: "Nova Plays", IsCreator: true},
		{ID: "u_pixel", Name: "Pixel Pete", IsCreator: true},
	}
	for i := range s.d.Users {
		u := &s.d.Users[i]
		u.AvatarURL = avatar(u.ID)
		if u.Follows == nil {
			u.Follows = []string{}
		}
		if u.Friends == nil {
			u.Friends = []string{}
		}
	}
	lisbon := []struct{ owner, caption string }{
		{"u_ana", "Sunset over the Tagus from Miradouro da Graça"},
		{"u_ben", "Yellow Tram 28 climbing through Alfama"},
		{"u_chloe", "Pastéis de nata fresh out of the oven in Belém"},
		{"u_me", "Jerónimos Monastery's carved cloister"},
		{"u_dev", "Tiled facade on a side street in Bairro Alto"},
		{"u_ana", "Group selfie at the Santa Justa Lift"},
		{"u_ben", "Grilled sardines at a tiny tasca in Alfama"},
		{"u_chloe", "Colourful Pena Palace on the Sintra day trip"},
	}
	book := []struct{ owner, caption string }{
		{"u_chloe", "Our copy of Piranesi on the café table"},
		{"u_eli", "Annotated pages from the March pick"},
		{"u_ben", "Book club snacks: cheese board and olives"},
		{"u_me", "The corner bookshop where we vote on the next book"},
	}
	g1 := Group{ID: "g_lisbon", Name: "Lisbon Trip '26", MemberIDs: []string{"u_me", "u_ana", "u_ben", "u_chloe", "u_dev"}}
	g2 := Group{ID: "g_book", Name: "Book Club", MemberIDs: []string{"u_me", "u_chloe", "u_eli", "u_ben"}}
	add := func(g *Group, idx int, owner, caption string) {
		id := fmt.Sprintf("m%d", idx)
		s.d.Media = append(s.d.Media, Media{ID: id, URL: mediaURL(id), Caption: caption, GroupID: g.ID, OwnerID: owner,
			TakenAt: now.AddDate(0, -2, -idx).Truncate(time.Hour)})
		g.MediaIDs = append(g.MediaIDs, id)
	}
	for i, m := range lisbon {
		add(&g1, i+1, m.owner, m.caption)
	}
	for i, m := range book {
		add(&g2, i+9, m.owner, m.caption)
	}
	s.d.Groups = []Group{g1, g2}

	lisbonIDs := g1.MediaIDs
	b := TemplateBrief("a trivia game about our Lisbon trip photos", "remix", s.d.Media[:8])
	lisbonContent := captionContent(s.d.Media[:8], 8)
	_ = lisbonIDs

	type sg struct {
		id, title, desc, creator, emoji, palette string
		content                                  json.RawMessage
		age                                      time.Duration
	}
	games := []sg{
		{"g_lisbon1", "Lisbon Trip Trivia", "How well do you remember our trip?", "u_ana", "🌍", "sunset", lisbonContent, 3 * time.Hour},
		{"g_book1", "Book Club Pop Quiz", "Think you did the reading?", "u_ben", "📚", "forest", quizContent([]seedQ{
			{"Who wrote Piranesi?", [4]string{"Susanna Clarke", "Sally Rooney", "Ann Patchett", "Madeline Miller"}, 0, "Also wrote Jonathan Strange."},
			{"What is the House in Piranesi full of?", [4]string{"Books", "Statues", "Clocks", "Mirrors"}, 1, "Marble."},
			{"Which genre is Dune?", [4]string{"Romance", "Mystery", "Science fiction", "Western"}, 2, "Spice."},
			{"How many books are in the Lord of the Rings trilogy?", [4]string{"2", "3", "4", "5"}, 1, "Three, despite the many appendices."},
		}, nil), 20 * time.Hour},
		{"g_capitals", "Speed Capitals", "Ten seconds a question, no mercy.", "u_nova", "🏙️", "ocean", quizContent([]seedQ{
			{"Capital of Australia?", [4]string{"Sydney", "Canberra", "Melbourne", "Perth"}, 1, "Not the biggest city."},
			{"Capital of Canada?", [4]string{"Toronto", "Vancouver", "Ottawa", "Montreal"}, 2, "Named after a river."},
			{"Capital of Brazil?", [4]string{"Rio", "Sao Paulo", "Salvador", "Brasilia"}, 3, "A planned city."},
			{"Capital of Turkey?", [4]string{"Istanbul", "Ankara", "Izmir", "Bursa"}, 1, "Not the largest city."},
			{"Capital of Kenya?", [4]string{"Nairobi", "Mombasa", "Kisumu", "Nakuru"}, 0, "Safari gateway."},
		}, nil), 30 * time.Hour},
		{"g_emoji", "Movie Emoji Quiz", "Guess the film from the emoji.", "u_pixel", "🎬", "neon", quizContent([]seedQ{
			{"🦁👑", [4]string{"Madagascar", "The Lion King", "Zootopia", "Tarzan"}, 1, "Hakuna matata."},
			{"🧙‍♂️💍🌋", [4]string{"The Hobbit", "Harry Potter", "The Lord of the Rings", "Eragon"}, 2, "One ring."},
			{"🚢🧊❤️", [4]string{"Titanic", "Frozen", "Moana", "Jaws"}, 0, "I'm flying."},
			{"🐠🔍", [4]string{"Shark Tale", "Finding Nemo", "Luca", "Ponyo"}, 1, "Just keep swimming."},
		}, nil), 52 * time.Hour},
		{"g_pastry", "Which Pastry?", "Bakery trivia for the hungry.", "u_chloe", "🥐", "sunset", quizContent([]seedQ{
			{"Which pastry is Belém famous for?", [4]string{"Croissant", "Pastel de nata", "Churro", "Eclair"}, 1, "Custard tart."},
			{"Croissants come from which country's tradition?", [4]string{"Austria/France", "Italy", "Spain", "Greece"}, 0, "Kipferl ancestors."},
			{"Baklava is layered with phyllo and what?", [4]string{"Nuts and syrup", "Cream", "Chocolate", "Jam"}, 0, "Sticky."},
		}, nil), 80 * time.Hour},
	}
	for _, g := range games {
		bb := b
		bb.TitleIdea, bb.Intent, bb.Emoji, bb.Palette = g.title, g.desc, g.emoji, g.palette
		briefRaw, _ := json.Marshal(bb)
		man := a.templateManifest(bb)
		s.d.Games[g.id] = &Game{ID: g.id, Title: g.title, Description: g.desc, CreatorID: g.creator, Status: "published",
			Moderation: "stub-pass", Manifest: man, Content: g.content, Brief: briefRaw, CreatedAt: now.Add(-g.age),
			Gen: GenInfo{Stages: map[string]int64{}, Source: "seed"}}
		s.d.Feed = append(s.d.Feed, FeedItem{ID: "f_" + g.id, Type: "game", ActorID: g.creator, GameID: g.id,
			Text: fmt.Sprintf("%s published %s", s.userName(g.creator), g.title), CreatedAt: now.Add(-g.age)})
	}
	plays := []struct {
		id, game, user string
		score          int
		age            time.Duration
	}{
		{"p_seed1", "g_lisbon1", "u_ana", 840, 150 * time.Minute},
		{"p_seed2", "g_lisbon1", "u_ben", 620, 100 * time.Minute},
		{"p_seed3", "g_book1", "u_chloe", 510, 18 * time.Hour},
		{"p_seed4", "g_capitals", "u_dev", 930, 26 * time.Hour},
		{"p_seed5", "g_capitals", "u_nova", 1200, 29 * time.Hour},
		{"p_seed6", "g_emoji", "u_ana", 400, 40 * time.Hour},
	}
	for i, p := range plays {
		s.d.Plays[p.id] = &Play{ID: p.id, GameID: p.game, UserID: p.user, Seed: uint32(1000 + i), Score: p.score, Ticks: 600,
			Verified: true, CreatedAt: now.Add(-p.age)}
		s.d.Feed = append(s.d.Feed, FeedItem{ID: "f_" + p.id, Type: "score", ActorID: p.user, GameID: p.game, PlayID: p.id,
			Text: fmt.Sprintf("%s scored %d on %s", s.userName(p.user), p.score, s.d.Games[p.game].Title), CreatedAt: now.Add(-p.age)})
	}
	chals := []struct{ id, play string }{{"c_seed1", "p_seed1"}, {"c_seed2", "p_seed4"}}
	for _, c := range chals {
		p := s.d.Plays[c.play]
		g := s.d.Games[p.GameID]
		s.d.Challenges[c.id] = &Challenge{ID: c.id, GameID: g.ID, PlayID: p.ID, FromID: p.UserID, ToUserIDs: []string{"u_me"},
			Seed: p.Seed, Score: p.Score, CreatedAt: p.CreatedAt.Add(time.Minute)}
		s.d.Feed = append(s.d.Feed, FeedItem{ID: "f_" + c.id, Type: "challenge", ActorID: p.UserID, GameID: g.ID, PlayID: p.ID,
			ChallengeID: c.id, ToUserIDs: []string{"u_me"},
			Text: fmt.Sprintf("%s scored %d on %s. Beat them?", s.userName(p.UserID), p.Score, g.Title), CreatedAt: p.CreatedAt.Add(time.Minute)})
	}
	s.saveLocked()
}

func (s *Store) userName(id string) string {
	if u, ok := s.user(id); ok {
		return u.Name
	}
	return id
}
