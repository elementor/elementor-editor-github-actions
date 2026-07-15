import semver from 'semver';
// ─── elementor.php ────────────────────────────────────────────────────────────

/**
 * Replaces the two version markers in elementor.php file content:
 *   * Version: X.Y.Z
 *   define( 'ELEMENTOR_VERSION', 'X.Y.Z' )
 */
export function patchPhpVersion(content: string, version: string): string {
	return content
		.replace(/( \* Version: ).*/, `$1${version}`)
		.replace(/(define\( 'ELEMENTOR_VERSION', ')[^']*'/, `$1${version}'`);
}

// ─── readme.txt ───────────────────────────────────────────────────────────────

/**
 * Replaces `Stable tag:` and `Beta tag:` lines in readme.txt.
 * Both tags are required — throws if either is missing from the content.
 */
export function patchReadmeTxt(
	content: string,
	tags: { stable: string; beta: string },
): string {
	if (!content.match(/^Stable tag: /m)) {
		throw new Error(
			'patchReadmeTxt: "Stable tag:" line not found in readme.txt',
		);
	}

	if (!content.match(/^Beta tag: /m)) {
		throw new Error(
			'patchReadmeTxt: "Beta tag:" line not found in readme.txt',
		);
	}

	return content
		.replace(/^Stable tag: .*/m, `Stable tag: ${tags.stable}`)
		.replace(/^Beta tag: .*/m, `Beta tag: ${tags.beta}`);
}

function normalizeVersion(version: string): string {
	return version.replace(/-beta(\d+)$/, '-beta.$1');
}

/**
 * Parses raw `git ls-remote --tags` output and returns the latest tag name
 * matching `pattern`, or null if none match.
 *
 * Each line from ls-remote looks like:
 *   abc123def\trefs/tags/3.11.0
 *
 * The function strips the `refs/tags/` prefix (and an optional leading `v`)
 * before applying the pattern and sorting.
 */
export function parseLatestTagFromLsRemote(
	lsRemoteOutput: string,
	pattern: RegExp,
): string | null {
	const safePattern = new RegExp(
		pattern.source,
		pattern.flags.replace(/[gy]/g, ''),
	);

	const tags = lsRemoteOutput
		.split('\n')
		.map((line) => line.split('\t')[1] ?? '')
		.map((ref) => ref.replace(/^refs\/tags\/v?/, ''))
		.filter((tag) => safePattern.test(tag))
		.filter((tag) => semver.valid(normalizeVersion(tag)) !== null)
		.sort((a, b) =>
			semver.compare(normalizeVersion(a), normalizeVersion(b)),
		);
	console.log(tags);

	return tags[tags.length - 1] ?? null;
}
