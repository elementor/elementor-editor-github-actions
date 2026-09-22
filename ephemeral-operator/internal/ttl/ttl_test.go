package ttl_test

import (
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	ephemeralv1alpha1 "github.com/elementor/ephemeral-operator/api/v1alpha1"
	"github.com/elementor/ephemeral-operator/internal/ttl"
)

func TestDefaultDuration(t *testing.T) {
	env := &ephemeralv1alpha1.EphemeralEnvironment{}
	if ttl.Duration(env) != 24*time.Hour {
		t.Fatalf("expected 24h default")
	}
}

func TestExpiredRespectsPause(t *testing.T) {
	past := metav1.NewTime(time.Now().Add(-time.Hour))
	env := &ephemeralv1alpha1.EphemeralEnvironment{
		Spec:   ephemeralv1alpha1.EphemeralEnvironmentSpec{Pause: true},
		Status: ephemeralv1alpha1.EphemeralEnvironmentStatus{ExpiresAt: &past},
	}
	if ttl.Expired(env, time.Now()) {
		t.Fatal("paused environments must not expire")
	}
}

func TestExpiresAtFromCreationPlusTTL(t *testing.T) {
	created := time.Date(2026, 9, 22, 12, 0, 0, 0, time.UTC)
	env := &ephemeralv1alpha1.EphemeralEnvironment{
		ObjectMeta: metav1.ObjectMeta{CreationTimestamp: metav1.NewTime(created)},
		Spec: ephemeralv1alpha1.EphemeralEnvironmentSpec{
			TTL: &metav1.Duration{Duration: 2 * time.Hour},
		},
	}
	got := ttl.ExpiresAt(env, created)
	want := created.Add(2 * time.Hour)
	if !got.Time.Equal(want) {
		t.Fatalf("got %v want %v", got.Time, want)
	}
}

func TestPauseFreezesExpiry(t *testing.T) {
	fixed := metav1.NewTime(time.Now().Add(2 * time.Hour))
	env := &ephemeralv1alpha1.EphemeralEnvironment{
		Spec:   ephemeralv1alpha1.EphemeralEnvironmentSpec{Pause: true},
		Status: ephemeralv1alpha1.EphemeralEnvironmentStatus{ExpiresAt: &fixed},
	}
	got := ttl.ExpiresAt(env, time.Now())
	if !got.Equal(&fixed) {
		t.Fatalf("expected frozen expiry, got %v", got)
	}
}
