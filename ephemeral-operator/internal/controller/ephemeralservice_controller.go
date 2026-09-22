package controller

import (
	"context"
	"fmt"
	"time"

	"github.com/go-logr/logr"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	ephemeralv1alpha1 "github.com/elementor/ephemeral-operator/api/v1alpha1"
	"github.com/elementor/ephemeral-operator/internal/argocd"
	"github.com/elementor/ephemeral-operator/internal/ingress"
	"github.com/elementor/ephemeral-operator/internal/naming"
)

const serviceFinalizer = "ephemeral.elementor.io/service"

// EphemeralServiceReconciler deploys one service into an environment via Argo CD
// Application + Traefik IngressRoute — without gitops commits.
type EphemeralServiceReconciler struct {
	client.Client
	Scheme *runtime.Scheme
	Log    logr.Logger
}

// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralservices,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralservices/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralservices/finalizers,verbs=update
// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralenvironments,verbs=get;list;watch
// +kubebuilder:rbac:groups=argoproj.io,resources=applications,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=traefik.io,resources=ingressroutes,verbs=get;list;watch;create;update;patch;delete

func (r *EphemeralServiceReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("ephemeralservice", req.Name)

	var svc ephemeralv1alpha1.EphemeralService
	if err := r.Get(ctx, req.NamespacedName, &svc); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	if !svc.DeletionTimestamp.IsZero() {
		return r.finalize(ctx, &svc, log)
	}

	if !controllerutil.ContainsFinalizer(&svc, serviceFinalizer) {
		controllerutil.AddFinalizer(&svc, serviceFinalizer)
		if err := r.Update(ctx, &svc); err != nil {
			return ctrl.Result{}, err
		}
		return ctrl.Result{Requeue: true}, nil
	}

	var env ephemeralv1alpha1.EphemeralEnvironment
	if err := r.Get(ctx, types.NamespacedName{Name: svc.Spec.EnvironmentRef}, &env); err != nil {
		if apierrors.IsNotFound(err) {
			return r.updateStatus(ctx, &svc, ephemeralv1alpha1.ServicePhaseFailed, "", "", "",
				"EnvironmentMissing", fmt.Sprintf("EphemeralEnvironment %q not found", svc.Spec.EnvironmentRef))
		}
		return ctrl.Result{}, err
	}
	if env.Status.Namespace == "" {
		return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
	}

	owner := metav1.NewControllerRef(&svc, ephemeralv1alpha1.GroupVersion.WithKind("EphemeralService"))
	appName := naming.ArgoApp(env.Name, svc.Spec.ServiceName)
	host := naming.ServiceHost(svc.Spec.ServiceName, env.Name, env.Spec.Ingress.Domain)

	repoKey := svc.Spec.Image.HelmRepositoryKey
	if repoKey == "" {
		repoKey = "global.image.repository"
	}
	tagKey := svc.Spec.Image.HelmTagKey
	if tagKey == "" {
		tagKey = "global.image.tag"
	}

	desired := argocd.NewApplication(argocd.Spec{
		Name:           appName,
		Namespace:      defaultString(svc.Spec.ArgoCDNamespace, "argocd"),
		Project:        defaultString(svc.Spec.ArgoCDProject, "ephemeral"),
		DestinationNS:  env.Status.Namespace,
		RepoURL:        svc.Spec.Source.RepoURL,
		Path:           svc.Spec.Source.Path,
		TargetRevision: defaultString(svc.Spec.Source.TargetRevision, "master"),
		Chart:          svc.Spec.Source.Chart,
		ValuesYAML:     svc.Spec.ValuesYAML,
		HelmParameters: []argocd.HelmParameter{
			{Name: repoKey, Value: svc.Spec.Image.Repository},
			{Name: tagKey, Value: svc.Spec.Image.Tag},
		},
		Labels: map[string]string{
			"ephemeral.elementor.io/environment": env.Name,
			"ephemeral.elementor.io/service":     svc.Spec.ServiceName,
		},
		OwnerRef: owner,
	})

	if err := r.ensureUnstructured(ctx, desired); err != nil {
		return r.updateStatus(ctx, &svc, ephemeralv1alpha1.ServicePhaseFailed, "", appName, "",
			"ArgoCDError", err.Error())
	}

	route := ingress.NewIngressRoute(ingress.Spec{
		Name:          svc.Spec.ServiceName,
		Namespace:     env.Status.Namespace,
		Host:          host,
		ServiceName:   svc.Spec.ServiceName,
		Entrypoints:   env.Spec.Ingress.EntrypointRefs,
		TLSSecretName: env.Spec.Ingress.TLSSecretName,
		Labels: map[string]string{
			"ephemeral.elementor.io/environment": env.Name,
			"ephemeral.elementor.io/service":     svc.Spec.ServiceName,
		},
		OwnerRef: owner,
	})
	if err := r.ensureUnstructured(ctx, route); err != nil {
		return r.updateStatus(ctx, &svc, ephemeralv1alpha1.ServicePhaseFailed, "", appName, "",
			"IngressError", err.Error())
	}

	currentApp := &unstructured.Unstructured{}
	currentApp.SetGroupVersionKind(argocd.ApplicationGVK)
	if err := r.Get(ctx, types.NamespacedName{
		Name:      appName,
		Namespace: defaultString(svc.Spec.ArgoCDNamespace, "argocd"),
	}, currentApp); err != nil {
		return ctrl.Result{}, err
	}

	sync, health := argocd.SyncHealth(currentApp)
	url := "https://" + host
	if argocd.Ready(currentApp) {
		res, err := r.updateStatus(ctx, &svc, ephemeralv1alpha1.ServicePhaseReady, url, appName, sync+"/"+health,
			"Ready", "Argo CD application is Synced and Healthy")
		if err != nil {
			return res, err
		}
		return ctrl.Result{RequeueAfter: 2 * time.Minute}, nil
	}

	phase := ephemeralv1alpha1.ServicePhaseDeploying
	reason := "Deploying"
	if sync == "Unknown" || health == "Degraded" || health == "Missing" {
		phase = ephemeralv1alpha1.ServicePhaseFailed
		reason = "Unhealthy"
	}
	res, err := r.updateStatus(ctx, &svc, phase, url, appName, sync+"/"+health, reason, argocd.DescribeFailure(currentApp))
	if err != nil {
		return res, err
	}
	return ctrl.Result{RequeueAfter: 15 * time.Second}, nil
}

