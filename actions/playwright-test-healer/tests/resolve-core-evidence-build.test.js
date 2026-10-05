const {
	WP_NIGHTLY_STEP_NAME,
	parsePhpVersion,
	ranOnWordPressNightly,
	resolveCoreEvidenceBuild,
} = require('../scripts/resolve-core-evidence-build');

const RUN_ID = '36544986122';
const CORE_SHA = '9714d3747e1c4b7e7950631f1c90757ab387dbee';

function playwrightJob(nightlyConclusion) {
	return {
		name: 'Playwright Suite / Playwright test - 7 on PHP (8.4)',
		steps: [
			{ name: 'Update PHP version in config', conclusion: 'success' },
			{ name: WP_NIGHTLY_STEP_NAME, conclusion: nightlyConclusion },
		],
	};
}

const JOBS = [
	{ name: 'Calculate PHP Version / calculate-php-version', steps: [] },
	{
		name: 'Playwright test - tagged tests on PHP (${{ needs.get-php-version.outputs.php_version }})',
		steps: [],
	},
	playwrightJob('success'),
];

describe('parsePhpVersion', () => {
	it('reads the PHP version from a Playwright job name inside the suite', () => {
		// Act
		const phpVersion = parsePhpVersion(JOBS);

		// Assert
		expect(phpVersion).toBe('8.4');
	});

	it('ignores skipped jobs whose name was never resolved', () => {
		// Arrange
		const jobs = [JOBS[1]];

		// Act
		const phpVersion = parsePhpVersion(jobs);

		// Assert
		expect(phpVersion).toBe('');
	});
});

describe('ranOnWordPressNightly', () => {
	it('is true when the nightly update step ran', () => {
		// Act & Assert
		expect(ranOnWordPressNightly([playwrightJob('success')])).toBe(true);
	});

	it('is false when the nightly update step was skipped', () => {
		// Act & Assert
		expect(ranOnWordPressNightly([playwrightJob('skipped')])).toBe(false);
		expect(ranOnWordPressNightly([])).toBe(false);
	});
});

describe('resolveCoreEvidenceBuild', () => {
	const run = { head_branch: 'main', head_sha: CORE_SHA };

	it('takes the run head as the build and keeps its environment', () => {
		// Act
		const build = resolveCoreEvidenceBuild({
			runId: RUN_ID,
			run,
			jobs: JOBS,
			coreVersion: '4.4.0',
			requestedBaseRef: '',
		});

		// Assert
		expect(build).toEqual({
			baseRef: 'main',
			coreSha: CORE_SHA,
			coreVersion: '4.4.0',
			phpVersion: '8.4',
			wpNightly: true,
		});
	});

	it('refuses a base_ref other than the branch the run tested', () => {
		// Act & Assert
		expect(() =>
			resolveCoreEvidenceBuild({
				runId: RUN_ID,
				run,
				jobs: JOBS,
				coreVersion: '4.4.0',
				requestedBaseRef: '4.3',
			}),
		).toThrow('Re-run with base_ref=main');
	});

	it('refuses a pull request run, whose branch is not a base to fix', () => {
		// Act & Assert
		expect(() =>
			resolveCoreEvidenceBuild({
				runId: RUN_ID,
				repo: 'elementor/elementor',
				run: {
					...run,
					head_branch: 'feature/x',
					event: 'pull_request',
					head_repository: { full_name: 'someone/elementor' },
				},
				jobs: JOBS,
				coreVersion: '4.4.0',
				requestedBaseRef: '',
			}),
		).toThrow('pull_request run');
	});

	it('refuses a run with no head commit', () => {
		// Act & Assert
		expect(() =>
			resolveCoreEvidenceBuild({
				runId: RUN_ID,
				run: { head_branch: 'main' },
				jobs: JOBS,
				coreVersion: '4.4.0',
				requestedBaseRef: '',
			}),
		).toThrow('no head branch or commit');
	});

	it('refuses a run whose Core version could not be read', () => {
		// Act & Assert
		expect(() =>
			resolveCoreEvidenceBuild({
				runId: RUN_ID,
				run,
				jobs: JOBS,
				coreVersion: '',
				requestedBaseRef: '',
			}),
		).toThrow('Could not read the Core version');
	});
});
