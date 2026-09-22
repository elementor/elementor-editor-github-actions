package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ServicePhase is a high-level lifecycle summary for one service.
type ServicePhase string

const (
	ServicePhasePending     ServicePhase = "Pending"
	ServicePhaseDeploying   ServicePhase = "Deploying"
	ServicePhaseReady       ServicePhase = "Ready"
	ServicePhaseFailed      ServicePhase = "Failed"
	ServicePhaseTerminating ServicePhase = "Terminating"
)

// ChartSource points at the Helm chart / gitops path used for the service.
// The controller creates an Argo CD Application with these fields and
// runtime image/value overrides — it never commits to the gitops repo.
type ChartSource struct {
	// RepoURL is the git repository that holds the chart or manifests.
	// +kubebuilder:validation:MinLength=1
	RepoURL string `json:"repoURL"`

	// Path inside the repository (e.g. "apps/billing-api").
	// +kubebuilder:validation:MinLength=1
	Path string `json:"path"`

	// TargetRevision is typically "master" for the chart definition.
	// Image tags are overridden separately; this is not the app branch.
	// +kubebuilder:default=master
	// +optional
	TargetRevision string `json:"targetRevision,omitempty"`

	// Chart is an optional Helm chart name when RepoURL is a Helm repo.
	// +optional
	Chart string `json:"chart,omitempty"`
}

// ImageSpec identifies the container image built from the feature branch.
type ImageSpec struct {
	// Repository is the image repository without tag.
	// +kubebuilder:validation:MinLength=1
	Repository string `json:"repository"`

	// Tag is usually the git SHA or branch build tag.
	// +kubebuilder:validation:MinLength=1
	Tag string `json:"tag"`

	// HelmImageKey is the values path for the image repository override.
	// Defaults to "global.image.repository" to match elementor-library.
	// +kubebuilder:default="global.image.repository"
	// +optional
	HelmRepositoryKey string `json:"helmRepositoryKey,omitempty"`

	// HelmTagKey is the values path for the image tag override.
	// Defaults to "global.image.tag" to match elementor-library.
	// +kubebuilder:default="global.image.tag"
	// +optional
	HelmTagKey string `json:"helmTagKey,omitempty"`
}

// EphemeralServiceSpec defines one service deployed into an environment.
type EphemeralServiceSpec struct {
	// EnvironmentRef is the name of the cluster-scoped EphemeralEnvironment.
	// +kubebuilder:validation:MinLength=1
	EnvironmentRef string `json:"environmentRef"`

	// ServiceName is used for Argo CD app naming and ingress host prefixes.
	// +kubebuilder:validation:MinLength=1
	// +kubebuilder:validation:Pattern=`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`
	ServiceName string `json:"serviceName"`

	// Image is the branch-built container image.
	Image ImageSpec `json:"image"`

	// Source locates the Helm chart without mutating gitops git history.
	Source ChartSource `json:"source"`

	// ValuesYAML is optional Helm values merged on top of the chart defaults.
	// Replaces the old practice of committing ephemeral-overrides.yaml to the branch.
	// +optional
	ValuesYAML string `json:"valuesYAML,omitempty"`

	// ArgoCDProject is the Argo CD project (defaults to "ephemeral").
	// +kubebuilder:default=ephemeral
	// +optional
	ArgoCDProject string `json:"argoCDProject,omitempty"`

	// ArgoCDNamespace is where Application CRs live (defaults to "argocd").
	// +kubebuilder:default=argocd
	// +optional
	ArgoCDNamespace string `json:"argoCDNamespace,omitempty"`

	// Core marks this service as a platform core companion (auto-deployed).
	// +optional
	Core bool `json:"core,omitempty"`
}

// EphemeralServiceStatus defines the observed state of one service.
type EphemeralServiceStatus struct {
	// Phase is a single-word summary.
	// +optional
	Phase ServicePhase `json:"phase,omitempty"`

	// URL is the public hostname for this service.
	// +optional
	URL string `json:"url,omitempty"`

	// ArgoCDApp is the Application name created for this service.
	// +optional
	ArgoCDApp string `json:"argoCDApp,omitempty"`

	// SyncStatus mirrors Argo CD sync status when available.
	// +optional
	SyncStatus string `json:"syncStatus,omitempty"`

	// HealthStatus mirrors Argo CD health when available.
	// +optional
	HealthStatus string `json:"healthStatus,omitempty"`

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
// +kubebuilder:resource:scope=Cluster,shortName=ephemsvc;esvc
// +kubebuilder:printcolumn:name="Environment",type=string,JSONPath=`.spec.environmentRef`
// +kubebuilder:printcolumn:name="Service",type=string,JSONPath=`.spec.serviceName`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="URL",type=string,JSONPath=`.status.url`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// EphemeralService deploys one microservice into an EphemeralEnvironment.
// Multiple services (possibly from different git repos) join the same
// environment by referencing the same environmentRef — no sequential
// GitHub Actions orchestration required.
type EphemeralService struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   EphemeralServiceSpec   `json:"spec,omitempty"`
	Status EphemeralServiceStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// EphemeralServiceList contains a list of EphemeralService.
type EphemeralServiceList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []EphemeralService `json:"items"`
}

func init() {
	SchemeBuilder.Register(&EphemeralService{}, &EphemeralServiceList{})
}
