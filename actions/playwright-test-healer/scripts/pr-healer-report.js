'use strict';

/**
 * Turns what the PR healer found into one verdict per failed test, and the
 * texts it posts: the summary comment on the PR, the body of the PR holding
 * the flaky fixes, and the Slack message announcing that PR.
 *
 * Every failure ends in exactly one of four verdicts. A failure the healer
 * could not get to the end of — no re-run, no main check — is "needs a human
 * look", never a guess at one of the others.
 */

const fs = require('fs');

const { findOpenPrForTest } = require('./healer-skips');
const { setOutput } = require('./github-output');

const COMMENT_MARKER = '<!-- playwright-pr-test-healer -->';
const TEST_MARKER_PREFIX = '<!-- heal-test: ';
const TEST_MARKER_SUFFIX = ' -->';

const VERDICTS = {
	BROKEN: 'broken-by-pr',
	FLAKY: 'flaky',
	FAILING_ON_MAIN: 'failing-on-main',
	NEEDS_HUMAN: 'needs-human',
};

const VERDICT_LABELS = {
	[VERDICTS.BROKEN]: '❌ Broken by this PR',
	[VERDICTS.FLAKY]: '🔁 Flaky',
	[VERDICTS.FAILING_ON_MAIN]: '🟠 Already failing on main',
	[VERDICTS.NEEDS_HUMAN]: '👀 Needs a human look',
};

const VERDICT_ORDER = [
	VERDICTS.BROKEN,
	VERDICTS.NEEDS_HUMAN,
	VERDICTS.FAILING_ON_MAIN,
	VERDICTS.FLAKY,
];

function byTestName(records) {
	return new Map((records || []).map((record) => [record.testName, record]));
}

function decideAfterRerun(rerun, mainRun, rerunJobFailed, mainJobFailed) {
	if (!rerun) {
		return {
			verdict: VERDICTS.NEEDS_HUMAN,
			reason: rerunJobFailed
				? "The healer's re-run on this PR's build failed before it could re-run this test."
				: 'The healer did not re-run this test.',
		};
	}

	if (rerun.error) {
		return {
			verdict: VERDICTS.NEEDS_HUMAN,
			reason: `Could not re-run it: ${rerun.error}`,
		};
	}

	if (rerun.passed > 0) {
		return {
			verdict: VERDICTS.FLAKY,
			reason: `Failed in CI, then passed ${rerun.passed} of ${rerun.runs} re-runs on this PR's build with no change.`,
		};
	}

	const here = `Failed all ${rerun.runs} re-runs on this PR's build`;

	if (!mainRun) {
		return {
			verdict: VERDICTS.NEEDS_HUMAN,
			reason: mainJobFailed
				? `${here}, and the healer's run on main failed before it could check it there.`
				: `${here}, and was not checked on main.`,
		};
	}

	if (mainRun.error) {
		return {
			verdict: VERDICTS.NEEDS_HUMAN,
			reason: `${here}; on main it could not run: ${mainRun.error}`,
		};
	}

	if (mainRun.failed === mainRun.runs) {
		return {
			verdict: VERDICTS.FAILING_ON_MAIN,
			reason: `${here} and all ${mainRun.runs} runs on main, so this PR did not cause it.`,
		};
	}

	return {
		verdict: VERDICTS.NEEDS_HUMAN,
		reason: `${here}, but passed ${mainRun.passed} of ${mainRun.runs} runs on main. The PR may break it in a way the healer could not trace to the diff.`,
	};
}

function describeFix(fix) {
	if (!fix) {
		return { fix: 'none', fixNote: '' };
	}

	return {
		fix: fix.status,
		fixNote: fix.note || '',
		fixUrl: fix.url || '',
	};
}

/**
 * @param {Object}   options
 * @param {Object[]} options.triage        From triage-pr-failures.js.
 * @param {Object[]} [options.prRerun]     Re-runs on the PR build.
 * @param {Object[]} [options.mainRerun]   Re-runs on main.
 * @param {Object[]} [options.fixes]       What happened to each flaky test's fix.
 * @param {string[]} [options.overLimit]   Tests not re-run because of the limit.
 * @param {boolean}  [options.prRerunFailed]   The PR re-run job did not finish.
 * @param {boolean}  [options.mainRerunFailed] The main re-run job did not finish.
 * @return {Object[]} One verdict per failure, most actionable first.
 */
