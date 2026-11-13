package api

import (
	"context"
	"errors"
	"hash/fnv"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/fbseed"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// The wider Facebook surfaces: feed posts, reels, stories and Messenger (README "Facebook surfaces"). The content
// starts as the synthetic demo world in internal/fbseed, written to the database the first time any /v1/fb route is
// called; people's own posts, reactions, comments, stories and messages are added on top.

func (s *Server) fbRoutes(r chi.Router) {
	r.Use(s.fbReady)
	r.With(s.optionalAuth).Get("/people", s.fbPeople)
	r.With(s.optionalAuth).Get("/posts", s.fbListPosts("post"))
	r.With(s.requireAuth).Post("/posts", s.fbCreatePost)
	r.With(s.optionalAuth).Get("/posts/{id}", s.fbGetPost)
	r.With(s.requireAuth).Put("/posts/{id}/reaction", s.fbReact(true))
	r.With(s.requireAuth).Delete("/posts/{id}/reaction", s.fbReact(false))
	r.With(s.requireAuth).Post("/posts/{id}/comments", s.fbComment)
	r.With(s.optionalAuth).Get("/reels", s.fbListPosts("reel"))
	r.With(s.optionalAuth).Get("/stories", s.fbStories)
	r.With(s.requireAuth).Post("/stories", s.fbCreateStory)
	r.With(s.requireAuth).Get("/threads", s.fbThreads)
	r.With(s.requireAuth).Post("/threads", s.fbCreateThread)
	r.With(s.requireAuth).Get("/threads/{id}/messages", s.fbMessages)
	r.With(s.requireAuth).Post("/threads/{id}/messages", s.fbSend)
	r.With(s.requireAuth).Put("/threads/{id}/read", s.fbRead)
}

// ---- seeding ----

type fbSeedState struct {
	mu      sync.Mutex
	done    bool
	checked time.Time // last freshenFB check
	world   *fbseed.World
}

var fbSeeds sync.Map // *Server -> *fbSeedState

func (s *Server) fb() (store.FBStore, bool) {
	f, ok := s.Store.(store.FBStore)
	return f, ok
}

func (s *Server) fbSeed() *fbSeedState {
	v, _ := fbSeeds.LoadOrStore(s, &fbSeedState{})
	return v.(*fbSeedState)
}

// fbReady writes the demo world once per process: Personas are upserted every time (so edits to world.json reach
// them), posts, reels and stories only into an empty database.
func (s *Server) fbReady(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, ok := s.fb()
		if !ok {
			writeErr(w, 501, "this store has no Facebook surfaces")
			return
		}
		st := s.fbSeed()
		st.mu.Lock()
		if !st.done {
			if err := s.seedFB(r.Context(), f, st); err != nil {
				st.mu.Unlock()
				s.serverErr(w, r, err)
				return
			}
			st.done = true
		}
		if now := time.Now(); now.Sub(st.checked) >= fbFreshenEvery {
			st.checked = now
			if err := s.freshenFB(r.Context(), f, st.world, now.UTC()); err != nil {
				s.Log.Warn("fb: keeping the demo world recent", "err", err) // not fatal: older times are still correct
			}
		}
		st.mu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// The demo world's times are "N minutes before seeding". When the server has run (or the database has sat) for
// longer than fbMaxDrift, the whole world moves forward together so the feed reads as recent during a demo.
// Reactions, comments and people's own posts are kept.
const (
	fbFreshenEvery = 10 * time.Minute
	fbMaxDrift     = time.Hour
)

func (s *Server) freshenFB(ctx context.Context, f store.FBStore, world *fbseed.World, now time.Time) error {
	if world == nil {
		return nil
	}
	id, minutesAgo, ok := world.Anchor()
	if !ok {
		return nil
	}
	p, err := f.FBPostByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	want := now.Add(-time.Duration(minutesAgo) * time.Minute)
	drift := want.Sub(p.CreatedAt).Truncate(time.Millisecond)
	if drift < fbMaxDrift {
		return nil
	}
	posts, stories := world.IDs()
	if err := f.FBShiftTimes(ctx, posts, stories, drift); err != nil {
		return err
	}
	s.Log.Info("fb: moved the demo world forward", "by", drift.String())
	return nil
}

func (s *Server) seedFB(ctx context.Context, f store.FBStore, st *fbSeedState) error {
	world, err := fbseed.Load()
	if err != nil {
		return err
	}
	st.world = world
	n, err := f.FBCountPersonas(ctx)
	if err != nil {
		return err
	}
	if err := f.FBUpsertPersonas(ctx, world.Personas); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	now := time.Now().UTC()
	if err := f.FBInsertPosts(ctx, world.PostsAt(now)); err != nil && !errors.Is(err, store.ErrConflict) {
		return err
	}
	if err := f.FBInsertStories(ctx, world.StoriesAt(now)); err != nil && !errors.Is(err, store.ErrConflict) {
		return err
	}
	s.Log.Info("fb: seeded the demo world", "personas", len(world.Personas), "posts", len(world.Posts), "stories", len(world.Stories))
	return nil
}

// ---- people ----

// fbPerson is an author or a chat member: a Persona or a server account.
type fbPerson struct {
	ID        string `json:"id"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName,omitempty"`
	Kind      string `json:"kind"`
	Category  string `json:"category,omitempty"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	CoverURL  string `json:"coverUrl,omitempty"`
	Bio       string `json:"bio,omitempty"`
	City      string `json:"city,omitempty"`
	Work      string `json:"work,omitempty"`
	Verified  bool   `json:"verified,omitempty"`
	IsMe      bool   `json:"isMe,omitempty"`
	IsAccount bool   `json:"isAccount,omitempty"` // a real server account (not a demo Persona)
}

func cartoonAvatar(seed string) string {
	return "https://api.dicebear.com/9.x/notionists/png?size=256&backgroundColor=c0aede,b6e3f4,d1d4f9&seed=" + url.QueryEscape(seed)
}

// fbPeopleByID resolves ids to people: Personas first, then accounts. Unknown ids are left out.
func (s *Server) fbPeopleByID(ctx context.Context, ids []string, me *model.User) (map[string]fbPerson, error) {
	f, _ := s.fb()
	uniq := map[string]bool{}
	var list []string
	for _, id := range ids {
		if id != "" && !uniq[id] {
			uniq[id] = true
			list = append(list, id)
		}
	}
	out := make(map[string]fbPerson, len(list))
	if len(list) == 0 {
		return out, nil
	}
	ps, err := f.FBPersonas(ctx, list)
	if err != nil {
		return nil, err
	}
	for _, p := range ps {
		out[p.ID] = fbPerson{ID: p.ID, FirstName: p.FirstName, LastName: p.LastName, Kind: p.Kind, Category: p.Category,
			AvatarURL: p.AvatarURL, CoverURL: p.CoverURL, Bio: p.Bio, City: p.City, Work: p.Work, Verified: p.Verified}
	}
	var accounts []string
	for _, id := range list {
		if _, ok := out[id]; !ok {
			accounts = append(accounts, id)
		}
	}
	if len(accounts) > 0 {
		us, err := s.Store.UsersByIDs(ctx, accounts)
		if err != nil {
			return nil, err
		}
		for _, u := range us {
			name := u.DisplayName
			if name == "" {
				name = u.Username
			}
			first, last, _ := strings.Cut(name, " ")
			avatar := u.AvatarURL
			if avatar == "" {
				avatar = cartoonAvatar(u.Username)
			}
			out[u.ID] = fbPerson{ID: u.ID, FirstName: first, LastName: last, Kind: "person", AvatarURL: avatar,
				Bio: u.Bio, IsAccount: true}
		}
	}
	if me != nil {
		if p, ok := out[me.ID]; ok {
			p.IsMe = true
			out[me.ID] = p
		}
	}
	return out, nil
}

// GET /v1/fb/people?ids=a,b: people by id; without ids, every Persona of the demo world.
func (s *Server) fbPeople(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	var ids []string
	if raw := r.URL.Query().Get("ids"); raw != "" {
		ids = strings.Split(raw, ",")
		if len(ids) > 100 {
			writeErr(w, 400, "at most 100 ids")
			return
		}
	} else {
		ps, err := f.FBPersonas(r.Context(), nil)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		for _, p := range ps {
			ids = append(ids, p.ID)
		}
	}
	people, err := s.fbPeopleByID(r.Context(), ids, userFrom(r))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := make([]fbPerson, 0, len(ids))
	for _, id := range ids {
		if p, ok := people[id]; ok {
			items = append(items, p)
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

// ---- posts and reels ----

type fbCommentView struct {
	ID        string    `json:"id"`
	Author    fbPerson  `json:"author"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

type fbPostView struct {
	model.FBPost
	Author     fbPerson        `json:"author"`
	Reactions  map[string]int  `json:"reactions"` // everyone else's, by type
	MyReaction string          `json:"myReaction,omitempty"`
	Comments   []fbCommentView `json:"comments"`
}

var fbReactionTypes = map[string]bool{"like": true, "love": true, "care": true, "haha": true, "wow": true, "sad": true, "angry": true}

func (s *Server) fbPostViews(ctx context.Context, posts []model.FBPost, me *model.User) ([]fbPostView, error) {
	var ids []string
	for _, p := range posts {
		ids = append(ids, p.AuthorID)
		for _, c := range p.Comments {
			ids = append(ids, c.AuthorID)
		}
	}
	people, err := s.fbPeopleByID(ctx, ids, me)
	if err != nil {
		return nil, err
	}
	out := make([]fbPostView, 0, len(posts))
	for _, p := range posts {
		author, ok := people[p.AuthorID]
		if !ok {
			continue // an author who was deleted
		}
		v := fbPostView{FBPost: p, Author: author, Reactions: map[string]int{}, Comments: []fbCommentView{}}
		for k, n := range p.BaseReactions {
			v.Reactions[k] += n
		}
		for uid, t := range p.ReactionsBy {
			if me != nil && uid == me.ID {
				v.MyReaction = t
				continue
			}
			v.Reactions[t]++
		}
		for _, c := range p.Comments {
			if a, ok := people[c.AuthorID]; ok {
				v.Comments = append(v.Comments, fbCommentView{ID: c.ID, Author: a, Text: c.Text, CreatedAt: c.CreatedAt})
			}
		}
		out = append(out, v)
	}
	return out, nil
}

// GET /v1/fb/posts?groupId=&authorId=&cursor=&limit= and GET /v1/fb/reels: newest first, one page.
func (s *Server) fbListPosts(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f, _ := s.fb()
		cur, err := store.DecodeCursor(r.URL.Query().Get("cursor"))
		if err != nil {
			writeErr(w, 400, "invalid cursor")
			return
		}
		limit := limitParam(r, 20, 50)
		q := store.FBPostQuery{Kind: kind, GroupID: r.URL.Query().Get("groupId"), AuthorID: r.URL.Query().Get("authorId"), Limit: limit + 1, Cursor: cur}
		posts, err := f.FBPosts(r.Context(), q)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		next := ""
		if len(posts) > limit {
			posts = posts[:limit]
			last := posts[len(posts)-1]
			next = store.Cursor{At: last.CreatedAt, ID: last.ID}.Encode()
		}
		items, err := s.fbPostViews(r.Context(), posts, userFrom(r))
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "cursor": next})
	}
}

