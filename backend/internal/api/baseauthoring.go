package api

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// withStoredAuthoring puts a stored game's content.authoring_json into a manifest the phone sent without one. The phone
// plays most games from a light manifest (pkgstore/light.go), so its copy has no authoring source; the person's edits to
// title, rule or sound stay, and the source they apply to comes from the stored game. It reports false when the stored
// game has no authoring source either, or either manifest isn't one.
func (s *Server) withStoredAuthoring(ctx context.Context, base *model.Game, phone json.RawMessage) (json.RawMessage, bool) {
	stored, err := s.Packages.ReadManifest(ctx, base.StorageKey)
	if err != nil {
		return nil, false
	}
	var sTop map[string]json.RawMessage
	var sContent map[string]json.RawMessage
	if json.Unmarshal(stored, &sTop) != nil || json.Unmarshal(sTop["content"], &sContent) != nil {
		return nil, false
	}
	authoring, ok := sContent["authoring_json"]
	if !ok || len(authoring) == 0 || string(authoring) == `""` {
		return nil, false
	}
	var top map[string]json.RawMessage
	if json.Unmarshal(phone, &top) != nil || top == nil {
		return nil, false
	}
	content := map[string]json.RawMessage{}
	if raw, ok := top["content"]; ok && string(raw) != "null" {
		if json.Unmarshal(raw, &content) != nil || content == nil {
			return nil, false
		}
	}
	content["authoring_json"] = authoring
	c, err := marshalNoEscape(content)
	if err != nil {
		return nil, false
	}
	top["content"] = c
	out, err := marshalNoEscape(top)
	if err != nil {
		return nil, false
	}
	return out, true
}

// marshalNoEscape encodes without escaping <, > and &, so embedded raw JSON keeps its bytes.
func marshalNoEscape(v any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}
