#!/usr/bin/env bash
# Check if beta is active by comparing release/beta version against latest stable release.
# Beta is active if release/beta X.Y > latest published stable X.Y.
# Prints JSON: {"isActive": true|false, "reason": "..."}
# All diagnostics go to stderr.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-}"

log_stderr() {
	echo "$@" >&2
}

# Extract X.Y from a version string (e.g., "4.3.0" -> "4.3", "4.4.0-beta1" -> "4.4")
extract_major_minor() {
	local version="$1"
	# Remove leading v if present
	version="${version#v}"
	# Extract X.Y from X.Y.Z or X.Y.Z-suffix
	if [[ "$version" =~ ^([0-9]+)\.([0-9]+) ]]; then
		echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
	else
		return 1
	fi
}

# Compare two X.Y versions: returns 0 if $1 > $2, 1 if $1 <= $2
version_gt() {
	local v1="$1"
	local v2="$2"
	
	local v1_major v1_minor v2_major v2_minor
	
	IFS='.' read -r v1_major v1_minor <<< "$v1"
	IFS='.' read -r v2_major v2_minor <<< "$v2"
	
	if [ "$v1_major" -gt "$v2_major" ]; then
		return 0
	elif [ "$v1_major" -eq "$v2_major" ] && [ "$v1_minor" -gt "$v2_minor" ]; then
		return 0
	else
		return 1
	fi
}

# Detect plugin file (elementor.php or elementor-pro.php)
detect_plugin_file() {
	if git show origin/release/beta:elementor.php >/dev/null 2>&1; then
		echo "elementor.php"
	elif git show origin/release/beta:elementor-pro.php >/dev/null 2>&1; then
		echo "elementor-pro.php"
	else
		return 1
	fi
}

# Extract version from plugin file content
extract_version_from_file() {
	local content="$1"
	local plugin_file="$2"
	
	if [ "$plugin_file" = "elementor.php" ]; then
		# Try header format first: * Version: X.Y.Z
		if echo "$content" | grep -m1 '^\s*\*\s*Version:' | sed 's/^\s*\*\s*Version:\s*//' | grep -q '^[0-9]'; then
			echo "$content" | grep -m1 '^\s*\*\s*Version:' | sed 's/^\s*\*\s*Version:\s*//' | tr -d '\r'
			return 0
		fi
		# Try constant format: define( 'ELEMENTOR_VERSION', 'X.Y.Z' )
		if echo "$content" | grep -q "define.*ELEMENTOR_VERSION"; then
			echo "$content" | grep "define.*ELEMENTOR_VERSION" | sed -E "s/.*'ELEMENTOR_VERSION'[[:space:]]*,[[:space:]]*'([^']+)'.*/\1/" | tr -d '\r'
			return 0
		fi
	elif [ "$plugin_file" = "elementor-pro.php" ]; then
		# Pro uses constant format: define( 'ELEMENTOR_PRO_VERSION', 'X.Y.Z' )
		if echo "$content" | grep -q "define.*ELEMENTOR_PRO_VERSION"; then
			echo "$content" | grep "define.*ELEMENTOR_PRO_VERSION" | sed -E "s/.*'ELEMENTOR_PRO_VERSION'[[:space:]]*,[[:space:]]*'([^']+)'.*/\1/" | tr -d '\r'
			return 0
		fi
	fi
	
	return 1
}

# Get version from release/beta
get_beta_version() {
	local plugin_file content version
	
	if ! plugin_file="$(detect_plugin_file)"; then
		log_stderr "Error: Could not find plugin file (elementor.php or elementor-pro.php) on origin/release/beta"
		return 1
	fi
	
	if ! content="$(git show "origin/release/beta:${plugin_file}" 2>&1)"; then
		log_stderr "Error: Could not read ${plugin_file} from origin/release/beta: ${content}"
		return 1
	fi
	
	if ! version="$(extract_version_from_file "$content" "$plugin_file")"; then
		log_stderr "Error: Could not extract version from ${plugin_file} on release/beta"
		return 1
	fi
	
	echo "$version"
}

