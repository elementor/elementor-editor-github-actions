export function parseHeaderField(
	content: string,
	field: string,
): string | null {
	const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = content.match(
		new RegExp(`^\\s*\\*?\\s*${escaped}:\\s*(.+)$`, 'mi'),
	);

	return match?.[1]?.trim() ?? null;
}

export function parsePhpDefine(
	content: string,
	constant: string,
): string | null {
	const escaped = constant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = content.match(
		new RegExp(`define\\(\\s*'${escaped}'\\s*,\\s*'([^']*)'`),
	);

	return match?.[1] ?? null;
}

export function parseReadmeTag(
	content: string,
	tag: 'Stable tag' | 'Beta tag',
): string | null {
	const match = content.match(new RegExp(`^${tag}:\\s*(.+)$`, 'm'));

	return match?.[1]?.trim() ?? null;
}

export function majorMinor(version: string): string {
	const [major = '', minor = ''] = version.split('.');

	return `${major}.${minor}`;
}

export function versionParts(version: string): [number, number, number] {
	const core = version.split('-')[0] ?? version;
	const [major = 0, minor = 0, patch = 0] = core
		.split('.')
		.map((part) => Number.parseInt(part, 10) || 0);

	return [major, minor, patch];
}

/** True if `version` is greater than or equal to `minimum` (prerelease suffix ignored). */
export function isVersionAtLeast(version: string, minimum: string): boolean {
	const left = versionParts(version);
	const right = versionParts(minimum);

	for (let index = 0; index < 3; index += 1) {
		const leftPart = left[index] ?? 0;
		const rightPart = right[index] ?? 0;

		if (leftPart > rightPart) {
			return true;
		}

		if (leftPart < rightPart) {
			return false;
		}
	}

	return true;
}
