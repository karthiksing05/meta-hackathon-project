package harness

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

// However a loopback address is written (decimal, hex, octal, short, v4-mapped v6, with a user name that tries to hide
// the real host, a trailing dot), the web lookup must never connect to it. The test server counts every request it gets;
// the count has to stay at zero.
func TestLookupNeverReachesLoopbackInAnyDisguise(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		fmt.Fprint(w, "<title>internal</title>")
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	port := u.Port()
	lk := NewLookup(nil)
	lk.defaults()

	for _, host := range []string{
		"127.0.0.1", "localhost", "localhost.", "2130706433", "0x7f000001", "0x7f.0.0.1", "0177.0.0.1", "127.1", "127.0.1",
		"[::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[0:0:0:0:0:0:0:1]", "0.0.0.0", "[::]", "0",
		"evil.example@127.0.0.1", "evil.example:80@127.0.0.1", "127.0.0.1#@example.com",
		// private ranges and cloud metadata, on the same port
		"10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "[fe80::1]", "[fc00::1]", "[fd00:ec2::254]",
	} {
		target := fmt.Sprintf("http://%s:%s/", host, port)
		if _, _, _, err := lk.get(context.Background(), target); err == nil {
			t.Errorf("%s was fetched without an error", target)
		}
	}
	if n := hits.Load(); n != 0 {
		t.Fatalf("the lookup reached the loopback server %d time(s)", n)
	}
	// sanity: the server is up, so a zero count means the guard worked and not that nothing could connect
	if resp, err := http.Get(srv.URL); err != nil || resp.StatusCode != 200 {
		t.Fatalf("the test server isn't reachable: %v", err)
	}
	if hits.Load() != 1 {
		t.Fatal("the direct request wasn't counted")
	}
}

// Schemes other than http and https are refused outright, including ones with odd casing or whitespace.
func TestLookupRefusesOtherSchemes(t *testing.T) {
	lk := NewLookup(nil)
	lk.defaults()
	for _, bad := range []string{
		"file:///etc/passwd", "FILE:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "javascript:alert(1)", "data:text/html,<script>1</script>",
		"jar:http://example.com/!/", "ws://example.com/", "  file:///etc/passwd", "//example.com/",
	} {
		if _, _, _, err := lk.get(context.Background(), bad); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
}
