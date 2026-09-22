package controller

import (
	"context"
	"fmt"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	ephemeralv1alpha1 "github.com/elementor/ephemeral-operator/api/v1alpha1"
	"github.com/elementor/ephemeral-operator/internal/naming"
	"github.com/elementor/ephemeral-operator/internal/ttl"
)

const environmentFinalizer = "ephemeral.elementor.io/environment"

// EphemeralEnvironmentReconciler owns namespace lifecycle and TTL.
type EphemeralEnvironmentReconciler struct {
	client.Client
	Scheme *runtime.Scheme
	Log    logr.Logger
}

// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralenvironments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralenvironments/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralenvironments/finalizers,verbs=update
// +kubebuilder:rbac:groups=ephemeral.elementor.io,resources=ephemeralservices,verbs=get;list;watch;delete
// +kubebuilder:rbac:groups="",resources=namespaces,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=resourcequotas,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=limitranges,verbs=get;list;watch;create;update;patch;delete

func (r *EphemeralEnvironmentReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("ephemeralenvironment", req.Name)

	var env ephemeralv1alpha1.EphemeralEnvironment
	if err := r.Get(ctx, req.NamespacedName, &env); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	if !env.DeletionTimestamp.IsZero() {
		return r.finalize(ctx, &env, log)
	}

	if !controllerutil.ContainsFinalizer(&env, environmentFinalizer) {
		controllerutil.AddFinalizer(&env, environmentFinalizer)
		if err := r.Update(ctx, &env); err != nil {
			return ctrl.Result{}, err
		}
		return ctrl.Result{Requeue: true}, nil
	}

	nsName := naming.Namespace(env.Name)
	if err := r.ensureNamespace(ctx, &env, nsName); err != nil {
		return ctrl.Result{}, err
	}
	if err := r.ensureQuota(ctx, &env, nsName); err != nil {
		return ctrl.Result{}, err
	}

	now := time.Now()
	expires := ttl.ExpiresAt(&env, now)
	if ttl.Expired(&env, now) {
		log.Info("TTL expired, deleting environment")
		env.Status.Phase = ephemeralv1alpha1.EnvironmentPhaseExpiring
		_ = r.Status().Update(ctx, &env)
		if err := r.Delete(ctx, &env); err != nil {
			return ctrl.Result{}, err
		}
		return ctrl.Result{}, nil
	}

	services, err := r.listServices(ctx, env.Name)
	if err != nil {
		return ctrl.Result{}, err
	}

	phase, summaries := summarizeServices(services)
	rootURL := ""
	if env.Spec.Ingress.Domain != "" {
		rootURL = "https://" + naming.RootHost(env.Name, env.Spec.Ingress.Domain)
	}

	env.Status.Phase = phase
	env.Status.Namespace = nsName
	env.Status.RootURL = rootURL
	env.Status.ExpiresAt = &expires
	env.Status.Services = summaries
	env.Status.ObservedGeneration = env.Generation
	setCondition(&env.Status.Conditions, "Ready", phase == ephemeralv1alpha1.EnvironmentPhaseReady,
		string(phase), fmt.Sprintf("environment namespace %s", nsName))

	if err := r.Status().Update(ctx, &env); err != nil {
		return ctrl.Result{}, err
	}

	if requeue := ttl.RequeueAfter(&env, now); requeue > 0 {
		// Cap requeue so we still refresh service summaries periodically.
		if requeue > time.Minute {
			requeue = time.Minute
		}
		return ctrl.Result{RequeueAfter: requeue}, nil
	}
	return ctrl.Result{RequeueAfter: time.Minute}, nil
}

func (r *EphemeralEnvironmentReconciler) finalize(ctx context.Context, env *ephemeralv1alpha1.EphemeralEnvironment, log logr.Logger) (ctrl.Result, error) {
	if !controllerutil.ContainsFinalizer(env, environmentFinalizer) {
		return ctrl.Result{}, nil
	}

	env.Status.Phase = ephemeralv1alpha1.EnvironmentPhaseTerminating
	_ = r.Status().Update(ctx, env)

	// Delete child services first so their Argo apps and routes tear down.
	services, err := r.listServices(ctx, env.Name)
	if err != nil {
		return ctrl.Result{}, err
	}
	for i := range services {
		svc := &services[i]
		if svc.DeletionTimestamp.IsZero() {
			log.Info("deleting child service", "service", svc.Name)
			if err := r.Delete(ctx, svc); err != nil && !apierrors.IsNotFound(err) {
				return ctrl.Result{}, err
			}
		}
	}
	if len(services) > 0 {
		return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
	}

	nsName := naming.Namespace(env.Name)
	var ns corev1.Namespace
	err = r.Get(ctx, types.NamespacedName{Name: nsName}, &ns)
	if err == nil && ns.DeletionTimestamp.IsZero() {
		log.Info("deleting namespace", "namespace", nsName)
		if err := r.Delete(ctx, &ns); err != nil && !apierrors.IsNotFound(err) {
			return ctrl.Result{}, err
		}
		return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
	}
	if err != nil && !apierrors.IsNotFound(err) {
		return ctrl.Result{}, err
	}

	controllerutil.RemoveFinalizer(env, environmentFinalizer)
	if err := r.Update(ctx, env); err != nil {
		return ctrl.Result{}, err
	}
	return ctrl.Result{}, nil
}

