const { MAX_ATTEMPTS, gh } = require('../scripts/gh');

function commandError(stderr) {
	return Object.assign(new Error('Command failed: gh api'), { stderr });
}

function execFailing(errors, output = 'ok') {
	const calls = [];
	const exec = (...args) => {
		calls.push(args);
		if (calls.length <= errors.length) {
			throw errors[calls.length - 1];
		}
		return output;
	};
	return { exec, calls };
}

const noWait = () => {};

describe('gh', () => {
	it('retries a GitHub server error and returns the output once it succeeds', () => {
		// Arrange
		const { exec, calls } = execFailing([
			commandError('gh: Server Error (HTTP 502)'),
		]);

		// Act
		const output = gh(['api', 'repos/o/r'], { exec, wait: noWait });

		// Assert
		expect(output).toBe('ok');
		expect(calls).toHaveLength(2);
	});

	it('gives up after the last attempt and rethrows the server error', () => {
		// Arrange
		const errors = Array.from({ length: MAX_ATTEMPTS }, () =>
			commandError('gh: Server Error (HTTP 503)'),
		);
		const { exec, calls } = execFailing(errors);

		// Act
		const act = () => gh(['api', 'repos/o/r'], { exec, wait: noWait });

		// Assert
		expect(act).toThrow('Command failed');
		expect(calls).toHaveLength(MAX_ATTEMPTS);
	});

	it('does not retry a client error such as a missing artifact', () => {
		// Arrange
		const { exec, calls } = execFailing([
			commandError('gh: Not Found (HTTP 404)'),
		]);

		// Act
		const act = () => gh(['api', 'repos/o/r'], { exec, wait: noWait });

		// Assert
		expect(act).toThrow('Command failed');
		expect(calls).toHaveLength(1);
	});
});
