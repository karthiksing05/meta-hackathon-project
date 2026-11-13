package store

import (
	"context"
	"slices"
	"sort"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// FBStore keeps the wider Facebook surfaces: Personas (the demo world's synthetic people), posts and reels, stories,
// and Messenger threads and messages. Memory and Mongo both implement it; the API reaches it with a type assertion so
// the main Store interface stays as it is.
type FBStore interface {
	FBUpsertPersonas(ctx context.Context, ps []model.Persona) error
	FBPersonas(ctx context.Context, ids []string) ([]model.Persona, error) // nil ids: all of them
	FBCountPersonas(ctx context.Context) (int64, error)

	FBInsertPosts(ctx context.Context, ps []model.FBPost) error
	FBPostByID(ctx context.Context, id string) (*model.FBPost, error)
	// FBPosts lists one kind ("post" or "reel"), newest first, after the cursor. groupID or authorID narrow it.
	FBPosts(ctx context.Context, q FBPostQuery) ([]model.FBPost, error)
	FBSetReaction(ctx context.Context, postID, userID, reaction string) error // "" removes it
	FBAddComment(ctx context.Context, postID string, c model.FBComment) error

	FBInsertStories(ctx context.Context, ss []model.FBStory) error
	FBStories(ctx context.Context, now time.Time, limit int) ([]model.FBStory, error) // not expired, newest first

	FBInsertThread(ctx context.Context, t *model.FBThread) error
	FBThreadByID(ctx context.Context, id string) (*model.FBThread, error)
	FBThreadsFor(ctx context.Context, userID string, limit int) ([]model.FBThread, error) // most recent first
	FBMarkRead(ctx context.Context, threadID, userID string, at time.Time) error
	FBInsertMessages(ctx context.Context, ms []model.FBMessage) error                                        // also moves each thread's lastAt and lastText
	FBMessages(ctx context.Context, threadID string, before time.Time, limit int) ([]model.FBMessage, error) // newest first
	FBCountUnread(ctx context.Context, threadID, userID string, since time.Time) (int64, error)
	// FBShiftTimes moves the given posts (with their comments) and stories later by delta: the demo world is kept
	// recent without reseeding, so reactions and comments on it survive.
	FBShiftTimes(ctx context.Context, postIDs, storyIDs []string, delta time.Duration) error
}

type FBPostQuery struct {
	Kind     string
	GroupID  string
	AuthorID string
	Limit    int
	Cursor   Cursor
}

const (
	cFBPersonas = "fb_personas"
	cFBPosts    = "fb_posts"
	cFBStories  = "fb_stories"
	cFBThreads  = "fb_threads"
	cFBMessages = "fb_messages"
)

func (q FBPostQuery) matches(p *model.FBPost) bool {
	return p.Kind == q.Kind && (q.GroupID == "" || p.GroupID == q.GroupID) && (q.AuthorID == "" || p.AuthorID == q.AuthorID) &&
		q.Cursor.allows(p.CreatedAt, p.ID)
}

// ---- memory ----

type fbMemory struct {
	mu       sync.Mutex
	personas map[string]model.Persona
	posts    map[string]*model.FBPost
	stories  map[string]model.FBStory
	threads  map[string]*model.FBThread
	messages []model.FBMessage
}

var fbMems sync.Map // *Memory -> *fbMemory, so the Memory struct stays as it is

func (m *Memory) fb() *fbMemory {
	v, _ := fbMems.LoadOrStore(m, &fbMemory{personas: map[string]model.Persona{}, posts: map[string]*model.FBPost{},
		stories: map[string]model.FBStory{}, threads: map[string]*model.FBThread{}})
	return v.(*fbMemory)
}

func clonePost(p *model.FBPost) model.FBPost {
	c := *p
	c.Media = append([]model.FBMedia(nil), p.Media...)
	c.Poll = append([]model.FBPollOption(nil), p.Poll...)
	c.Comments = append([]model.FBComment(nil), p.Comments...)
	c.BaseReactions = make(map[string]int, len(p.BaseReactions))
	for k, v := range p.BaseReactions {
		c.BaseReactions[k] = v
	}
	c.ReactionsBy = make(map[string]string, len(p.ReactionsBy))
	for k, v := range p.ReactionsBy {
		c.ReactionsBy[k] = v
	}
	return c
}

func cloneThread(t *model.FBThread) model.FBThread {
	c := *t
	c.Members = append([]string(nil), t.Members...)
	c.ReadAt = make(map[string]time.Time, len(t.ReadAt))
	for k, v := range t.ReadAt {
		c.ReadAt[k] = v
	}
	return c
}

func (m *Memory) FBUpsertPersonas(ctx context.Context, ps []model.Persona) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range ps {
		f.personas[p.ID] = p
	}
	return nil
}