func (r *EphemeralEnvironmentReconciler) ensureNamespace(ctx context.Context, env *ephemeralv1alpha1.EphemeralEnvironment, nsName string) error {
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: nsName}}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, ns, func() error {
		if ns.Labels == nil {
			ns.Labels = map[string]string{}
		}
		ns.Labels["ephemeral.elementor.io/environment"] = env.Name
		ns.Labels["app.kubernetes.io/managed-by"] = "ephemeral-operator"
		if env.Spec.Owner != "" {
			ns.Labels["ephemeral.elementor.io/owner"] = naming.DNSLabel(env.Spec.Owner)
		}
		if env.Spec.Database.Mode != "" {
			ns.Labels["ephemeral.elementor.io/database"] = string(env.Spec.Database.Mode)
		}
		return nil
	})
	return err
}

func (r *EphemeralEnvironmentReconciler) ensureQuota(ctx context.Context, env *ephemeralv1alpha1.EphemeralEnvironment, nsName string) error {
	if env.Spec.Resources == nil {
		return nil
	}
	rq := &corev1.ResourceQuota{ObjectMeta: metav1.ObjectMeta{Name: "ephemeral-budget", Namespace: nsName}}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, rq, func() error {
		hard := corev1.ResourceList{}
		if env.Spec.Resources.CPU != "" {
			hard[corev1.ResourceRequestsCPU] = resource.MustParse(env.Spec.Resources.CPU)
			hard[corev1.ResourceLimitsCPU] = resource.MustParse(env.Spec.Resources.CPU)
		}
		if env.Spec.Resources.Memory != "" {
			hard[corev1.ResourceRequestsMemory] = resource.MustParse(env.Spec.Resources.Memory)
			hard[corev1.ResourceLimitsMemory] = resource.MustParse(env.Spec.Resources.Memory)
		}
		if env.Spec.Resources.Pods != "" {
			hard[corev1.ResourcePods] = resource.MustParse(env.Spec.Resources.Pods)
		}
		rq.Spec.Hard = hard
		return nil
	})
	return err
}

func (r *EphemeralEnvironmentReconciler) listServices(ctx context.Context, envName string) ([]ephemeralv1alpha1.EphemeralService, error) {
	var list ephemeralv1alpha1.EphemeralServiceList
	if err := r.List(ctx, &list); err != nil {
		return nil, err
	}
	out := make([]ephemeralv1alpha1.EphemeralService, 0)
	for i := range list.Items {
		if list.Items[i].Spec.EnvironmentRef == envName {
			out = append(out, list.Items[i])
		}
	}
	return out, nil
}

func summarizeServices(services []ephemeralv1alpha1.EphemeralService) (ephemeralv1alpha1.EnvironmentPhase, []ephemeralv1alpha1.ServiceStatusSummary) {
	summaries := make([]ephemeralv1alpha1.ServiceStatusSummary, 0, len(services))
	if len(services) == 0 {
		return ephemeralv1alpha1.EnvironmentPhasePending, summaries
	}

	ready := 0
	failed := 0
	for _, s := range services {
		summaries = append(summaries, ephemeralv1alpha1.ServiceStatusSummary{
			Name:    s.Spec.ServiceName,
			Phase:   string(s.Status.Phase),
			URL:     s.Status.URL,
			Message: conditionMessage(s.Status.Conditions),
		})
		switch s.Status.Phase {
		case ephemeralv1alpha1.ServicePhaseReady:
			ready++
		case ephemeralv1alpha1.ServicePhaseFailed:
			failed++
		}
	}
	switch {
	case failed > 0 && ready > 0:
		return ephemeralv1alpha1.EnvironmentPhaseDegraded, summaries
	case failed > 0:
		return ephemeralv1alpha1.EnvironmentPhaseFailed, summaries
	case ready == len(services):
		return ephemeralv1alpha1.EnvironmentPhaseReady, summaries
	default:
		return ephemeralv1alpha1.EnvironmentPhasePending, summaries
	}
}

func conditionMessage(conds []metav1.Condition) string {
	for _, c := range conds {
		if c.Type == "Ready" {
			return c.Message
		}
	}
	return ""
}

func setCondition(conds *[]metav1.Condition, ctype string, ready bool, reason, message string) {
	status := metav1.ConditionFalse
	if ready {
		status = metav1.ConditionTrue
	}
	*conds = upsertCondition(*conds, metav1.Condition{
		Type:               ctype,
		Status:             status,
		Reason:             reason,
		Message:            message,
		LastTransitionTime: metav1.Now(),
	})
}

func upsertCondition(conds []metav1.Condition, next metav1.Condition) []metav1.Condition {
	for i := range conds {
		if conds[i].Type == next.Type {
			if conds[i].Status == next.Status && conds[i].Reason == next.Reason && conds[i].Message == next.Message {
				return conds
			}
			if conds[i].Status == next.Status {
				next.LastTransitionTime = conds[i].LastTransitionTime
			}
			conds[i] = next
			return conds
		}
	}
	return append(conds, next)
}

// SetupWithManager registers the controller.
func (r *EphemeralEnvironmentReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&ephemeralv1alpha1.EphemeralEnvironment{}).
		Watches(
			&ephemeralv1alpha1.EphemeralService{},
			handler.EnqueueRequestsFromMapFunc(func(_ context.Context, obj client.Object) []reconcile.Request {
				svc, ok := obj.(*ephemeralv1alpha1.EphemeralService)
				if !ok || svc.Spec.EnvironmentRef == "" {
					return nil
				}
				return []reconcile.Request{{NamespacedName: types.NamespacedName{Name: svc.Spec.EnvironmentRef}}}
			}),
		).
		Complete(r)
}
