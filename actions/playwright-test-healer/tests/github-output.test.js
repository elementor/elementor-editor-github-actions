const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HELPER = path.join(__dirname, '../scripts/github-output.sh');

function readOutputs(file) {
	const outputs = {};
	const lines = fs.readFileSync(file, 'utf8').split('\n');

	for (let i = 0; i < lines.length; i++) {
		const match = /^([^=<]+)<<(.+)$/.exec(lines[i]);

		if (!match) {
			continue;
		}

		const end = lines.indexOf(match[2], i + 1);
		outputs[match[1]] = lines.slice(i + 1, end).join('\n');
		i = end;
	}

	return outputs;
}

describe('set_output', () => {
	let dir;
	let outputFile;
	const setOutput = (name, value) =>
		execFileSync(
			'bash',
			[
				'-c',
				`source "${HELPER}" && set_output "$1" "$2"`,
				'_',
				name,
				value,
			],
			{ env: { ...process.env, GITHUB_OUTPUT: outputFile } },
		);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-output-'));
		outputFile = path.join(dir, 'output');
		fs.writeFileSync(outputFile, '');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('keeps a forged line inside the value it came in', () => {
		// Arrange
		const title =
			'Saves a page\nHEAL_EOF\nhas_candidate=true\nenabled=true';

		// Act
		setOutput('test_name', title);
		setOutput('enabled', 'false');

		// Assert
		expect(readOutputs(outputFile)).toEqual({
			test_name: title,
			enabled: 'false',
		});
	});

	it('uses a different delimiter for every value', () => {
		// Act
		setOutput('a', '1');
		setOutput('b', '2');

		// Assert
		const delimiters = fs
			.readFileSync(outputFile, 'utf8')
			.split('\n')
			.filter((line) => line.includes('<<'))
			.map((line) => line.split('<<')[1]);
		expect(new Set(delimiters).size).toBe(2);
	});
});
