'use strict';

const fs = require('fs');
const { buildJiraIssuePayload } = require('./build-jira-heal-ticket');

const {
	JIRA_API_EMAIL,
	JIRA_API_TOKEN,
	JIRA_SITE_URL,
	HEAL_TEST_NAME,
	HEAL_RUN_URL,
	HEAL_VERIFICATION_RUN_URL,
	HEAL_BRANCH,
	JIRA_PARENT_KEY,
	JIRA_HEALER_ASSIGNEE_EMAIL,
} = process.env;

const JIRA_ISSUE_CREATED_STATUS = 201;
const DEFAULT_JIRA_SITE_URL = 'https://elementor.atlassian.net';
const RESPONSE_PREVIEW_LIMIT = 300;

function setOutput(name, value) {
	if (!process.env.GITHUB_OUTPUT) {
		return;
	}
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function previewBody(text) {
	return String(text || '')
		.replace(/\s+/g, ' ')
		.slice(0, RESPONSE_PREVIEW_LIMIT);
}

async function readHttpBody(response) {
	const raw = await response.text();
	if (!raw) {
		return { json: null, raw: '' };
	}
	try {
		return { json: JSON.parse(raw), raw };
	} catch {
		return { json: null, raw };
	}
}

function formatHttpError(action, response, raw) {
	return `${action} failed: HTTP ${response.status}: ${previewBody(raw)}`;
}

function normalizeBaseUrl(url) {
	return String(url || '')
		.trim()
		.replace(/\/+$/, '')
		.toLowerCase();
}

function resolveJiraSiteUrl(siteUrl) {
	return normalizeBaseUrl(siteUrl || DEFAULT_JIRA_SITE_URL);
}

function buildBasicAuthHeader(email, apiToken) {
	return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

function jsonHeaders(authorization) {
	return {
		Accept: 'application/json',
		Authorization: authorization,
		'Content-Type': 'application/json',
	};
}

async function findAssigneeAccountId(authorization, restBase, email) {
	if (!email) {
		return null;
	}

	const response = await fetch(
		`${restBase}/rest/api/3/user/search?query=${encodeURIComponent(email)}`,
		{
			headers: {
				Accept: 'application/json',
				Authorization: authorization,
			},
		},
	);

	const { json, raw } = await readHttpBody(response);

	if (!response.ok) {
		console.warn(
			`::warning::${formatHttpError('Jira user search', response, raw)}; creating ticket unassigned.`,
		);
		return null;
	}

	return json?.[0]?.accountId ?? null;
}

async function createJiraIssue(authorization, restBase, payload) {
	const response = await fetch(`${restBase}/rest/api/3/issue`, {
		method: 'POST',
		headers: jsonHeaders(authorization),
		body: JSON.stringify(payload),
	});

	const { json, raw } = await readHttpBody(response);

	if (response.status !== JIRA_ISSUE_CREATED_STATUS) {
		throw new Error(formatHttpError('Jira ticket creation', response, raw));
	}

	if (!json?.key) {
		throw new Error(
			`Jira ticket creation returned no issue key: ${previewBody(raw)}`,
		);
	}

	return json;
}

async function main() {
	if (!JIRA_API_EMAIL || !JIRA_API_TOKEN) {
		throw new Error('JIRA_API_EMAIL and JIRA_API_TOKEN are required.');
	}
	if (!HEAL_TEST_NAME || !HEAL_RUN_URL) {
		throw new Error('HEAL_TEST_NAME and HEAL_RUN_URL are required.');
	}

	const restBase = resolveJiraSiteUrl(JIRA_SITE_URL);
	const authorization = buildBasicAuthHeader(JIRA_API_EMAIL, JIRA_API_TOKEN);
	const payload = buildJiraIssuePayload({
		testName: HEAL_TEST_NAME,
		runUrl: HEAL_RUN_URL,
		verificationRunUrl: HEAL_VERIFICATION_RUN_URL,
		branch: HEAL_BRANCH,
		parentKey: JIRA_PARENT_KEY,
	});

	const accountId = await findAssigneeAccountId(
		authorization,
		restBase,
		JIRA_HEALER_ASSIGNEE_EMAIL,
	);
	if (accountId) {
		payload.fields.assignee = { accountId };
	}

	const body = await createJiraIssue(authorization, restBase, payload);

	console.log(`Created Jira ticket: ${body.key}`);
	setOutput('jira_key', body.key);
	setOutput('jira_url', `${restBase}/browse/${body.key}`);
}

if (require.main === module) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}

module.exports = {
	buildBasicAuthHeader,
	formatHttpError,
	normalizeBaseUrl,
	previewBody,
	readHttpBody,
	resolveJiraSiteUrl,
};
