// Package naming centralises ephemeral resource name conventions.
package naming

import (
	"fmt"
	"regexp"
	"strings"
)

var nonDNS = regexp.MustCompile(`[^a-z0-9-]+`)

// Namespace returns the Kubernetes namespace for an environment.
func Namespace(envName string) string {
	return fmt.Sprintf("ephem-%s", DNSLabel(envName))
}

// ArgoApp returns the Argo CD Application name for a service in an env.
func ArgoApp(envName, serviceName string) string {
	return DNSLabel(fmt.Sprintf("ephem-%s-%s", envName, serviceName))
}

// ServiceHost builds <service>-<env>.<domain>.
func ServiceHost(serviceName, envName, domain string) string {
	return fmt.Sprintf("%s-%s.%s", DNSLabel(serviceName), DNSLabel(envName), domain)
}

// RootHost builds <env>.<domain>.
func RootHost(envName, domain string) string {
	return fmt.Sprintf("%s.%s", DNSLabel(envName), domain)
}

// DNSLabel lowercases, replaces invalid chars, and trims to 63 chars.
func DNSLabel(in string) string {
	s := strings.ToLower(strings.TrimSpace(in))
	s = strings.ReplaceAll(s, "_", "-")
	s = strings.ReplaceAll(s, "/", "-")
	s = nonDNS.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	if len(s) > 63 {
		s = strings.Trim(s[:63], "-")
	}
	if s == "" {
		return "unnamed"
	}
	return s
}
