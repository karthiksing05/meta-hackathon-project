// Package repo finds files that live in the repository outside backend/ (Kevin's recommender, the app's game
// runtime, Artem's engine bundles). Those files have one copy, in the app's folders; the backend reads them from
// there in development and tests, and the Docker images copy them in at build time, so nothing is duplicated.
package repo

import (
	"os"
	"path/filepath"
)

// Find returns the path of rel (a path from the repository root, such as "FacebookClone/Bubbles/Runtime/web")
// by walking up from the working directory and from the executable's directory.
func Find(rel string) (string, bool) {
	var starts []string
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	for _, dir := range starts {
		for {
			p := filepath.Join(dir, filepath.FromSlash(rel))
			if _, err := os.Stat(p); err == nil {
				return p, true
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "", false
}
