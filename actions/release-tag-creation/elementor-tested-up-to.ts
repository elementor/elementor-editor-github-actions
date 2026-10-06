import semver from 'semver';
import { parseHeaderField } from '@elementor/editor-github-actions-utils';

export type ReleaseChannel = 'stable' | 'beta';

export function coreReleasePluginFileUrl(channel: ReleaseChannel): string {
	return `https://raw.githubusercontent.com/elementor/elementor/refs/heads/release/${channel}/elementor.php`;
}

export function toTestedUpToVersion(coreVersion: string): string {
	const parsed = semver.parse(coreVersion);

	if (!parsed) {
		throw new Error(`Core version "${coreVersion}" is not valid semver.`);
	}

	return `${String(parsed.major)}.${String(parsed.minor)}.${String(parsed.patch)}`;
}

export async function fetchCoreReleaseVersion(
	channel: ReleaseChannel,
): Promise<string> {
	const url = coreReleasePluginFileUrl(channel);
	const response = await fetch(url);

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
