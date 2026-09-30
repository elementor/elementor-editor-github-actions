const {
	parseBuildVersions,
	parseCoreClone,
	parseProCommit,
	parseReusableWorkflowInputs,
	releaseLine,
	resolveEvidenceBuilds,
} = require('../scripts/resolve-evidence-builds');

const RUN_ID = '36377505644';
const PRO_SHA = 'f9f4e90603e02b7e9b9d48bfef2af04bd5f87917';
const CORE_SHA = '0123456789abcdef0123456789abcdef01234567';

function buildLog({
	coreBranch = 'release/beta',
	coreReleaseTag = '',
	proBranch = '4.02',
	artifact = 'elementor-pro-4.2.0-core-4.3.0',
	proCheckout = true,
	coreClone = true,
	coreCommit = '',
} = {}) {
	return [
		'2026-09-28T04:23:45.4923246Z Commit: abac92662cab4cc7352de4f9f9d2e2419aad9c29',
		'2026-09-28T04:23:49.2557814Z Uses: elementor/elementor-pro/.github/workflows/playwright-custom-core-suite.yml@refs/heads/main (9bffd0b)',
		'2026-09-28T04:23:49.2562603Z ##[group] Inputs',
		'2026-09-28T04:23:49.2562900Z   build_artifact_name: ',
		`2026-09-28T04:23:49.2563154Z   core_branch: ${coreBranch}`,
		`2026-09-28T04:23:49.2563392Z   core_release_tag: ${coreReleaseTag}`,
		`2026-09-28T04:23:49.2563613Z   pro_branch: ${proBranch}`,
		'2026-09-28T04:23:49.2563830Z   hello_theme_branch: main',
		'2026-09-28T04:23:49.2564100Z ##[endgroup]',
		...(proCheckout
			? [
					'2026-09-28T04:23:52.3425121Z [command]/usr/bin/git log -1 --format=%H',
					`2026-09-28T04:23:52.3455580Z ${PRO_SHA}`,
				]
			: []),
		...(coreClone
			? [
					'2026-09-28T04:24:04.9316027Z Cloning ELEMENTOR_CORE_BRANCH: release/beta',
					"2026-09-28T04:24:04.9327609Z Cloning into '../elementor'...",
				]
			: []),
		...(coreCommit
			? [`2026-09-28T04:24:21.1000000Z Core commit: ${coreCommit}`]
			: []),
		'2026-09-28T04:30:55.7105883Z   PRO_PACKAGE_VERSION: 4.2.0',
		...(artifact
			? [`2026-09-28T04:31:10.1000000Z   name: ${artifact}`]
			: []),
		'2026-09-28T04:31:12.1000000Z   name: elementor-core-build',
	].join('\n');
}

describe('parseReusableWorkflowInputs', () => {
	it('reads the inputs group the reusable workflow echoes into its log', () => {
		// Act
		const inputs = parseReusableWorkflowInputs(buildLog());

		// Assert
		expect(inputs).toEqual({
			build_artifact_name: '',
			core_branch: 'release/beta',
			core_release_tag: '',
			pro_branch: '4.02',
			hello_theme_branch: 'main',
		});
	});

	it('returns nothing for a log without an inputs group', () => {
		expect(
			parseReusableWorkflowInputs(
				'2026-09-28T04:23:49Z   core_branch: main',
			),
		).toEqual({});
	});
});

describe('parseBuildVersions', () => {
	it('reads the Pro and Core versions from the uploaded build artifact name', () => {
		expect(parseBuildVersions(buildLog())).toEqual({
			proVersion: '4.2.0',
			coreVersion: '4.3.0',
		});
	});

	it('returns empty versions when no build artifact was uploaded', () => {
		expect(parseBuildVersions(buildLog({ artifact: '' }))).toEqual({
			proVersion: '',
			coreVersion: '',
		});
	});
});

describe('parseProCommit', () => {
	it('reads the commit actions/checkout resolved', () => {
		expect(parseProCommit(buildLog())).toBe(PRO_SHA);
	});

	it('returns nothing when no checkout was logged', () => {
		expect(parseProCommit(buildLog({ proCheckout: false }))).toBe('');
	});
});

describe('parseCoreClone', () => {
	it('reads the cloned branch and when the clone started, to the second', () => {
		expect(parseCoreClone(buildLog())).toEqual({
			branch: 'release/beta',
			clonedAt: '2026-09-28T04:24:04Z',
			commit: '',
		});
	});

	it('reads the Core commit newer clone-core.sh copies log', () => {
		expect(parseCoreClone(buildLog({ coreCommit: CORE_SHA })).commit).toBe(
			CORE_SHA,
		);
	});
});

