import type { CheckResult } from './check-result.ts';

export type GithubRelease = {
	tag_name: string;
	assets: Array<{
		name: string;
		url: string;
		browser_download_url: string;
	}>;
};

export function githubHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'User-Agent': 'elementor-post-release-verify',
		'X-GitHub-Api-Version': '2022-11-28',
	};
}

export function githubRawHeaders(token: string): Record<string, string> {
	return {
		...githubHeaders(token),
		Accept: 'application/vnd.github.raw',
	};
}

export function githubAssetHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/octet-stream',
		'User-Agent': 'elementor-post-release-verify',
		'X-GitHub-Api-Version': '2022-11-28',
	};
}

export function releaseApiUrl(
	repo: 'elementor' | 'elementor-pro',
	tag: string,
) {
	return `https://api.github.com/repos/elementor/${repo}/releases/tags/${encodeURIComponent(tag)}`;
}

export function contentsApiUrl(
	repo: 'elementor' | 'elementor-pro',
	filePath: string,
	ref = 'main',
) {
	return `https://api.github.com/repos/elementor/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;
}

export function wordpressOrgReadmeUrl(version: string) {
	return `https://plugins.svn.wordpress.org/elementor/tags/${encodeURIComponent(version)}/readme.txt`;
}

export function wordpressOrgZipUrl(version: string) {
	return `https://downloads.wordpress.org/plugin/elementor.${encodeURIComponent(version)}.zip`;
}

export function parseGithubRelease(body: string): GithubRelease {
	const parsed = JSON.parse(body) as GithubRelease;

	if (!parsed.tag_name || !Array.isArray(parsed.assets)) {
		throw new Error('GitHub release payload is missing tag_name or assets');
	}

	return parsed;
}

export function pickZipAsset(
	release: GithubRelease,
): GithubRelease['assets'][number] {
	const zipAssets = release.assets.filter((asset) =>
		asset.name.toLowerCase().endsWith('.zip'),
	);
	const preferred =
		zipAssets.find((asset) =>
			asset.name.toLowerCase().includes('elementor'),
		) ?? zipAssets[0];

	if (!preferred) {
		throw new Error(`No zip asset on GitHub release ${release.tag_name}`);
	}

	return preferred;
}

export function formatCheckError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function collectFailures(checks: CheckResult[]): string[] {
	return checks
		.filter((check) => check.status === 'fail')
		.map((check) => `${check.title}: ${check.detail}`);
}
