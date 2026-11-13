package api

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// Making a game. The app only calls these endpoints; everything else happens here:
//
//	POST /v1/generate        {request, brief}  -> 202 {jobId}
//	GET  /v1/generate/{id}   -> the job: status, the steps so far, and the game once it is done
//	GET  /v1/generate        -> my recent jobs
//
// The API never talks to Muse. It hands the job to the generator service (which holds the Muse key),
// follows its progress, and publishes the finished game as an immutable package.

const (
	jobTimeout       = 10 * time.Minute
	maxRequestChars  = 2000
	maxBriefBytes    = 8 << 10
	maxAnatomyBytes  = 16 << 10
	generatorTimeout = 3 * time.Second
)

type generateIn struct {
	Request string         `json:"request"`
	Brief   map[string]any `json:"brief"`
	// Changing an existing game: BaseGameID names it and Change says how. Look and NextLevel are shortcuts for
	// the two common changes. The result is always a new game that points back at the base game.
	BaseGameID string `json:"baseGameId"`
	Change     string `json:"change"`
	Look       string `json:"look"`
	NextLevel  bool   `json:"nextLevel"`
	// BaseManifest is the game as the phone has it, with the person's own edits (title, rule, sound). When it is sent,
	// the change starts from it and not from the stored copy. It must carry content.authoring_json.
	BaseManifest json.RawMessage `json:"baseManifest"`
	// Anatomy is the agreed game anatomy text. It is kept apart from the request so it doesn't count against the
	// 2,000 character limit (it can be up to 16 KB).
	Anatomy string `json:"anatomy"`
	// Draft makes the finished game unlisted: reachable by id and in the owner's creations, but not in the feed or
	// search until it is published. A change is a draft unless this is false; a new game is public unless this is true.
	Draft *bool `json:"draft"`
	// A sound to put behind the finished game (a sound id from /v1/sounds), where in the loop to start, and how loud it
	// is against the game's own sound effects (0 to 1). A change to a game keeps the original's sound unless this names another.
	SoundID  string   `json:"soundId"`
	OffsetMs *int64   `json:"offsetMs"`
	Mix      *float64 `json:"mix"`
}

// genHealthCache remembers the generator's last health answer for a few seconds.
type genHealthCache struct {
	mu         sync.Mutex
	at         time.Time
	reachable  bool
	configured bool
}

func (s *Server) generatorStatus(ctx context.Context) (reachable, configured bool) {
	c := &s.genHealth
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.at) < 10*time.Second {
		return c.reachable, c.configured
	}
	ctx, cancel := context.WithTimeout(ctx, generatorTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.GeneratorURL+"/healthz", nil)
	c.reachable, c.configured = false, false
	if err == nil {
		if res, err := http.DefaultClient.Do(req); err == nil {
			defer res.Body.Close()
			var h struct {
				MuseConfigured bool `json:"museConfigured"`
			}
			if res.StatusCode == 200 && json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&h) == nil {
				c.reachable, c.configured = true, h.MuseConfigured
			}
		}
	}
	c.at = time.Now()
	return c.reachable, c.configured
}

