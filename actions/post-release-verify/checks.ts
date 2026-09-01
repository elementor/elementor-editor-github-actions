import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	assertValidVersion,
	getChangelogSection,
	isPrereleaseVersion,
	isVersionAtLeast,
	majorMinor,
	parseHeaderField,
	parsePhpDefine,
	parseReadmeTag,
} from '@elementor/editor-github-actions-utils';

import {
	failed,
	hasFailedChecks,
	passed,
	skipped,
	warned,
	type CheckResult,
} from './check-result.ts';
import {
	contentsApiUrl,
	formatCheckError,
	githubAssetHeaders,
	githubHeaders,
	githubRawHeaders,
	parseGithubRelease,
	pickZipAsset,
	releaseApiUrl,
	repoApiUrl,
	wordpressOrgReadmeUrl,
	wordpressOrgZipUrl,
} from './github.ts';
import {
	HttpError,
	requireOk,
	type HttpGet,
	type HttpGetBuffer,
} from './http.ts';
import { downloadZip, findFileNamed, unzipTo } from './zip.ts';

const CORE_REPO = 'elementor' as const;
const PRO_REPO = 'elementor-pro' as const;

export type VerifyInputs = {
	coreVersion: string;
	proVersion: string | null;
	githubToken: string;
	skipWordpressOrg: boolean;
	workDir: string;
};

export type VerifyDeps = {
	get: HttpGet;
	getBuffer: HttpGetBuffer;
};

export type VerifyOutcome = {
	checks: CheckResult[];
	coreZipPath: string | null;
	proZipPath: string | null;
	changelogSections: Array<{ title: string; body: string }>;
	failed: boolean;
};

export async function runVerify(
	inputs: VerifyInputs,
	deps: VerifyDeps,
): Promise<VerifyOutcome> {
	assertValidVersion(inputs.coreVersion);

	if (inputs.proVersion) {
		assertValidVersion(inputs.proVersion);
	}

	await mkdir(inputs.workDir, { recursive: true });

	const checks: CheckResult[] = [];
	const changelogSections: Array<{ title: string; body: string }> = [];
	const githubJson = githubHeaders(inputs.githubToken);
	const githubRaw = githubRawHeaders(inputs.githubToken);
	const githubAsset = githubAssetHeaders(inputs.githubToken);

	const coreRelease = await checkGithubRelease({
		id: 'core-github-release',
		title: 'GitHub release API (Core)',
		repo: CORE_REPO,
		version: inputs.coreVersion,
		get: deps.get,
		headers: githubJson,
		checks,
	});

	let proRelease = null;

	if (inputs.proVersion) {
		const proReadable = await checkProRepoAccess({
			get: deps.get,
			headers: githubJson,
			checks,
		});

		if (!proReadable) {
			return {
				checks,
				coreZipPath: null,
				proZipPath: null,
				changelogSections,
				failed: hasFailedChecks(checks),
			};
		}

		proRelease = await checkGithubRelease({
			id: 'pro-github-release',
			title: 'GitHub release API (Pro)',
			repo: PRO_REPO,
			version: inputs.proVersion,
			get: deps.get,
			headers: githubJson,
			checks,
		});
	}

	await checkMainChangelog({
		id: 'core-changelog-main',
		title: 'Changelog on main (Core)',
		repo: CORE_REPO,
		version: inputs.coreVersion,
		files: ['changelog.txt', 'readme.txt'],
		get: deps.get,
		headers: githubRaw,
		checks,
		changelogSections,
	});

	if (inputs.proVersion) {
		await checkMainChangelog({
			id: 'pro-changelog-main',
			title: 'Changelog on main (Pro)',
			repo: PRO_REPO,
			version: inputs.proVersion,
			files: ['changelog.txt'],
			get: deps.get,
			headers: githubRaw,
			checks,
			changelogSections,
		});
	}

	const wordpressOrgZip = await checkWordpressOrg({
		coreVersion: inputs.coreVersion,
		skip: inputs.skipWordpressOrg,
		get: deps.get,
		checks,
		changelogSections,
	});

	const coreZipPath = path.join(inputs.workDir, 'elementor.zip');
	const coreExtractDir = path.join(inputs.workDir, 'elementor-extracted');
	let coreZipOk = false;

	if (wordpressOrgZip) {
		coreZipOk = await downloadAndCheckCoreZip({
			url: wordpressOrgZip,
			headers: undefined,
			sourceLabel: 'wordpress.org',
			destPath: coreZipPath,
			extractDir: coreExtractDir,
			version: inputs.coreVersion,
			deps,
			checks,
		});
	} else if (coreRelease) {
		const asset = pickZipAsset(coreRelease);

		coreZipOk = await downloadAndCheckCoreZip({
			url: asset.url,
			headers: githubAsset,
			sourceLabel:
				'GitHub release (wordpress.org skipped or unavailable)',
			destPath: coreZipPath,
			extractDir: coreExtractDir,
			version: inputs.coreVersion,
			deps,
			checks,
		});
	} else {
		checks.push(
			failed(
				'core-zip-headers',
				'Downloaded Core zip version headers',
				'Could not download a Core zip from wordpress.org or GitHub',
			),
		);
	}

	let proZipPath: string | null = null;

	if (inputs.proVersion && proRelease) {
		const candidate = path.join(inputs.workDir, 'elementor-pro.zip');
		const extractDir = path.join(inputs.workDir, 'elementor-pro-extracted');
		const asset = pickZipAsset(proRelease);
		const proZipOk = await downloadAndCheckProZip({
			url: asset.url,
			headers: githubAsset,
			destPath: candidate,
			extractDir,
			proVersion: inputs.proVersion,
			coreVersion: inputs.coreVersion,
			deps,
			checks,
		});

		if (proZipOk) {
			proZipPath = candidate;
		}
	} else if (inputs.proVersion) {
		checks.push(
			failed(
				'pro-zip-headers',
				'Downloaded Pro zip version headers',
				'Could not download a Pro zip from GitHub',
			),
		);
	}

	return {
		checks,
		coreZipPath: coreZipOk ? coreZipPath : null,
		proZipPath,
		changelogSections,
		failed: hasFailedChecks(checks),
	};
}

