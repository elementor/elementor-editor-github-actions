import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

function patchPhpVersion(content: string, version: string): string {
	return content
		.replace(/( \* Version: ).*/g, `$1${version}`)
		.replace(/(define\( 'ELEMENTOR_VERSION', ')[^']*'/, `$1${version}'`);
}

function patchReadmeTxt(content: string, tags: { stable: string; beta: string }): string {
	if (!content.match(/^Stable tag: /m)) {
		throw new Error('patchReadmeTxt: "Stable tag:" line not found in readme.txt');
	}
	if (!content.match(/^Beta tag: /m)) {
		throw new Error('patchReadmeTxt: "Beta tag:" line not found in readme.txt');
	}
	return content
		.replace(/^Stable tag: .*/m, `Stable tag: ${tags.stable}`)
		.replace(/^Beta tag: .*/m, `Beta tag: ${tags.beta}`);
}

function parseLatestTagFromLsRemote(lsRemoteOutput: string, pattern: RegExp): string | null {
	const tags = lsRemoteOutput
		.split('\n')
		.map((line) => line.split('\t')[1] ?? '')
		.map((ref) => ref.replace(/^refs\/tags\/v?/, ''))
		.filter((tag) => pattern.test(tag))
		.sort((a, b) => {
			const toparts = (v: string) =>
				v.split(/[.\-]/).map((p) => (isNaN(Number(p)) ? p : Number(p)));
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

const STABLE_TAG_PATTERN = /^\d+\.\d+\.\d+$/;
const BETA_TAG_PATTERN = /^\d+\.\d+\.\d+-beta\d+$/;

function getEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function setOutput(name: string, value: string): void {
	const outputFile = process.env['GITHUB_OUTPUT'];
	if (outputFile) {
		appendFileSync(outputFile, `${name}=${value}\n`);
	} else {
		console.log(`OUTPUT ${name}=${value}`);
	}
}

function fetchLsRemote(): string {
	return execSync('git ls-remote --tags', { encoding: 'utf8' });
}

export function run(): void {
	try {
		const version = getEnv('INPUT_VERSION');
		const channel = getEnv('INPUT_CHANNEL');

		// ── elementor.php ────────────────────────────────────────────────────────
		const phpPath = 'elementor.php';
		const patchedPhp = patchPhpVersion(readFileSync(phpPath, 'utf8'), version);
		writeFileSync(phpPath, patchedPhp, 'utf8');
		console.log(`✅ elementor.php patched to ${version}`);

		// ── readme.txt ───────────────────────────────────────────────────────────
		const readmePath = 'readme.txt';
		const lsRemote = fetchLsRemote();

		let readmeTags: { stable: string; beta: string };

		if (channel === 'stable') {
			const lastBetaTag = parseLatestTagFromLsRemote(lsRemote, BETA_TAG_PATTERN);
			if (!lastBetaTag) {
				throw new Error('Could not find any existing beta tag in remote — cannot update readme.txt Beta tag.');
			}
			readmeTags = { stable: version, beta: lastBetaTag };
		} else {
			const lastStableTag = parseLatestTagFromLsRemote(lsRemote, STABLE_TAG_PATTERN);
			if (!lastStableTag) {
				throw new Error('Could not find any existing stable tag in remote — cannot update readme.txt Stable tag.');
			}
			readmeTags = { stable: lastStableTag, beta: version };
		}

		const patchedReadme = patchReadmeTxt(readFileSync(readmePath, 'utf8'), readmeTags);
		writeFileSync(readmePath, patchedReadme, 'utf8');
		console.log(`✅ readme.txt patched — Stable: ${readmeTags.stable}, Beta: ${readmeTags.beta}`);

		// ── outputs ──────────────────────────────────────────────────────────────
		setOutput('readme_stable_tag', readmeTags.stable);
		setOutput('readme_beta_tag', readmeTags.beta);
	} catch (err) {
		console.error(`\n::error::${(err as Error).message}\n`);
		process.exit(1);
	}
}

run();