function resolvePrVerdicts({
	triage,
	prRerun,
	mainRerun,
	fixes,
	overLimit = [],
	rerunLimit = 0,
	prRerunFailed = false,
	mainRerunFailed = false,
}) {
	const prRuns = byTestName(prRerun);
	const mainRuns = byTestName(mainRerun);
	const fixRecords = byTestName(fixes);
	const skipped = new Set(overLimit);

	const verdicts = (triage || []).map((failure) => {
		const base = {
			testName: failure.testName,
			shardIndex: failure.shardIndex,
			specFiles: failure.specFiles || [],
			artifactNames: failure.artifactNames || [],
			hasTrace: Boolean(failure.hasTrace),
			evidence: failure.evidence || [],
			rerun: prRuns.get(failure.testName) || null,
			mainRun: mainRuns.get(failure.testName) || null,
		};

		if (failure.linked) {
			return {
				...base,
				verdict: VERDICTS.BROKEN,
				reason: failure.reasons[0],
				otherReasons: failure.reasons.slice(1),
			};
		}

		if (!failure.rerunnable) {
			return {
				...base,
				verdict: VERDICTS.NEEDS_HUMAN,
				reason: `It runs in the \`${failure.shardIndex}\` shard, which the healer cannot re-run.`,
			};
		}

		if (skipped.has(failure.testName)) {
			return {
				...base,
				verdict: VERDICTS.NEEDS_HUMAN,
				reason: `Not re-run: the healer re-runs at most ${rerunLimit} tests per PR, and so many failures at once usually share one cause.`,
			};
		}

		const decision = decideAfterRerun(
			base.rerun,
			base.mainRun,
			prRerunFailed,
			mainRerunFailed,
		);

		return {
			...base,
			...decision,
			...(VERDICTS.FLAKY === decision.verdict
				? describeFix(fixRecords.get(failure.testName))
				: {}),
		};
	});

	return verdicts.sort(
		(a, b) =>
			VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict),
	);
}

function testMarker(testName) {
	return `${TEST_MARKER_PREFIX}${String(testName).replace(/--/g, '- -')}${TEST_MARKER_SUFFIX}`;
}

/**
 * The open PR already proposing a fix for a test: a nightly healer PR, a PR
 * that names it in its title, or an earlier PR healer fix PR listing it.
 */
function findExistingFix(testName, openPrs, baseRef) {
	const nightly = findOpenPrForTest(testName, openPrs, baseRef);

	if (nightly) {
		return nightly;
	}

	const marker = testMarker(testName);
	return (
		(openPrs || []).find(
			(pr) =>
				(!baseRef || pr.baseRefName === baseRef) &&
				String(pr.body || '').includes(marker),
		) || null
	);
}

/**
 * Which flaky tests get an agent. A test someone is already fixing is linked
 * instead, and past the limit the rest are reported, not dropped.
 */
function planFlakyFixes({ flakyTests, openPrs, baseRef, maxFixes }) {
	const toFix = [];
	const skipped = [];

	for (const test of flakyTests || []) {
		const existing = findExistingFix(test.testName, openPrs, baseRef);

		if (existing) {
			skipped.push({
				testName: test.testName,
				status: 'existing-pr',
				url: existing.url,
				note: `A fix is already open: ${existing.url}`,
			});
		} else if (toFix.length >= maxFixes) {
			skipped.push({
				testName: test.testName,
				status: 'not-fixed',
				note: `Not fixed: the healer fixes at most ${maxFixes} flaky tests per PR.`,
			});
		} else {
			toFix.push({ ...test, index: toFix.length });
		}
	}

	return { toFix, skipped };
}

function escapeCell(text) {
	return String(text || '')
		.replace(/\|/g, '\\|')
		.replace(/\r?\n/g, ' ');
}

