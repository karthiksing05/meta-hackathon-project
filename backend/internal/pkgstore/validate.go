package pkgstore

import (
	"fmt"
	"path"
	"strings"
)

// Allowed asset extensions. Anything else is rejected, so a package cannot smuggle in
// executables, dotfiles or nested archives.
var allowedExt = map[string]bool{
	".json": true, ".wasm": true, ".js": true, ".mjs": true, ".css": true, ".txt": true, ".bin": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true,
	".mp3": true, ".ogg": true, ".wav": true, ".m4a": true, ".glb": true,
	".woff": true, ".woff2": true, ".ttf": true,
}

const sourcePrefix = "source/"

// cleanEntryName validates a zip entry name: a relative, normalized, forward-slash path with
// no dot segments, hidden components, control characters or backslashes.
func cleanEntryName(name string) error {
	if name == "" || len(name) > 240 {
		return fmt.Errorf("bad file name length")
	}
	if strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\:") {
		return fmt.Errorf("unsafe file name %q", name)
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("unsafe file name")
		}
	}
	if path.Clean(name) != name {
		return fmt.Errorf("unsafe file name %q", name)
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == "" || strings.HasPrefix(seg, ".") {
			return fmt.Errorf("unsafe file name %q", name)
		}
	}
	if !allowedExt[strings.ToLower(path.Ext(name))] {
		return fmt.Errorf("file type not allowed: %q", name)
	}
	return nil
}
