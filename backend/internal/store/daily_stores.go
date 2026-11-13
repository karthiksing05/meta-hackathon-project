package store

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

const cDailies = "group_dailies"

func (m *Memory) PutGroupDaily(ctx context.Context, d model.GroupDaily) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.dailies == nil {
		m.dailies = map[string]model.GroupDaily{}
	}
	d.ID = d.GroupID + ":" + d.Date
	m.dailies[d.ID] = d
	return nil
}

func (m *Memory) LatestGroupDaily(ctx context.Context, groupID, onOrBefore string) (*model.GroupDaily, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var best *model.GroupDaily
	for _, d := range m.dailies {
		if d.GroupID != groupID || d.Date > onOrBefore {
			continue
		}
		if best == nil || d.Date > best.Date {
			c := d
			best = &c
		}
	}
	if best == nil {
		return nil, ErrNotFound
	}
	return best, nil
}

func (m *Mongo) PutGroupDaily(ctx context.Context, d model.GroupDaily) error {
	d.ID = d.GroupID + ":" + d.Date
	_, err := m.coll(cDailies).ReplaceOne(ctx, bson.D{{Key: "_id", Value: d.ID}}, d, options.Replace().SetUpsert(true))
	return mapErr(err)
}

func (m *Mongo) LatestGroupDaily(ctx context.Context, groupID, onOrBefore string) (*model.GroupDaily, error) {
	var d model.GroupDaily
	err := m.coll(cDailies).FindOne(ctx,
		bson.D{{Key: "groupId", Value: groupID}, {Key: "date", Value: bson.D{{Key: "$lte", Value: onOrBefore}}}},
		options.FindOne().SetSort(bson.D{{Key: "date", Value: -1}})).Decode(&d)
	if err != nil {
		return nil, mapErr(err)
	}
	return &d, nil
}