func (s *Server) fbOnePost(w http.ResponseWriter, r *http.Request, id string, code int) {
	f, _ := s.fb()
	p, err := f.FBPostByID(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "post not found")
		return
	}
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	views, err := s.fbPostViews(r.Context(), []model.FBPost{*p}, userFrom(r))
	if err != nil || len(views) == 0 {
		s.serverErr(w, r, errors.Join(err, errors.New("post has no author")))
		return
	}
	writeJSON(w, code, views[0])
}

func (s *Server) fbGetPost(w http.ResponseWriter, r *http.Request) {
	s.fbOnePost(w, r, chi.URLParam(r, "id"), 200)
}

func validPhotoURL(u string) bool {
	p, err := url.Parse(u)
	return err == nil && p.Scheme == "https" && p.Host != "" && len(u) <= 1000
}

// POST /v1/fb/posts {text, groupId?, background?, feeling?, location?, photoUrls?, gameId?}: a post by the signed-in
// person. gameId attaches a game as a playable card.
func (s *Server) fbCreatePost(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	var in struct {
		Text       string   `json:"text"`
		GroupID    string   `json:"groupId"`
		Background *int     `json:"background"`
		Feeling    string   `json:"feeling"`
		Location   string   `json:"location"`
		PhotoURLs  []string `json:"photoUrls"`
		GameID     string   `json:"gameId"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if len([]rune(in.Text)) > 5000 || len(in.Feeling) > 40 || len(in.Location) > 120 || len(in.GroupID) > 80 || len(in.PhotoURLs) > 10 || len(in.GameID) > 80 {
		writeErr(w, 400, "post too long")
		return
	}
	if in.Text == "" && len(in.PhotoURLs) == 0 && in.GameID == "" {
		writeErr(w, 400, "text, photoUrls or gameId required")
		return
	}
	if in.Background != nil && (*in.Background < 0 || *in.Background > 31) {
		writeErr(w, 400, "background out of range")
		return
	}
	p := model.FBPost{ID: "p_" + auth.NewID(10), Kind: "post", AuthorID: userFrom(r).ID, GroupID: in.GroupID, Text: in.Text,
		Background: in.Background, Feeling: in.Feeling, Location: in.Location, GameID: strings.TrimSpace(in.GameID), CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	for _, u := range in.PhotoURLs {
		if !validPhotoURL(u) {
			writeErr(w, 400, "photoUrls must be https URLs")
			return
		}
		p.Media = append(p.Media, model.FBMedia{Kind: "photo", URL: u, Aspect: 1})
	}
	if err := f.FBInsertPosts(r.Context(), []model.FBPost{p}); err != nil {
		s.serverErr(w, r, err)
		return
	}
	s.fbOnePost(w, r, p.ID, 201)
}

// PUT /v1/fb/posts/{id}/reaction {type}; DELETE takes mine off. Returns the post.
func (s *Server) fbReact(on bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f, _ := s.fb()
		id := chi.URLParam(r, "id")
		t := ""
		if on {
			var in struct {
				Type string `json:"type"`
			}
			if !decode(w, r, &in) {
				return
			}
			if !fbReactionTypes[in.Type] {
				writeErr(w, 400, "type must be like, love, care, haha, wow, sad or angry")
				return
			}
			t = in.Type
		}
		if err := f.FBSetReaction(r.Context(), id, userFrom(r).ID, t); errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "post not found")
			return
		} else if err != nil {
			s.serverErr(w, r, err)
			return
		}
		s.fbOnePost(w, r, id, 200)
	}
}

// POST /v1/fb/posts/{id}/comments {text}: returns the new comment.
func (s *Server) fbComment(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	var in struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if in.Text == "" || len([]rune(in.Text)) > 2000 {
		writeErr(w, 400, "text must be 1 to 2000 characters")
		return
	}
	me := userFrom(r)
	c := model.FBComment{ID: "c_" + auth.NewID(10), AuthorID: me.ID, Text: in.Text, CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	if err := f.FBAddComment(r.Context(), chi.URLParam(r, "id"), c); errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "post not found")
		return
	} else if err != nil {
		s.serverErr(w, r, err)
		return
	}
	people, err := s.fbPeopleByID(r.Context(), []string{me.ID}, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, fbCommentView{ID: c.ID, Author: people[me.ID], Text: c.Text, CreatedAt: c.CreatedAt})
}

// ---- stories ----

type fbStoryItem struct {
	ID         string         `json:"id"`
	Media      *model.FBMedia `json:"media,omitempty"`
	Text       string         `json:"text,omitempty"`
	Background int            `json:"background,omitempty"`
	Caption    string         `json:"caption,omitempty"`
	CreatedAt  time.Time      `json:"createdAt"`
}

type fbStoryGroup struct {
	Author fbPerson      `json:"author"`
	Items  []fbStoryItem `json:"items"` // oldest first, as they play
}

// GET /v1/fb/stories: the tray, one entry per author, most recent author first; my own first when I have one.
func (s *Server) fbStories(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	me := userFrom(r)
	all, err := f.FBStories(r.Context(), time.Now().UTC(), 300)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	var ids []string
	byAuthor := map[string][]model.FBStory{}
	for _, st := range all { // newest first, so ids is in tray order
		if _, ok := byAuthor[st.AuthorID]; !ok {
			ids = append(ids, st.AuthorID)
		}
		byAuthor[st.AuthorID] = append(byAuthor[st.AuthorID], st)
	}
	people, err := s.fbPeopleByID(r.Context(), ids, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := []fbStoryGroup{}
	for _, id := range ids {
		a, ok := people[id]
		if !ok {
			continue
		}
		g := fbStoryGroup{Author: a}
		list := byAuthor[id]
		for i := len(list) - 1; i >= 0; i-- {
			st := list[i]
			g.Items = append(g.Items, fbStoryItem{ID: st.ID, Media: st.Media, Text: st.Text, Background: st.Background, Caption: st.Caption, CreatedAt: st.CreatedAt})
		}
		if a.IsMe {
			items = append([]fbStoryGroup{g}, items...)
		} else {
			items = append(items, g)
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

// POST /v1/fb/stories {text?, background?, caption?, photoUrl?}: a story of mine for 24 hours.
func (s *Server) fbCreateStory(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	var in struct {
		Text       string `json:"text"`
		Background int    `json:"background"`
		Caption    string `json:"caption"`
		PhotoURL   string `json:"photoUrl"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Text, in.Caption = strings.TrimSpace(in.Text), strings.TrimSpace(in.Caption)
	if (in.Text == "") == (in.PhotoURL == "") {
		writeErr(w, 400, "send text or photoUrl")
		return
	}
	if len([]rune(in.Text)) > 500 || len([]rune(in.Caption)) > 200 || in.Background < 0 || in.Background > 31 {
		writeErr(w, 400, "story too long")
		return
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	exp := now.Add(24 * time.Hour)
	st := model.FBStory{ID: "s_" + auth.NewID(10), AuthorID: userFrom(r).ID, Text: in.Text, Background: in.Background, Caption: in.Caption,
		CreatedAt: now, ExpiresAt: &exp}
	if in.PhotoURL != "" {
		if !validPhotoURL(in.PhotoURL) {
			writeErr(w, 400, "photoUrl must be an https URL")
			return
		}
		st.Media = &model.FBMedia{Kind: "photo", URL: in.PhotoURL, Aspect: 0.5625}
	}
	if err := f.FBInsertStories(r.Context(), []model.FBStory{st}); err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, fbStoryItem{ID: st.ID, Media: st.Media, Text: st.Text, Background: st.Background, Caption: st.Caption, CreatedAt: st.CreatedAt})
}

// ---- Messenger ----

type fbThreadView struct {
	ID       string            `json:"id"`
	Members  []fbPerson        `json:"members"` // everyone but me
	Name     string            `json:"name,omitempty"`
	Theme    string            `json:"theme,omitempty"`
	Emoji    string            `json:"emoji,omitempty"`
	LastAt   time.Time         `json:"lastAt"`
	LastText string            `json:"lastText,omitempty"`
	Unread   int64             `json:"unread"`
	Messages []model.FBMessage `json:"messages,omitempty"` // the latest few, oldest first
}

// fbEnsureThreads gives a person their copies of the demo chats the first time they open Messenger.
func (s *Server) fbEnsureThreads(ctx context.Context, f store.FBStore, me *model.User) error {
	world := s.fbSeed().world
	if world == nil {
		return nil
	}
	threads, msgs := world.ThreadsFor(me.ID, time.Now().UTC())
	if len(threads) == 0 {
		return nil
	}
	if _, err := f.FBThreadByID(ctx, threads[0].ID); err == nil {
		return nil // already given
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	for i := range threads {
		if err := f.FBInsertThread(ctx, &threads[i]); err != nil && !errors.Is(err, store.ErrConflict) {
			return err
		}
	}
	return f.FBInsertMessages(ctx, msgs)
}

func (s *Server) fbThreadViews(ctx context.Context, f store.FBStore, threads []model.FBThread, me *model.User, withMessages int) ([]fbThreadView, error) {
	var ids []string
	for _, t := range threads {
		ids = append(ids, t.Members...)
	}
	people, err := s.fbPeopleByID(ctx, ids, me)
	if err != nil {
		return nil, err
	}
	out := make([]fbThreadView, 0, len(threads))
	for _, t := range threads {
		v := fbThreadView{ID: t.ID, Name: t.Name, Theme: t.Theme, Emoji: t.Emoji, LastAt: t.LastAt, LastText: t.LastText, Members: []fbPerson{}}
		for _, id := range t.Members {
			if p, ok := people[id]; ok && id != me.ID {
				v.Members = append(v.Members, p)
			}
		}
		if v.Unread, err = f.FBCountUnread(ctx, t.ID, me.ID, t.ReadAt[me.ID]); err != nil {
			return nil, err
		}
		if withMessages > 0 {
			msgs, err := f.FBMessages(ctx, t.ID, time.Time{}, withMessages)
			if err != nil {
				return nil, err
			}
			v.Messages = oldestFirst(msgs)
		}
		out = append(out, v)
	}
	return out, nil
}

func oldestFirst(msgs []model.FBMessage) []model.FBMessage {
	out := append([]model.FBMessage{}, msgs...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].SentAt.Before(out[j].SentAt) })
	return out
}

