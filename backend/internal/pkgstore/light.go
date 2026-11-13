package pkgstore

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// A light manifest is a published manifest.json without content.authoring_json.
//
// A microgame Muse builds carries its game twice: content.game_json (what the runtime plays) and content.authoring_json
// (the source it was expanded from, which remix and the sound editor read). When a game has painted art, every image is
// embedded in both, so the file is roughly twice what a player needs. Playing needs only game_json, so the API hands
// everyone except the game's owner a sibling file with the authoring source left out. manifest.json itself is never
// touched (it is immutable, and the server's own remix path reads it whole).
const LightManifestName = "manifest.light.json"

// MinLightSavings is how big authoring_json must be for a light copy to be worth making.
const MinLightSavings = 32 << 10

// LightManifest returns raw without content.authoring_json, and false when there is nothing worth removing (no
// authoring_json, or one smaller than minBytes) or raw isn't a manifest. Everything else is carried over byte for byte,
// content.game_json included, so its hash is unchanged.
func LightManifest(raw []byte, minBytes int) ([]byte, bool) {
	var top map[string]json.RawMessage
	if json.Unmarshal(raw, &top) != nil {
		return nil, false
	}
	var content map[string]json.RawMessage
	if json.Unmarshal(top["content"], &content) != nil {
		return nil, false
	}
	a, ok := content["authoring_json"]
	if !ok || len(a) < minBytes {
		return nil, false
	}
	// The app's "How Muse made it" screen lists the fragments a game uses, read from content.authoring when authoring_json
	// is missing. Keep just those names, so a light manifest still shows them (no art, no params, nothing editable).
	if _, has := content["authoring"]; !has {
		if uses := fragmentUses(a); uses != nil {
			if b, err := marshalRaw(map[string]any{"uses": uses}); err == nil {
				content["authoring"] = b
			}
		}
	}
	delete(content, "authoring_json")
	c, err := marshalRaw(content)
	if err != nil {
		return nil, false
	}
	top["content"] = c
	out, err := marshalRaw(top)
	if err != nil {
		return nil, false
	}
	return out, true
}

// fragmentUses reads the `uses[].fragment` names out of an authoring_json value (a JSON string holding JSON), as
// [{"fragment": name}, ...]. Nil when there are none or it can't be read.
func fragmentUses(authoringJSON json.RawMessage) []map[string]string {
	var text string
	if json.Unmarshal(authoringJSON, &text) != nil {
		return nil
	}
	var a struct {
		Uses []struct {
			Fragment string `json:"fragment"`
		} `json:"uses"`
	}
	if json.Unmarshal([]byte(text), &a) != nil {
		return nil
	}
	var out []map[string]string
	for _, u := range a.Uses {
		if u.Fragment != "" {
			out = append(out, map[string]string{"fragment": u.Fragment})
		}
	}
	return out
}

// marshalRaw encodes without escaping <, > and &, so embedded raw values keep their bytes.
func marshalRaw(v any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

// lightMemo remembers which packages have a light manifest, so the answer costs one map read after the first.
type lightMemo struct{ m sync.Map }

// EnsureLightManifest makes sure a package has manifest.light.json when it is worth having, and reports its name. The
// file is written once (atomically, read-only) next to the immutable manifest.json; an old package gets it the first time
// it is asked for. It reports false for a package that has none to make, or when the file can't be written (the caller
// then serves the full manifest).
func (s *Local) EnsureLightManifest(ctx context.Context, id string) (string, bool) {
	if !ValidID(id) {
		return "", false
	}
	if v, ok := s.light.m.Load(id); ok {
		return LightManifestName, v.(bool)
	}
	dir := s.sub("published", id)
	dst := filepath.Join(dir, LightManifestName)
	if _, err := os.Stat(dst); err == nil {
		s.light.m.Store(id, true)
		return LightManifestName, true
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return "", false // not remembered: it may be a transient error
	}
	light, ok := LightManifest(raw, MinLightSavings)
	if !ok {
		s.light.m.Store(id, false)
		return "", false
	}
	tmp, err := os.CreateTemp(s.sub("tmp"), "light-*.json")
	if err != nil {
		return "", false
	}
	_, werr := tmp.Write(light)
	cerr := tmp.Close()
	if werr != nil || cerr != nil || os.Chmod(tmp.Name(), 0o444) != nil || os.Rename(tmp.Name(), dst) != nil {
		os.Remove(tmp.Name())
		return "", false
	}
	s.light.m.Store(id, true)
	return LightManifestName, true
}