async function checkGithubRelease(params: {
	id: string;
	title: string;
	repo: typeof CORE_REPO | typeof PRO_REPO;
	version: string;
	get: HttpGet;
	headers: Record<string, string>;
	checks: CheckResult[];
}) {
	try {
		const body = await requireOk(
			params.get,
			releaseApiUrl(params.repo, params.version),
			{ headers: params.headers },
		);
		const release = parseGithubRelease(body);

		if (release.tag_name !== params.version) {
			params.checks.push(
				failed(
					params.id,
					params.title,
					`Expected tag ${params.version}, got ${release.tag_name}`,
				),
			);
			return null;
		}

		pickZipAsset(release);
		params.checks.push(
			passed(
				params.id,
				params.title,
				`https://api.github.com/repos/elementor/${params.repo}/releases/tags/${params.version} returned ${release.tag_name} with a zip asset`,
			),
		);

		return release;
	} catch (error) {
		params.checks.push(
			failed(
				params.id,
				params.title,
				githubNotFoundHint(params.repo, error),
			),
		);
		return null;
	}
}

async function checkProRepoAccess(params: {
	get: HttpGet;
	headers: Record<string, string>;
	checks: CheckResult[];
}): Promise<boolean> {
	const title = 'GitHub access to elementor-pro';

	try {
		await requireOk(params.get, repoApiUrl(PRO_REPO), {
			headers: params.headers,
		});
		params.checks.push(
			passed(
				'pro-repo-access',
				title,
				'Token can read the private elementor-pro repository',
			),
		);
		return true;
	} catch (error) {
		params.checks.push(
			failed(
				'pro-repo-access',
				title,
				`${githubNotFoundHint(PRO_REPO, error)} Pass MAINTAIN_TOKEN from Core/Pro (this repo's github.token cannot see private Pro).`,
			),
		);
		return false;
	}
}

function githubNotFoundHint(
	repo: typeof CORE_REPO | typeof PRO_REPO,
	error: unknown,
): string {
	const detail = formatCheckError(error);

	if (repo === PRO_REPO && /404/.test(detail)) {
		return `${detail} Private Pro returns 404 when the token has no access.`;
	}

	return detail;
}