func (r *EphemeralServiceReconciler) finalize(ctx context.Context, svc *ephemeralv1alpha1.EphemeralService, log logr.Logger) (ctrl.Result, error) {
	if !controllerutil.ContainsFinalizer(svc, serviceFinalizer) {
		return ctrl.Result{}, nil
	}

	appName := naming.ArgoApp(svc.Spec.EnvironmentRef, svc.Spec.ServiceName)
	appNS := defaultString(svc.Spec.ArgoCDNamespace, "argocd")

	app := &unstructured.Unstructured{}
	app.SetGroupVersionKind(argocd.ApplicationGVK)
	err := r.Get(ctx, types.NamespacedName{Name: appName, Namespace: appNS}, app)
	if err == nil {
		log.Info("deleting Argo CD application", "app", appName)
		if err := r.Delete(ctx, app); err != nil && !apierrors.IsNotFound(err) {
			return ctrl.Result{}, err
		}
		return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
	}
	if !apierrors.IsNotFound(err) {
		return ctrl.Result{}, err
	}

	// IngressRoute is namespaced; best-effort delete if environment namespace still exists.
	var env ephemeralv1alpha1.EphemeralEnvironment
	if err := r.Get(ctx, types.NamespacedName{Name: svc.Spec.EnvironmentRef}, &env); err == nil && env.Status.Namespace != "" {
		route := &unstructured.Unstructured{}
		route.SetGroupVersionKind(ingress.IngressRouteGVK)
		route.SetName(svc.Spec.ServiceName)
		route.SetNamespace(env.Status.Namespace)
		_ = r.Delete(ctx, route)
	}

	controllerutil.RemoveFinalizer(svc, serviceFinalizer)
	if err := r.Update(ctx, svc); err != nil {
		return ctrl.Result{}, err
	}
	return ctrl.Result{}, nil
}

func (r *EphemeralServiceReconciler) ensureUnstructured(ctx context.Context, desired *unstructured.Unstructured) error {
	current := &unstructured.Unstructured{}
	current.SetGroupVersionKind(desired.GroupVersionKind())
	key := types.NamespacedName{Name: desired.GetName(), Namespace: desired.GetNamespace()}
	err := r.Get(ctx, key, current)
	if apierrors.IsNotFound(err) {
		return r.Create(ctx, desired)
	}
	if err != nil {
		return err
	}

	// Preserve resource version and merge spec.
	desired.SetResourceVersion(current.GetResourceVersion())
	desired.SetUID(current.GetUID())
	return r.Update(ctx, desired)
}

func (r *EphemeralServiceReconciler) updateStatus(
	ctx context.Context,
	svc *ephemeralv1alpha1.EphemeralService,
	phase ephemeralv1alpha1.ServicePhase,
	url, app, syncHealth, reason, message string,
) (ctrl.Result, error) {
	svc.Status.Phase = phase
	svc.Status.URL = url
	svc.Status.ArgoCDApp = app
	if syncHealth != "" && syncHealth != "/" {
		parts := split2(syncHealth)
		svc.Status.SyncStatus = parts[0]
		svc.Status.HealthStatus = parts[1]
	}
	svc.Status.ObservedGeneration = svc.Generation
	setCondition(&svc.Status.Conditions, "Ready", phase == ephemeralv1alpha1.ServicePhaseReady, reason, message)
	if err := r.Status().Update(ctx, svc); err != nil {
		return ctrl.Result{}, err
	}
	return ctrl.Result{}, nil
}

func split2(s string) [2]string {
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			return [2]string{s[:i], s[i+1:]}
		}
	}
	return [2]string{s, ""}
}

func defaultString(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

// SetupWithManager registers the controller.
func (r *EphemeralServiceReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&ephemeralv1alpha1.EphemeralService{}).
		Complete(r)
}