describe('releaseLine', () => {
	it('keeps only major.minor, so a nightly suffix or patch bump still matches', () => {
		expect(releaseLine('4.4.0-latest-1790598751')).toBe('4.4');
		expect(releaseLine('4.3.2')).toBe('4.3');
		expect(releaseLine('')).toBe('');
	});
});

describe('resolveEvidenceBuilds', () => {
	it('takes the Pro branch and Core source the run tested, not the branch it ran on', () => {
		// Act
		const builds = resolveEvidenceBuilds({
			runId: RUN_ID,
			buildLog: buildLog(),
			headBranch: 'main',
			requestedBaseRef: '',
		});

		// Assert
		expect(builds).toEqual({
			baseRef: '4.02',
			proSha: PRO_SHA,
			coreBranch: 'release/beta',
			coreReleaseTag: '',
			coreSha: '',
			coreCloneBranch: 'release/beta',
			coreClonedAt: '2026-09-28T04:24:04Z',
			proVersion: '4.2.0',
			coreVersion: '4.3.0',
		});
	});

	it('uses the Core commit when clone-core.sh logged it', () => {
		// Act
		const builds = resolveEvidenceBuilds({
			runId: RUN_ID,
			buildLog: buildLog({ coreCommit: CORE_SHA }),
			headBranch: 'main',
			requestedBaseRef: '',
		});

		// Assert
		expect(builds.coreSha).toBe(CORE_SHA);
	});

	it('still reads the Core clone for a Core release run, because Pro was built against it', () => {
		// Act
		const builds = resolveEvidenceBuilds({
			runId: RUN_ID,
			buildLog: buildLog({
				coreReleaseTag: '4.3.0',
				coreCommit: CORE_SHA,
			}),
			headBranch: 'main',
			requestedBaseRef: '',
		});

		// Assert
		expect(builds.coreReleaseTag).toBe('4.3.0');
		expect(builds.coreSha).toBe(CORE_SHA);
	});

	it('refuses a run whose Pro commit is unknown', () => {
		expect(() =>
			resolveEvidenceBuilds({
				runId: RUN_ID,
				buildLog: buildLog({ proCheckout: false }),
				headBranch: 'main',
				requestedBaseRef: '',
			}),
		).toThrow(/Could not tell which Pro commit/);
	});

	it('refuses a run whose Core clone commit and clone time are both unknown', () => {
		expect(() =>
			resolveEvidenceBuilds({
				runId: RUN_ID,
				buildLog: buildLog({ coreClone: false }),
				headBranch: 'main',
				requestedBaseRef: '',
			}),
		).toThrow(/Could not tell which Core commit/);
	});

	it('falls back to the run branch when no Pro branch was given', () => {
		// Act
		const builds = resolveEvidenceBuilds({
			runId: RUN_ID,
			buildLog: buildLog({ proBranch: '' }),
			headBranch: 'main',
			requestedBaseRef: '',
		});

		// Assert
		expect(builds.baseRef).toBe('main');
	});

	it('prefers a Core release tag over a Core branch, as the suite does', () => {
		// Act
		const builds = resolveEvidenceBuilds({
			runId: RUN_ID,
			buildLog: buildLog({ coreBranch: 'main', coreReleaseTag: '4.3.0' }),
			headBranch: 'main',
			requestedBaseRef: '',
		});

		// Assert
		expect(builds.coreReleaseTag).toBe('4.3.0');
		expect(builds.coreBranch).toBe('');
	});

	it('refuses a base_ref other than the Pro branch that failed', () => {
		expect(() =>
			resolveEvidenceBuilds({
				runId: RUN_ID,
				buildLog: buildLog(),
				headBranch: 'main',
				requestedBaseRef: 'main',
			}),
		).toThrow(/tested Pro from "4\.02", but base_ref is "main"/);
	});

	it('refuses a run whose Core source is unknown', () => {
		expect(() =>
			resolveEvidenceBuilds({
				runId: RUN_ID,
				buildLog: buildLog({ coreBranch: '' }),
				headBranch: 'main',
				requestedBaseRef: '',
			}),
		).toThrow(/Could not tell which Core/);
	});

	it('refuses a run whose versions are unknown', () => {
		expect(() =>
			resolveEvidenceBuilds({
				runId: RUN_ID,
				buildLog: buildLog({ artifact: '' }),
				headBranch: 'main',
				requestedBaseRef: '',
			}),
		).toThrow(/Could not tell which Pro and Core versions/);
	});
});
