package api

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Reading a run off a request and checking the engine's verdict on it: shared by a score on a game with a score model
// (scoring.go), a series round (series.go) and a same-seed round (rounds.go), which all take the same {log} body.

// runBody is what a request carries about one run.
type runBody struct {
	Log    string          // the run's input log (microgame-log/1), as text
	Seed   string          // the log's own engine seed, when it was asked for
	Replay json.RawMessage // the runtime's replay of the same run, for friends to watch (runlogs.go); optional
}

// readRunBody reads {log, replay?} from the request, up to maxBody bytes. The log may be sent as text or as JSON. With
// needSeed it must also be a microgame-log/1 run, and its seed is returned. missingLog is the message for a body with no
// usable log. On any failure it has already answered, and reports false.
func readRunBody(w http.ResponseWriter, r *http.Request, maxBody int64, missingLog string, needSeed bool) (runBody, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var in struct {
		Log    json.RawMessage `json:"log"`
		Replay json.RawMessage `json:"replay"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErr(w, 413, "that run's log is too large")
		} else {
			writeErr(w, 400, "invalid JSON body")
		}
		return runBody{}, false
	}
	logText := string(in.Log)
	if len(in.Log) > 0 && in.Log[0] == '"' { // the log as text, the way the app sends it
		if json.Unmarshal(in.Log, &logText) != nil {
			writeErr(w, 400, "log must be the run's log")
			return runBody{}, false
		}
	}
	if logText == "" || logText == "null" || len(logText) > maxLogBytes {
		writeErr(w, 400, missingLog)
		return runBody{}, false
	}
	run := runBody{Log: logText, Replay: in.Replay}
	if needSeed {
		var head struct {
			Seed json.Number `json:"seed"`
		}
		if json.Unmarshal([]byte(logText), &head) != nil || head.Seed == "" {
			writeErr(w, 400, "log must be a microgame-log/1 run")
			return runBody{}, false
		}
		run.Seed = head.Seed.String()
	}
	return run, true
}

// requireFinishedRun answers 422 unless the engine accepted the run on this game and it ended (won or lost). wrongGame
// is the message for a run played on another game. It reports whether the run may be used.
func requireFinishedRun(w http.ResponseWriter, res *verifyResult, wrongGame string) bool {
	if !res.OK || !res.GameHashOK || res.Recomputed == nil {
		reason := "the run didn't check out"
		if !res.GameHashOK {
			reason = wrongGame
		} else if len(res.Problems) > 0 {
			reason = "the run didn't check out: " + res.Problems[0]
		}
		writeErr(w, 422, reason)
		return false
	}
	if p := res.Recomputed.Phase; p != "won" && p != "lost" {
		writeErr(w, 422, "the run isn't finished")
		return false
	}
	return true
}
