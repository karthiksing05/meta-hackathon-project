package harness

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"time"
)

// The web lookup's fetcher rules (Max, 2026-11-12): http(s) only; never a private, loopback or link-local
// address, checked after DNS resolution and again on every redirect; a few seconds and about 1 MB per page;
// no cookies; and never the Muse key (the fetcher sends no credentials of any kind).

// ErrBlockedAddress is returned when a fetch would reach a non-public address.
var ErrBlockedAddress = errors.New("harness: refusing to fetch a private, loopback or link-local address")

// blockedPrefixes are the non-public ranges beyond what netip's own predicates cover.
var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),      // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),  // carrier-grade NAT
	netip.MustParsePrefix("192.0.0.0/24"),   // IETF protocol assignments
	netip.MustParsePrefix("198.18.0.0/15"),  // benchmarking
	netip.MustParsePrefix("240.0.0.0/4"),    // reserved
	netip.MustParsePrefix("64:ff9b::/96"),   // NAT64 (could map to a private v4)
	netip.MustParsePrefix("2001:db8::/32"),  // documentation
	netip.MustParsePrefix("fec0::/10"),      // old site-local
	netip.MustParsePrefix("169.254.0.0/16"), // link-local (cloud metadata lives here)
	netip.MustParsePrefix("fe80::/10"),      // link-local v6
	netip.MustParsePrefix("255.255.255.255/32"),
}

// PublicIP reports whether ip is safe to fetch from: a global unicast address outside every private,
// loopback, link-local, multicast and reserved range.
func PublicIP(ip netip.Addr) bool {
	if !ip.IsValid() {
		return false
	}
	ip = ip.Unmap()
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || !ip.IsGlobalUnicast() {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// guardedDialContext resolves the host itself, refuses non-public addresses, and dials the checked IP
// (so a second DNS answer can't swap in a private one). Every connection, including each redirect's, goes
// through it.
func guardedDialContext(resolver *net.Resolver, dialer *net.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		var ips []netip.Addr
		if ip, err := netip.ParseAddr(host); err == nil {
			ips = []netip.Addr{ip}
		} else {
			ips, err = resolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
		}
		var lastErr error = ErrBlockedAddress
		for _, ip := range ips {
			if !PublicIP(ip) {
				lastErr = fmt.Errorf("%w (%s)", ErrBlockedAddress, host)
				continue
			}
			c, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
			if err == nil {
				return c, nil
			}
			lastErr = err
		}
		return nil, lastErr
	}
}

// checkRedirect allows at most 5 redirects, each to http or https. The address check happens again in
// the dialer when the redirect connects.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("harness: too many redirects")
	}
	if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
		return fmt.Errorf("harness: refusing a redirect to %q", req.URL.Scheme)
	}
	req.Header.Del("Cookie")
	req.Header.Del("Authorization")
	return nil
}

// NewSafeHTTPClient is the lookup's HTTP client: public addresses only (after resolution and on every
// redirect), http(s) only, no cookie jar, no proxy, a per-request timeout.
func NewSafeHTTPClient(perRequest time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: perRequest, KeepAlive: -1}
	tr := &http.Transport{
		Proxy:                 nil, // a proxy would dial for us and skip the address check
		DialContext:           guardedDialContext(net.DefaultResolver, dialer),
		TLSHandshakeTimeout:   perRequest,
		ResponseHeaderTimeout: perRequest,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
		DisableKeepAlives:     true,
	}
	return &http.Client{Transport: tr, Timeout: perRequest, CheckRedirect: checkRedirect, Jar: nil}
}
