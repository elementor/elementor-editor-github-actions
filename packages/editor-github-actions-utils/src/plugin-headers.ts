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
