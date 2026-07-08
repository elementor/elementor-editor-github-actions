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


export function resolveReadmeTags(
	version: string,
	channel: string,
	counterpartTag: string,
): { stable: string; beta: string } {
	if (channel === 'stable') {
		return { stable: version, beta: counterpartTag };
	}
	return { stable: counterpartTag, beta: version };
}

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

export function run(): void {
	try {
		const version = getEnv('INPUT_VERSION');
		const channel = getEnv('INPUT_CHANNEL');
		const counterpartTag = getEnv('INPUT_COMPANION_TAG');

		// ── elementor.php ────────────────────────────────────────────────────────
		const phpPath = 'elementor.php';
		const patchedPhp = patchPhpVersion(readFileSync(phpPath, 'utf8'), version);
		writeFileSync(phpPath, patchedPhp, 'utf8');
		console.log(`✅ elementor.php patched to ${version}`);

		// ── readme.txt ───────────────────────────────────────────────────────────
		const readmePath = 'readme.txt';
		const readmeTags = resolveReadmeTags(version, channel, counterpartTag);

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
