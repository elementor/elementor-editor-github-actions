const {
	BUILD_SOURCE_EVIDENCE,
	BUILD_SOURCE_FRESH,
	CORE_BUILD_ARTIFACT_NAME,
	planBuildRestore,
} = require('../scripts/restore-nightly-playwright-builds');

describe('planBuildRestore', () => {
	it('restores Core, Pro, and Hello from the evidence run when all are present', () => {
		// Arrange
		const artifacts = [
			{ name: 'allure-report', expired: false },
			{ name: 'playwright-test-results-1', expired: false },
			{ name: CORE_BUILD_ARTIFACT_NAME, expired: false },
			{ name: 'elementor-pro-3.35.0-core-3.35.0', expired: false },
			{ name: 'hello-elementor.3.4.4', expired: false },
		];

		// Act
		const result = planBuildRestore(artifacts);

		// Assert
		expect(result).toEqual({
			source: BUILD_SOURCE_EVIDENCE,
			missing: [],
			coreArtifactName: CORE_BUILD_ARTIFACT_NAME,
			proArtifactName: 'elementor-pro-3.35.0-core-3.35.0',
			helloArtifactName: 'hello-elementor.3.4.4',
		});
	});

	it('still restores from the evidence run when only Hello is missing', () => {
		// Arrange
		const artifacts = [
			{ name: CORE_BUILD_ARTIFACT_NAME, expired: false },
			{ name: 'elementor-pro-3.35.0-core-3.35.0', expired: false },
		];

		// Act
		const result = planBuildRestore(artifacts);

		// Assert
		expect(result.source).toBe(BUILD_SOURCE_EVIDENCE);
		expect(result.helloArtifactName).toBe('');
	});

	it("keeps the run's Pro and Hello and rebuilds only Core when the run uploaded no Core", () => {
		// Arrange
		const artifacts = [
			{ name: 'elementor-pro-4.4.0-core-4.4.0', expired: false },
			{ name: 'hello-elementor.3.5.1', expired: false },
		];

		// Act
		const result = planBuildRestore(artifacts);

		// Assert
		expect(result).toEqual({
			source: BUILD_SOURCE_FRESH,
			missing: [CORE_BUILD_ARTIFACT_NAME],
			coreArtifactName: '',
			proArtifactName: 'elementor-pro-4.4.0-core-4.4.0',
			helloArtifactName: 'hello-elementor.3.5.1',
		});
	});

	it('treats expired build artifacts as missing', () => {
		// Arrange
		const artifacts = [
			{ name: CORE_BUILD_ARTIFACT_NAME, expired: true },
			{ name: 'elementor-pro-4.4.0-core-4.4.0', expired: true },
		];

		// Act
		const result = planBuildRestore(artifacts);

		// Assert
		expect(result).toEqual({
			source: BUILD_SOURCE_FRESH,
			missing: [CORE_BUILD_ARTIFACT_NAME, 'elementor-pro-*'],
			coreArtifactName: '',
			proArtifactName: '',
			helloArtifactName: '',
		});
	});
});