async function checkMainChangelog(params: {
	id: string;
	title: string;
	repo: typeof CORE_REPO | typeof PRO_REPO;
	version: string;
	files: string[];
	get: HttpGet;
	headers: Record<string, string>;
	checks: CheckResult[];
	changelogSections: Array<{ title: string; body: string }>;
}) {
	try {
		const missing: string[] = [];

		for (const filePath of params.files) {
			const content = await requireOk(
				params.get,
				contentsApiUrl(params.repo, filePath),
				{ headers: params.headers },
			);
			const section = getChangelogSection(content, params.version);

			if (!section) {
				missing.push(filePath);
				continue;
			}

			params.changelogSections.push({
				title: `${params.title} — ${filePath}`,
				body: section,
			});
		}

		if (missing.length > 0) {
			params.checks.push(
				failed(
					params.id,
					params.title,
					`No non-empty changelog section for ${params.version} in: ${missing.join(', ')}`,
				),
			);
			return;
		}

		params.checks.push(
			passed(
				params.id,
				params.title,
				`Found ${params.version} in ${params.files.join(', ')} on main`,
			),
		);
	} catch (error) {
		params.checks.push(
			failed(
				params.id,
				params.title,
				githubNotFoundHint(params.repo, error),
			),
		);
	}
}

async function checkWordpressOrg(params: {
	coreVersion: string;
	skip: boolean;
	get: HttpGet;
	checks: CheckResult[];
	changelogSections: Array<{ title: string; body: string }>;
}): Promise<string | null> {
	const title = 'wordpress.org changelog and Stable tag (Core)';

	if (params.skip) {
		params.checks.push(
			skipped(
				'wordpress-org',
				title,
				'Skipped by skip-wordpress-org input',
			),
		);
		return null;
	}

	if (isPrereleaseVersion(params.coreVersion)) {
		params.checks.push(
			skipped(
				'wordpress-org',
				title,
				'Prerelease versions are not published as Stable tag on wordpress.org',
			),
		);
		return null;
	}

	const url = wordpressOrgReadmeUrl(params.coreVersion);

	try {
		const response = await params.get(url);

		if (response.status === 404) {
			params.checks.push(
				skipped(
					'wordpress-org',
					title,
					`SVN tag not found yet (${url}). Use the GitHub zip until wordpress.org syncs.`,
				),
			);
			return null;
		}

		if (!response.ok) {
			params.checks.push(
				failed(
					'wordpress-org',
					title,
					`${String(response.status)} ${url}`,
				),
			);
			return null;
		}

		const stableTag = parseReadmeTag(response.body, 'Stable tag');
		const section = getChangelogSection(response.body, params.coreVersion);

		if (stableTag !== params.coreVersion) {
			params.checks.push(
				failed(
					'wordpress-org',
					title,
					`Stable tag is ${stableTag ?? '(missing)'}, expected ${params.coreVersion}`,
				),
			);
			return null;
		}

		if (!section) {
			params.checks.push(
				failed(
					'wordpress-org',
					title,
					`No non-empty changelog section for ${params.coreVersion} in wordpress.org readme.txt`,
				),
			);
			return null;
		}

		params.changelogSections.push({
			title,
			body: section,
		});
		params.checks.push(
			passed(
				'wordpress-org',
				title,
				`Stable tag ${stableTag} and changelog section found at ${url}`,
			),
		);

		return wordpressOrgZipUrl(params.coreVersion);
	} catch (error) {
		params.checks.push(
			failed('wordpress-org', title, formatCheckError(error)),
		);
		return null;
	}
}

async function downloadAndCheckCoreZip(params: {
	url: string;
	headers: Record<string, string> | undefined;
	sourceLabel: string;
	destPath: string;
	extractDir: string;
	version: string;
	deps: VerifyDeps;
	checks: CheckResult[];
}): Promise<boolean> {
	const title = 'Downloaded Core zip version headers';

	try {
		await downloadZip({
			url: params.url,
			headers: params.headers,
			destPath: params.destPath,
			getBuffer: params.deps.getBuffer,
		});
		await unzipTo(params.destPath, params.extractDir);

		const phpPath = await findFileNamed(params.extractDir, 'elementor.php');
		const readmePath = await findFileNamed(params.extractDir, 'readme.txt');

		if (!phpPath) {
			params.checks.push(
				failed(
					'core-zip-headers',
					title,
					'elementor.php not found in zip',
				),
			);
			return false;
		}

		const php = await readFile(phpPath, 'utf8');
		const headerVersion = parseHeaderField(php, 'Version');
		const defineVersion = parsePhpDefine(php, 'ELEMENTOR_VERSION');
		const mismatches: string[] = [];

		if (headerVersion !== params.version) {
			mismatches.push(`header Version=${headerVersion ?? '(missing)'}`);
		}

		if (defineVersion !== params.version) {
			mismatches.push(
				`ELEMENTOR_VERSION=${defineVersion ?? '(missing)'}`,
			);
		}

		if (readmePath) {
			const stableTag = parseReadmeTag(
				await readFile(readmePath, 'utf8'),
				'Stable tag',
			);

			if (
				!isPrereleaseVersion(params.version) &&
				stableTag !== params.version
			) {
				mismatches.push(
					`readme Stable tag=${stableTag ?? '(missing)'}`,
				);
			}
		}

		if (mismatches.length > 0) {
			params.checks.push(
				failed(
					'core-zip-headers',
					title,
					`Zip from ${params.sourceLabel} does not match ${params.version}: ${mismatches.join(', ')}`,
				),
			);
			return false;
		}

		params.checks.push(
			passed(
				'core-zip-headers',
				title,
				`Version ${params.version} in elementor.php (${params.sourceLabel})`,
			),
		);
		return true;
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) {
			params.checks.push(
				failed(
					'core-zip-headers',
					title,
					`Zip not found at ${params.url}`,
				),
			);
			return false;
		}

		params.checks.push(
			failed('core-zip-headers', title, formatCheckError(error)),
		);
		return false;
	}
}

