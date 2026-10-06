import * as semver from 'semver';
// ─── plugin main file (elementor.php / elementor-pro.php) ────────────────────

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces a ` * <field>: <value>` line in the plugin header.
 * Throws if the field is missing so a wrong field name can't silently ship.
 *
 * Example — patchPhpHeaderField(content, 'Elementor tested up to', '4.4.0'):
 *   * Elementor tested up to: 4.3.0  →  * Elementor tested up to: 4.4.0
 */
export function patchPhpHeaderField(
	content: string,
	field: string,
	value: string,
): string {
	const pattern = new RegExp(`^( \\* ${escapeRegExp(field)}: ).*$`, 'm');

	if (!pattern.test(content)) {
		throw new Error(
			`patchPhpHeaderField: "${field}:" header not found in plugin file`,
		);
	}

	return content.replace(pattern, `$1${value}`);
}

/**
 * Replaces the two version markers in the plugin main file content:
 *   * Version: X.Y.Z
 *   define( '<constant>', 'X.Y.Z' )
 */
export type VersionConstant = 'ELEMENTOR_VERSION' | 'ELEMENTOR_PRO_VERSION';

export function patchPhpVersion(
	content: string,
	version: string,
	constant: VersionConstant = 'ELEMENTOR_VERSION',
): string {
	const definePattern = new RegExp(
		`(define\\( '${escapeRegExp(constant)}', ')[^']*'`,
	);

	if (!definePattern.test(content)) {
		throw new Error(
			`patchPhpVersion: "${constant}" define not found in plugin file`,
		);
	}

	return patchPhpHeaderField(content, 'Version', version).replace(
		definePattern,
		`$1${version}'`,
	);
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

	return tags[tags.length - 1] ?? null;
}
