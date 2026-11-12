// Command genphotos generates caption-matching demo photos with Muse Image and writes
// them to static/media/<media_id>.jpg. Existing files are skipped; spend is metered into
// the server's usage.json budget.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"scrollgames/server/internal/srv"
)

const (
	imageModel   = "muse-image-1.0"
	costMicro    = 10000 // $0.01 per image
	maxFileBytes = 300 << 10
)

func main() {
	dataDir := flag.String("data", "data", "data directory (holds usage.json)")
	outDir := flag.String("out", "static/media", "output directory")
	baseURL := flag.String("muse-url", "https://api.meta.ai/v1", "Muse API base URL")
	envFile := flag.String("env", "", "path to .env (default: search upward)")
	flag.Parse()

	key := srv.LoadDotenvKey(*envFile)
	if key == "" {
		log.Fatal("MUSE_API_KEY not found")
	}
	capUSD := 15.0
	if v, err := strconv.ParseFloat(os.Getenv("SG_SPEND_CAP_USD"), 64); err == nil && v >= 0 {
		capUSD = v
	}
	budget := srv.NewBudget(filepath.Join(*dataDir, "usage.json"), capUSD)
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatal(err)
	}
	client := &http.Client{Timeout: 180 * time.Second}

	var spent float64
	var made int
	for _, p := range srv.SeedPhotos() {
		path := filepath.Join(*outDir, p.ID+".jpg")
		if _, err := os.Stat(path); err == nil {
			fmt.Printf("%s: exists, skipped\n", p.ID)
			continue
		}
		if !budget.Reserve(costMicro) {
			log.Fatalf("%s: spend cap reached", p.ID)
		}
		start := time.Now()
		img, err := generate(client, *baseURL, key, prompt(p.Caption))
		ms := time.Since(start).Milliseconds()
		if err != nil {
			budget.Release(costMicro)
			log.Printf("%s: failed after %dms: %v", p.ID, ms, err)
			continue
		}
		budget.RecordFixed(costMicro, costMicro, srv.Call{Model: imageModel, Purpose: "demo-photo", MS: ms, Status: "ok"})
		if err := os.WriteFile(path, img, 0o644); err != nil {
			log.Fatal(err)
		}
		shrink(path)
		st, _ := os.Stat(path)
		fmt.Printf("%s: %dms, %d KB (%s)\n", p.ID, ms, st.Size()/1024, p.Caption)
		spent += float64(costMicro) / 1e6
		made++
	}
	fmt.Printf("generated %d images, cost $%.2f\n", made, spent)
}

func prompt(caption string) string {
	return "Photo-realistic candid smartphone photograph: " + caption + ". Natural lighting, true-to-life colours, " +
		"landscape framing, no text or watermarks. No identifiable real people: if anyone appears, show only crowds, " +
		"people from behind, or hands."
}

func generate(client *http.Client, baseURL, key, prompt string) ([]byte, error) {
	body, _ := json.Marshal(map[string]any{"model": imageModel, "prompt": prompt, "n": 1, "size": "1536x1024",
		"response_format": "b64_json", "output_format": "jpeg", "reasoning_strength": "low"})
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 3 * time.Second)
		}
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, baseURL+"/images/generations", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("http %d", resp.StatusCode)
			continue
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("http %d: %.200s", resp.StatusCode, raw)
		}
		var out struct {
			Data []struct {
				B64 string `json:"b64_json"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &out); err != nil || len(out.Data) == 0 || out.Data[0].B64 == "" {
			return nil, errors.New("response has no data[0].b64_json")
		}
		return base64.StdEncoding.DecodeString(out.Data[0].B64)
	}
	return nil, lastErr
}

// shrink downscales and recompresses with macOS sips until the file is under maxFileBytes.
func shrink(path string) {
	for _, q := range []string{"70", "55", "40"} {
		if st, err := os.Stat(path); err != nil || st.Size() <= maxFileBytes {
			return
		}
		if err := exec.Command("sips", "-Z", "1200", "-s", "format", "jpeg", "-s", "formatOptions", q, path).Run(); err != nil {
			log.Printf("sips failed for %s: %v", path, err)
			return
		}
	}
}
