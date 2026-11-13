package apns

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testKey(t *testing.T) (*ecdsa.PrivateKey, []byte) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	return k, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func TestNewRejectsBadConfig(t *testing.T) {
	_, p := testKey(t)
	for name, c := range map[string]Config{
		"no ids":   {KeyPEM: p},
		"not pem":  {KeyPEM: []byte("nope"), KeyID: "K", TeamID: "T", Topic: "com.x"},
		"no topic": {KeyPEM: p, KeyID: "K", TeamID: "T"},
	} {
		if _, err := New(c); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
	if _, err := New(Config{KeyPEM: p, KeyID: "K", TeamID: "T", Topic: "com.x"}); err != nil {
		t.Fatal(err)
	}
}

func TestSendSignsAndMapsErrors(t *testing.T) {
	key, p := testKey(t)
	c, err := New(Config{KeyPEM: p, KeyID: "KEY123", TeamID: "TEAM456", Topic: "com.example.app"})
	if err != nil {
		t.Fatal(err)
	}
	var gotAuth, gotTopic, gotPath, gotType string
	var gotBody map[string]any
	reply := 200
	reason := ""
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotTopic, gotPath, gotType = r.Header.Get("authorization"), r.Header.Get("apns-topic"), r.URL.Path, r.Header.Get("apns-push-type")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(reply)
		if reason != "" {
			json.NewEncoder(w).Encode(map[string]string{"reason": reason})
		}
	}))
	defer srv.Close()
	c.SetHostForTest("sandbox", srv.URL, srv.Client())

	if err := c.Send(context.Background(), "sandbox", "abcd1234", []byte(`{"aps":{"alert":{"title":"t","body":"b"}}}`)); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/3/device/abcd1234" || gotTopic != "com.example.app" || gotType != "alert" || gotBody["aps"] == nil {
		t.Fatalf("request: %s %s %s %v", gotPath, gotTopic, gotType, gotBody)
	}
	// the bearer is a real ES256 JWT for this team and key
	parts := strings.Split(strings.TrimPrefix(gotAuth, "bearer "), ".")
	if len(parts) != 3 {
		t.Fatalf("authorization: %q", gotAuth)
	}
	var head, claims map[string]any
	h, _ := base64.RawURLEncoding.DecodeString(parts[0])
	cl, _ := base64.RawURLEncoding.DecodeString(parts[1])
	json.Unmarshal(h, &head)
	json.Unmarshal(cl, &claims)
	if head["alg"] != "ES256" || head["kid"] != "KEY123" || claims["iss"] != "TEAM456" || claims["iat"] == nil {
		t.Fatalf("jwt: %v %v", head, claims)
	}
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if len(sig) != 64 || !ecdsa.Verify(&key.PublicKey, sum[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("the signature does not verify")
	}
	first := gotAuth
	c.Send(context.Background(), "sandbox", "abcd1234", []byte(`{}`))
	if gotAuth != first {
		t.Fatal("the provider token must be reused until it is due")
	}

	for _, tc := range []struct {
		status         int
		reason         string
		bad, retryable bool
	}{
		{410, "Unregistered", true, false},
		{400, "BadDeviceToken", true, false},
		{403, "ExpiredProviderToken", false, true},
		{429, "TooManyRequests", false, true},
		{503, "ServiceUnavailable", false, true},
		{400, "PayloadTooLarge", false, false},
	} {
		reply, reason = tc.status, tc.reason
		err := c.Send(context.Background(), "sandbox", "abcd1234", []byte(`{}`))
		e, ok := err.(*Error)
		if !ok || e.Status != tc.status || e.Reason != tc.reason || e.BadToken() != tc.bad || e.Retryable() != tc.retryable {
			t.Errorf("%d %s: %#v", tc.status, tc.reason, err)
		}
	}
	if err := c.Send(context.Background(), "moon", "abcd", nil); err == nil {
		t.Error("an unknown environment must fail")
	}
	// a network failure never puts the device token in the error
	c.SetHostForTest("sandbox", "http://127.0.0.1:1", &http.Client{})
	err = c.Send(context.Background(), "sandbox", "secrettoken", []byte(`{}`))
	if err == nil || strings.Contains(err.Error(), "secrettoken") {
		t.Fatalf("network error: %v", err)
	}
}
