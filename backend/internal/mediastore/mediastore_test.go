package mediastore

import (
	"bytes"
	"image"
	"image/jpeg"
	"os"
	"testing"
)

func TestFitAndJPEG(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 900, 300)) // fully transparent: becomes white
	out := Fit(src, 300)
	if out.Bounds().Dx() != 300 || out.Bounds().Dy() != 100 {
		t.Fatalf("fit: %v", out.Bounds())
	}
	if small := Fit(src, 2000); small.Bounds().Dx() != 900 {
		t.Errorf("never scales up: %v", small.Bounds())
	}
	var b bytes.Buffer
	if err := JPEG(&b, out, 80); err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(&b)
	if err != nil {
		t.Fatal(err)
	}
	if r, g, bl, _ := img.At(10, 10).RGBA(); r>>8 < 250 || g>>8 < 250 || bl>>8 < 250 {
		t.Errorf("transparent should flatten to white, got %d %d %d", r>>8, g>>8, bl>>8)
	}
}

func TestQuotaOwnerScopeAndGameDelete(t *testing.T) {
	s, err := New(t.TempDir(), 2, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	add := func(owner, id string, game string) {
		t.Helper()
		if _, err := s.Reserve(owner, id, 10); err != nil {
			t.Fatal(err)
		}
		p, _ := s.Path(owner, id, "image.jpg")
		os.WriteFile(p, []byte("jpeg"), 0o644)
		it := &Item{ID: id, OwnerID: owner, Kind: KindPhoto}
		if game != "" {
			it.GameIDs = []string{game}
		}
		if err := s.Commit(it); err != nil {
			t.Fatal(err)
		}
	}
	a1, a2, a3 := "aaaaaaaaaaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaaaaaaaaaa2", "aaaaaaaaaaaaaaaaaaaaaaa3"
	add("alice", a1, "g1")
	add("alice", a2, "")
	if _, err := s.Reserve("alice", a3, 10); err == nil {
		t.Error("third item passed a quota of 2")
	}
	if _, err := s.Reserve("bob", a3, 2<<20); err == nil {
		t.Error("2 MB passed a 1 MB quota")
	}
	if _, err := s.Get("bob", a1); err != ErrNotFound {
		t.Errorf("bob reads alice's item: %v", err)
	}
	if _, err := s.Path("alice", a1, "../meta.json"); err == nil {
		t.Error("path escape allowed")
	}
	gone, _ := s.DeleteForGame("alice", "g1")
	if len(gone) != 1 || gone[0] != a1 {
		t.Errorf("deleted for game: %v", gone)
	}
	if n, bytes, _ := s.Usage("alice"); n != 1 || bytes != 4 {
		t.Errorf("usage after: %d items, %d bytes", n, bytes)
	}
}
