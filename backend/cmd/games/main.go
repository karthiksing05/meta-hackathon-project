// Command games is the lightweight static-file server for published game packages.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/repo"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/staticsrv"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	dir := getenv("GAMES_PUBLIC_DIR", "./data/games/published")
	addr := getenv("GAMES_ADDR", ":8081")
	var opts []staticsrv.Option
	if rt := playerRuntimeDir(); rt != "" {
		opts = append(opts, staticsrv.WithPlayerRuntime(rt))
	} else {
		log.Warn("the web player has no runtime: set PLAYER_RUNTIME_DIR to FacebookClone/Bubbles/Runtime/web")
	}
	h, err := staticsrv.New(dir, opts...)
	if err != nil {
		log.Error("cannot open games directory", "dir", dir, "err", err)
		os.Exit(1)
	}
	srv := &http.Server{
		Addr: addr, Handler: h,
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 5 * time.Minute, IdleTimeout: 120 * time.Second,
	}
	log.Info("games server listening", "addr", addr, "dir", dir)
	if err := srv.ListenAndServe(); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// playerRuntimeDir is where the app's runtime files are: $PLAYER_RUNTIME_DIR, the image's /app/player/runtime,
// or the repository copy.
func playerRuntimeDir() string {
	for _, p := range []string{os.Getenv("PLAYER_RUNTIME_DIR"), "/app/player/runtime"} {
		if p != "" {
			if st, err := os.Stat(p); err == nil && st.IsDir() {
				return p
			}
		}
	}
	if p, ok := repo.Find("FacebookClone/Bubbles/Runtime/web"); ok {
		return p
	}
	return ""
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
