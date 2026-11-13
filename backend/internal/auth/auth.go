// Package auth provides password hashing, HS256 access tokens and opaque refresh tokens.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidToken = errors.New("invalid token")

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), 11)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

// NewID returns a random lowercase-hex id of 2*n characters.
func NewID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// NewRefreshToken returns the opaque token for the client and its hash for storage.
func NewRefreshToken() (token, hash string) {
	token = NewID(32)
	return token, HashToken(token)
}

func HashToken(t string) string {
	s := sha256.Sum256([]byte(t))
	return hex.EncodeToString(s[:])
}

type Signer struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

func NewSigner(secret []byte, ttl time.Duration) *Signer {
	return &Signer{secret: secret, ttl: ttl, now: time.Now}
}

type claims struct {
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

var b64 = base64.RawURLEncoding

const header = `{"alg":"HS256","typ":"JWT"}`

func (s *Signer) sign(data string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(data))
	return b64.EncodeToString(m.Sum(nil))
}

func (s *Signer) Issue(userID string) (string, time.Time) {
	now := s.now()
	exp := now.Add(s.ttl)
	body, _ := json.Marshal(claims{Sub: userID, Iat: now.Unix(), Exp: exp.Unix()})
	data := b64.EncodeToString([]byte(header)) + "." + b64.EncodeToString(body)
	return data + "." + s.sign(data), exp
}

// Verify returns the user id from a valid, unexpired token.
func (s *Signer) Verify(tok string) (string, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return "", ErrInvalidToken
	}
	if h, err := b64.DecodeString(parts[0]); err != nil || string(h) != header {
		return "", ErrInvalidToken
	}
	want := s.sign(parts[0] + "." + parts[1])
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		return "", ErrInvalidToken
	}
	raw, err := b64.DecodeString(parts[1])
	if err != nil {
		return "", ErrInvalidToken
	}
	var c claims
	if json.Unmarshal(raw, &c) != nil || c.Sub == "" || s.now().Unix() >= c.Exp {
		return "", ErrInvalidToken
	}
	return c.Sub, nil
}
