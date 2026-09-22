// Package ttl helpers compute environment expiry.
package ttl

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	ephemeralv1alpha1 "github.com/elementor/ephemeral-operator/api/v1alpha1"
)

const Default = 24 * time.Hour

// Duration returns the effective TTL, defaulting to 24h.
func Duration(env *ephemeralv1alpha1.EphemeralEnvironment) time.Duration {
	if env.Spec.TTL != nil && env.Spec.TTL.Duration > 0 {
		return env.Spec.TTL.Duration
	}
	return Default
}

// ExpiresAt computes when the environment should be deleted.
//
// Normal mode: creationTimestamp + TTL (so patching spec.ttl extends/shortens).
// Pause mode: freeze at the previously observed ExpiresAt (or compute once).
func ExpiresAt(env *ephemeralv1alpha1.EphemeralEnvironment, now time.Time) metav1.Time {
	if env.Spec.Pause {
		if env.Status.ExpiresAt != nil {
			return *env.Status.ExpiresAt
		}
		return metav1.NewTime(now.Add(Duration(env)))
	}

	base := env.CreationTimestamp.Time
	if base.IsZero() {
		base = now
	}
	return metav1.NewTime(base.Add(Duration(env)))
}

// Expired reports whether cleanup should run.
func Expired(env *ephemeralv1alpha1.EphemeralEnvironment, now time.Time) bool {
	if env.Spec.Pause {
		return false
	}
	if env.Status.ExpiresAt == nil {
		return false
	}
	return !env.Status.ExpiresAt.After(now)
}

// RequeueAfter returns how long until expiry, or 0 if already expired/paused.
func RequeueAfter(env *ephemeralv1alpha1.EphemeralEnvironment, now time.Time) time.Duration {
	if env.Spec.Pause || env.Status.ExpiresAt == nil {
		return 0
	}
	d := env.Status.ExpiresAt.Sub(now)
	if d < 0 {
		return 0
	}
	return d
}
