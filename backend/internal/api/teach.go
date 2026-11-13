package api

import (
	"context"
	"slices"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// Social moments the server knows about and the app never reports. The recommender (game-recs.js) weighs
// challenge_sent and challenge_accepted, but the app only posts moments it can see on the phone, and a challenge's
// life (who it went to, who played it) is the server's. So the server teaches the recommender itself, once per
// challenge or series, under a stable event id so a retry or a replay never counts twice.
//
// These events carry no `with`, so they don't also show up in the other person's /v1/me/moments (a challenge already
// does, as challenge_received).

// teach adds one social moment for a person and lets their model learn from it. id makes it idempotent.
func (s *Server) teach(ctx context.Context, userID, kind, gameID, id string) {
	if !s.recsEnabled() || userID == "" || gameID == "" {
		return
	}
	ctx = context.WithoutCancel(ctx)
	e := model.Event{
		ID: "srv:" + id, Actor: "u:" + userID, UserID: userID, GameID: gameID, Kind: kind,
		SocialMoment: true, Credit: true, CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
	added, err := s.Store.AddEvents(ctx, []model.Event{e})
	if err != nil {
		s.Log.Warn("teach: could not store a social moment", "kind", kind, "err", err)
		return
	}
	if len(added) > 0 { // a repeat is a no-op
		s.learnFromEvents(ctx, userID, added)
	}
}

// noteChallengeAccepted is called when a person has just played a game. Every challenge sent to them on it that they
// hadn't answered yet counts, once, as challenge_accepted.
func (s *Server) noteChallengeAccepted(ctx context.Context, userID, gameID string) {
	if !s.recsEnabled() {
		return
	}
	cs, err := s.Store.ChallengesFor(ctx, userID, 100)
	if err != nil {
		return
	}
	for _, c := range cs {
		if c.GameID == gameID && c.FromID != userID && slices.Contains(c.ToIDs, userID) {
			s.teach(ctx, userID, "challenge_accepted", gameID, "challenge_accepted:"+c.ID+":"+userID)
		}
	}
}
