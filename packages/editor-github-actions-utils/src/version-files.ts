// ─── elementor.php ────────────────────────────────────────────────────────────

/**
 * Replaces the two version markers in elementor.php file content:
 *   * Version: X.Y.Z
 *   define( 'ELEMENTOR_VERSION', 'X.Y.Z' )
 */
export function patchPhpVersion(content: string, version: string): string {
	return content
		.replace(/( \* Version: ).*/g, `$1${version}`)
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

// ─── git ls-remote output parsing ─────────────────────────────────────────────

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
	const tags = lsRemoteOutput
		.split('\n')
		.map((line) => line.split('\t')[1] ?? '')
		.map((ref) => ref.replace(/^refs\/tags\/v?/, ''))
		.filter((tag) => pattern.test(tag))
		.sort((a, b) => {
			// Semantic version sort — splits numeric and alphabetic parts so that
			// beta10 > beta2 (numeric comparison, not lexicographic).
			const toparts = (v: string) =>
				v.split(/[.-]/).flatMap((p) => {
					const m = p.match(/^([a-z]+)(\d+)$/);
					return m
						? [m[1], Number(m[2])]
						: [isNaN(Number(p)) ? p : Number(p)];
				});
			const ap = toparts(a);
			const bp = toparts(b);
			for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
				const ai = ap[i] ?? 0;
				const bi = bp[i] ?? 0;
				if (ai < bi) return -1;
				if (ai > bi) return 1;
			}
			return 0;
		});

	return tags[tags.length - 1] ?? null;
}