func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	if s.GeneratorURL == "" {
		writeErr(w, 503, "making games is not set up on this server")
		return
	}
	var in generateIn
	if !decode(w, r, &in) {
		return
	}
	if len(in.Anatomy) > maxAnatomyBytes {
		writeErr(w, 400, "anatomy is too large")
		return
	}
	var base *model.Game
	if id := strings.TrimSpace(in.BaseGameID); id != "" {
		var ok bool
		if base, ok = s.reviseBase(w, r, id, &in); !ok {
			return
		}
	}
	in.Request = strings.TrimSpace(in.Request)
	if n := len([]rune(in.Request)); n == 0 || n > maxRequestChars {
		writeErr(w, 400, fmt.Sprintf("request must be 1 to %d characters", maxRequestChars))
		return
	}
	if in.Brief == nil {
		in.Brief = map[string]any{}
	}
	if raw, _ := json.Marshal(in.Brief); len(raw) > maxBriefBytes {
		writeErr(w, 400, "brief is too large")
		return
	}
	if v, _ := in.Brief["intent"].(string); strings.TrimSpace(v) == "" && base == nil {
		in.Brief["intent"] = in.Request // the brief's intent defaults to the request
	}

	var sound *model.GameSound
	switch {
	case strings.TrimSpace(in.SoundID) != "":
		if _, err := s.Store.SoundByID(r.Context(), strings.TrimSpace(in.SoundID)); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, 404, "sound not found")
			} else {
				s.serverErr(w, r, err)
			}
			return
		}
		sound = &model.GameSound{ID: strings.TrimSpace(in.SoundID), Mix: defaultSoundMix}
		if in.OffsetMs != nil {
			sound.OffsetMs = *in.OffsetMs
		}
		if in.Mix != nil {
			sound.Mix = *in.Mix
		}
	case base != nil && base.Sound != nil:
		c := *base.Sound
		sound = &c
	}
	if len(in.BaseManifest) > 0 && string(in.BaseManifest) != "null" {
		var bm struct {
			Content struct {
				Authoring string `json:"authoring_json"`
			} `json:"content"`
		}
		if base == nil || json.Unmarshal(in.BaseManifest, &bm) != nil || bm.Content.Authoring == "" {
			writeErr(w, 400, "baseManifest needs baseGameId and content.authoring_json")
			return
		}
	} else {
		in.BaseManifest = nil
	}

	reachable, configured := s.generatorStatus(r.Context())
	switch {
	case !reachable:
		writeErr(w, 503, "the game maker is unavailable right now, try again shortly")
		return
	case !configured:
		writeErr(w, 503, "Muse is not set up on this server yet")
		return
	}

	u := userFrom(r)
	if active, err := s.Store.HasActiveJob(r.Context(), u.ID); err != nil {
		s.serverErr(w, r, err)
		return
	} else if active {
		writeErr(w, 429, "you already have a game being made; wait for it to finish")
		return
	}
	if n, err := s.Store.CountJobsSince(r.Context(), u.ID, time.Now().Add(-time.Hour)); err != nil {
		s.serverErr(w, r, err)
		return
	} else if n >= s.GeneratePerHour {
		w.Header().Set("Retry-After", "600")
		writeErr(w, 429, fmt.Sprintf("you can make %d games an hour; try again a little later", s.GeneratePerHour))
		return
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	job := &model.Job{ID: auth.NewID(12), OwnerID: u.ID, Request: in.Request, Brief: in.Brief,
		Status: model.JobQueued, Events: []model.JobEvent{}, CreatedAt: now, UpdatedAt: now}
	if a := strings.TrimSpace(in.Anatomy); a != "" {
		if !strings.Contains(a, "Agreed game anatomy") {
			a = "Agreed game anatomy:\n" + a
		}
		job.Anatomy = a
	}
	job.Sound = sound
	job.Draft = base != nil // a change stays a draft until it is published
	if in.Draft != nil {
		job.Draft = *in.Draft
	}
	if base != nil {
		job.BaseGameID, job.NextLevel = base.ID, in.NextLevel
		job.Level = max(base.Level, 1)
		if in.NextLevel {
			job.Level++
		}
	}
	if err := s.Store.InsertJob(r.Context(), job); err != nil {
		s.serverErr(w, r, err)
		return
	}
	go s.runJob(*job, *u, in.BaseManifest)
	w.Header().Set("Location", "/v1/generate/"+job.ID)
	writeJSON(w, 202, map[string]string{"jobId": job.ID, "status": job.Status})
}

// jobView is a job as the app sees it. Events carry their detail fields (issues, headline, ...) inline.
func (s *Server) jobView(r *http.Request, j *model.Job, withEvents bool) (map[string]any, error) {
	out := map[string]any{
		"jobId": j.ID, "status": j.Status, "request": j.Request, "createdAt": j.CreatedAt,
	}
	if j.FinishedAt != nil {
		out["finishedAt"] = j.FinishedAt
	}
	if j.Error != "" {
		out["error"] = j.Error
	}
	if withEvents {
		events := make([]map[string]any, len(j.Events))
		for i, e := range j.Events {
			ev := map[string]any{}
			for k, v := range e.Detail {
				ev[k] = v
			}
			ev["seq"], ev["kind"], ev["summary"], ev["at"] = e.Seq, e.Kind, e.Summary, e.At
			events[i] = ev
		}
		out["events"] = events
	}
	if j.GameID != "" {
		g, err := s.Store.GameByID(r.Context(), j.GameID)
		if err != nil {
			return nil, err
		}
		v, err := s.views(r, []model.Game{*g})
		if err != nil {
			return nil, err
		}
		out["game"] = v[0]
	}
	if j.Stats != nil {
		out["stats"] = j.Stats
	}
	return out, nil
}

