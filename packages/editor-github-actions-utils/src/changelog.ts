const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-z0-9-]+)?$/i;

const escapeVersionForRegex = (version: string) =>
	version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CHANGELOG_HEADER_PATTERNS = [
	(version: string) =>
		new RegExp(
			`^= ${escapeVersionForRegex(version)} - \\d{4}-\\d{2}-\\d{2} =\\s*$`,
			'm',
		),
	(version: string) =>
		new RegExp(
			`^#### ${escapeVersionForRegex(version)} - \\d{4}-\\d{2}-\\d{2}\\s*$`,
			'm',
		),
];

const CHANGELOG_SECTION_PATTERNS = [
	(version: string) =>
		new RegExp(
			`^= ${escapeVersionForRegex(version)} - \\d{4}-\\d{2}-\\d{2} =\\s*\\n+([\\s\\S]*?)(?=^= \\d+\\.\\d+\\.\\d+ - \\d{4}-\\d{2}-\\d{2} =|(?![\\s\\S]))`,
			'm',
		),
	(version: string) =>
		new RegExp(
			`^#### ${escapeVersionForRegex(version)} - \\d{4}-\\d{2}-\\d{2}\\s*\\n+([\\s\\S]*?)(?=^#### \\d+\\.\\d+\\.\\d+ - \\d{4}-\\d{2}-\\d{2}|(?![\\s\\S]))`,
			'm',
		),
];

export function isPrereleaseVersion(version: string): boolean {
	return version.includes('-');
}

export function assertValidVersion(version: string): void {
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`Invalid version format: ${version}`);
	}
}

export function getChangelogSection(
	content: string,
	version: string,
): string | null {
	assertValidVersion(version);

	const hasHeader = CHANGELOG_HEADER_PATTERNS.some((build) =>
		build(version).test(content),
	);

	if (!hasHeader) {
		return null;
	}

	for (const build of CHANGELOG_SECTION_PATTERNS) {
		const body = content.match(build(version))?.[1]?.trim();

		if (body) {
			return body;
		}
	}

	return null;
}
