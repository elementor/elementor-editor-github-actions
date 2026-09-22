// Package argocd builds unstructured Argo CD Application manifests.
// Using unstructured avoids a hard dependency on argoproj API versions.
package argocd

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var ApplicationGVK = schema.GroupVersionKind{
	Group:   "argoproj.io",
	Version: "v1alpha1",
	Kind:    "Application",
}

// Spec describes an Application the ephemeral controller should ensure.
type Spec struct {
	Name           string
	Namespace      string // Argo CD namespace (usually "argocd")
	Project        string
	DestinationNS  string
	RepoURL        string
	Path           string
	TargetRevision string
	Chart          string
	HelmParameters []HelmParameter
	ValuesYAML     string
	Labels         map[string]string
	OwnerRef       *metav1.OwnerReference
}

// HelmParameter is a single --set style override.
type HelmParameter struct {
	Name  string
	Value string
}

// NewApplication builds an unstructured Argo CD Application.
func NewApplication(s Spec) *unstructured.Unstructured {
	if s.Project == "" {
		s.Project = "ephemeral"
	}
	if s.Namespace == "" {
		s.Namespace = "argocd"
	}
	if s.TargetRevision == "" {
		s.TargetRevision = "master"
	}

	source := map[string]any{
		"repoURL":        s.RepoURL,
		"targetRevision": s.TargetRevision,
	}
	if s.Chart != "" {
		source["chart"] = s.Chart
	} else {
		source["path"] = s.Path
	}

	helm := map[string]any{}
	if len(s.HelmParameters) > 0 {
		params := make([]any, 0, len(s.HelmParameters))
		for _, p := range s.HelmParameters {
			params = append(params, map[string]any{
				"name":  p.Name,
				"value": p.Value,
			})
		}
		helm["parameters"] = params
	}
	if s.ValuesYAML != "" {
		helm["values"] = s.ValuesYAML
	}
	if len(helm) > 0 {
		source["helm"] = helm
	}

	labels := map[string]string{
		"app.kubernetes.io/managed-by": "ephemeral-operator",
		"ephemeral.elementor.io/owner": "true",
	}
	for k, v := range s.Labels {
		labels[k] = v
	}

	app := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "argoproj.io/v1alpha1",
			"kind":       "Application",
			"metadata": map[string]any{
				"name":      s.Name,
				"namespace": s.Namespace,
				"labels":    labels,
				"finalizers": []any{
					"resources-finalizer.argocd.argoproj.io",
				},
			},
			"spec": map[string]any{
				"project": s.Project,
				"source":  source,
				"destination": map[string]any{
					"server":    "https://kubernetes.default.svc",
					"namespace": s.DestinationNS,
				},
				"syncPolicy": map[string]any{
					"automated": map[string]any{
						"prune":    true,
						"selfHeal": true,
					},
					"syncOptions": []any{
						"CreateNamespace=false",
						"PruneLast=true",
					},
				},
			},
		},
	}
	app.SetGroupVersionKind(ApplicationGVK)

	if s.OwnerRef != nil {
		app.SetOwnerReferences([]metav1.OwnerReference{*s.OwnerRef})
	}
	return app
}

// SyncHealth extracts sync/health strings from an Application status.
func SyncHealth(app *unstructured.Unstructured) (sync, health string) {
	sync, _, _ = unstructured.NestedString(app.Object, "status", "sync", "status")
	health, _, _ = unstructured.NestedString(app.Object, "status", "health", "status")
	return sync, health
}

// Ready returns true when Argo reports Synced + Healthy.
func Ready(app *unstructured.Unstructured) bool {
	sync, health := SyncHealth(app)
	return sync == "Synced" && health == "Healthy"
}

// DescribeFailure returns a short human message when not ready.
func DescribeFailure(app *unstructured.Unstructured) string {
	sync, health := SyncHealth(app)
	if sync == "" && health == "" {
		return "waiting for Argo CD status"
	}
	return fmt.Sprintf("sync=%s health=%s", sync, health)
}
