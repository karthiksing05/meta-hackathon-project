package api_test

import "testing"

func TestUserSearch(t *testing.T) {
	ts := serverWithRecs(t, false)
	me := register(t, ts, "annabel")
	register(t, ts, "anders")
	bob := register(t, ts, "bob_anne") // matches "ann" by no prefix; "anne" is inside the name
	cat := register(t, ts, "cat")
	catID := meID(t, ts, cat)
	_ = bob
	do(t, "PUT", ts.URL+"/v1/me/friends/"+catID, me, nil, "")

	names := func(q string) (int, []string) {
		code, out := do(t, "GET", ts.URL+"/v1/users?q="+q, me, nil, "")
		var got []string
		if items, ok := out["items"].([]any); ok {
			for _, it := range items {
				m := it.(map[string]any)
				if m["email"] != nil {
					t.Fatalf("email leaked: %v", m)
				}
				got = append(got, m["username"].(string))
			}
		}
		return code, got
	}
	if code, got := names("an"); code != 200 || len(got) != 1 || got[0] != "anders" { // not me, not bob_anne
		t.Fatalf("prefix search: %d %v", code, got)
	}
	if _, got := names("ANDERS"); len(got) != 1 { // case-insensitive
		t.Fatalf("case: %v", got)
	}
	if code, got := names("c"); code != 400 || got != nil { // too short
		t.Fatalf("one letter: %d %v", code, got)
	}
	code, out := do(t, "GET", ts.URL+"/v1/users?q=cat", me, nil, "")
	if code != 200 || out["items"].([]any)[0].(map[string]any)["isFriend"] != true {
		t.Fatalf("friend flag: %d %v", code, out)
	}
	if _, got := names("zzz"); len(got) != 0 {
		t.Fatalf("no match: %v", got)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/users?q=an", "", nil, ""); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	// regex characters are text, not patterns
	if code, got := names("a.*"); code != 200 || len(got) != 0 {
		t.Fatalf("regex injection: %d %v", code, got)
	}
}