func (s *Server) jobOr404(w http.ResponseWriter, r *http.Request) (*model.Job, bool) {
	j, err := s.Store.JobByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil || j.OwnerID != userFrom(r).ID { // never reveal other people's jobs
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.serverErr(w, r, err)
		} else {
			writeErr(w, 404, "job not found")
		}
		return nil, false
	}
	return j, true
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	j, ok := s.jobOr404(w, r)
	if !ok {
		return
	}
	v, err := s.jobView(r, j, true)
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.Store.JobsByOwner(r.Context(), userFrom(r).ID, limitParam(r, 20, 50))
	if err != nil {
		s.serverErr(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(jobs))
	for i := range jobs {
		v, err := s.jobView(r, &jobs[i], false)
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		items = append(items, v)
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

// ---- running a job ----

// genLine is one line of the generator's stream.
type genLine struct {
	Type     string          `json:"type"`
	Event    map[string]any  `json:"event"`
	Manifest json.RawMessage `json:"manifest"` // kept as the exact bytes: the game inside is text whose key order matters
	Stats    map[string]any  `json:"stats"`
	Gate     map[string]any  `json:"gate"`
	Bots     []model.BotRun  `json:"bots"` // the playtest bots' runs, kept for the recommender
	Message  string          `json:"message"`
}

// jobRun is a running job, so it can be cancelled.
type jobRun struct {
	cancel    context.CancelFunc
	cancelled atomic.Bool
}

// DELETE /v1/generate/{id}: stop a job that is queued or running. Finished jobs are left as they are.
func (s *Server) cancelJob(w http.ResponseWriter, r *http.Request) {
	j, ok := s.jobOr404(w, r)
	if !ok {
		return
	}
	if j.Status == model.JobQueued || j.Status == model.JobRunning {
		if v, running := s.jobRuns.Load(j.ID); running {
			run := v.(*jobRun)
			run.cancelled.Store(true)
			run.cancel() // the generator hears the connection close and stops spending Muse calls
		} else { // left over from a restart
			s.failJob(r.Context(), j.ID, "Cancelled.")
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) failJob(ctx context.Context, id, msg string) {
	if v, ok := s.jobRuns.Load(id); ok && v.(*jobRun).cancelled.Load() {
		msg = "Cancelled."
	}
	if err := s.Store.SetJobStatus(context.WithoutCancel(ctx), id, model.JobFailed, model.JobUpdate{Error: msg}); err != nil {
		s.Log.Error("generate: could not record failure", "job", id, "err", err)
	}
}

func (s *Server) runJob(job model.Job, owner model.User, baseManifest json.RawMessage) {
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	defer cancel()
	log := s.Log.With("job", job.ID)
	s.jobRuns.Store(job.ID, &jobRun{cancel: cancel})
	defer s.jobRuns.Delete(job.ID)

	select { // wait for a free slot; the job stays queued meanwhile
	case s.genSem <- struct{}{}:
		defer func() { <-s.genSem }()
	case <-ctx.Done():
		s.failJob(ctx, job.ID, "The game maker was too busy. Please try again.")
		return
	}
	if err := s.Store.SetJobStatus(ctx, job.ID, model.JobRunning, model.JobUpdate{}); err != nil {
		log.Error("generate: could not start", "err", err)
		return
	}

	if c := s.harnessContext(ctx, job); c != nil { // nil (harness off or failed) leaves the job as it was
		job.Context = c
	}
	request := job.Request
	if job.Anatomy != "" {
		request += "\n\n" + job.Anatomy
	}
	payload := map[string]any{"request": request, "brief": job.Brief}
	if len(job.Context) > 0 {
		payload["context"] = job.Context
	}
	if job.BaseGameID != "" {
		if len(job.Brief) == 0 {
			payload["brief"] = nil // a change keeps the game's own brief
		}
		manifest := baseManifest // the phone's own copy, when it sent one
		if len(manifest) == 0 {
			var err error
			if manifest, err = s.Packages.ReadManifest(ctx, s.baseKey(ctx, job.BaseGameID)); err != nil {
				s.failJob(ctx, job.ID, "The game to change is no longer available.")
				return
			}
		}
		payload["base"] = json.RawMessage(manifest)
		payload["remixOf"] = job.BaseGameID
		if job.Level > 1 {
			payload["level"] = job.Level
		}
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.GeneratorURL+"/compose", bytes.NewReader(body))
	if err != nil {
		s.failJob(ctx, job.ID, "Couldn't start the game maker.")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Error("generate: generator unreachable", "err", err)
		s.failJob(ctx, job.ID, "The game maker is unavailable right now. Please try again shortly.")
		return
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case 200:
	case 503:
		s.failJob(ctx, job.ID, "Muse is not set up on this server yet.")
		return
	case 429:
		s.failJob(ctx, job.ID, "The game maker is busy. Please try again in a minute.")
		return
	default:
		log.Error("generate: generator refused", "status", res.StatusCode)
		s.failJob(ctx, job.ID, "The game maker couldn't take this request.")
		return
	}

	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 0, 64<<10), 64<<20) // a result line carries the whole manifest
	seq := 0
	for sc.Scan() {
		var l genLine
		if err := json.Unmarshal(sc.Bytes(), &l); err != nil {
			continue
		}
		switch l.Type {
		case "event":
			seq++
			kind, _ := l.Event["kind"].(string)
			summary, _ := l.Event["summary"].(string)
			detail := map[string]any{}
			for k, v := range l.Event {
				if k != "kind" && k != "summary" {
					detail[k] = v
				}
			}
			ev := model.JobEvent{Seq: seq, Kind: kind, Summary: summary, At: time.Now().UTC().Truncate(time.Millisecond), Detail: detail}
			if err := s.Store.AppendJobEvent(ctx, job.ID, ev); err != nil {
				log.Warn("generate: could not record an event", "err", err)
			}
		case "result":
			s.finishJob(ctx, job, owner, l)
			return
		case "error":
			msg := l.Message
			if msg == "" {
				msg = "The game couldn't be made."
			}
			if err := s.Store.SetJobStatus(ctx, job.ID, model.JobFailed, model.JobUpdate{Error: msg, Stats: l.Stats}); err != nil {
				log.Error("generate: could not record failure", "err", err)
			}
			return
		}
	}
	if ctx.Err() != nil {
		s.failJob(ctx, job.ID, "Making the game took too long. Please try again.")
		return
	}
	log.Error("generate: stream ended early", "err", sc.Err())
	s.failJob(ctx, job.ID, "The game maker stopped unexpectedly. Please try again.")
}

// finishJob stores the generated game as a package, exactly as an upload would be, and links it to the job.
func (s *Server) finishJob(ctx context.Context, job model.Job, owner model.User, l genLine) {
	log := s.Log.With("job", job.ID)
	if len(l.Manifest) == 0 {
		s.failJob(ctx, job.ID, "The game maker returned no game.")
		return
	}
	zb, err := zipManifest(l.Manifest)
	if err != nil {
		log.Error("generate: could not package", "err", err)
		s.failJob(ctx, job.ID, "Couldn't save the game.")
		return
	}
	g, perr := s.publishPackage(context.WithoutCancel(ctx), &owner, zb, l.Bots)
	if perr != nil {
		if perr.Err != nil {
			log.Error("generate: could not publish", "err", perr.Err)
		}
		s.failJob(ctx, job.ID, "Couldn't save the game: "+perr.Msg)
		return
	}
	if job.Sound != nil {
		if err := s.attachSound(context.WithoutCancel(ctx), g, job.Sound.ID, job.Sound.OffsetMs, job.Sound.Mix); err != nil {
			log.Warn("generate: could not put the sound behind the game", "err", err)
		}
	}
	if job.Draft {
		if err := s.Store.SetGameUnlisted(context.WithoutCancel(ctx), g.ID, true); err != nil {
			log.Error("generate: could not make the game a draft", "err", err)
		}
		g.Unlisted = true
	}
	stats := l.Stats
	if stats == nil {
		stats = map[string]any{}
	}
	if l.Gate != nil {
		stats["gate"] = l.Gate
	}
	if err := s.Store.SetJobStatus(context.WithoutCancel(ctx), job.ID, model.JobDone, model.JobUpdate{GameID: g.ID, Stats: stats}); err != nil {
		log.Error("generate: could not record the finished job", "err", err)
	}
	log.Info("generate: done", "game", g.ID, "slug", g.Slug)
}

// zipManifest packs manifest.json, the exact bytes and never re-encoded, into a game package.
func zipManifest(manifest []byte) (*bytes.Buffer, error) {
	var zb bytes.Buffer
	zw := zip.NewWriter(&zb)
	w, err := zw.Create("manifest.json")
	if err == nil {
		_, err = w.Write(manifest)
	}
	if err == nil {
		err = zw.Close()
	}
	return &zb, err
}

// reviseBase checks a "change this game" request and folds Look and NextLevel into the request text.
// It writes the error and returns ok=false when the request can't go ahead.
func (s *Server) reviseBase(w http.ResponseWriter, r *http.Request, id string, in *generateIn) (*model.Game, bool) {
	var g *model.Game
	var err error
	if store.LooksLikeID(id) {
		g, err = s.Store.GameByID(r.Context(), id)
	} else {
		g, err = s.Store.GameBySlug(r.Context(), id)
	}
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "the game to change was not found")
		} else {
			s.serverErr(w, r, err)
		}
		return nil, false
	}
	if g.Formula != "microgame" {
		writeErr(w, 422, "only microgames can be changed this way")
		return nil, false
	}
	parts := []string{}
	if c := strings.TrimSpace(in.Change); c != "" {
		parts = append(parts, c)
	}
	if l := strings.TrimSpace(in.Look); l != "" {
		parts = append(parts, fmt.Sprintf("Change the look to %q.", l))
	}
	if in.NextLevel {
		parts = append(parts, fmt.Sprintf("Make the next level of this game (level %d): the same idea, a little harder, with fresh content.", max(g.Level, 1)+1))
	}
	if len(parts) == 0 {
		writeErr(w, 400, "say what to change: change, look or nextLevel")
		return nil, false
	}
	in.Request = strings.Join(parts, " ")
	return g, true
}

