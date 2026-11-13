// Package apns sends lock-screen notifications through Apple's push service (token-based authentication: an ES256 JWT
// signed with the team's .p8 key). It holds no queue: the API's outbox decides what to send and when to retry.
package apns

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Hosts are Apple's push endpoints; the device's environment (sandbox or production) picks one.
var Hosts = map[string]string{
	"production": "https://api.push.apple.com",
	"sandbox":    "https://api.sandbox.push.apple.com",
}

// Config is what the server needs to sign in to APNs. None of it is ever logged.
type Config struct {
	KeyPEM []byte // the .p8 auth key (PEM)
	KeyID  string
	TeamID string
	Topic  string // the app's bundle id
}

// Error is APNs refusing a push. Status is the HTTP status and Reason Apple's reason string.
type Error struct {
	Status int
	Reason string
}

func (e *Error) Error() string { return fmt.Sprintf("apns: %d %s", e.Status, e.Reason) }

// BadToken reports that the device token will never work again (the app was removed, or the token is for another
// environment), so the device should be forgotten.
func (e *Error) BadToken() bool {
	switch e.Reason {
	case "BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken":
		return true
	}
	return false
}

// Retryable reports a failure that may pass: Apple being busy or down, a rate limit, or an expired signing token.
func (e *Error) Retryable() bool {
	return e.Status == 429 || e.Status >= 500 || e.Reason == "ExpiredProviderToken" || e.Reason == "TooManyProviderTokenUpdates"
}

// Client sends pushes. It is safe for concurrent use.
type Client struct {
	cfg   Config
	key   *ecdsa.PrivateKey
	hc    *http.Client
	hosts map[string]string

	mu     sync.Mutex
	jwt    string
	jwtAt  time.Time
	nowFn  func() time.Time
	tokTTL time.Duration
}

// New parses the key and returns a client. An error here means the key or ids are unusable.
func New(cfg Config) (*Client, error) {
	if cfg.KeyID == "" || cfg.TeamID == "" || cfg.Topic == "" {
		return nil, errors.New("apns: key id, team id and topic (the bundle id) are all required")
	}
	block, _ := pem.Decode(cfg.KeyPEM)
	if block == nil {
		return nil, errors.New("apns: the key is not PEM")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("apns: the key is not a PKCS8 key: %w", err)
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("apns: the key is not an EC key")
	}
	hosts := map[string]string{}
	for k, v := range Hosts {
		hosts[k] = v
	}
	return &Client{cfg: cfg, key: ec, hc: &http.Client{Timeout: 15 * time.Second}, hosts: hosts, nowFn: time.Now, tokTTL: 40 * time.Minute}, nil
}

// bearer is the signed provider token. Apple wants it refreshed no more than every 20 minutes and no less than hourly.
func (c *Client) bearer() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.nowFn()
	if c.jwt != "" && now.Sub(c.jwtAt) < c.tokTTL {
		return c.jwt, nil
	}
	enc := base64.RawURLEncoding
	head, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": c.cfg.KeyID})
	claims, _ := json.Marshal(map[string]any{"iss": c.cfg.TeamID, "iat": now.Unix()})
	signing := enc.EncodeToString(head) + "." + enc.EncodeToString(claims)
	sum := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, c.key, sum[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64) // r and s as fixed-width big-endian, 32 bytes each
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	c.jwt, c.jwtAt = signing+"."+enc.EncodeToString(sig), now
	return c.jwt, nil
}

// Send delivers one payload to one device. env is "sandbox" or "production".
func (c *Client) Send(ctx context.Context, env, token string, payload []byte) error {
	host, ok := c.hosts[env]
	if !ok {
		return fmt.Errorf("apns: unknown environment %q", env)
	}
	bearer, err := c.bearer()
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, host+"/3/device/"+token, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "bearer "+bearer)
	req.Header.Set("apns-topic", c.cfg.Topic)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")
	req.Header.Set("content-type", "application/json")
	res, err := c.hc.Do(req)
	if err != nil {
		return &Error{Status: 599, Reason: "network"} // never the URL: it carries the device token
	}
	defer res.Body.Close()
	if res.StatusCode == 200 {
		io.Copy(io.Discard, res.Body)
		return nil
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&body)
	return &Error{Status: res.StatusCode, Reason: strings.TrimSpace(body.Reason)}
}

// SetHostForTest points an environment at another server (tests only).
func (c *Client) SetHostForTest(env, url string, hc *http.Client) {
	c.hosts[env] = url
	if hc != nil {
		c.hc = hc
	}
}
