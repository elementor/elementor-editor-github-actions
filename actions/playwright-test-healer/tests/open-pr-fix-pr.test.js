const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	mergeVerifiedFixes,
	readOutcomes,
} = require('../scripts/open-pr-fix-pr');

const SHA = 'a'.repeat(40);
const BRANCH = 'heal/pr-7-a-test-99-0';

function verified(overrides = {}) {
	return {
		testName: 'A test',
		branch: BRANCH,
		verifiedSha: SHA,
		status: 'verified',
		...overrides,
	};
}

function merge(outcome, overrides = {}) {
	const calls = [];
	const [result] = mergeVerifiedFixes([outcome], {
		combinedBranch: 'heal/pr-7-99',
		targetRef: 'release/4.0',
		runGit: (args) => calls.push(args.join(' ')),
		getRemoteHead: () => SHA,
		fetch: () => SHA,
		scopeCheck: () => {},
		...overrides,
	});

	return { result, calls };
}

describe('readOutcomes', () => {
	let dataDir;

	function write(name, data) {
		fs.writeFileSync(path.join(dataDir, name), JSON.stringify(data));
	}

	function read() {
		return readOutcomes({
			matrix: [{ testName: 'A test', index: 0, branch: BRANCH }],
			dataDir,
			verifyRepeat: 10,
		})[0];
	}

	beforeEach(() => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-fix-'));
	});

	afterEach(() => {
		fs.rmSync(dataDir, { recursive: true, force: true });
	});

	it('keeps a fix whose records match the plan', () => {
		// Arrange
		write('agent-0.json', { branch: BRANCH });
		write('verify-0.json', { branch: BRANCH, sha: SHA, passed: 'true' });

		// Assert
		expect(read()).toMatchObject({ status: 'verified', branch: BRANCH });
	});

	it.each([
		['agent', { branch: 'unprotected' }, { branch: BRANCH, sha: SHA }],
		['verify', { branch: BRANCH }, { branch: 'unprotected', sha: SHA }],
		['SHA', { branch: BRANCH }, { branch: BRANCH, sha: '--upload-pack=x' }],
	])(
		'rejects a forged %s record, and never carries its branch',
		(_, agent, verify) => {
			// Arrange
			write('agent-0.json', agent);
			write('verify-0.json', { ...verify, passed: 'true' });

			// Act
			const outcome = read();

			// Assert
			expect(outcome.status).toBe('not-fixed');
			expect(outcome.branch).toBe(BRANCH);
		},
	);
});

describe('mergeVerifiedFixes', () => {
	it('starts from the target branch and merges the verified commit', () => {
		// Act
		const { result, calls } = merge(verified());

		// Assert
		expect(result.status).toBe('merged');
		expect(calls).toContain('checkout -B heal/pr-7-99 origin/release/4.0');
		expect(calls).toContain(`merge --no-ff --no-edit ${SHA}`);
	});

	it('leaves out a branch that moved after it was verified', () => {
		// Act
		const { result, calls } = merge(verified(), {
			getRemoteHead: () => 'b'.repeat(40),
		});

		// Assert
		expect(result.status).toBe('not-fixed');
		expect(result.note).toContain('moved after it was verified');
		expect(calls.join()).not.toContain('merge');
	});

	it('leaves out a fetch that does not return the verified commit', () => {
		// Act
		const { result, calls } = merge(verified(), {
			fetch: () => 'b'.repeat(40),
		});

		// Assert
		expect(result.status).toBe('not-fixed');
		expect(result.note).toContain('did not return the verified commit');
		expect(calls.join()).not.toContain('merge');
	});

	it('leaves out a fix that fails the scope check on the target', () => {
		// Act
		const { result, calls } = merge(verified(), {
			scopeCheck: (ref) => {
				expect(ref).toBe('release/4.0');
				throw new Error('out of scope');
			},
		});

		// Assert
		expect(result.note).toContain('may not touch');
		expect(calls.at(-1)).toBe('checkout --quiet heal/pr-7-99');
		expect(calls.join()).not.toContain('merge');
	});

	it('aborts a conflicting merge and reports that fix', () => {
		// Arrange
		const calls = [];

		// Act
		const { result } = merge(verified(), {
			runGit: (args) => {
				calls.push(args.join(' '));
				if ('merge' === args[0] && '--abort' !== args[1]) {
					throw new Error('conflict');
				}
			},
		});

		// Assert
		expect(result.note).toContain('conflicts with another fix');
		expect(calls.at(-1)).toBe('merge --abort');
	});

	it('does not touch a fix that was not verified', () => {
		// Arrange
		const outcome = verified({ status: 'not-fixed', note: 'No.' });

		// Act
		const { result } = merge(outcome, {
			getRemoteHead: () => {
				throw new Error('should not be asked');
			},
		});

		// Assert
		expect(result).toEqual(outcome);
	});
});