func (m *Memory) FBPersonas(ctx context.Context, ids []string) ([]model.Persona, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []model.Persona
	if ids == nil {
		for _, p := range f.personas {
			out = append(out, p)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		return out, nil
	}
	for _, id := range ids {
		if p, ok := f.personas[id]; ok {
			out = append(out, p)
		}
	}
	return out, nil
}

func (m *Memory) FBCountPersonas(ctx context.Context) (int64, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	return int64(len(f.personas)), nil
}

func (m *Memory) FBInsertPosts(ctx context.Context, ps []model.FBPost) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range ps {
		if _, ok := f.posts[ps[i].ID]; ok {
			return ErrConflict
		}
	}
	for i := range ps {
		c := clonePost(&ps[i])
		f.posts[c.ID] = &c
	}
	return nil
}

func (m *Memory) FBPostByID(ctx context.Context, id string) (*model.FBPost, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.posts[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := clonePost(p)
	return &c, nil
}

func (m *Memory) FBPosts(ctx context.Context, q FBPostQuery) ([]model.FBPost, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []model.FBPost
	for _, p := range f.posts {
		if q.matches(p) {
			out = append(out, clonePost(p))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.After(out[j].CreatedAt)
		}
		return out[i].ID > out[j].ID
	})
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

func (m *Memory) FBSetReaction(ctx context.Context, postID, userID, reaction string) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.posts[postID]
	if !ok {
		return ErrNotFound
	}
	if p.ReactionsBy == nil {
		p.ReactionsBy = map[string]string{}
	}
	if reaction == "" {
		delete(p.ReactionsBy, userID)
	} else {
		p.ReactionsBy[userID] = reaction
	}
	return nil
}

func (m *Memory) FBAddComment(ctx context.Context, postID string, c model.FBComment) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.posts[postID]
	if !ok {
		return ErrNotFound
	}
	p.Comments = append(p.Comments, c)
	return nil
}

func (m *Memory) FBInsertStories(ctx context.Context, ss []model.FBStory) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range ss {
		f.stories[s.ID] = s
	}
	return nil
}

