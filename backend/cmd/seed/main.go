// Command seed puts the demo world (people, friends, a Group and an Event, the app's seed games and their
// scores) on the server. Run it once after the first deploy, on the server, with the API's environment:
//
//	/srv/game-platform/app/deploy.sh seed
//
// It is safe to run again: whatever is already there is left alone.
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/config"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/seed"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	var st store.Store
	if cfg.Store == "memory" {
		st = store.NewMemory()
	} else {
		m, err := store.ConnectMongo(ctx, cfg.MongoURI, cfg.MongoDB)
		if err != nil {
			log.Error("mongo", "err", err)
			os.Exit(1)
		}
		defer m.Close(context.Background())
		st = m
	}
	pk, err := pkgstore.NewLocal(cfg.GamesRoot, pkgstore.Limits{MaxUploadBytes: cfg.MaxUploadMB << 20, MaxUnpackedBytes: cfg.MaxUnpackMB << 20, MaxFileBytes: 50 << 20})
	if err != nil {
		log.Error("storage", "err", err)
		os.Exit(1)
	}
	srv := api.New(api.Options{Store: st, Packages: pk, Signer: auth.NewSigner(cfg.JWTSecret, cfg.AccessTTL), GamesBaseURL: cfg.GamesBaseURL, MaxUploadMB: cfg.MaxUploadMB, Log: log})
	rep, err := seed.Run(ctx, st, srv, log)
	if err != nil {
		log.Error("seed failed", "err", err, "so_far", rep)
		os.Exit(1)
	}
	log.Info("seed done", "users", rep.Users, "friendships", rep.Friendships, "groups", rep.Groups, "members", rep.Members, "games", rep.Games, "alreadyThere", rep.Skipped, "scores", rep.Scores)
}