// baseKey is the package id of a game (its StorageKey).
func (s *Server) baseKey(ctx context.Context, gameID string) string {
	if g, err := s.Store.GameByID(ctx, gameID); err == nil {
		return g.StorageKey
	}
	return gameID
}

// ---- game anatomy ----
//
//	POST /v1/anatomy         {request, audience?}                        -> the anatomy (game-anatomy/0.1)
//	POST /v1/anatomy/revise  {anatomy, change, request?, afterPlaying?}  -> the anatomy, updated
//
// Muse takes a person's idea apart into its working parts (docs/BUBBLES.md 7.13). The server asks, the app only
// shows the result and reads it back. One short call, so the answer comes in the reply.

const anatomyTimeout = 70 * time.Second

func (s *Server) anatomy(path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.GeneratorURL == "" {
			writeErr(w, 503, "the game maker is not set up on this server")
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
		if err != nil {
			writeErr(w, 413, "request too large")
			return
		}
		if !json.Valid(raw) {
			writeErr(w, 400, "invalid JSON body")
			return
		}
		reachable, configured := s.generatorStatus(r.Context())
		switch {
		case !reachable:
			writeErr(w, 503, "the game maker is unavailable right now, try again shortly")
			return
		case !configured:
			writeErr(w, 503, "Muse is not set up on this server yet")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), anatomyTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.GeneratorURL+path, bytes.NewReader(raw))
		if err != nil {
			s.serverErr(w, r, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			s.Log.Error("anatomy: generator unreachable", "err", err)
			writeErr(w, 503, "the game maker is unavailable right now, try again shortly")
			return
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		switch res.StatusCode {
		case 200:
			var out struct {
				Anatomy json.RawMessage `json:"anatomy"`
			}
			if json.Unmarshal(body, &out) != nil || len(out.Anatomy) == 0 {
				writeErr(w, 502, "Muse didn't return an anatomy")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write(out.Anatomy) // the anatomy itself, exactly as Muse wrote it
		case 400:
			writeErr(w, 400, "that request can't be turned into a game anatomy")
		case 429:
			writeErr(w, 429, "the game maker is busy, try again in a minute")
		case 503:
			writeErr(w, 503, "Muse is not set up on this server yet")
		default:
			s.Log.Error("anatomy: generator failed", "status", res.StatusCode, "body", string(body[:min(len(body), 300)]))
			writeErr(w, 502, "Muse couldn't take this game apart, try again")
		}
	}
}