func (m *Memory) FBStories(ctx context.Context, now time.Time, limit int) ([]model.FBStory, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []model.FBStory
	for _, s := range f.stories {
		if s.ExpiresAt == nil || s.ExpiresAt.After(now) {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) FBInsertThread(ctx context.Context, t *model.FBThread) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.threads[t.ID]; ok {
		return ErrConflict
	}
	c := cloneThread(t)
	f.threads[t.ID] = &c
	return nil
}

func (m *Memory) FBThreadByID(ctx context.Context, id string) (*model.FBThread, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	t, ok := f.threads[id]
	if !ok {
		return nil, ErrNotFound
	}
	c := cloneThread(t)
	return &c, nil
}

func (m *Memory) FBThreadsFor(ctx context.Context, userID string, limit int) ([]model.FBThread, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []model.FBThread
	for _, t := range f.threads {
		if slices.Contains(t.Members, userID) {
			out = append(out, cloneThread(t))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastAt.After(out[j].LastAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) FBMarkRead(ctx context.Context, threadID, userID string, at time.Time) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	t, ok := f.threads[threadID]
	if !ok {
		return ErrNotFound
	}
	if t.ReadAt == nil {
		t.ReadAt = map[string]time.Time{}
	}
	t.ReadAt[userID] = at
	return nil
}

func (m *Memory) FBInsertMessages(ctx context.Context, ms []model.FBMessage) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, msg := range ms {
		f.messages = append(f.messages, msg)
		if t, ok := f.threads[msg.ThreadID]; ok && !msg.SentAt.Before(t.LastAt) {
			t.LastAt, t.LastText = msg.SentAt, previewOf(msg)
		}
	}
	return nil
}

func (m *Memory) FBMessages(ctx context.Context, threadID string, before time.Time, limit int) ([]model.FBMessage, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []model.FBMessage
	for _, msg := range f.messages {
		if msg.ThreadID == threadID && (before.IsZero() || msg.SentAt.Before(before)) {
			out = append(out, msg)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SentAt.After(out[j].SentAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) FBCountUnread(ctx context.Context, threadID, userID string, since time.Time) (int64, error) {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for _, msg := range f.messages {
		if msg.ThreadID == threadID && msg.SenderID != userID && msg.SentAt.After(since) {
			n++
		}
	}
	return n, nil
}

func previewOf(msg model.FBMessage) string {
	switch {
	case msg.Text != "":
		return msg.Text
	case msg.ImageURL != "":
		return "Sent a photo"
	case msg.GameID != "":
		return "Sent a game"
	default:
		return msg.Emoji
	}
}

// ---- mongo ----

func (m *Mongo) FBUpsertPersonas(ctx context.Context, ps []model.Persona) error {
	for _, p := range ps {
		if _, err := m.coll(cFBPersonas).ReplaceOne(ctx, bson.D{{Key: "_id", Value: p.ID}}, p, options.Replace().SetUpsert(true)); err != nil {
			return err
		}
	}
	return nil
}

func (m *Mongo) FBPersonas(ctx context.Context, ids []string) ([]model.Persona, error) {
	filter := bson.D{}
	if ids != nil {
		filter = bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}}
	}
	cur, err := m.coll(cFBPersonas).Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []model.Persona
	return out, cur.All(ctx, &out)
}

func (m *Mongo) FBCountPersonas(ctx context.Context) (int64, error) {
	return m.coll(cFBPersonas).CountDocuments(ctx, bson.D{})
}

func (m *Mongo) FBInsertPosts(ctx context.Context, ps []model.FBPost) error {
	if len(ps) == 0 {
		return nil
	}
	docs := make([]any, len(ps))
	for i := range ps {
		docs[i] = ps[i]
	}
	_, err := m.coll(cFBPosts).InsertMany(ctx, docs)
	return mapErr(err)
}

func (m *Mongo) FBPostByID(ctx context.Context, id string) (*model.FBPost, error) {
	var p model.FBPost
	if err := m.coll(cFBPosts).FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&p); err != nil {
		return nil, mapErr(err)
	}
	return &p, nil
}

func (m *Mongo) FBPosts(ctx context.Context, q FBPostQuery) ([]model.FBPost, error) {
	filter := bson.D{{Key: "kind", Value: q.Kind}}
	if q.GroupID != "" {
		filter = append(filter, bson.E{Key: "groupId", Value: q.GroupID})
	}
	if q.AuthorID != "" {
		filter = append(filter, bson.E{Key: "authorId", Value: q.AuthorID})
	}
	if !q.Cursor.IsZero() {
		filter = append(filter, bson.E{Key: "$or", Value: bson.A{
			bson.D{{Key: "createdAt", Value: bson.D{{Key: "$lt", Value: q.Cursor.At}}}},
			bson.D{{Key: "createdAt", Value: q.Cursor.At}, {Key: "_id", Value: bson.D{{Key: "$lt", Value: q.Cursor.ID}}}},
		}})
	}
	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}})
	if q.Limit > 0 {
		opts.SetLimit(int64(q.Limit))
	}
	cur, err := m.coll(cFBPosts).Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	var out []model.FBPost
	return out, cur.All(ctx, &out)
}

