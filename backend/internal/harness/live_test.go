package harness

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestLiveFetch reads the real Wikipedia through the safe client. It needs the network, so it runs only
// with HARNESS_LIVE=1.
func TestLiveFetch(t *testing.T) {
	if os.Getenv("HARNESS_LIVE") == "" {
		t.Skip("set HARNESS_LIVE=1 to fetch from the real web")
	}
	lk := NewLookup(nil)
	lk.defaults()
	start := time.Now()
	b, _, final, err := lk.get(context.Background(), "https://en.wikipedia.org/w/rest.php/v1/search/page?limit=5&q=hexcells")
	t.Logf("search: %d bytes from %s in %v, err %v", len(b), final, time.Since(start), err)
	start = time.Now()
	e := lk.wikipedia(context.Background(), "hexcells")
	t.Logf("wikipedia: %+v in %v", e, time.Since(start))
	if e == nil {
		t.Fatal("no Wikipedia evidence for Hexcells")
	}
}
