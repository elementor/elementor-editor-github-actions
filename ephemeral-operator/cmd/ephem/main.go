// Package main implements the `ephem` CLI for creating and inspecting
// ephemeral environments without multi-step GitHub Actions orchestration.
package main

import (
	"context"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"

	ephemeralv1alpha1 "github.com/elementor/ephemeral-operator/api/v1alpha1"
)

var scheme = runtime.NewScheme()

func init() {
	utilruntime.Must(ephemeralv1alpha1.AddToScheme(scheme))
}

func main() {
	root := &cobra.Command{
		Use:   "ephem",
		Short: "Kubernetes-native ephemeral environments for Elementor",
		Long: `ephem creates and manages EphemeralEnvironment / EphemeralService CRs.

Compared to the legacy GitHub Actions flow, this CLI (or a thin CI step)
only applies desired state. The in-cluster operator handles namespaces,
Argo CD Applications, IngressRoutes, TTL, and multi-service joins.`,
	}

	root.AddCommand(newCreateCmd(), newJoinCmd(), newStatusCmd(), newListCmd(), newDeleteCmd())

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func kubeClient() (client.Client, error) {
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	configOverrides := &clientcmd.ConfigOverrides{}
	kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides)
	cfg, err := kubeConfig.ClientConfig()
	if err != nil {
		return nil, err
	}
	return client.New(cfg, client.Options{Scheme: scheme})
}

func newCreateCmd() *cobra.Command {
	var (
		name       string
		domain     string
		owner      string
		dbMode     string
		ttl        string
		service    string
		imageRepo  string
		imageTag   string
		chartRepo  string
		chartPath  string
		valuesFile string
	)

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create an environment and optionally deploy the first service",
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, err := kubeClient()
			if err != nil {
				return err
			}
			ctx := context.Background()

			dur, err := time.ParseDuration(ttl)
			if err != nil {
				return fmt.Errorf("invalid --ttl: %w", err)
			}
			includeCore := true
			env := &ephemeralv1alpha1.EphemeralEnvironment{
				ObjectMeta: metav1.ObjectMeta{Name: name},
				Spec: ephemeralv1alpha1.EphemeralEnvironmentSpec{
					TTL:             &metav1.Duration{Duration: dur},
					Database:        ephemeralv1alpha1.DatabaseSpec{Mode: ephemeralv1alpha1.DatabaseMode(dbMode)},
					Ingress:         ephemeralv1alpha1.IngressSpec{Domain: domain},
					IncludeCoreApps: &includeCore,
					Owner:           owner,
				},
			}
			if err := c.Create(ctx, env); err != nil {
				return err
			}
			fmt.Printf("created EphemeralEnvironment/%s\n", name)

			if service == "" {
				return nil
			}
			if imageRepo == "" || imageTag == "" || chartRepo == "" || chartPath == "" {
				return fmt.Errorf("when --service is set, require --image-repo --image-tag --chart-repo --chart-path")
			}
			valuesYAML := ""
			if valuesFile != "" {
				b, err := os.ReadFile(valuesFile)
				if err != nil {
					return err
				}
				valuesYAML = string(b)
			}
			svc := &ephemeralv1alpha1.EphemeralService{
				ObjectMeta: metav1.ObjectMeta{Name: name + "-" + service},
				Spec: ephemeralv1alpha1.EphemeralServiceSpec{
					EnvironmentRef: name,
					ServiceName:    service,
					Image: ephemeralv1alpha1.ImageSpec{
						Repository: imageRepo,
						Tag:        imageTag,
					},
					Source: ephemeralv1alpha1.ChartSource{
						RepoURL: chartRepo,
						Path:    chartPath,
					},
					ValuesYAML: valuesYAML,
				},
			}
			if err := c.Create(ctx, svc); err != nil {
				return err
			}
			fmt.Printf("created EphemeralService/%s\n", svc.Name)
			return nil
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "Environment name (becomes ephem-<name>)")
	cmd.Flags().StringVar(&domain, "domain", "", "Ingress base domain")
	cmd.Flags().StringVar(&owner, "owner", "", "Owner email or GitHub handle")
	cmd.Flags().StringVar(&dbMode, "database", "shared", "Database mode: shared|fresh")
	cmd.Flags().StringVar(&ttl, "ttl", "24h", "Time to live")
	cmd.Flags().StringVar(&service, "service", "", "Optional first service name")
	cmd.Flags().StringVar(&imageRepo, "image-repo", "", "Container image repository")
	cmd.Flags().StringVar(&imageTag, "image-tag", "", "Container image tag")
	cmd.Flags().StringVar(&chartRepo, "chart-repo", "", "Git repo URL for the Helm chart")
	cmd.Flags().StringVar(&chartPath, "chart-path", "", "Path to the chart inside the repo")
	cmd.Flags().StringVar(&valuesFile, "values", "", "Optional values YAML file")
	_ = cmd.MarkFlagRequired("name")
	_ = cmd.MarkFlagRequired("domain")
	return cmd
}