async function downloadAndCheckProZip(params: {
	url: string;
	headers: Record<string, string>;
	destPath: string;
	extractDir: string;
	proVersion: string;
	coreVersion: string;
	deps: VerifyDeps;
	checks: CheckResult[];
}): Promise<boolean> {
	const title = 'Downloaded Pro zip version headers';

	try {
		await downloadZip({
			url: params.url,
			headers: params.headers,
			destPath: params.destPath,
			getBuffer: params.deps.getBuffer,
		});
		await unzipTo(params.destPath, params.extractDir);

		const phpPath = await findFileNamed(
			params.extractDir,
			'elementor-pro.php',
		);

		if (!phpPath) {
			params.checks.push(
				failed(
					'pro-zip-headers',
					title,
					'elementor-pro.php not found in zip',
				),
			);
			return false;
		}

		const php = await readFile(phpPath, 'utf8');
		const headerVersion = parseHeaderField(php, 'Version');
		const defineVersion = parsePhpDefine(php, 'ELEMENTOR_PRO_VERSION');
		const required = parsePhpDefine(
			php,
			'ELEMENTOR_PRO_REQUIRED_CORE_VERSION',
		);
		const recommended = parsePhpDefine(
			php,
			'ELEMENTOR_PRO_RECOMMENDED_CORE_VERSION',
		);
		const mismatches: string[] = [];

		if (headerVersion !== params.proVersion) {
			mismatches.push(`header Version=${headerVersion ?? '(missing)'}`);
		}

		if (defineVersion !== params.proVersion) {
			mismatches.push(
				`ELEMENTOR_PRO_VERSION=${defineVersion ?? '(missing)'}`,
			);
		}

		if (!required) {
			mismatches.push('ELEMENTOR_PRO_REQUIRED_CORE_VERSION missing');
		} else if (!isVersionAtLeast(params.coreVersion, required)) {
			mismatches.push(
				`ELEMENTOR_PRO_REQUIRED_CORE_VERSION=${required} but Core is ${params.coreVersion}`,
			);
		}

		if (!recommended) {
			mismatches.push('ELEMENTOR_PRO_RECOMMENDED_CORE_VERSION missing');
		}

		if (mismatches.length > 0) {
			params.checks.push(
				failed(
					'pro-zip-headers',
					title,
					`Pro zip does not match ${params.proVersion}: ${mismatches.join(', ')}`,
				),
			);
			return false;
		}

		params.checks.push(
			passed(
				'pro-zip-headers',
				title,
				`Version ${params.proVersion}; Required Core ${required ?? ''}; Recommended Core ${recommended ?? ''}`,
			),
		);

		if (recommended && majorMinor(params.coreVersion) !== recommended) {
			params.checks.push(
				warned(
					'pro-recommended-core',
					'Pro Recommended Core vs this Core release',
					`Recommended is ${recommended}, Core release major.minor is ${majorMinor(params.coreVersion)}`,
				),
			);
		} else if (recommended) {
			params.checks.push(
				passed(
					'pro-recommended-core',
					'Pro Recommended Core vs this Core release',
					`Recommended ${recommended} matches Core ${params.coreVersion}`,
				),
			);
		}

		return true;
	} catch (error) {
		params.checks.push(
			failed('pro-zip-headers', title, formatCheckError(error)),
		);
		return false;
	}
}
