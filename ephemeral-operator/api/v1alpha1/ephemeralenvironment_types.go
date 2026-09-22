package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// DatabaseMode controls whether the environment reuses shared staging data or
// provisions an isolated copy.
// +kubebuilder:validation:Enum=shared;fresh
type DatabaseMode string

const (
	DatabaseModeShared DatabaseMode = "shared"
	DatabaseModeFresh  DatabaseMode = "fresh"
)

// EnvironmentPhase is a high-level lifecycle summary.
type EnvironmentPhase string

const (
	EnvironmentPhasePending     EnvironmentPhase = "Pending"
	EnvironmentPhaseReady       EnvironmentPhase = "Ready"
	EnvironmentPhaseDegraded    EnvironmentPhase = "Degraded"
	EnvironmentPhaseExpiring    EnvironmentPhase = "Expiring"
	EnvironmentPhaseFailed      EnvironmentPhase = "Failed"
	EnvironmentPhaseTerminating EnvironmentPhase = "Terminating"
)

// DatabaseSpec configures database behaviour for the environment.
type DatabaseSpec struct {
	// Mode selects shared staging databases or a fresh isolated set.
	// +kubebuilder:default=shared
	Mode DatabaseMode `json:"mode,omitempty"`
}

// IngressSpec configures how services in this environment are exposed.
type IngressSpec struct {
	// Domain is the base DNS suffix, e.g. "stg.elementor.cloud".
	// Hosts become <service>-<env>.<domain> and <env>.<domain>.
	// +kubebuilder:validation:MinLength=1
	Domain string `json:"domain"`

	// EntrypointRefs lists Traefik entrypoints (defaults to websecure).
	// +optional
	EntrypointRefs []string `json:"entrypointRefs,omitempty"`

	// TLSSecretName optionally pins a cluster TLS secret for IngressRoutes.
	// +optional
	TLSSecretName string `json:"tlsSecretName,omitempty"`
}

// ResourceBudget optionally caps CPU/memory for the ephemeral namespace.
type ResourceBudget struct {
	// +optional
	CPU string `json:"cpu,omitempty"`
	// +optional
	Memory string `json:"memory,omitempty"`
	// +optional
	Pods string `json:"pods,omitempty"`
}

// EphemeralEnvironmentSpec defines the desired state of an ephemeral environment.
type EphemeralEnvironmentSpec struct {
	// TTL is how long the environment lives before automatic cleanup.
	// Defaults to 24h to match the current platform behaviour.
	// +kubebuilder:default="24h"
	// +optional
	TTL *metav1.Duration `json:"ttl,omitempty"`

	// Database configures shared vs fresh database mode.
	// +optional
	Database DatabaseSpec `json:"database,omitempty"`

	// Ingress configures hostnames for services in this environment.
	Ingress IngressSpec `json:"ingress"`

	// IncludeCoreApps deploys the platform "core" companion apps into the
	// namespace (auth, gateway stubs, etc.), matching today's appset behaviour.
	// +kubebuilder:default=true
	// +optional
	IncludeCoreApps *bool `json:"includeCoreApps,omitempty"`

	// Owner is an email or GitHub handle used for attribution and notifications.
	// +optional
	Owner string `json:"owner,omitempty"`

	// Resources optionally limits what the namespace may consume.
	// +optional
	Resources *ResourceBudget `json:"resources,omitempty"`

	// Pause stops TTL countdown without deleting the environment.
	// +optional
	Pause bool `json:"pause,omitempty"`
}

// ServiceStatusSummary is a compact view of a service belonging to the env.
type ServiceStatusSummary struct {
	Name    string `json:"name"`
	Phase   string `json:"phase,omitempty"`
	URL     string `json:"url,omitempty"`
	Message string `json:"message,omitempty"`
}

// EphemeralEnvironmentStatus defines the observed state.
type EphemeralEnvironmentStatus struct {
	// Phase is a single-word summary of environment health.
	// +optional
	Phase EnvironmentPhase `json:"phase,omitempty"`

	// Namespace is the concrete Kubernetes namespace (ephem-<name>).
	// +optional
	Namespace string `json:"namespace,omitempty"`

	// RootURL is the environment root hostname.
	// +optional
	RootURL string `json:"rootURL,omitempty"`

	// ExpiresAt is when the controller will delete the environment.
	// +optional
	ExpiresAt *metav1.Time `json:"expiresAt,omitempty"`

	// Services lists child EphemeralService summaries.
	// +optional
	Services []ServiceStatusSummary `json:"services,omitempty"`

	// ObservedGeneration is the last reconciled generation.
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`

	// Conditions follow standard Kubernetes condition semantics.
	// +optional
	// +listType=map
	// +listMapKey=type
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Cluster,shortName=ephemenv;ee
// +kubebuilder:printcolumn:name="Namespace",type=string,JSONPath=`.status.namespace`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Expires",type=date,JSONPath=`.status.expiresAt`
// +kubebuilder:printcolumn:name="Owner",type=string,JSONPath=`.spec.owner`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// EphemeralEnvironment is the Schema for the ephemeralenvironments API.
// It owns a temporary Kubernetes namespace that hosts one or more services
// for branch preview against staging infrastructure.
type EphemeralEnvironment struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   EphemeralEnvironmentSpec   `json:"spec,omitempty"`
	Status EphemeralEnvironmentStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// EphemeralEnvironmentList contains a list of EphemeralEnvironment.
type EphemeralEnvironmentList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []EphemeralEnvironment `json:"items"`
}

func init() {
	SchemeBuilder.Register(&EphemeralEnvironment{}, &EphemeralEnvironmentList{})
}