func newJoinCmd() *cobra.Command {
	var (
		envName    string
		service    string
		imageRepo  string
		imageTag   string
		chartRepo  string
		chartPath  string
		valuesFile string
	)
	cmd := &cobra.Command{
		Use:   "join",
		Short: "Add another service into an existing environment",
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, err := kubeClient()
			if err != nil {
				return err
			}
			valuesYAML := ""
			if valuesFile != "" {
				b, err := os.ReadFile(valuesFile)
				if err != nil {
					return err
				}
				valuesYAML = string(b)
			}
			svc := &ephemeralv1alpha1.EphemeralService{
				ObjectMeta: metav1.ObjectMeta{Name: envName + "-" + service},
				Spec: ephemeralv1alpha1.EphemeralServiceSpec{
					EnvironmentRef: envName,
					ServiceName:    service,
					Image: ephemeralv1alpha1.ImageSpec{
						Repository: imageRepo,
						Tag:        imageTag,
					},
					Source: ephemeralv1alpha1.ChartSource{
						RepoURL: chartRepo,
						Path:    chartPath,
					},
					ValuesYAML: valuesYAML,
				},
			}
			if err := c.Create(context.Background(), svc); err != nil {
				return err
			}
			fmt.Printf("joined EphemeralService/%s -> %s\n", svc.Name, envName)
			return nil
		},
	}
	cmd.Flags().StringVar(&envName, "environment", "", "Existing EphemeralEnvironment name")
	cmd.Flags().StringVar(&service, "service", "", "Service name")
	cmd.Flags().StringVar(&imageRepo, "image-repo", "", "Container image repository")
	cmd.Flags().StringVar(&imageTag, "image-tag", "", "Container image tag")
	cmd.Flags().StringVar(&chartRepo, "chart-repo", "", "Git repo URL for the Helm chart")
	cmd.Flags().StringVar(&chartPath, "chart-path", "", "Path to the chart inside the repo")
	cmd.Flags().StringVar(&valuesFile, "values", "", "Optional values YAML file")
	_ = cmd.MarkFlagRequired("environment")
	_ = cmd.MarkFlagRequired("service")
	_ = cmd.MarkFlagRequired("image-repo")
	_ = cmd.MarkFlagRequired("image-tag")
	_ = cmd.MarkFlagRequired("chart-repo")
	_ = cmd.MarkFlagRequired("chart-path")
	return cmd
}

func newStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status <name>",
		Short: "Show environment status, services, and URLs",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := kubeClient()
			if err != nil {
				return err
			}
			var env ephemeralv1alpha1.EphemeralEnvironment
			if err := c.Get(context.Background(), types.NamespacedName{Name: args[0]}, &env); err != nil {
				return err
			}
			fmt.Printf("Environment: %s\n", env.Name)
			fmt.Printf("Namespace:   %s\n", env.Status.Namespace)
			fmt.Printf("Phase:       %s\n", env.Status.Phase)
			fmt.Printf("Root URL:    %s\n", env.Status.RootURL)
			if env.Status.ExpiresAt != nil {
				fmt.Printf("Expires:     %s\n", env.Status.ExpiresAt.Format(time.RFC3339))
			}
			fmt.Printf("Database:    %s\n", env.Spec.Database.Mode)
			fmt.Println("Services:")
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "NAME\tPHASE\tURL")
			for _, s := range env.Status.Services {
				fmt.Fprintf(tw, "%s\t%s\t%s\n", s.Name, s.Phase, s.URL)
			}
			return tw.Flush()
		},
	}
}

func newListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all ephemeral environments",
		RunE: func(cmd *cobra.Command, _ []string) error {
			c, err := kubeClient()
			if err != nil {
				return err
			}
			var list ephemeralv1alpha1.EphemeralEnvironmentList
			if err := c.List(context.Background(), &list); err != nil {
				return err
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "NAME\tNAMESPACE\tPHASE\tEXPIRES\tOWNER")
			for _, env := range list.Items {
				exp := ""
				if env.Status.ExpiresAt != nil {
					exp = env.Status.ExpiresAt.Format(time.RFC3339)
				}
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
					env.Name, env.Status.Namespace, env.Status.Phase, exp, env.Spec.Owner)
			}
			return tw.Flush()
		},
	}
}

func newDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <name>",
		Short: "Delete an ephemeral environment and all joined services",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := kubeClient()
			if err != nil {
				return err
			}
			env := &ephemeralv1alpha1.EphemeralEnvironment{
				ObjectMeta: metav1.ObjectMeta{Name: args[0]},
			}
			if err := c.Delete(context.Background(), env); err != nil {
				return err
			}
			fmt.Printf("deletion requested for EphemeralEnvironment/%s\n", args[0])
			return nil
		},
	}
}
