'use strict';

const SUMMARY_WORD_LIMIT = 5;
const DEFAULT_PROJECT_KEY = 'ED';

// commitlint's header-max-length-with-cherry-pick, severity 2.
const PR_TITLE_MAX_LENGTH = 100;

const WORD = /[\p{L}\p{N}]/u;
const TRAILING_PUNCTUATION = /[\s\-–—:;,.]+$/u;

/**
 * Separators such as the `-` in `Default styling - Icon Experiment: active`
 * are not words, and a cut that ends on one reads as a broken title.
 */
function firstWords(text, limit) {
	const kept = [];
	let wordCount = 0;

	for (const token of text.trim().split(/\s+/)) {
		if (WORD.test(token)) {
			if (wordCount === limit) {
				break;
			}
			wordCount++;
		}
		kept.push(token);
	}

	return kept.join(' ').replace(TRAILING_PUNCTUATION, '');
}

function buildTicketSummary(testName) {
	return `Internal: Fix flaky test - ${firstWords(testName, SUMMARY_WORD_LIMIT)}`;
}

/**
 * `Internal: Fix flaky test - <=5 words [KEY]`, matching how this repo titles
 * the same change by hand (e.g. #7638). A Playwright title pasted in whole
 * routinely breaks commitlint's 100-character header limit, so the descriptor
 * is truncated and the result is trimmed again if a long key still overflows.
 */
function buildHealPrTitle({ testName, jiraKey }) {
	const suffix = jiraKey ? ` [${jiraKey}]` : '';
	const title = `${buildTicketSummary(testName)}${suffix}`;

	if (title.length <= PR_TITLE_MAX_LENGTH) {
		return title;
	}

	const room = PR_TITLE_MAX_LENGTH - suffix.length - 1;
	return `${title.slice(0, room).trimEnd()}…${suffix}`;
}

function paragraph(text) {
	return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function linkParagraph(label, url) {
	return {
		type: 'paragraph',
		content: [
			{ type: 'text', text: `${label}: ` },
			{
				type: 'text',
				text: url,
				marks: [{ type: 'link', attrs: { href: url } }],
			},
		],
	};
}

function buildJiraIssuePayload({
	testName,
	runUrl,
	verificationRunUrl,
	branch,
	parentKey,
	projectKey = DEFAULT_PROJECT_KEY,
	reproduced = true,
}) {
	const verification = reproduced
		? 'The fix failed without the change and passed repeatedly with it on the builds the failure ran on'
		: 'The failure did not reproduce during verification, so the fix was only shown to pass repeatedly on the builds the failure ran on, not to remove the flake; review it before merging';
	return {
		fields: {
			project: { key: projectKey },
			issuetype: { name: 'Task' },
			...(parentKey ? { parent: { key: parentKey } } : {}),
			summary: buildTicketSummary(testName),
			description: {
				version: 1,
				type: 'doc',
				content: [
					paragraph(
						`The Playwright test healer fixed a flaky test: "${testName}". ${verification}, and a PR referencing this ticket is being opened from branch ${branch || '(unknown)'}.`,
					),
					linkParagraph('Failing run', runUrl),
					...(verificationRunUrl
						? [
								linkParagraph(
									'Verification run',
									verificationRunUrl,
								),
							]
						: []),
				],
			},
		},
	};
}

module.exports = { buildHealPrTitle, buildJiraIssuePayload };
