#!/usr/bin/env node
import { execSync } from 'node:child_process';
import * as semver from 'semver';

export type BetaCheckResult = {
	isActive: boolean;
	reason: string;
	betaVersion: string | null;
	stableVersion: string | null;
};

/**
 * Extract version from plugin file content.
 * Supports both header format (Version: X.Y.Z) and constant format (CONSTANT_NAME, 'X.Y.Z')
 */
export function extractVersion(
	fileContent: string,
	pluginFile: string,
): string | null {
	if (pluginFile === 'elementor.php') {
		const headerMatch = fileContent.match(/^\s*\*\s*Version:\s*(.+)$/m);
		if (headerMatch?.[1]) {
			return headerMatch[1].trim();
		}

		const constantMatch = fileContent.match(
			/define\s*\(\s*'ELEMENTOR_VERSION'\s*,\s*'([^']+)'\s*\)/,
		);
		if (constantMatch?.[1]) {
			return constantMatch[1];
		}
	} else if (pluginFile === 'elementor-pro.php') {
		const constantMatch = fileContent.match(
			/define\s*\(\s*'ELEMENTOR_PRO_VERSION'\s*,\s*'([^']+)'\s*\)/,
		);
		if (constantMatch?.[1]) {
			return constantMatch[1];
		}
	}

	return null;
}

/**
 * Detect which plugin this repo is for by checking which version file exists.
 */
export function detectPlugin(): 'elementor.php' | 'elementor-pro.php' | null {
	try {
		execSync('git show origin/release/beta:elementor.php', {
			stdio: 'pipe',
			encoding: 'utf8',
		});
		return 'elementor.php';
	} catch {
		try {
			execSync('git show origin/release/beta:elementor-pro.php', {
				stdio: 'pipe',
				encoding: 'utf8',
			});
			return 'elementor-pro.php';
		} catch {
			return null;
		}
	}
}

/**
 * Get version from the plugin file on a specific branch.
 */
export function getVersionFromBranch(
	branch: string,
	pluginFile: string,
): string | null {
	try {
		const fileContent = execSync(
			`git show origin/${branch}:${pluginFile}`,
			{
				stdio: 'pipe',
				encoding: 'utf8',
			},
		);
		return extractVersion(fileContent, pluginFile);
	} catch {
		return null;
	}
}

/**
 * Get the latest published stable release version from GitHub.
 * Returns null if no release exists or on API error.
 */
export function getLatestPublishedRelease(repo: string): string | null {
	try {
		const result = execSync(`gh api repos/${repo}/releases/latest`, {
			stdio: 'pipe',
			encoding: 'utf8',
		});
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const release = JSON.parse(result);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		const tagName = release.tag_name as string | undefined;
		return tagName?.replace(/^v/, '') ?? null;
	} catch {
		return null;
	}
}

/**
 * Extract major.minor (X.Y) from a version string.
 */
export function getMajorMinor(version: string): string | null {
	const parsed = semver.parse(version);
	if (!parsed) {
		return null;
	}
	return `${String(parsed.major)}.${String(parsed.minor)}`;
}

/**
 * Check if beta is active based on version comparison.
 * Beta is active if the X.Y version on release/beta > X.Y of latest published stable release.
 */
export function checkBetaActive(
	repo: string,
	pluginFile: string,
): BetaCheckResult {
	const betaVersion = getVersionFromBranch('release/beta', pluginFile);
	if (!betaVersion) {
		return {
			isActive: true,
			reason: 'Failed to read version from release/beta; failing open (include beta)',
			betaVersion: null,
			stableVersion: null,
		};
	}

	const stableReleaseVersion = getLatestPublishedRelease(repo);
	if (!stableReleaseVersion) {
		return {
			isActive: true,
			reason: 'Failed to get latest published release; failing open (include beta)',
			betaVersion,
			stableVersion: null,
		};
	}

	const betaMajorMinor = getMajorMinor(betaVersion);
	const stableMajorMinor = getMajorMinor(stableReleaseVersion);

	if (!betaMajorMinor || !stableMajorMinor) {
		return {
			isActive: true,
			reason: 'Failed to parse versions; failing open (include beta)',
			betaVersion,
			stableVersion: stableReleaseVersion,
		};
	}

	const betaMajorMinorVersion = `${betaMajorMinor}.0`;
	const stableMajorMinorVersion = `${stableMajorMinor}.0`;
	const isActive = semver.gt(betaMajorMinorVersion, stableMajorMinorVersion);

	if (isActive) {
		return {
			isActive: true,
			reason: `Beta version ${betaMajorMinor} > stable release ${stableMajorMinor}`,
			betaVersion,
			stableVersion: stableReleaseVersion,
		};
	}

	return {
		isActive: false,
		reason: `Beta version ${betaMajorMinor} <= stable release ${stableMajorMinor}`,
		betaVersion,
		stableVersion: stableReleaseVersion,
	};
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
	const repo = process.env.GITHUB_REPOSITORY;
	if (!repo) {
		console.error('GITHUB_REPOSITORY environment variable is required');
		process.exit(1);
	}

	const pluginFile = detectPlugin();
	if (!pluginFile) {
		console.error(
			'Could not detect plugin (neither elementor.php nor elementor-pro.php found on release/beta)',
		);
		process.exit(1);
	}

	const result = checkBetaActive(repo, pluginFile);
	console.log(JSON.stringify(result));
	process.exit(0);
}
