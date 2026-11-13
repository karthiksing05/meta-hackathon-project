package config

import "testing"

func TestHarnessOnByDefault(t *testing.T) {
	for v, want := range map[string]bool{"": true, "1": true, "on": true, "0": false, "off": false, "OFF": false, "false": false} {
		if got := harnessOn(v); got != want {
			t.Errorf("HARNESS_CONTEXT=%q → %v, want %v", v, got, want)
		}
	}
}
