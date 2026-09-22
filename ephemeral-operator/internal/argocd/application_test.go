package argocd_test

import (
	"testing"

	"github.com/elementor/ephemeral-operator/internal/argocd"
)

func TestNewApplicationHelmOverrides(t *testing.T) {
	app := argocd.NewApplication(argocd.Spec{
		Name:          "ephem-feat-billing",
		DestinationNS: "ephem-feat",
		RepoURL:       "https://github.com/elementor/example-gitops.git",
		Path:          "apps/billing",
		HelmParameters: []argocd.HelmParameter{
			{Name: "global.image.repository", Value: "gcr.io/x/billing"},
			{Name: "global.image.tag", Value: "abc123"},
		},
		ValuesYAML: "global:\n  env: ephemeral\n",
	})

	if app.GetName() != "ephem-feat-billing" {
		t.Fatalf("unexpected name %s", app.GetName())
	}
	src, ok, err := unstructuredNestedMap(app.Object, "spec", "source")
	if err != nil || !ok {
		t.Fatalf("missing source: %v", err)
	}
	helm, ok := src["helm"].(map[string]any)
	if !ok {
		t.Fatal("expected helm block")
	}
	if helm["values"] != "global:\n  env: ephemeral\n" {
		t.Fatalf("unexpected values: %#v", helm["values"])
	}
	params, ok := helm["parameters"].([]any)
	if !ok || len(params) != 2 {
		t.Fatalf("expected 2 parameters, got %#v", helm["parameters"])
	}
}

func unstructuredNestedMap(obj map[string]any, fields ...string) (map[string]any, bool, error) {
	cur := any(obj)
	for _, f := range fields {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false, nil
		}
		cur, ok = m[f]
		if !ok {
			return nil, false, nil
		}
	}
	out, ok := cur.(map[string]any)
	return out, ok, nil
}
