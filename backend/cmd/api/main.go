// Command api is the Bubbles HTTP API. TLS is terminated by Cloudflare; this serves plain HTTP.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/config"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/recs"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var st store.Store
	switch cfg.Store {
	case "memory":
		log.Warn("using in-memory store: data is lost on restart (development only)")
		st = store.NewMemory()
	default:
		m, err := store.ConnectMongo(ctx, cfg.MongoURI, cfg.MongoDB)
		if err != nil {
			return err
		}
		defer m.Close(context.Background())
		st = m
	}
	pk, err := pkgstore.NewLocal(cfg.GamesRoot, pkgstore.Limits{
		MaxUploadBytes: cfg.MaxUploadMB << 20, MaxUnpackedBytes: cfg.MaxUnpackMB << 20, MaxFileBytes: 50 << 20,
	})
	if err != nil {
		return err
	}
	var engine *recs.Engine
	if cfg.RecsRuntimes > 0 {
		opts := recs.Options{Runtimes: cfg.RecsRuntimes}
		if cfg.RecsInterleave != "" {
			opts.Overrides = map[string]any{"interleave": map[string]any{"on": true, "against": cfg.RecsInterleave}}
		}
		if engine, err = recs.New(opts); err != nil {
			return err
		}
		log.Info("recommender loaded", "version", engine.Version(), "runtimes", cfg.RecsRuntimes, "interleave", cfg.RecsInterleave)
	}
	srv := api.New(api.Options{
		Store: st, Packages: pk, Signer: auth.NewSigner(cfg.JWTSecret, cfg.AccessTTL),
		RefreshTTL: cfg.RefreshTTL, GamesBaseURL: cfg.GamesBaseURL, CORSOrigins: cfg.CORSOrigins,
		MaxUploadMB: cfg.MaxUploadMB, Log: log,
		Recs: engine, GeneratorURL: cfg.GeneratorURL, GenerateConcurrent: cfg.GenerateConcurrent, GeneratePerHour: cfg.GeneratePerHour,
	})
	if n, err := st.FailStaleJobs(ctx, "The server restarted while this game was being made. Please try again."); err != nil {
		log.Warn("could not clear stale generation jobs", "err", err)
	} else if n > 0 {
		log.Info("marked generation jobs left by a restart as failed", "count", n)
	}
	hs := &http.Server{
		Addr: cfg.Addr, Handler: srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 2 * time.Minute,
		IdleTimeout: 120 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- hs.ListenAndServe() }()
	log.Info("api listening", "addr", cfg.Addr, "store", cfg.Store)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	sctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := hs.Shutdown(sctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
