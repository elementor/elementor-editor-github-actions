const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '../scripts/unpack-healer-build.sh');

describe('unpack-healer-build.sh', () => {
	let source;
	let workspace;
	let archive;

	function pack(...entries) {
		const result = spawnSync('tar', ['-czf', archive, ...entries], {
			cwd: source,
		});
		expect(result.status).toBe(0);
	}

	function unpack(product) {
		return spawnSync('bash', [SCRIPT, archive, product], {
			cwd: workspace,
			env: { ...process.env, RUNNER_TEMP: os.tmpdir() },
			encoding: 'utf8',
		});
	}

	beforeEach(() => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unpack-'));
		source = path.join(root, 'source');
		workspace = path.join(root, 'workspace');
		archive = path.join(root, 'build.tgz');
		fs.mkdirSync(path.join(source, 'build'), { recursive: true });
		fs.mkdirSync(workspace);
		fs.writeFileSync(path.join(source, 'build', 'elementor.php'), 'ok');
		fs.writeFileSync(path.join(source, 'package.json'), 'forged');
	});

	afterEach(() => {
		fs.rmSync(path.dirname(source), { recursive: true, force: true });
	});

	it('unpacks the paths a build holds into the workspace', () => {
		// Arrange
		pack('build');

		// Act
		const result = unpack('core');

		// Assert
		expect(result.status).toBe(0);
		expect(
			fs.readFileSync(
				path.join(workspace, 'build/elementor.php'),
				'utf8',
			),
		).toBe('ok');
	});

	it('refuses an archive with any other path, and unpacks nothing', () => {
		// Arrange
		pack('build', 'package.json');

		// Act
		const result = unpack('core');

		// Assert
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('paths a healer build never has');
		expect(fs.readdirSync(workspace)).toEqual([]);
	});

	it('refuses an unknown product', () => {
		// Arrange
		pack('build');

		// Assert
		expect(unpack('other').status).toBe(1);
	});
});
