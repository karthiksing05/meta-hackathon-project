package api_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/mediastore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// fakeMediaTools stands in for the generator's ffmpeg and Muse vision.
type fakeMediaTools struct {
	mu         sync.Mutex
	durationMs int64
	videos     int
	describes  []api.DescribeIn
}

func tinyJPEG(w, h int, c color.RGBA) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, 255
	}
	var b bytes.Buffer
	jpeg.Encode(&b, img, nil)
	return b.Bytes()
}

func (f *fakeMediaTools) Video(_ context.Context, mime string, r io.Reader) (*api.VideoProbe, error) {
	io.Copy(io.Discard, r)
	f.mu.Lock()
	f.videos++
	d := f.durationMs
	f.mu.Unlock()
	frame := base64.StdEncoding.EncodeToString(tinyJPEG(48, 27, color.RGBA{200, 40, 40, 255}))
	p := &api.VideoProbe{Width: 640, Height: 360, DurationMs: d, Thumb: frame, Cuts: []int64{0, 4000}}
	for i, t := range []int64{0, 2000, 4000, 6000} {
		p.Frames = append(p.Frames, struct {
			T   int64  `json:"t"`
			Cut bool   `json:"cut"`
			JPG string `json:"jpg"`
			W   int    `json:"w"`
			H   int    `json:"h"`
		}{T: t, Cut: i == 0 || t == 4000, JPG: frame, W: 48, H: 27})
	}
	return p, nil
}

func (f *fakeMediaTools) Describe(_ context.Context, in api.DescribeIn) (json.RawMessage, error) {
	f.mu.Lock()
	f.describes = append(f.describes, in)
	f.mu.Unlock()
	if in.Kind == "video" {
		return json.RawMessage(`{"summary":"A press interview that goes badly","people":true,"setting":"a press room","captions":["LIVE"],
			"frames":[{"t":0,"desc":"a reporter raises a hand"},{"t":4000,"desc":"the speaker knocks over a glass"}],
			"beats":[{"t":0,"end":4000,"text":"the question"},{"t":4000,"end":6000,"text":"the glass falls"}]}`), nil
	}
	return json.RawMessage(`{"summary":"A brown dog on a sofa","people":false,"subjects":["dog"]}`), nil
}

type mediaServer struct {
	ts    *httptest.Server
	media *mediastore.Store
	tools *fakeMediaTools
	gen   *harnessGenerator
}

func newMediaServer(t *testing.T, maxItems int) *mediaServer {
	t.Helper()
	ms := &mediaServer{tools: &fakeMediaTools{durationMs: 6500}, gen: newHarnessGenerator(t)}
	var err error
	if ms.media, err = mediastore.New(t.TempDir(), maxItems, 400<<20); err != nil {
		t.Fatal(err)
	}
	h, err := harness.New(context.Background(), harness.Config{
		Source:       harness.MemorySource{Catalog: harnessCatalog()},
		Understander: harness.MuseUnderstander{Muse: harness.UnderstandMuse(ms.gen.URL)},
	})
	if err != nil {
		t.Fatal(err)
	}
	pk, _ := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
		GeneratorURL: ms.gen.URL, GenerateConcurrent: 2, GeneratePerHour: 6,
		HarnessContext: true, Harness: h, Planner: &harness.Planner{Muse: harness.PlanMuse(ms.gen.URL)},
		Media: ms.media, MediaTools: ms.tools,
	})
	ms.ts = httptest.NewServer(s.Handler())
	t.Cleanup(ms.ts.Close)
	return ms
}

func uploadFile(t *testing.T, base, tok string, data []byte) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, _ := mw.CreateFormFile("file", "upload.bin")
	w.Write(data)
	mw.Close()
	return do(t, "POST", base+"/v1/media", tok, &buf, mw.FormDataContentType())
}

