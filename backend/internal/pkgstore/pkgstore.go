// Package pkgstore abstracts where game packages live. The API depends only on PackageStore;
// the first implementation (Local) uses the filesystem, and an object store could replace it.
package pkgstore

import (
	"context"
	"encoding/json"
	"errors"
	"io"
)

var (
	ErrNotFound = errors.New("package not found")
	ErrExists   = errors.New("package already exists")
)

// InvalidError means the uploaded package failed validation; the message is safe to show the client.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// Package describes a published, immutable package.
type Package struct {
	ID           string
	Manifest     json.RawMessage
	ManifestPath string // relative to the package root, always "manifest.json"
	CoverPath    string // relative, empty if none
	HasSource    bool
	Files        int
	Bytes        int64
}

type Limits struct {
	MaxUploadBytes   int64
	MaxUnpackedBytes int64
	MaxFileBytes     int64
	MaxFiles         int
}

type PackageStore interface {
	// Publish validates the zip in r and publishes it under the caller-supplied server-generated
	// id. It is atomic (readers see all of the package or none) and never overwrites.
	// check, if non-nil, runs on the validated package before anything is published; an error
	// from it aborts the publish and is returned as an InvalidError.
	Publish(ctx context.Context, id string, r io.Reader, check func(*Package) error) (*Package, error)
	// ReadManifest returns a published package's manifest.json, exactly as stored.
	ReadManifest(ctx context.Context, id string) ([]byte, error)
	// WriteSourceZip streams the private editable source (the zip's source/ folder) as a zip.
	WriteSourceZip(ctx context.Context, id string, w io.Writer) error
	// EnsureLightManifest makes a sibling of manifest.json without content.authoring_json when that is worth it (light.go),
	// and reports its file name. False means serve the full manifest.
	EnsureLightManifest(ctx context.Context, id string) (string, bool)
	// Ready reports whether the store can accept uploads.
	Ready(ctx context.Context) error
}
