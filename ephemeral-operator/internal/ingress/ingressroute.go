// Package ingress builds Traefik IngressRoute unstructured objects.
package ingress

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var IngressRouteGVK = schema.GroupVersionKind{
	Group:   "traefik.io",
	Version: "v1alpha1",
	Kind:    "IngressRoute",
}

// Spec describes a Traefik IngressRoute for an ephemeral service.
type Spec struct {
	Name          string
	Namespace     string
	Host          string
	ServiceName   string
	ServicePort   int64
	Entrypoints   []string
	TLSSecretName string
	Labels        map[string]string
	OwnerRef      *metav1.OwnerReference
}

// NewIngressRoute builds an unstructured Traefik IngressRoute.
func NewIngressRoute(s Spec) *unstructured.Unstructured {
	if s.ServicePort == 0 {
		s.ServicePort = 80
	}
	if len(s.Entrypoints) == 0 {
		s.Entrypoints = []string{"websecure"}
	}

	entryPoints := make([]any, 0, len(s.Entrypoints))
	for _, e := range s.Entrypoints {
		entryPoints = append(entryPoints, e)
	}

	route := map[string]any{
		"match": "Host(`" + s.Host + "`)",
		"kind":  "Rule",
		"services": []any{
			map[string]any{
				"name": s.ServiceName,
				"port": s.ServicePort,
			},
		},
	}

	spec := map[string]any{
		"entryPoints": entryPoints,
		"routes":      []any{route},
	}
	if s.TLSSecretName != "" {
		spec["tls"] = map[string]any{
			"secretName": s.TLSSecretName,
		}
	} else {
		// Let the cluster default certificate resolver handle TLS when unset.
		spec["tls"] = map[string]any{}
	}

	labels := map[string]string{
		"app.kubernetes.io/managed-by": "ephemeral-operator",
	}
	for k, v := range s.Labels {
		labels[k] = v
	}

	obj := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "traefik.io/v1alpha1",
			"kind":       "IngressRoute",
			"metadata": map[string]any{
				"name":      s.Name,
				"namespace": s.Namespace,
				"labels":    labels,
			},
			"spec": spec,
		},
	}
	obj.SetGroupVersionKind(IngressRouteGVK)
	if s.OwnerRef != nil {
		obj.SetOwnerReferences([]metav1.OwnerReference{*s.OwnerRef})
	}
	return obj
}
