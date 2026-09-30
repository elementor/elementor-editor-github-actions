'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE_BUILD_ARTIFACT_NAME = 'elementor-core-build';
const CORE_ZIP_FILE_NAME = 'elementor.zip';
const HELLO_ARTIFACT_PREFIX = 'hello-elementor.';
const LOCAL_HELLO_THEME_PATH = './hello-elementor';
const PRO_ARTIFACT_PREFIX = 'elementor-pro-';
const PRO_DIRECTORY_NAME = 'elementor-pro';
const WP_ORG_HELLO_THEME_ZIP =
	'https://downloads.wordpress.org/theme/hello-elementor.zip';

const BUILD_SOURCE_EVIDENCE = 'evidence';
const BUILD_SOURCE_FRESH = 'fresh';

function isUsableArtifact(artifact) {
	return artifact && !artifact.expired && typeof artifact.name === 'string';
}

function pickBuildArtifacts(artifacts) {
	const usable = (artifacts || []).filter(isUsableArtifact);

	return {
		core:
			usable.find(
				(artifact) => artifact.name === CORE_BUILD_ARTIFACT_NAME,
			) || null,
		pro:
			usable.find((artifact) =>
				artifact.name.startsWith(PRO_ARTIFACT_PREFIX),
			) || null,
		hello:
			usable.find((artifact) =>
				artifact.name.startsWith(HELLO_ARTIFACT_PREFIX),
			) || null,
	};
}

/**
 * Whatever the evidence run still has is restored, and the caller rebuilds
 * only what is missing. That is safe because the rebuild pins the exact
 * commits the run tested, so the run's Pro next to a rebuilt Core is the same
 * combination it ran. Release branches that predate the Core upload never
 * have the Core artifact, which makes this the usual case there.
 * Hello is optional: without it wp-env installs the wordpress.org release,
 * which is what the nightly uses by default anyway.
 */
function planBuildRestore(artifacts) {
	const picks = pickBuildArtifacts(artifacts);
	const missing = [
		...(picks.core ? [] : [CORE_BUILD_ARTIFACT_NAME]),
		...(picks.pro ? [] : [`${PRO_ARTIFACT_PREFIX}*`]),
	];

	return {
		source:
			0 === missing.length ? BUILD_SOURCE_EVIDENCE : BUILD_SOURCE_FRESH,
		missing,
		coreArtifactName: picks.core ? picks.core.name : '',
		proArtifactName: picks.pro ? picks.pro.name : '',
		helloArtifactName: picks.hello ? picks.hello.name : '',
	};
}

function listRunArtifacts(repo, runId) {
	const output = execFileSync(
		'gh',
		['api', `repos/${repo}/actions/runs/${runId}/artifacts`, '--paginate'],
		{ encoding: 'utf8' },
	);
	return JSON.parse(output).artifacts || [];
}

function downloadArtifact(repo, runId, artifactName, destinationDir) {
	fs.mkdirSync(destinationDir, { recursive: true });
	execFileSync(
		'gh',
		[
			'run',
			'download',
			String(runId),
			'--repo',
			repo,
			'-n',
			artifactName,
			'-D',
			destinationDir,
		],
		{ stdio: 'inherit' },
	);
}

function walkFiles(rootDir, visitor) {
	for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
		const fullPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			walkFiles(fullPath, visitor);
			continue;
		}
		visitor(fullPath, entry.name);
	}
}

function findDownloadedFile(rootDir, fileName) {
	let match = null;
	walkFiles(rootDir, (fullPath, name) => {
		if (!match && name === fileName) {
			match = fullPath;
		}
	});
	return match;
}

function findHelloThemeZip(rootDir) {
	let match = null;
	walkFiles(rootDir, (fullPath, name) => {
		if (
			!match &&
			name.startsWith('hello-elementor') &&
			name.endsWith('.zip')
		) {
			match = fullPath;
		}
	});
	return match;
}

function copyDirectoryContents(sourceDir, destinationDir) {
	fs.mkdirSync(destinationDir, { recursive: true });
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const fromPath = path.join(sourceDir, entry.name);
		const toPath = path.join(destinationDir, entry.name);
		if (entry.isDirectory()) {
			copyDirectoryContents(fromPath, toPath);
		} else {
			fs.copyFileSync(fromPath, toPath);
		}
	}
}

