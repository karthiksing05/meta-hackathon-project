package store

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

// Run logs: the replay behind each counted score (model.RunLog), one per person and game, keyed "gameId:userId".
const cRunLogs = "run_logs"

func runLogKey(gameID, userID string) string { return gameID + ":" + userID }

func (m *Memory) PutRunLog(ctx context.Context, l model.RunLog) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.runLogs == nil {
		m.runLogs = map[string]model.RunLog{}
	}
	m.runLogs[runLogKey(l.GameID, l.UserID)] = l
	return nil
}

func (m *Memory) RunLogOf(ctx context.Context, gameID, userID string) (*model.RunLog, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.runLogs[runLogKey(gameID, userID)]
	if !ok {
		return nil, ErrNotFound
	}
	return &l, nil
}

func (m *Memory) RunLogScores(ctx context.Context, gameID string, userIDs []string) (map[string]int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]int64{}
	for _, id := range userIDs {
		if l, ok := m.runLogs[runLogKey(gameID, id)]; ok {
			out[id] = l.Score
		}
	}
	return out, nil
}

// deleteRunLogsLocked drops a game's run logs; the caller holds m.mu.
func (m *Memory) deleteRunLogsLocked(gameID string) {
	for k, l := range m.runLogs {
		if l.GameID == gameID {
			delete(m.runLogs, k)
		}
	}
}

func (m *Mongo) PutRunLog(ctx context.Context, l model.RunLog) error {
	_, err := m.coll(cRunLogs).ReplaceOne(ctx, bson.D{{Key: "_id", Value: runLogKey(l.GameID, l.UserID)}}, l, options.Replace().SetUpsert(true))
	return err
}

func (m *Mongo) RunLogOf(ctx context.Context, gameID, userID string) (*model.RunLog, error) {
	var l model.RunLog
	if err := m.coll(cRunLogs).FindOne(ctx, bson.D{{Key: "_id", Value: runLogKey(gameID, userID)}}).Decode(&l); err != nil {
		return nil, mapErr(err)
	}
	return &l, nil
}

func (m *Mongo) RunLogScores(ctx context.Context, gameID string, userIDs []string) (map[string]int64, error) {
	out := map[string]int64{}
	if len(userIDs) == 0 {
		return out, nil
	}
	keys := make([]string, len(userIDs))
	for i, id := range userIDs {
		keys[i] = runLogKey(gameID, id)
	}
	// only the ids and scores: the logs stay in the database until someone watches one
	cur, err := m.coll(cRunLogs).Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: keys}}}},
		options.Find().SetProjection(bson.D{{Key: "userId", Value: 1}, {Key: "score", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		UserID string `bson:"userId"`
		Score  int64  `bson:"score"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.UserID] = r.Score
	}
	return out, nil
}
