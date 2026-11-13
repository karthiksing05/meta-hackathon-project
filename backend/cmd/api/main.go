// Command api is the Bubbles HTTP API. TLS is terminated by Cloudflare; this serves plain HTTP.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/apns"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/config"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/mediastore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/recs"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/mongo"
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
	// The person's own photos and videos, on the games volume but outside published/ (never served by the games host).
	media, err := mediastore.New(filepath.Join(cfg.GamesRoot, "media"), cfg.MediaMaxItems, cfg.MediaMaxMB<<20)
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
	var hs0 *harness.Harness
	var planner *harness.Planner
	if cfg.HarnessContext && cfg.GeneratorURL != "" {
		var db *mongo.Database
		if m, ok := st.(*store.Mongo); ok {
			db = m.Database()
		}
		if h, p, err := harness.NewForServer(ctx, db, cfg.GeneratorURL); err != nil {
			log.Warn("harness not loaded; games are made without it", "err", err) // best-effort, never blocks the API
		} else {
			hs0, planner = h, p
			nt, nl := h.Index().Len()
			log.Info("harness loaded", "types", nt, "tools", nl)
		}
	}
	var push api.PushSender
	if len(cfg.APNSKeyPEM) > 0 || cfg.APNSKeyID != "" || cfg.APNSTeamID != "" || cfg.APNSTopic != "" {
		c, err := apns.New(apns.Config{KeyPEM: cfg.APNSKeyPEM, KeyID: cfg.APNSKeyID, TeamID: cfg.APNSTeamID, Topic: cfg.APNSTopic})
		if err != nil {
			log.Warn("push notifications are off: APNs is not set up correctly", "err", err.Error())
		} else {
			push = c
			log.Info("push notifications on", "topic", cfg.APNSTopic)
		}
	}
	srv := api.New(api.Options{
		Store: st, Packages: pk, Signer: auth.NewSigner(cfg.JWTSecret, cfg.AccessTTL),
		RefreshTTL: cfg.RefreshTTL, GamesBaseURL: cfg.GamesBaseURL, CORSOrigins: cfg.CORSOrigins,
		MaxUploadMB: cfg.MaxUploadMB, Log: log,
		Recs: engine, FeedExplore: cfg.FeedExplore, GeneratorURL: cfg.GeneratorURL, GenerateConcurrent: cfg.GenerateConcurrent, GeneratePerHour: cfg.GeneratePerHour,
		HarnessContext: cfg.HarnessContext, Harness: hs0, Planner: planner, SponsorUsers: cfg.SponsorUsers, DebugDelete: cfg.DebugDelete,
		Push: push, Media: media,
		Viral: api.ViralOptions{Off: cfg.ViralOff, MinPlayers: cfg.ViralMinPlayers, Window: cfg.ViralWindow, Cosine: cfg.ViralCosine,
			MinPages: cfg.ViralMinPages, PerDay: cfg.ViralPerDay, Interval: cfg.ViralInterval},
	})
	go srv.RunPush(ctx)
	go srv.RunViral(ctx)
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
