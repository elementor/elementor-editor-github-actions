import type { CheckResult } from './check-result.ts';

const STATUS_LABEL: Record<CheckResult['status'], string> = {
	pass: '✅ Pass',
	fail: '❌ Fail',
	skipped: '⏭️ Skipped',
	warn: '⚠️ Warn',
};

export function renderSummary(params: {
	coreVersion: string;
	proVersion: string | null;
	dryRun: boolean;
	skipWordpressOrg: boolean;
	checks: CheckResult[];
	changelogSections: Array<{ title: string; body: string }>;
}): string {
	const rows = params.checks
		.map(
			(check) =>
				`| ${STATUS_LABEL[check.status]} | ${check.title} | ${escapeCell(check.detail)} |`,
		)
		.join('\n');

	const changelogDump = params.changelogSections
		.map((section) => `### ${section.title}\n\n${section.body}\n`)
		.join('\n');

	return [
		'## Post-release checklist',
		'',
		`| Field | Value |`,
		`| --- | --- |`,
		`| **Core** | \`${params.coreVersion}\` |`,
		`| **Pro** | ${params.proVersion ? `\`${params.proVersion}\`` : '_not requested_'} |`,
		`| **wordpress.org** | ${params.skipWordpressOrg ? 'skipped by input' : 'checked'} |`,
		`| **Dry run** | ${params.dryRun ? 'yes' : 'no'} |`,
		'',
		'| Result | Check | Detail |',
		'| --- | --- | --- |',
		rows,
		'',
		'Changelog sections (for a quick human read):',
		'',
		changelogDump || '_No changelog sections captured._',
		'',
	].join('\n');
}

function escapeCell(value: string): string {
	return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}
