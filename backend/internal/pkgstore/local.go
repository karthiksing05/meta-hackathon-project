package pkgstore

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Local keeps packages on the local filesystem:
//
//	<root>/tmp/        private scratch space for uploads and staging
//	<root>/published/  immutable public packages, served by the static server
//	<root>/private/    editable source for future remixes; never served
//
// All three live on one filesystem so that publishing is a single rename.
type Local struct {
	root   string
	limits Limits
	light  lightMemo // which packages have a light manifest (light.go)
}

func NewLocal(root string, l Limits) (*Local, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	for _, d := range []string{"tmp", "published", "private"} {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			return nil, err
		}
	}
	if l.MaxFileBytes == 0 {
		l.MaxFileBytes = l.MaxUnpackedBytes
	}
	if l.MaxFiles == 0 {
		l.MaxFiles = 2000
	}
	return &Local{root: root, limits: l}, nil
}

func (s *Local) sub(parts ...string) string {
	return filepath.Join(append([]string{s.root}, parts...)...)
}

func (s *Local) Ready(ctx context.Context) error {
	f, err := os.CreateTemp(s.sub("tmp"), "ready-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

// ValidID reports whether id has the server-generated shape (24 lowercase hex characters).
func ValidID(id string) bool {
	if len(id) != 24 {
		return false
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func (s *Local) Publish(ctx context.Context, id string, r io.Reader, check func(*Package) error) (*Package, error) {
	if !ValidID(id) {
		return nil, errors.New("invalid package id")
	}
	// 1. Spool the upload to a private temp file, capped.
	up, err := os.CreateTemp(s.sub("tmp"), "upload-*.zip")
	if err != nil {
		return nil, err
	}
	defer os.Remove(up.Name())
	defer up.Close()
	n, err := io.Copy(up, io.LimitReader(r, s.limits.MaxUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if n > s.limits.MaxUploadBytes {
		return nil, &InvalidError{fmt.Sprintf("upload exceeds %d MB", s.limits.MaxUploadBytes>>20)}
	}
	zr, err := zip.NewReader(up, n)
	if err != nil {
		return nil, &InvalidError{"not a valid zip file"}
	}

	// 2. Extract and validate in a private staging dir.
	stage, err := os.MkdirTemp(s.sub("tmp"), "stage-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(stage)
	pubDir, srcDir := filepath.Join(stage, "public"), filepath.Join(stage, "source")
	pkg, err := s.extract(zr, pubDir, srcDir)
	if err != nil {
		return nil, err
	}
	pkg.ID = id
	if check != nil {
		if err := check(pkg); err != nil {
			return nil, &InvalidError{err.Error()}
		}
	}

	// 3. Claim the id exclusively. Mkdir fails if it exists, so an id is never reused.
	claim := s.sub("private", id)
	if err := os.Mkdir(claim, 0o750); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return nil, ErrExists
		}
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(claim)
		}
	}()
	if pkg.HasSource {
		if err := os.Rename(srcDir, filepath.Join(claim, "source")); err != nil {
			return nil, err
		}
	}
	// 4. Publish atomically: one rename makes the whole directory visible.
	dest := s.sub("published", id)
	if _, err := os.Lstat(dest); err == nil {
		return nil, ErrExists
	}
	if err := freeze(pubDir); err != nil {
		return nil, err
	}
	if err := os.Rename(pubDir, dest); err != nil {
		return nil, err
	}
	ok = true
	return pkg, nil
}

// extract unpacks and validates. Public files go to pubDir; entries under source/ go to srcDir.
func (s *Local) extract(zr *zip.Reader, pubDir, srcDir string) (*Package, error) {
	if len(zr.File) == 0 || len(zr.File) > s.limits.MaxFiles {
		return nil, &InvalidError{fmt.Sprintf("package must contain 1 to %d files", s.limits.MaxFiles)}
	}
	for _, d := range []string{pubDir, srcDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	pkg := &Package{ManifestPath: "manifest.json"}
	seen := map[string]bool{}
	var total int64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue // directories are created from file paths
		}
		name := f.Name
		if !f.Mode().IsRegular() {
			return nil, &InvalidError{fmt.Sprintf("special files are not allowed: %q", name)}
		}
		if err := cleanEntryName(name); err != nil {
			return nil, &InvalidError{err.Error()}
		}
		key := strings.ToLower(name)
		if seen[key] {
			return nil, &InvalidError{fmt.Sprintf("duplicate file %q", name)}
		}
		seen[key] = true
		if int64(f.UncompressedSize64) > s.limits.MaxFileBytes {
			return nil, &InvalidError{fmt.Sprintf("file too large: %q", name)}
		}
		base, rel, isSource := pubDir, name, false
		if strings.HasPrefix(name, sourcePrefix) {
			base, rel, isSource = srcDir, strings.TrimPrefix(name, sourcePrefix), true
			pkg.HasSource = true
		}
		dest := filepath.Join(base, filepath.FromSlash(rel))
		if !strings.HasPrefix(dest, base+string(filepath.Separator)) {
			return nil, &InvalidError{"unsafe file name"}
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return nil, err
		}
		rc, err := f.Open()
		if err != nil {
			return nil, &InvalidError{"corrupt zip entry"}
		}
		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			rc.Close()
			return nil, err
		}
		// Count real bytes, not the header's claim, to defeat zip bombs.
		n, err := io.Copy(out, io.LimitReader(rc, s.limits.MaxFileBytes+1))
		rc.Close()
		out.Close()
		if err != nil {
			return nil, &InvalidError{"corrupt zip entry"}
		}
		if n > s.limits.MaxFileBytes {
			return nil, &InvalidError{fmt.Sprintf("file too large: %q", name)}
		}
		total += n
		if total > s.limits.MaxUnpackedBytes {
			return nil, &InvalidError{fmt.Sprintf("package exceeds %d MB unpacked", s.limits.MaxUnpackedBytes>>20)}
		}
		pkg.Files++
		if !isSource && (name == "cover.png" || name == "cover.webp" || name == "cover.jpg") && pkg.CoverPath == "" {
			pkg.CoverPath = name
		}
	}
	pkg.Bytes = total
	raw, err := os.ReadFile(filepath.Join(pubDir, "manifest.json"))
	if err != nil {
		return nil, &InvalidError{"manifest.json is required at the package root"}
	}
	var probe map[string]json.RawMessage
	if json.Unmarshal(raw, &probe) != nil {
		return nil, &InvalidError{"manifest.json must be a JSON object"}
	}
	pkg.Manifest = raw
	return pkg, nil
}

// freeze makes published files read-only, a guard against accidental mutation.
func freeze(dir string) error {
	return filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		return os.Chmod(p, 0o444)
	})
}

func (s *Local) ReadManifest(ctx context.Context, id string) ([]byte, error) {
	if !ValidID(id) {
		return nil, ErrNotFound
	}
	b, err := os.ReadFile(s.sub("published", id, "manifest.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

func (s *Local) WriteSourceZip(ctx context.Context, id string, w io.Writer) error {
	if !ValidID(id) {
		return ErrNotFound
	}
	root := s.sub("private", id, "source")
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		return ErrNotFound
	}
	zw := zip.NewWriter(w)
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !d.Type().IsRegular() {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		fw, err := zw.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(fw, f)
		return err
	})
	if err != nil {
		return err
	}
	return zw.Close()
}