function code(text) {
	const value = String(text || '').replace(/`/g, "'");
	return `\`${value}\``;
}

function evidenceLink(item, { repo, headSha, baseSha }) {
	const sha = 'base' === item.side ? baseSha : headSha;
	const anchor = item.line ? `#L${item.line}` : '';
	const label = item.line ? `${item.file}:${item.line}` : item.file;
	return `[${code(label)}](https://github.com/${repo}/blob/${sha}/${item.file}${anchor})`;
}

function evidenceCell(verdict, links) {
	const parts = [];

	if (verdict.artifactNames.length) {
		parts.push(
			`[${verdict.hasTrace ? 'trace' : 'test results'}](${links.sourceRunUrl}#artifacts) (${verdict.artifactNames.map(code).join(', ')})`,
		);
	}

	for (const item of verdict.evidence.slice(0, 2)) {
		parts.push(
			`${evidenceLink(item, links)}${item.text ? `: ${code(item.text)}` : ''}`,
		);
	}

	return parts.join('<br>') || '—';
}

function whyCell(verdict) {
	const parts = [verdict.reason];

	if (VERDICTS.FLAKY === verdict.verdict) {
		if ('fixed' === verdict.fix) {
			parts.push('Fixed in the flaky-fix PR.');
		} else if (verdict.fixNote) {
			parts.push(verdict.fixNote);
		}
	}

	return parts.filter(Boolean).join(' ');
}

function countLine(verdicts) {
	return VERDICT_ORDER.map((verdict) => {
		const count = verdicts.filter(
			(item) => item.verdict === verdict,
		).length;
		return count ? `${VERDICT_LABELS[verdict]}: **${count}**` : '';
	})
		.filter(Boolean)
		.join(' · ');
}

/**
 * The single comment the healer keeps on the PR. It is replaced, not added
 * to, on every run, so the PR shows one current answer.
 */
function buildPrComment({
	state,
	verdicts = [],
	repo,
	headSha,
	baseSha,
	sourceRunUrl,
	healerRunUrl,
	fixPrUrl,
	label,
}) {
	const shortSha = code(String(headSha || '').slice(0, 7));
	const footer = `<sub>[Healer run](${healerRunUrl}) · Remove and re-add the \`${label}\` label to run it again.</sub>`;
	const lines = [COMMENT_MARKER, '## 🩺 Playwright test healer', ''];

	if ('disabled' === state) {
		lines.push(
			'The test healer is switched off in this repository (`TEST_HEALER_ENABLED`), so nothing was checked.',
		);
	} else if ('fork' === state) {
		lines.push(
			"The healer only runs on PRs from branches in this repository: a fork's code cannot be run with the healer's secrets.",
		);
	} else if ('error' === state) {
		lines.push(
			`The healer failed before it could check the failures on ${shortSha}. The healer run below has the details.`,
		);
	} else if ('no-run' === state) {
		lines.push(
			`No Playwright run on ${shortSha} has finished, so there is nothing to heal yet. Wait for the PR checks, then add the label again.`,
		);
	} else if (!verdicts.length) {
		lines.push(
			`The [latest Playwright run](${sourceRunUrl}) on ${shortSha} has no failed tests — nothing to heal.`,
		);
	} else {
		lines.push(
			`Checked the ${verdicts.length} failed test${1 === verdicts.length ? '' : 's'} from the [latest Playwright run](${sourceRunUrl}) on ${shortSha}.`,
			'',
			countLine(verdicts),
			'',
			'| Test | Verdict | Why | Evidence |',
			'| --- | --- | --- | --- |',
			...verdicts.map(
				(verdict) =>
					`| ${escapeCell(code(verdict.testName))} | ${VERDICT_LABELS[verdict.verdict]} | ${escapeCell(whyCell(verdict))} | ${escapeCell(evidenceCell(verdict, { repo, headSha, baseSha, sourceRunUrl }))} |`,
			),
		);

		if (fixPrUrl) {
			lines.push(
				'',
				`🩹 **Flaky fixes:** ${fixPrUrl} — opened against \`main\`, not this branch. It goes through normal review.`,
			);
		}

		if (verdicts.some((verdict) => VERDICTS.BROKEN === verdict.verdict)) {
			lines.push(
				'',
				'Tests marked broken by this PR were not re-run or changed. Fix the PR, or the test if the change to the product is intended.',
			);
		}
	}

	lines.push('', footer);
	return lines.join('\n');
}

const FIX_PR_TITLE_MAX_LENGTH = 100;

function buildFixPrTitle({ prNumber, jiraKey }) {
	const title = `Internal: Fix flaky Playwright tests found on PR ${prNumber} [${jiraKey}]`;
	return title.slice(0, FIX_PR_TITLE_MAX_LENGTH);
}

function buildFixPrBody({
	fixes,
	prUrl,
	sourceRunUrl,
	healerRunUrl,
	verifyRepeat,
	jiraUrl,
}) {
	const safe = (text) => String(text || '').replace(/~~~/g, '~ ~ ~');

	return [
		`Automated fixes for Playwright tests that failed on ${prUrl} and passed when re-run with no change, so they were flaky rather than broken by that PR.`,
		'',
		'| | |',
		'| --- | --- |',
		`| Jira | ${jiraUrl} |`,
		`| Found on | ${prUrl} |`,
		`| Evidence run | ${sourceRunUrl} |`,
		`| Healer run | ${healerRunUrl} |`,
		'',
		`Each fix was verified on its own against a fresh build of \`main\`: the test passed ${verifyRepeat}x in a row with it. They were not run together. The diff is gated to \`tests/playwright/\` with no snapshot-baseline or environment changes.`,
		'',
		...fixes.flatMap((fix) => [
			`### ${code(fix.testName)}`,
			testMarker(fix.testName),
			'',
			'~~~text',
			safe(fix.resultText) || '(no agent summary)',
			'~~~',
			'',
		]),
	].join('\n');
}

function buildSlackPayload({ repo, prNumber, prUrl, fixPrUrl, fixes }) {
	const tests = fixes.map((fix) => `• \`${fix.testName}\``).join('\n');
	const text = `🩹 Flaky test fixes from <${prUrl}|${repo}#${prNumber}>: <${fixPrUrl}|review the fix PR>`;

	return {
		text,
		blocks: [
			{ type: 'section', text: { type: 'mrkdwn', text } },
			{
				type: 'section',
				text: { type: 'mrkdwn', text: `Tests it covers:\n${tests}` },
			},
		],
	};
}

const HANDOFF_NOTES = {
	'baseline-drift':
		'Not fixed: the agent found the screenshot differs for a real reason (baseline drift), which needs a versioned baseline.',
	'product-bug':
		'Not fixed: the agent found what looks like a product bug, not a flaky test.',
};

/**
 * Why a flaky test's fix did or did not make it into the fix PR, from the
 * agent's and the verification's records.
 */
function describeFixOutcome({ agent, verify, verifyRepeat }) {
	if ('true' === String(verify?.passed)) {
		return { status: 'verified' };
	}

	if (!agent) {
		return {
			status: 'not-fixed',
			note: 'Not fixed: the agent did not report back.',
		};
	}

	if (agent.handoff) {
		return {
			status: 'not-fixed',
			note:
				HANDOFF_NOTES[agent.handoff] ||
				`Not fixed: the agent handed it off (${agent.handoff}).`,
		};
	}

	if (!agent.branch) {
		return {
			status: 'not-fixed',
			note: `Not fixed: the agent pushed no fix (${String(agent.status || 'no status').toLowerCase()}).`,
		};
	}

	if (!verify) {
		return {
			status: 'not-fixed',
			note: `Not fixed: the fix on \`${agent.branch}\` could not be verified.`,
		};
	}

	if ('scope' === verify.stage) {
		return {
			status: 'not-fixed',
			note: `Not fixed: the agent's fix on \`${agent.branch}\` changes files the healer may not touch.`,
		};
	}

	if ('test' === verify.stage) {
		return {
			status: 'not-fixed',
			note: `Not fixed: the agent's fix on \`${agent.branch}\` did not pass ${verifyRepeat} runs in a row on main.`,
		};
	}

	return {
		status: 'not-fixed',
		note: `Not fixed: verifying \`${agent.branch}\` failed at the ${verify.stage || 'unknown'} stage, before the test ran.`,
	};
}

function readJson(file, fallback) {
	if (!file || !fs.existsSync(file)) {
		return fallback;
	}
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Reads what every job left in the data directory and writes the comment.
 * A file missing because its job never ran or crashed is read as empty; the
 * job results in the environment say which it was.
 */
function reportMain(env) {
	const dir = env.HEALER_DATA_DIR;
	const data = (name, fallback = []) =>
		readJson(dir ? `${dir}/${name}` : '', fallback);
	const state = env.HEALER_STATE;
	const fixes = [...data('fix-skips.json'), ...data('fixes.json')];

	const verdicts =
		'ok' === state
			? resolvePrVerdicts({
					triage: data('pr-triage.json'),
					prRerun: data('pr-rerun.json', null),
					mainRerun: data('main-rerun.json', null),
					fixes,
					overLimit: JSON.parse(env.OVER_LIMIT || '[]'),
					rerunLimit: Number(env.RERUN_LIMIT) || 0,
					prRerunFailed: 'success' !== env.PR_RERUN_RESULT,
					mainRerunFailed: 'success' !== env.MAIN_RERUN_RESULT,
				})
			: [];

	const comment = buildPrComment({
		state,
		verdicts,
		repo: env.GITHUB_REPOSITORY,
		headSha: env.PR_HEAD_SHA,
		baseSha: env.PR_BASE_SHA,
		sourceRunUrl: env.SOURCE_RUN_URL,
		healerRunUrl: env.HEALER_RUN_URL,
		fixPrUrl: env.FIX_PR_URL,
		label: env.HEAL_LABEL,
	});

	fs.writeFileSync(env.COMMENT_PATH, comment);

	const fixed = fixes.filter((fix) => 'fixed' === fix.status);
	if (env.FIX_PR_URL && fixed.length && env.SLACK_PAYLOAD_PATH) {
		fs.writeFileSync(
			env.SLACK_PAYLOAD_PATH,
			JSON.stringify(
				buildSlackPayload({
					repo: env.GITHUB_REPOSITORY,
					prNumber: env.PR_NUMBER,
					prUrl: env.PR_URL,
					fixPrUrl: env.FIX_PR_URL,
					fixes: fixed,
				}),
			),
		);
		setOutput('has_slack_payload', 'true');
	}

	const counts = verdicts.reduce((all, verdict) => {
		all[verdict.verdict] = (all[verdict.verdict] || 0) + 1;
		return all;
	}, {});
	console.log(
		`State: ${state}; verdicts: ${JSON.stringify(counts)}; fix PR: ${env.FIX_PR_URL || '(none)'}`,
	);
}

function planMain(env) {
	const { toFix, skipped } = planFlakyFixes({
		flakyTests: readJson(env.FLAKY_TESTS_PATH, []),
		openPrs: readJson(env.OPEN_PRS_PATH, []),
		baseRef: 'main',
		maxFixes: Number(env.MAX_FIXES) || 0,
	});

	fs.writeFileSync(env.FIX_SKIPS_PATH, JSON.stringify(skipped, null, 2));
	setOutput('fix_matrix', JSON.stringify(toFix));
	setOutput('has_fixes', String(toFix.length > 0));
}

if (require.main === module) {
	try {
		if ('plan-fixes' === process.argv[2]) {
			planMain(process.env);
		} else if ('report' === process.argv[2]) {
			reportMain(process.env);
		} else {
			throw new Error('Usage: pr-healer-report.js plan-fixes|report');
		}
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	COMMENT_MARKER,
	VERDICTS,
	buildFixPrBody,
	buildFixPrTitle,
	buildPrComment,
	buildSlackPayload,
	describeFixOutcome,
	findExistingFix,
	planFlakyFixes,
	readJson,
	resolvePrVerdicts,
	testMarker,
};