function layoutProArtifact(downloadDir, workspaceDir) {
	const nestedPro = path.join(downloadDir, PRO_DIRECTORY_NAME);
	const destination = path.join(workspaceDir, PRO_DIRECTORY_NAME);
	if (fs.existsSync(nestedPro) && fs.statSync(nestedPro).isDirectory()) {
		copyDirectoryContents(nestedPro, destination);
		return;
	}
	copyDirectoryContents(downloadDir, destination);
}

function patchWpEnvHelloTheme(workspaceDir) {
	const wpEnvPath = path.join(workspaceDir, '.wp-env.json');
	if (!fs.existsSync(wpEnvPath)) {
		throw new Error(
			'Cannot patch Hello theme path: .wp-env.json is missing.',
		);
	}
	const wpEnv = fs.readFileSync(wpEnvPath, 'utf8');
	if (!wpEnv.includes(WP_ORG_HELLO_THEME_ZIP)) {
		throw new Error(
			'Cannot patch Hello theme path: .wp-env.json does not reference the wordpress.org Hello zip.',
		);
	}
	fs.writeFileSync(
		wpEnvPath,
		wpEnv.split(WP_ORG_HELLO_THEME_ZIP).join(LOCAL_HELLO_THEME_PATH),
	);
}

function unzipHelloTheme(helloDownloadDir, workspaceDir) {
	const helloZip = findHelloThemeZip(helloDownloadDir);
	if (!helloZip) {
		throw new Error(
			'Hello theme zip was downloaded but could not be found.',
		);
	}
	execFileSync('unzip', ['-qo', helloZip, '-d', workspaceDir], {
		stdio: 'inherit',
	});
	patchWpEnvHelloTheme(workspaceDir);
}

function restoreEvidenceBuilds({ repo, runId, plan, workspaceDir }) {
	const stagingDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nightly-healer-restore-'),
	);

	try {
		if (plan.coreArtifactName) {
			const coreDir = path.join(stagingDir, 'core');
			downloadArtifact(repo, runId, plan.coreArtifactName, coreDir);

			const coreZip = findDownloadedFile(coreDir, CORE_ZIP_FILE_NAME);
			if (!coreZip) {
				throw new Error(
					`Artifact "${plan.coreArtifactName}" did not contain ${CORE_ZIP_FILE_NAME}.`,
				);
			}
			fs.copyFileSync(
				coreZip,
				path.join(workspaceDir, CORE_ZIP_FILE_NAME),
			);
			execFileSync(
				'unzip',
				[
					'-qo',
					path.join(workspaceDir, CORE_ZIP_FILE_NAME),
					'-d',
					workspaceDir,
				],
				{ stdio: 'inherit' },
			);
		}

		if (plan.proArtifactName) {
			const proDir = path.join(stagingDir, 'pro');
			downloadArtifact(repo, runId, plan.proArtifactName, proDir);
			layoutProArtifact(proDir, workspaceDir);
		}

		if (plan.helloArtifactName) {
			const helloDir = path.join(stagingDir, 'hello');
			downloadArtifact(repo, runId, plan.helloArtifactName, helloDir);
			unzipHelloTheme(helloDir, workspaceDir);
		}
	} finally {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}

function setOutput(name, value) {
	if (!process.env.GITHUB_OUTPUT) {
		console.log(`${name}=${value}`);
		return;
	}
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.SOURCE_RUN_ID;

	if (!repo || !runId) {
		throw new Error(
			'GITHUB_REPOSITORY and SOURCE_RUN_ID are required to restore nightly Playwright builds.',
		);
	}

	const plan = planBuildRestore(listRunArtifacts(repo, runId));

	restoreEvidenceBuilds({ repo, runId, plan, workspaceDir: process.cwd() });

	const restored = [
		plan.coreArtifactName,
		plan.proArtifactName,
		plan.helloArtifactName,
	].filter(Boolean);
	console.log(
		`Restored from run ${runId}: ${restored.join(', ') || '(nothing)'}`,
	);

	if (plan.missing.length > 0) {
		console.log(
			`::notice::Run ${runId} has no ${plan.missing.join(', ')} (build artifacts are kept for 1 day, and older release branches never upload Core). Rebuilding only that, at the commit the run tested.`,
		);
	}

	setOutput('build_source', plan.source);
	setOutput('pro_restored', plan.proArtifactName ? 'true' : 'false');
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	BUILD_SOURCE_EVIDENCE,
	BUILD_SOURCE_FRESH,
	CORE_BUILD_ARTIFACT_NAME,
	planBuildRestore,
};
