package naming_test

import (
	"testing"

	"github.com/elementor/ephemeral-operator/internal/naming"
)

func TestNamespace(t *testing.T) {
	got := naming.Namespace("Feat_Billing/API")
	want := "ephem-feat-billing-api"
	if got != want {
		t.Fatalf("Namespace() = %q, want %q", got, want)
	}
}

func TestServiceHost(t *testing.T) {
	got := naming.ServiceHost("billing-api", "feat-x", "stg.example.com")
	want := "billing-api-feat-x.stg.example.com"
	if got != want {
		t.Fatalf("ServiceHost() = %q, want %q", got, want)
	}
}

func TestDNSLabelTruncation(t *testing.T) {
	long := stringsRepeat("a", 80)
	got := naming.DNSLabel(long)
	if len(got) > 63 {
		t.Fatalf("DNSLabel length %d > 63", len(got))
	}
}

func stringsRepeat(s string, n int) string {
	out := make([]byte, 0, n*len(s))
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}
