const fs = require('fs');
const os = require('os');
const path = require('path');

const { formatOutput, setOutput } = require('../scripts/github-output');

function parseOutputs(text) {
	const outputs = {};
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^([^<]+)<<(.+)$/);
		if (!match) {
			continue;
		}
		const [, name, delimiter] = match;
		const end = lines.indexOf(delimiter, i + 1);
		outputs[name] = lines.slice(i + 1, end).join('\n');
		i = end;
	}
	return outputs;
}

describe('formatOutput', () => {
	it('wraps the value in the delimiter', () => {
		expect(formatOutput('branch', 'fix/x', 'D')).toBe(
			'branch<<D\nfix/x\nD\n',
		);
	});

	it('writes an empty string for null and undefined', () => {
		expect(formatOutput('x', undefined, 'D')).toBe('x<<D\n\nD\n');
		expect(formatOutput('x', null, 'D')).toBe('x<<D\n\nD\n');
	});

	it('refuses a value that contains the delimiter', () => {
		expect(() => formatOutput('x', 'a\nD\nb', 'D')).toThrow(/delimiter/);
	});
});

describe('setOutput', () => {
	let dir;
	let outputFile;
	let original;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-output-'));
		outputFile = path.join(dir, 'output');
		fs.writeFileSync(outputFile, '');
		original = process.env.GITHUB_OUTPUT;
		process.env.GITHUB_OUTPUT = outputFile;
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.GITHUB_OUTPUT;
		} else {
			process.env.GITHUB_OUTPUT = original;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('keeps a newline in a value from forging another output', () => {
		setOutput('branch', 'fix/x\npassed=true');
		setOutput('status', 'FINISHED');

		expect(parseOutputs(fs.readFileSync(outputFile, 'utf8'))).toEqual({
			branch: 'fix/x\npassed=true',
			status: 'FINISHED',
		});
	});
});
