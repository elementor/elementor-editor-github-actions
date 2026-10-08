import semver from 'semver';
import { parseHeaderField } from '@elementor/editor-github-actions-utils';

export type ReleaseChannel = 'stable' | 'beta';

export function toTestedUpToVersion(coreVersion: string): string {
	const parsed = semver.parse(coreVersion);

	if (!parsed) {
		throw new Error(`Core version "${coreVersion}" is not valid semver.`);
	}

	return `${String(parsed.major)}.${String(parsed.minor)}.${String(parsed.patch)}`;
}

export async function fetchCoreReleaseVersion(
	channel: ReleaseChannel,
	token?: string,
): Promise<string> {
	const ref = `release/${channel}`;
	const url = `https://api.github.com/repos/elementor/elementor/contents/elementor.php?ref=${ref}`;

	const headers: HeadersInit = {
		Accept: 'application/vnd.github.raw',
		'User-Agent': 'elementor-editor-github-actions',
	};

	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const response = await fetch(url, { headers });

	if (!response.ok) {
		throw new Error(
			`Failed to fetch Core plugin file from ${url}: HTTP ${String(response.status)}`,
		);
	}

	const version = parseHeaderField(await response.text(), 'Version');

	if (!version) {
		throw new Error(`No "Version:" header found in ${url}`);
	}

	return version;
}
