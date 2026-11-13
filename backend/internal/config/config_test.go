package config

import "testing"

func TestHarnessOnByDefault(t *testing.T) {
	for v, want := range map[string]bool{"": true, "1": true, "on": true, "0": false, "off": false, "OFF": false, "false": false} {
		if got := harnessOn(v); got != want {
			t.Errorf("HARNESS_CONTEXT=%q → %v, want %v", v, got, want)
		}
	}
}

func TestFeedExplore(t *testing.T) {
	for v, want := range map[string]float64{"": 0.15, "0.3": 0.3, "0": -1, "abc": 0.15, "2": 0.15, "-1": 0.15} {
		if got := feedExplore(v); got != want {
			t.Errorf("FEED_EXPLORE=%q → %v, want %v", v, got, want)
		}
	}
}