func (m *Mongo) FBSetReaction(ctx context.Context, postID, userID, reaction string) error {
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "reactionsBy." + userID, Value: reaction}}}}
	if reaction == "" {
		update = bson.D{{Key: "$unset", Value: bson.D{{Key: "reactionsBy." + userID, Value: ""}}}}
	}
	res, err := m.coll(cFBPosts).UpdateOne(ctx, bson.D{{Key: "_id", Value: postID}}, update)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) FBAddComment(ctx context.Context, postID string, c model.FBComment) error {
	res, err := m.coll(cFBPosts).UpdateOne(ctx, bson.D{{Key: "_id", Value: postID}},
		bson.D{{Key: "$push", Value: bson.D{{Key: "comments", Value: c}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) FBInsertStories(ctx context.Context, ss []model.FBStory) error {
	if len(ss) == 0 {
		return nil
	}
	docs := make([]any, len(ss))
	for i := range ss {
		docs[i] = ss[i]
	}
	_, err := m.coll(cFBStories).InsertMany(ctx, docs)
	return mapErr(err)
}

func (m *Mongo) FBStories(ctx context.Context, now time.Time, limit int) ([]model.FBStory, error) {
	filter := bson.D{{Key: "$or", Value: bson.A{
		bson.D{{Key: "expiresAt", Value: bson.D{{Key: "$exists", Value: false}}}},
		bson.D{{Key: "expiresAt", Value: bson.D{{Key: "$gt", Value: now}}}},
	}}}
	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})
	if limit > 0 {
		opts.SetLimit(int64(limit))
	}
	cur, err := m.coll(cFBStories).Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	var out []model.FBStory
	return out, cur.All(ctx, &out)
}

func (m *Mongo) FBInsertThread(ctx context.Context, t *model.FBThread) error {
	_, err := m.coll(cFBThreads).InsertOne(ctx, t)
	return mapErr(err)
}

func (m *Mongo) FBThreadByID(ctx context.Context, id string) (*model.FBThread, error) {
	var t model.FBThread
	if err := m.coll(cFBThreads).FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&t); err != nil {
		return nil, mapErr(err)
	}
	return &t, nil
}

func (m *Mongo) FBThreadsFor(ctx context.Context, userID string, limit int) ([]model.FBThread, error) {
	opts := options.Find().SetSort(bson.D{{Key: "lastAt", Value: -1}})
	if limit > 0 {
		opts.SetLimit(int64(limit))
	}
	cur, err := m.coll(cFBThreads).Find(ctx, bson.D{{Key: "members", Value: userID}}, opts)
	if err != nil {
		return nil, err
	}
	var out []model.FBThread
	return out, cur.All(ctx, &out)
}

func (m *Mongo) FBMarkRead(ctx context.Context, threadID, userID string, at time.Time) error {
	res, err := m.coll(cFBThreads).UpdateOne(ctx, bson.D{{Key: "_id", Value: threadID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "readAt." + userID, Value: at}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Mongo) FBInsertMessages(ctx context.Context, ms []model.FBMessage) error {
	if len(ms) == 0 {
		return nil
	}
	docs := make([]any, len(ms))
	for i := range ms {
		docs[i] = ms[i]
	}
	if _, err := m.coll(cFBMessages).InsertMany(ctx, docs); err != nil {
		return mapErr(err)
	}
	for _, msg := range ms {
		// only move lastAt forward
		_, err := m.coll(cFBThreads).UpdateOne(ctx,
			bson.D{{Key: "_id", Value: msg.ThreadID}, {Key: "lastAt", Value: bson.D{{Key: "$lte", Value: msg.SentAt}}}},
			bson.D{{Key: "$set", Value: bson.D{{Key: "lastAt", Value: msg.SentAt}, {Key: "lastText", Value: previewOf(msg)}}}})
		if err != nil {
			return err
		}
	}
	return nil
}

func (m *Mongo) FBMessages(ctx context.Context, threadID string, before time.Time, limit int) ([]model.FBMessage, error) {
	filter := bson.D{{Key: "threadId", Value: threadID}}
	if !before.IsZero() {
		filter = append(filter, bson.E{Key: "sentAt", Value: bson.D{{Key: "$lt", Value: before}}})
	}
	opts := options.Find().SetSort(bson.D{{Key: "sentAt", Value: -1}})
	if limit > 0 {
		opts.SetLimit(int64(limit))
	}
	cur, err := m.coll(cFBMessages).Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	var out []model.FBMessage
	return out, cur.All(ctx, &out)
}

func (m *Mongo) FBCountUnread(ctx context.Context, threadID, userID string, since time.Time) (int64, error) {
	return m.coll(cFBMessages).CountDocuments(ctx, bson.D{{Key: "threadId", Value: threadID},
		{Key: "senderId", Value: bson.D{{Key: "$ne", Value: userID}}}, {Key: "sentAt", Value: bson.D{{Key: "$gt", Value: since}}}})
}

func (m *Mongo) FBShiftTimes(ctx context.Context, postIDs, storyIDs []string, delta time.Duration) error {
	ms := delta.Milliseconds()
	if len(postIDs) > 0 {
		shiftComments := bson.D{{Key: "$map", Value: bson.D{
			{Key: "input", Value: bson.D{{Key: "$ifNull", Value: bson.A{"$comments", bson.A{}}}}},
			{Key: "in", Value: bson.D{{Key: "$mergeObjects", Value: bson.A{"$$this",
				bson.D{{Key: "createdAt", Value: bson.D{{Key: "$add", Value: bson.A{"$$this.createdAt", ms}}}}}}}}},
		}}}
		pipe := mongoPipeline(bson.D{{Key: "$set", Value: bson.D{
			{Key: "createdAt", Value: bson.D{{Key: "$add", Value: bson.A{"$createdAt", ms}}}},
			{Key: "comments", Value: shiftComments},
		}}})
		if _, err := m.coll(cFBPosts).UpdateMany(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: postIDs}}}}, pipe); err != nil {
			return err
		}
	}
	if len(storyIDs) > 0 {
		pipe := mongoPipeline(bson.D{{Key: "$set", Value: bson.D{{Key: "createdAt", Value: bson.D{{Key: "$add", Value: bson.A{"$createdAt", ms}}}}}}})
		if _, err := m.coll(cFBStories).UpdateMany(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: storyIDs}}}}, pipe); err != nil {
			return err
		}
	}
	return nil
}

func mongoPipeline(stages ...bson.D) bson.A {
	out := bson.A{}
	for _, s := range stages {
		out = append(out, s)
	}
	return out
}

func (m *Memory) FBShiftTimes(ctx context.Context, postIDs, storyIDs []string, delta time.Duration) error {
	f := m.fb()
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, id := range postIDs {
		if p, ok := f.posts[id]; ok {
			p.CreatedAt = p.CreatedAt.Add(delta)
			for i := range p.Comments {
				p.Comments[i].CreatedAt = p.Comments[i].CreatedAt.Add(delta)
			}
		}
	}
	for _, id := range storyIDs {
		if s, ok := f.stories[id]; ok {
			s.CreatedAt = s.CreatedAt.Add(delta)
			f.stories[id] = s
		}
	}
	return nil
}

var (
	_ FBStore = (*Memory)(nil)
	_ FBStore = (*Mongo)(nil)
)