# Get latest published stable release version.
# Excludes: drafts, prereleases, -latest-*, nightly, -beta, -dev, -rc tags.
# Returns the highest semver from remaining releases.
get_latest_stable_release() {
	local releases tag is_draft is_prerelease
	
	if ! releases="$(gh api repos/"${REPO}"/releases --paginate --jq '.[] | {tag_name, draft, prerelease}' 2>&1)"; then
		log_stderr "Error: Failed to fetch releases: ${releases}"
		return 1
	fi
	
	local latest_version=""
	local latest_major=0
	local latest_minor=0
	
	while IFS= read -r line; do
		if [[ "$line" =~ \"tag_name\":[[:space:]]*\"([^\"]+)\" ]]; then
			tag="${BASH_REMATCH[1]}"
		fi
		if [[ "$line" =~ \"draft\":[[:space:]]*(true|false) ]]; then
			is_draft="${BASH_REMATCH[1]}"
		fi
		if [[ "$line" =~ \"prerelease\":[[:space:]]*(true|false) ]]; then
			is_prerelease="${BASH_REMATCH[1]}"
			
			# When we have all three fields, evaluate this release
			if [ -n "${tag:-}" ] && [ -n "${is_draft:-}" ] && [ -n "${is_prerelease:-}" ]; then
				# Skip drafts and prereleases
				if [ "$is_draft" = "true" ] || [ "$is_prerelease" = "true" ]; then
					tag=""
					is_draft=""
					is_prerelease=""
					continue
				fi
				
				# Skip automated build tags
				if [[ "$tag" =~ -latest- ]] || [[ "$tag" =~ nightly ]]; then
					tag=""
					is_draft=""
					is_prerelease=""
					continue
				fi
				
				# Skip pre-release version strings
				local clean_tag="${tag#v}"
				if [[ "$clean_tag" =~ -beta ]] || [[ "$clean_tag" =~ -dev ]] || [[ "$clean_tag" =~ -rc ]]; then
					tag=""
					is_draft=""
					is_prerelease=""
					continue
				fi
				
				# Extract X.Y and compare
				if major_minor="$(extract_major_minor "$tag")"; then
					local major minor
					IFS='.' read -r major minor <<< "$major_minor"
					
					# Keep the highest version
					if [ "$major" -gt "$latest_major" ] || \
					   ([ "$major" -eq "$latest_major" ] && [ "$minor" -gt "$latest_minor" ]); then
						latest_major="$major"
						latest_minor="$minor"
						latest_version="$tag"
					fi
				fi
				
				tag=""
				is_draft=""
				is_prerelease=""
			fi
		fi
	done <<< "$releases"
	
	if [ -z "$latest_version" ]; then
		log_stderr "Error: No valid stable releases found"
		return 1
	fi
	
	echo "$latest_version"
}

# Main logic
check_beta_active() {
	local beta_version stable_version beta_xy stable_xy
	
	if [ -z "$REPO" ]; then
		log_stderr "GITHUB_REPOSITORY not set; failing open (include beta)"
		echo '{"isActive":true,"reason":"GITHUB_REPOSITORY not set; failing open"}'
		return 0
	fi
	
	if ! beta_version="$(get_beta_version)"; then
		log_stderr "Failed to get beta version; failing open (include beta)"
		echo '{"isActive":true,"reason":"Failed to get beta version; failing open"}'
		return 0
	fi
	
	if ! beta_xy="$(extract_major_minor "$beta_version")"; then
		log_stderr "Failed to parse beta version ${beta_version}; failing open (include beta)"
		echo '{"isActive":true,"reason":"Failed to parse beta version; failing open"}'
		return 0
	fi
	
	if ! stable_version="$(get_latest_stable_release)"; then
		log_stderr "Failed to get latest stable release; failing open (include beta)"
		echo '{"isActive":true,"reason":"Failed to get latest stable release; failing open"}'
		return 0
	fi
	
	if ! stable_xy="$(extract_major_minor "$stable_version")"; then
		log_stderr "Failed to parse stable version ${stable_version}; failing open (include beta)"
		echo '{"isActive":true,"reason":"Failed to parse stable version; failing open"}'
		return 0
	fi
	
	log_stderr "Beta version: ${beta_version} (${beta_xy}), Stable release: ${stable_version} (${stable_xy})"
	
	if version_gt "$beta_xy" "$stable_xy"; then
		log_stderr "Beta is ACTIVE: ${beta_xy} > ${stable_xy}"
		echo "{\"isActive\":true,\"reason\":\"Beta ${beta_xy} > stable ${stable_xy}\"}"
	else
		log_stderr "Beta is INACTIVE: ${beta_xy} <= ${stable_xy}"
		echo "{\"isActive\":false,\"reason\":\"Beta ${beta_xy} <= stable ${stable_xy}\"}"
	fi
}

check_beta_active
