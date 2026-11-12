// Command games is the lightweight static-file server for published game packages.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/staticsrv"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	dir := getenv("GAMES_PUBLIC_DIR", "./data/games/published")
	addr := getenv("GAMES_ADDR", ":8081")
	h, err := staticsrv.New(dir)
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

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