func pngPhoto(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

// fakeMP4 starts like an MP4 (an ftyp box), which is all the sniffing reads; the fake tools do the rest.
func fakeMP4() []byte {
	return append([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 2, 0}, bytes.Repeat([]byte{1}, 4000)...)
}

func getRaw(t *testing.T, url, tok string) (int, string, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, res.Header.Get("Content-Type"), b
}

func TestMediaUploadPhotoScopedToOwner(t *testing.T) {
	ms := newMediaServer(t, 40)
	alice, bob := register(t, ms.ts, "alice"), register(t, ms.ts, "bob")
	if code, _ := uploadFile(t, ms.ts.URL, "", pngPhoto(64, 64)); code != 401 {
		t.Fatalf("upload without sign-in: %d", code)
	}
	code, out := uploadFile(t, ms.ts.URL, alice, pngPhoto(2000, 1000))
	if code != 201 || out["kind"] != "photo" || out["width"].(float64) != 2000 || out["height"].(float64) != 1000 || out["durationMs"].(float64) != 0 {
		t.Fatalf("photo upload: %d %v", code, out)
	}
	id := out["mediaId"].(string)
	if out["thumbUrl"] != "/v1/media/"+id+"/thumb" {
		t.Errorf("thumbUrl = %v", out["thumbUrl"])
	}
	c, ct, b := getRaw(t, ms.ts.URL+out["thumbUrl"].(string), alice)
	if c != 200 || ct != "image/jpeg" {
		t.Fatalf("thumb: %d %s", c, ct)
	}
	if cfg, err := jpeg.DecodeConfig(bytes.NewReader(b)); err != nil || cfg.Width != 320 || cfg.Height != 160 {
		t.Errorf("thumb size: %+v %v", cfg, err)
	}
	full, _ := ms.media.ReadFile(func() string { _, m := do(t, "GET", ms.ts.URL+"/v1/auth/me", alice, nil, ""); return m["id"].(string) }(), id, "image.jpg")
	if cfg, err := jpeg.DecodeConfig(bytes.NewReader(full)); err != nil || cfg.Width != 1024 {
		t.Errorf("downscaled photo: %+v %v", cfg, err)
	}
	// Bob can't see, fetch, use or delete Alice's upload.
	for _, path := range []string{"/v1/media/" + id, "/v1/media/" + id + "/thumb", "/v1/media/" + id + "/files/image.jpg"} {
		if c, _, _ := getRaw(t, ms.ts.URL+path, bob); c != 404 {
			t.Errorf("bob GET %s: %d", path, c)
		}
	}
	if c, _ := do(t, "POST", ms.ts.URL+"/v1/harness/plan", bob, js(map[string]any{"request": "a quiz", "media": []string{id}}), "application/json"); c != 400 {
		t.Errorf("bob plans with alice's media: %d", c)
	}
	if c, _ := do(t, "DELETE", ms.ts.URL+"/v1/media/"+id, bob, nil, ""); c != 404 {
		t.Errorf("bob deletes: %d", c)
	}
	if c, _ := do(t, "DELETE", ms.ts.URL+"/v1/media/"+id, alice, nil, ""); c != 204 {
		t.Errorf("alice deletes: %d", c)
	}
	if c, _, _ := getRaw(t, ms.ts.URL+"/v1/media/"+id, alice); c != 404 {
		t.Errorf("after delete: %d", c)
	}
}

func TestMediaLimits(t *testing.T) {
	ms := newMediaServer(t, 2)
	tok := register(t, ms.ts, "lim")
	if c, _ := uploadFile(t, ms.ts.URL, tok, []byte("hello, this is not a picture")); c != 415 {
		t.Errorf("text: %d", c)
	}
	big := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 13<<20)...)
	if c, _ := uploadFile(t, ms.ts.URL, tok, big); c != 413 {
		t.Errorf("13 MB photo: %d", c)
	}
	if c, _ := uploadFile(t, ms.ts.URL, tok, []byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3}); c != 415 {
		t.Errorf("broken JPEG: %d", c)
	}
	ms.tools.durationMs = 75_000
	if c, out := uploadFile(t, ms.ts.URL, tok, fakeMP4()); c != 422 || !strings.Contains(out["error"].(string), "60 seconds") {
		t.Errorf("75 s video: %d %v", c, out)
	}
	ms.tools.durationMs = 6500
	if c, out := uploadFile(t, ms.ts.URL, tok, fakeMP4()); c != 201 || out["kind"] != "video" || out["durationMs"].(float64) != 6500 {
		t.Errorf("video: %d %v", c, out)
	}
	if c, _ := uploadFile(t, ms.ts.URL, tok, pngPhoto(32, 32)); c != 201 {
		t.Errorf("second item: %d", c)
	}
	if c, out := uploadFile(t, ms.ts.URL, tok, pngPhoto(32, 32)); c != 429 {
		t.Errorf("past the quota: %d %v", c, out)
	}
	// Failed uploads left nothing behind: only the two that worked count.
	_, me := do(t, "GET", ms.ts.URL+"/v1/auth/me", tok, nil, "")
	if n, _, _ := ms.media.Usage(me["id"].(string)); n != 2 {
		t.Errorf("items kept = %d", n)
	}
}

