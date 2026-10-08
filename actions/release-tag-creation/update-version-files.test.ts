import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

let testDir: string;
let originalCwd: string;
let originalEnv: NodeJS.ProcessEnv;

function mockFetchResponse(body: string, status = HTTP_OK) {
	const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

beforeEach(() => {
	vi.resetModules();
	testDir = mkdtempSync(join(tmpdir(), 'update-version-files-test-'));
	originalCwd = process.cwd();
	originalEnv = { ...process.env };
	process.env = { ...originalEnv };
	process.chdir(testDir);
});

afterEach(() => {
	process.chdir(originalCwd);
	process.env = originalEnv;
	rmSync(testDir, { recursive: true, force: true });
	vi.unstubAllGlobals();
});

describe('run', () => {
	it('patches plugin file for core and writes outputs after file write succeeds', async () => {
		const pluginContent = [
			'<?php',
			'/**',
			' * Version: 4.3.0',
			' */',
			'',
			"define( 'ELEMENTOR_VERSION', '4.3.0' );",
		].join('\n');

		const readmeContent = [
			'Stable tag: 4.2.0',
			'Beta tag: 4.3.0-beta1',
		].join('\n');

		const pluginPath = join(testDir, 'elementor.php');
		const readmePath = join(testDir, 'readme.txt');
		writeFileSync(pluginPath, pluginContent, 'utf8');
		writeFileSync(readmePath, readmeContent, 'utf8');

		const outputFile = join(testDir, 'github_output.txt');
		process.env['INPUT_VERSION'] = '4.4.0';
		process.env['INPUT_CHANNEL'] = 'stable';
		process.env['INPUT_COMPANION_TAG'] = '4.4.0-beta1';
		process.env['INPUT_PLUGIN'] = 'core';
		process.env['GITHUB_OUTPUT'] = outputFile;

		const mockExit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => {}) as never);

		const { run } = await import('./update-version-files.ts');
		await run();

		expect(mockExit).not.toHaveBeenCalled();

		const patchedPhp = readFileSync(pluginPath, 'utf8');
		expect(patchedPhp).toContain("define( 'ELEMENTOR_VERSION', '4.4.0' );");
		expect(patchedPhp).toContain(' * Version: 4.4.0');

		const patchedReadme = readFileSync(readmePath, 'utf8');
		expect(patchedReadme).toContain('Stable tag: 4.4.0');

		const output = readFileSync(outputFile, 'utf8');
		expect(output).toContain('plugin_file=elementor.php\n');
		expect(output).toContain('update_readme=true\n');
		expect(output).toContain('readme_stable_tag=4.4.0\n');
		expect(output).toContain('readme_beta_tag=4.4.0-beta1\n');

		mockExit.mockRestore();
	});

	it('patches plugin file for pro with tested-up-to and writes outputs after file write succeeds', async () => {
		const pluginContent = [
			'<?php',
			'/**',
			' * Version: 4.3.0',
			' * Elementor tested up to: 4.2.0',
			' */',
			'',
			"define( 'ELEMENTOR_PRO_VERSION', '4.3.0' );",
		].join('\n');

		const pluginFilePath = join(testDir, 'elementor-pro.php');
		writeFileSync(pluginFilePath, pluginContent, 'utf8');

		const outputFile = join(testDir, 'github_output.txt');
		process.env['INPUT_VERSION'] = '4.4.0';
		process.env['INPUT_CHANNEL'] = 'beta';
		process.env['INPUT_PLUGIN'] = 'pro';
		process.env['INPUT_GITHUB_TOKEN'] = 'ghp_test123';
		process.env['GITHUB_OUTPUT'] = outputFile;

		mockFetchResponse(
			['<?php', '/**', ' * Version: 4.4.1-beta2', ' */'].join('\n'),
		);

		const mockExit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => {}) as never);

		const { run } = await import('./update-version-files.ts');
		await run();

		expect(mockExit).not.toHaveBeenCalled();

		const patchedPhp = readFileSync(pluginFilePath, 'utf8');
		expect(patchedPhp).toContain(
			"define( 'ELEMENTOR_PRO_VERSION', '4.4.0' );",
		);
		expect(patchedPhp).toContain(' * Version: 4.4.0');
		expect(patchedPhp).toContain(' * Elementor tested up to: 4.4.1');

		const output = readFileSync(outputFile, 'utf8');
		expect(output).toContain('plugin_file=elementor-pro.php\n');
		expect(output).toContain('update_readme=false\n');
		expect(output).toContain('elementor_tested_up_to=4.4.1\n');

		mockExit.mockRestore();
	});

	it('exits with error when fetch fails and does not write outputs', async () => {
		const pluginContent = [
			'<?php',
			'/**',
			' * Version: 4.3.0',
			' * Elementor tested up to: 4.2.0',
			' */',
			'',
			"define( 'ELEMENTOR_PRO_VERSION', '4.3.0' );",
		].join('\n');

		const pluginFilePath = join(testDir, 'elementor-pro.php');
		writeFileSync(pluginFilePath, pluginContent, 'utf8');

		const outputFile = join(testDir, 'github_output.txt');
		process.env['INPUT_VERSION'] = '4.4.0';
		process.env['INPUT_CHANNEL'] = 'beta';
		process.env['INPUT_PLUGIN'] = 'pro';
		process.env['GITHUB_OUTPUT'] = outputFile;

		mockFetchResponse('Not Found', HTTP_NOT_FOUND);

		const mockExit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => {}) as never);
		const mockConsoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		const { run } = await import('./update-version-files.ts');
		await run();

		expect(mockConsoleError).toHaveBeenCalledWith(
			expect.stringContaining('::error::'),
		);
		expect(mockConsoleError).toHaveBeenCalledWith(
			expect.stringContaining('HTTP 404'),
		);
		expect(mockExit).toHaveBeenCalledWith(1);

		const patchedPhp = readFileSync(pluginFilePath, 'utf8');
		expect(patchedPhp).toContain(
			"define( 'ELEMENTOR_PRO_VERSION', '4.3.0' );",
		);
		expect(patchedPhp).not.toContain(
			"define( 'ELEMENTOR_PRO_VERSION', '4.4.0' );",
		);

		const outputExists = (() => {
			try {
				readFileSync(outputFile, 'utf8');
				return true;
			} catch {
				return false;
			}
		})();

		if (outputExists) {
			const output = readFileSync(outputFile, 'utf8');
			expect(output).not.toContain('plugin_file=');
			expect(output).not.toContain('update_readme=');
		}

		mockExit.mockRestore();
		mockConsoleError.mockRestore();
	});

	it('exits with error when patching fails and does not write outputs', async () => {
		const pluginContent = [
			'<?php',
			'/**',
			' * Version: 4.3.0',
			' */',
			'',
			"define( 'UNKNOWN_CONSTANT', '4.3.0' );",
		].join('\n');

		const pluginFilePath = join(testDir, 'elementor.php');
		writeFileSync(pluginFilePath, pluginContent, 'utf8');

		const outputFile = join(testDir, 'github_output.txt');
		process.env['INPUT_VERSION'] = '4.4.0';
		process.env['INPUT_CHANNEL'] = 'stable';
		process.env['INPUT_COMPANION_TAG'] = '4.4.0-beta1';
		process.env['INPUT_PLUGIN'] = 'core';
		process.env['GITHUB_OUTPUT'] = outputFile;

		const mockExit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => {}) as never);
		const mockConsoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		const { run } = await import('./update-version-files.ts');
		await run();

		expect(mockConsoleError).toHaveBeenCalledWith(
			expect.stringContaining('::error::'),
		);
		expect(mockExit).toHaveBeenCalledWith(1);

		const patchedPhp = readFileSync(pluginFilePath, 'utf8');
		expect(patchedPhp).toContain("define( 'UNKNOWN_CONSTANT', '4.3.0' );");

		const outputExists = (() => {
			try {
				readFileSync(outputFile, 'utf8');
				return true;
			} catch {
				return false;
			}
		})();

		if (outputExists) {
			const output = readFileSync(outputFile, 'utf8');
			expect(output).not.toContain('plugin_file=');
			expect(output).not.toContain('update_readme=');
		}

		mockExit.mockRestore();
		mockConsoleError.mockRestore();
	});
});