// GET /v1/fb/threads?messages=20: my chats, most recent first, each with its latest messages.
func (s *Server) fbThreads(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	me := userFrom(r)
	if err := s.fbEnsureThreads(r.Context(), f, me); err != nil {
		s.serverErr(w, r, err)
		return
	}
	threads, err := f.FBThreadsFor(r.Context(), me.ID, 50)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	n := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("messages")); err == nil && v >= 0 {
		n = min(v, 50)
	}
	views, err := s.fbThreadViews(r.Context(), f, threads, me, n)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": views})
}

// POST /v1/fb/threads {memberIds, name?}: a new chat with people (Personas or accounts). A one-to-one chat that
// already exists is returned instead (200).
func (s *Server) fbCreateThread(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	me := userFrom(r)
	var in struct {
		MemberIDs []string `json:"memberIds"`
		Name      string   `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(in.MemberIDs) == 0 || len(in.MemberIDs) > 30 || len([]rune(in.Name)) > 80 {
		writeErr(w, 400, "memberIds must list 1 to 30 people")
		return
	}
	people, err := s.fbPeopleByID(r.Context(), in.MemberIDs, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	members := []string{me.ID}
	for _, id := range in.MemberIDs {
		if _, ok := people[id]; !ok {
			writeErr(w, 400, "unknown member "+id)
			return
		}
		if !fbHas(members, id) {
			members = append(members, id)
		}
	}
	if len(members) < 2 {
		writeErr(w, 400, "add someone besides you")
		return
	}
	if len(members) == 2 && in.Name == "" {
		mine, err := f.FBThreadsFor(r.Context(), me.ID, 200)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		for _, t := range mine {
			if len(t.Members) == 2 && fbHas(t.Members, members[1]) && t.Name == "" {
				views, err := s.fbThreadViews(r.Context(), f, []model.FBThread{t}, me, 20)
				if err != nil {
					s.serverErr(w, r, err)
					return
				}
				writeJSON(w, 200, views[0])
				return
			}
		}
	}
	t := model.FBThread{ID: "t_" + auth.NewID(10), Members: members, Name: in.Name, Theme: "0A7CFF", OwnerID: me.ID,
		LastAt: time.Now().UTC().Truncate(time.Millisecond)}
	if err := f.FBInsertThread(r.Context(), &t); err != nil {
		s.serverErr(w, r, err)
		return
	}
	views, err := s.fbThreadViews(r.Context(), f, []model.FBThread{t}, me, 0)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 201, views[0])
}

func fbHas(list []string, id string) bool {
	for _, x := range list {
		if x == id {
			return true
		}
	}
	return false
}

// fbMyThread loads a thread the caller is in (404 otherwise, so ids don't leak).
func (s *Server) fbMyThread(w http.ResponseWriter, r *http.Request) (*model.FBThread, bool) {
	f, _ := s.fb()
	t, err := f.FBThreadByID(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && !fbHas(t.Members, userFrom(r).ID)) {
		writeErr(w, 404, "chat not found")
		return nil, false
	}
	if err != nil {
		s.serverErr(w, r, err)
		return nil, false
	}
	return t, true
}

// GET /v1/fb/threads/{id}/messages?before=<RFC 3339>&limit=: a page of messages, oldest first.
func (s *Server) fbMessages(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	t, ok := s.fbMyThread(w, r)
	if !ok {
		return
	}
	var before time.Time
	if b := r.URL.Query().Get("before"); b != "" {
		var err error
		if before, err = time.Parse(time.RFC3339Nano, b); err != nil {
			writeErr(w, 400, "before must be RFC 3339")
			return
		}
	}
	msgs, err := f.FBMessages(r.Context(), t.ID, before, limitParam(r, 50, 200))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": oldestFirst(msgs)})
}

var fbReplies = []string{
	"Haha yes!", "Sounds good to me 👍", "Omg same", "Wait really?", "Let's do it", "Love that", "On my way",
	"Tell me more", "😂😂", "Perfect, see you then", "Can't wait!", "Good call",
}

// POST /v1/fb/threads/{id}/messages {text?, emoji?, imageUrl?}: sends a message. In a chat with demo people, one
// of them answers a moment later (the reply is stored with that time and returned as `reply`).
func (s *Server) fbSend(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	me := userFrom(r)
	t, ok := s.fbMyThread(w, r)
	if !ok {
		return
	}
	var in struct {
		Text     string `json:"text"`
		Emoji    string `json:"emoji"`
		ImageURL string `json:"imageUrl"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if in.Text == "" && in.Emoji == "" && in.ImageURL == "" {
		writeErr(w, 400, "send text, emoji or imageUrl")
		return
	}
	if len([]rune(in.Text)) > 4000 || len([]rune(in.Emoji)) > 8 || (in.ImageURL != "" && !validPhotoURL(in.ImageURL)) {
		writeErr(w, 400, "message too long or bad imageUrl")
		return
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	msg := model.FBMessage{ID: "m_" + auth.NewID(10), ThreadID: t.ID, SenderID: me.ID, Text: in.Text, Emoji: in.Emoji, ImageURL: in.ImageURL, SentAt: now}
	batch := []model.FBMessage{msg}
	var reply *model.FBMessage
	// someone in the chat who is a Persona (not an account) answers
	people, err := s.fbPeopleByID(r.Context(), t.Members, me)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	var personas []string
	for _, id := range t.Members {
		if p, ok := people[id]; ok && !p.IsAccount && p.Kind == "person" {
			personas = append(personas, id)
		}
	}
	if len(personas) > 0 {
		h := fnv.New32a()
		h.Write([]byte(msg.ID))
		n := h.Sum32()
		reply = &model.FBMessage{ID: "m_" + auth.NewID(10), ThreadID: t.ID, SenderID: personas[int(n)%len(personas)],
			Text: fbReplies[int(n/7)%len(fbReplies)], SentAt: now.Add(2500 * time.Millisecond)}
		batch = append(batch, *reply)
	}
	if err := f.FBInsertMessages(r.Context(), batch); err != nil {
		s.serverErr(w, r, err)
		return
	}
	_ = f.FBMarkRead(r.Context(), t.ID, me.ID, now)
	writeJSON(w, 201, map[string]any{"message": msg, "reply": reply})
}

// PUT /v1/fb/threads/{id}/read: marks everything up to now as read.
func (s *Server) fbRead(w http.ResponseWriter, r *http.Request) {
	f, _ := s.fb()
	t, ok := s.fbMyThread(w, r)
	if !ok {
		return
	}
	if err := f.FBMarkRead(r.Context(), t.ID, userFrom(r).ID, time.Now().UTC().Add(5*time.Second)); err != nil {
		s.serverErr(w, r, err)
		return
	}
	w.WriteHeader(204)
}