func TestMediaInPlanAndJobThenDeletedWithTheGame(t *testing.T) {
	ms := newMediaServer(t, 40)
	tok := register(t, ms.ts, "maker")
	_, me := do(t, "GET", ms.ts.URL+"/v1/auth/me", tok, nil, "")
	owner := me["id"].(string)
	_, v := uploadFile(t, ms.ts.URL, tok, fakeMP4())
	_, p := uploadFile(t, ms.ts.URL, tok, pngPhoto(300, 200))
	vid, pid := v["mediaId"].(string), p["mediaId"].(string)

	// Too many videos for one game.
	_, v2 := uploadFile(t, ms.ts.URL, tok, fakeMP4())
	if c, _ := do(t, "POST", ms.ts.URL+"/v1/harness/plan", tok, js(map[string]any{"request": "a quiz", "media": []any{vid, v2["mediaId"]}}), "application/json"); c != 400 {
		t.Errorf("two videos: %d", c)
	}

	c, plan := do(t, "POST", ms.ts.URL+"/v1/harness/plan", tok, js(map[string]any{"request": "make a quiz from this clip", "media": []string{vid, pid}, "mediaNote": "quiz from the clip, my dog is the host"}), "application/json")
	if c != 200 {
		t.Fatalf("plan: %d %v", c, plan)
	}
	media := plan["media"].([]any)
	m1 := media[0].(map[string]any)
	if len(media) != 2 || m1["kind"] != "video" || m1["summary"] != "A press interview that goes badly" || m1["ref"] != "m1" {
		t.Fatalf("plan media: %v", media)
	}
	beats := m1["beats"].([]any)
	if len(beats) != 2 || beats[1].(map[string]any)["asset"] != "m1_beat2" {
		t.Errorf("beats: %v", beats)
	}
	frames := m1["frames"].([]any)
	if len(frames) != 4 || frames[2].(map[string]any)["desc"] != "the speaker knocks over a glass" || frames[2].(map[string]any)["asset"] != "m1_f3" {
		t.Errorf("frames: %v", frames)
	}
	if len(ms.tools.describes) != 2 || len(ms.tools.describes[0].Frames) != 4 || ms.tools.describes[0].Note == "" {
		t.Errorf("describe calls: %d", len(ms.tools.describes))
	}

	// The job: the description is reused (no second vision call), and the generator gets context.media and the files.
	code, out := startJob(t, ms.ts, tok, map[string]any{"request": "make a quiz from this clip", "media": []string{vid, pid}, "mediaRestyle": true})
	if code != 202 {
		t.Fatalf("start: %d %v", code, out)
	}
	job := waitJob(t, ms.ts, tok, out["jobId"].(string), "done")
	if len(ms.tools.describes) != 2 {
		t.Errorf("described again: %d calls", len(ms.tools.describes))
	}
	body := composeBody(t, ms.gen.gen)
	ctx := body["context"].(map[string]any)
	cm := ctx["media"].([]any)
	if len(cm) != 2 || cm[1].(map[string]any)["assets"].(map[string]any)["restyled"] != "m2_art" {
		t.Errorf("context.media: %v", cm)
	}
	files := body["media_files"].(map[string]any)
	if vf := files[vid].(map[string]any); len(vf["frames"].([]any)) != 4 {
		t.Errorf("video files: %v", vf)
	}
	if pf := files[pid].(map[string]any); pf["image"] == "" {
		t.Errorf("photo file missing")
	}
	// The planner saw the media too.
	if !strings.Contains(strings.Join(ms.gen.museUsers(), "\n"), "A press interview that goes badly") {
		t.Errorf("the plan's Muse calls never saw the media description")
	}

	// Deleting the game deletes the media it was made from, and nothing else.
	gameID := job["game"].(map[string]any)["id"].(string)
	if c, _ := do(t, "DELETE", ms.ts.URL+"/v1/creations/"+gameID, tok, nil, ""); c != 204 {
		t.Fatalf("delete game: %d", c)
	}
	for _, id := range []string{vid, pid} {
		if _, err := ms.media.Get(owner, id); err == nil {
			t.Errorf("media %s survived the game", id)
		}
	}
	if _, err := ms.media.Get(owner, v2["mediaId"].(string)); err != nil {
		t.Errorf("unrelated media deleted: %v", err)
	}
}
