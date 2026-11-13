package pkgstore

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func manifestWith(authoring string) []byte {
	m := map[string]any{
		"id": "g1", "title": "T", "one_line_rule": "R <b>&</b>", "formula": "microgame",
		"content": map[string]any{"game_json": `{"z":1,"a":["<x>"]}`, "authoring_json": authoring, "extra": "kept"},
	}
	var buf bytes.Buffer
	e := json.NewEncoder(&buf)
	e.SetEscapeHTML(false) // like the generator's own output: < and & stay as they are
	e.Encode(m)
	return bytes.TrimRight(buf.Bytes(), "\n")
}

func TestLightManifest(t *testing.T) {
	big := strings.Repeat("A", 40<<10)
	raw := manifestWith(big)
	light, ok := LightManifest(raw, MinLightSavings)
	if !ok || len(light) > len(raw)-len(big)+100 {
		t.Fatalf("light %d bytes of %d, ok %v", len(light), len(raw), ok)
	}
	var m struct {
		Title   string `json:"title"`
		Content map[string]json.RawMessage
	}
	if err := json.Unmarshal(light, &m); err != nil {
		t.Fatal(err)
	}
	if _, has := m.Content["authoring_json"]; has || m.Title != "T" || string(m.Content["extra"]) != `"kept"` {
		t.Fatalf("what is left: %s", light)
	}
	// game_json comes through as the same string, so its hash is unchanged
	var orig, now struct {
		Content struct {
			GameJSON string `json:"game_json"`
		} `json:"content"`
	}
	json.Unmarshal(raw, &orig)
	json.Unmarshal(light, &now)
	if orig.Content.GameJSON == "" || orig.Content.GameJSON != now.Content.GameJSON {
		t.Fatalf("game_json changed: %q vs %q", orig.Content.GameJSON, now.Content.GameJSON)
	}
	if !bytes.Contains(light, []byte("R <b>&</b>")) {
		t.Fatal("html characters must not be escaped")
	}
	for name, in := range map[string][]byte{
		"small authoring": manifestWith("tiny"), "not json": []byte("nope"), "no content": []byte(`{"title":"x"}`),
		"no authoring": []byte(`{"content":{"game_json":"{}"}}`),
	} {
		if _, ok := LightManifest(in, MinLightSavings); ok {
			t.Errorf("%s must not get a light copy", name)
		}
	}
}

func TestEnsureLightManifest(t *testing.T) {
	root := t.TempDir()
	s, err := NewLocal(root, Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	publish := func(id string, manifest []byte) {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		w, _ := zw.Create("manifest.json")
		w.Write(manifest)
		zw.Close()
		if _, err := s.Publish(context.Background(), id, &buf, nil); err != nil {
			t.Fatal(err)
		}
	}
	bigID, smallID := "aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"
	publish(bigID, manifestWith(strings.Repeat("A", 40<<10)))
	publish(smallID, manifestWith("tiny"))

	name, ok := s.EnsureLightManifest(context.Background(), bigID)
	if !ok || name != LightManifestName {
		t.Fatalf("big: %q %v", name, ok)
	}
	full, _ := os.ReadFile(filepath.Join(root, "published", bigID, "manifest.json"))
	light, err := os.ReadFile(filepath.Join(root, "published", bigID, LightManifestName))
	if err != nil || len(light) >= len(full) || bytes.Contains(light, []byte("authoring_json")) {
		t.Fatalf("light file: %v, %d vs %d bytes", err, len(light), len(full))
	}
	if again, ok := s.EnsureLightManifest(context.Background(), bigID); !ok || again != name {
		t.Fatal("a second ask must give the same answer")
	}
	if _, ok := s.EnsureLightManifest(context.Background(), smallID); ok {
		t.Fatal("a small authoring source needs no light copy")
	}
	if _, err := os.Stat(filepath.Join(root, "published", smallID, LightManifestName)); err == nil {
		t.Fatal("no file should have been written for a small one")
	}
	// a package that was published before light manifests existed gets one the first time (a fresh store, no memory)
	s2, _ := NewLocal(root, Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	os.Remove(filepath.Join(root, "published", bigID, LightManifestName))
	if _, ok := s2.EnsureLightManifest(context.Background(), bigID); !ok {
		t.Fatal("an old package must get its light file on first ask")
	}
	if _, ok := s.EnsureLightManifest(context.Background(), "not-an-id"); ok {
		t.Fatal("an invalid id")
	}
	// the stored manifest is untouched
	if after, _ := os.ReadFile(filepath.Join(root, "published", bigID, "manifest.json")); !bytes.Equal(after, full) {
		t.Fatal("manifest.json must never change")
	}
}

// The app's "How Muse made it" screen reads the fragment names from content.authoring when there is no authoring_json,
// so the light manifest keeps just those names and nothing else of the source.
func TestLightManifestKeepsFragmentNames(t *testing.T) {
	authoring := `{"uses":[{"fragment":"timer_bar","params":{"img":"data:image/png;base64,SECRETART"}},{"fragment":"lives"},{"nofragment":1}],"pad":"` + strings.Repeat("A", 40<<10) + `"}`
	raw := manifestWith(authoring)
	light, ok := LightManifest(raw, MinLightSavings)
	if !ok {
		t.Fatal("no light manifest")
	}
	var m struct {
		Content map[string]json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(light, &m); err != nil {
		t.Fatal(err)
	}
	if got := string(m.Content["authoring"]); got != `{"uses":[{"fragment":"timer_bar"},{"fragment":"lives"}]}` {
		t.Fatalf("authoring summary: %s", got)
	}
	if bytes.Contains(light, []byte("SECRETART")) || bytes.Contains(light, []byte("params")) {
		t.Fatal("nothing but the fragment names may be kept")
	}
	// an authoring object that is already there is left alone
	withObj := bytes.Replace(raw, []byte(`"extra":"kept"`), []byte(`"extra":"kept","authoring":{"mine":1}`), 1)
	light2, _ := LightManifest(withObj, MinLightSavings)
	var m2 struct {
		Content map[string]json.RawMessage `json:"content"`
	}
	json.Unmarshal(light2, &m2)
	if string(m2.Content["authoring"]) != `{"mine":1}` {
		t.Fatalf("an existing authoring object must stay: %s", m2.Content["authoring"])
	}
}
