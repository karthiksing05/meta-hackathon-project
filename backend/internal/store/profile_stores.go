package store

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func (m *Memory) UpdateUserProfile(ctx context.Context, u *model.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	x, ok := m.users[u.ID]
	if !ok {
		return ErrNotFound
	}
	x.DisplayName, x.Bio, x.AvatarURL, x.CoverColor = u.DisplayName, u.Bio, u.AvatarURL, u.CoverColor
	return nil
}

func (m *Mongo) UpdateUserProfile(ctx context.Context, u *model.User) error {
	res, err := m.coll(cUsers).UpdateOne(ctx, bson.D{{Key: "_id", Value: u.ID}}, bson.D{{Key: "$set", Value: bson.D{
		{Key: "displayName", Value: u.DisplayName}, {Key: "bio", Value: u.Bio},
		{Key: "avatarUrl", Value: u.AvatarURL}, {Key: "coverColor", Value: u.CoverColor},
	}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (m *Memory) SetPasswordHash(ctx context.Context, id, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	x, ok := m.users[id]
	if !ok {
		return ErrNotFound
	}
	x.PasswordHash = hash
	return nil
}

func (m *Mongo) SetPasswordHash(ctx context.Context, id, hash string) error {
	res, err := m.coll(cUsers).UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, bson.D{{Key: "$set", Value: bson.D{{Key: "passwordHash", Value: hash}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}
