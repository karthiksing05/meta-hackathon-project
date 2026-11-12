package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"scrollgames/server/internal/srv"
)

func main() {
	cfg := srv.DefaultConfig()
	flag.StringVar(&cfg.Addr, "addr", envOr("SG_ADDR", cfg.Addr), "listen address")
	flag.StringVar(&cfg.DataDir, "data", envOr("SG_DATA", cfg.DataDir), "data directory")
	flag.StringVar(&cfg.PlayerDir, "player", envOr("SG_PLAYER", cfg.PlayerDir), "static player directory")
	flag.StringVar(&cfg.SpecDir, "spec", envOr("SG_SPEC", cfg.SpecDir), "spec directory")
	flag.StringVar(&cfg.SgtoolPath, "sgtool", envOr("SG_SGTOOL", cfg.SgtoolPath), "sgtool binary")
	flag.StringVar(&cfg.MuseBaseURL, "muse-url", envOr("MUSE_BASE_URL", cfg.MuseBaseURL), "Muse API base URL")
	envFile := flag.String("env", "", "path to .env (default: search upward)")
	flag.Parse()
	cfg.MuseKey = srv.LoadDotenvKey(*envFile)

	app := srv.NewApp(cfg)
	go app.PrewarmMuse()
	log.Printf("scroll-games server on %s (muse configured: %v)", cfg.Addr, cfg.MuseKey != "")
	log.Fatal(http.ListenAndServe(cfg.Addr, app.Handler()))
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
